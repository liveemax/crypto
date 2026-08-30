import { Inject, Injectable, Optional } from '@nestjs/common';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

interface CacheEntry<T> {
  savedAt: string;
  value: T;
}

@Injectable()
export class StoreService {
  constructor(
    @Optional()
    @Inject('STORE_ROOT')
    private readonly root: string = join(process.cwd(), 'data'),
    @Optional()
    @Inject('REPORTS_ROOT')
    private readonly reportsRoot: string = join(process.cwd(), 'reports'),
  ) {}

  /** Возвращает непросроченное значение из файлового кэша. */
  async cacheGet<T>(ns: string, key: string, ttlDays = 1): Promise<T | null> {
    const path = join(this.root, 'cache', this.safe(ns), `${this.safe(key)}.json`);
    try {
      const entry = await this.readJson<CacheEntry<T>>(path);
      const ageMs = Date.now() - Date.parse(entry.savedAt);
      return Number.isFinite(ageMs) && ageMs <= ttlDays * 86_400_000 ? entry.value : null;
    } catch (error: unknown) {
      if (this.isMissing(error)) return null;
      throw error;
    }
  }

  /** Сохраняет значение в файловый кэш и возвращает его без изменений. */
  async cachePut<T>(ns: string, key: string, value: T): Promise<T> {
    const path = join(this.root, 'cache', this.safe(ns), `${this.safe(key)}.json`);
    await this.writeJson(path, { savedAt: new Date().toISOString(), value }, true);
    return value;
  }

  /** Сохраняет неизменённый ответ внешнего источника до обработки. */
  async saveRaw(source: string, name: string, payload: unknown): Promise<string> {
    const date = this.today();
    const dir = join(this.root, 'raw', date, this.safe(source));
    const path = await this.availablePath(dir, this.safe(name));
    await this.writeJson(path, payload);
    return path;
  }

  /** Сохраняет именованный снапшот, не перезаписывая существующие файлы. */
  async saveSnapshot(name: string, rows: unknown): Promise<string> {
    const path = await this.availablePath(join(this.root, 'snapshots'), `${this.today()}_${this.safe(name)}`);
    await this.writeJson(path, rows);
    return path;
  }

  /** Загружает последний снапшот по имени или снапшот за указанную дату. */
  async loadSnapshot<T>(name: string, onDate?: string): Promise<T | null> {
    const prefix = `${onDate ?? ''}${onDate ? '_' : ''}${this.safe(name)}`;
    return this.loadLatest<T>(join(this.root, 'snapshots'), prefix, onDate === undefined);
  }

  /**
   * Сохраняет изменяемое состояние поверх прежнего. В отличие от снапшота у него
   * ровно одна актуальная версия: история включений фильтра — это лог, а не данные.
   */
  async saveState<T>(name: string, value: T): Promise<string> {
    const path = join(this.root, 'state', `${this.safe(name)}.json`);
    await this.writeJson(path, value, true);
    return path;
  }

  /** Читает изменяемое состояние; файла нет — null, а не исключение. */
  async loadState<T>(name: string): Promise<T | null> {
    const path = join(this.root, 'state', `${this.safe(name)}.json`);
    try {
      return await this.readJson<T>(path);
    } catch (error: unknown) {
      if (this.isMissing(error)) return null;
      throw error;
    }
  }

  /**
   * Сохраняет воспроизводимый прогон целиком: каталог даты, имя — runId.
   * Рядом обновляется latest.json — указатель на последний, а не второй
   * источник правды: тысячи per-token файлов нечем сверить между собой.
   */
  async saveRun(kind: string, runId: string, value: unknown): Promise<string> {
    const path = await this.availablePath(
      join(this.root, this.safe(kind), this.today()),
      this.safe(runId),
    );
    await this.writeJson(path, value);
    await this.writeJson(join(this.root, this.safe(kind), 'latest.json'), value, true);
    return path;
  }

  /** Читает последний прогон указанного вида; файла нет — null, а не исключение. */
  async loadRun<T>(kind: string): Promise<T | null> {
    try {
      return await this.readJson<T>(join(this.root, this.safe(kind), 'latest.json'));
    } catch (error: unknown) {
      if (this.isMissing(error)) return null;
      throw error;
    }
  }

  /**
   * Читает произвольный сохранённый прогон по его runId среди всех дат — тот же
   * обход каталогов, что и у loadReport для markdown. Не найден — null, а не
   * исключение: runId из чужого прогона или опечатка не должны падать 500.
   */
  async loadRunById<T>(kind: string, runId: string): Promise<T | null> {
    const dir = join(this.root, this.safe(kind));
    let dates: string[];
    try {
      dates = (await readdir(dir, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
    } catch (error: unknown) {
      if (this.isMissing(error)) return null;
      throw error;
    }
    for (const date of dates) {
      const path = join(dir, date, `${this.safe(runId)}.json`);
      try {
        return await this.readJson<T>(path);
      } catch (error: unknown) {
        if (!this.isMissing(error)) throw error;
      }
    }
    return null;
  }

  /**
   * Сохраняет markdown-отчёт прогона под его runId, а не под датой: два прогона
   * за день получают разные файлы. Каталог reports/ — соседний с data/, вне git.
   */
  async saveReport(kind: string, runId: string, text: string): Promise<string> {
    const dir = join(this.reportsRoot, this.safe(kind), this.today());
    await mkdir(dir, { recursive: true });
    const path = join(dir, `${this.safe(runId)}.md`);
    await writeFile(path, text, { encoding: 'utf8', flag: 'wx' });
    return path;
  }

  /** Читает сохранённый отчёт по runId среди всех дат; не найден — null, а не исключение. */
  async loadReport(kind: string, runId: string): Promise<string | null> {
    const dir = join(this.reportsRoot, this.safe(kind));
    let dates: string[];
    try {
      dates = (await readdir(dir, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
    } catch (error: unknown) {
      if (this.isMissing(error)) return null;
      throw error;
    }
    for (const date of dates) {
      const path = join(dir, date, `${this.safe(runId)}.md`);
      try {
        return await readFile(path, 'utf8');
      } catch (error: unknown) {
        if (!this.isMissing(error)) throw error;
      }
    }
    return null;
  }

  /**
   * Дополняет журнал одной строкой на runId; runId уже есть в файле — no-op.
   * Заголовок пишется только при создании файла, не при каждой записи.
   */
  async appendJournal(name: string, runId: string, line: string, header: string): Promise<boolean> {
    const path = join(this.reportsRoot, `${this.safe(name)}.md`);
    await mkdir(this.reportsRoot, { recursive: true });
    let existing = '';
    try {
      existing = await readFile(path, 'utf8');
    } catch (error: unknown) {
      if (!this.isMissing(error)) throw error;
    }
    if (existing.includes(runId)) return false;
    const prefix = existing.length > 0 ? existing : `${header}\n`;
    await writeFile(path, `${prefix}${line}\n`, 'utf8');
    return true;
  }

  /** Сохраняет результат агента в каталоге текущей даты. */
  async saveResult(agent: string, token: string, result: unknown): Promise<string> {
    const dir = join(this.root, 'results', this.today(), this.safe(agent));
    const path = await this.availablePath(dir, this.safe(token));
    await this.writeJson(path, result);
    return path;
  }

  /** Загружает последний результат агента и токена за дату. */
  async loadResult<T>(agent: string, token: string, onDate = this.today()): Promise<T | null> {
    return this.loadLatest<T>(
      join(this.root, 'results', this.safe(onDate), this.safe(agent)),
      this.safe(token),
      false,
    );
  }

  private async loadLatest<T>(dir: string, prefix: string, anyDate: boolean): Promise<T | null> {
    try {
      const files = (await readdir(dir)).filter((file) => {
        const expected = anyDate ? new RegExp(`^\\d{4}-\\d{2}-\\d{2}_${this.escape(prefix)}(?:_|\\.json)`) : new RegExp(`^${this.escape(prefix)}(?:_|\\.json)`);
        return expected.test(file) && file.endsWith('.json');
      });
      if (files.length === 0) return null;
      const candidates = await Promise.all(files.map(async (file) => ({ file, stats: await stat(join(dir, file)) })));
      candidates.sort((left, right) => right.stats.mtimeMs - left.stats.mtimeMs);
      return this.readJson<T>(join(dir, candidates[0].file));
    } catch (error: unknown) {
      if (this.isMissing(error)) return null;
      throw error;
    }
  }

  private async availablePath(dir: string, name: string): Promise<string> {
    await mkdir(dir, { recursive: true });
    const base = join(dir, `${name}.json`);
    try {
      await stat(base);
    } catch (error: unknown) {
      if (this.isMissing(error)) return base;
      throw error;
    }
    const suffix = new Date().toISOString().replace(/[:.]/g, '-');
    return join(dir, `${name}_${suffix}.json`);
  }

  private async writeJson(path: string, value: unknown, overwrite = false): Promise<void> {
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: 'utf8',
      flag: overwrite ? 'w' : 'wx',
    });
  }

  private async readJson<T>(path: string): Promise<T> {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  }

  private safe(value: string): string {
    if (!/^[a-zA-Z0-9._-]+$/.test(value) || value === '.' || value === '..') {
      throw new Error(`Недопустимое имя файла: ${value}`);
    }
    return value;
  }

  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private isMissing(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
  }

  private escape(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
