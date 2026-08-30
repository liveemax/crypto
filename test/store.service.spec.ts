import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StoreService } from '../src/core/store/store.service';

describe('StoreService', () => {
  let root: string;
  let store: StoreService;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'crypto-store-'));
    store = new StoreService(root, join(root, 'reports'));
  });

  afterEach(async () => rm(root, { recursive: true, force: true }));

  it('обновляет кэш и возвращает последнее значение', async () => {
    await store.cachePut('prices', 'AAVE', { price: 1 });
    await store.cachePut('prices', 'AAVE', { price: 2 });
    await expect(store.cacheGet('prices', 'AAVE')).resolves.toEqual({ price: 2 });
  });

  it('не перезаписывает снапшоты и загружает последний', async () => {
    const first = await store.saveSnapshot('market', [{ ticker: 'AAVE' }]);
    const second = await store.saveSnapshot('market', [{ ticker: 'MORPHO' }]);

    expect(second).not.toBe(first);
    await expect(readFile(first, 'utf8')).resolves.toContain('AAVE');
    await expect(store.loadSnapshot('market')).resolves.toEqual([{ ticker: 'MORPHO' }]);
  });

  it('сохраняет и загружает результат агента', async () => {
    await store.saveResult('screener', 'AAVE', { score: 80 });
    await expect(store.loadResult('screener', 'AAVE')).resolves.toEqual({ score: 80 });
  });

  it('сохраняет markdown-отчёт по runId и читает его обратно как текст', async () => {
    await store.saveReport('rankings', 'rank_2026-08-30T00-00-00-000Z_deep-value', '# Отчёт\n');
    await expect(
      store.loadReport('rankings', 'rank_2026-08-30T00-00-00-000Z_deep-value'),
    ).resolves.toBe('# Отчёт\n');
  });

  it('неизвестный runId отчёта — null, а не исключение', async () => {
    await expect(store.loadReport('rankings', 'not-existing-run')).resolves.toBeNull();
  });

  it('appendJournal пишет заголовок один раз и не дублирует строку на тот же runId', async () => {
    const first = await store.appendJournal('journal', 'run-1', '| run-1 | 5 |', '| id | n |\n|---|---|');
    const second = await store.appendJournal('journal', 'run-1', '| run-1 | 5 |', '| id | n |\n|---|---|');
    const third = await store.appendJournal('journal', 'run-2', '| run-2 | 7 |', '| id | n |\n|---|---|');

    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(third).toBe(true);

    const content = await readFile(join(root, 'reports', 'journal.md'), 'utf8');
    expect(content.match(/run-1/g)).toHaveLength(1);
    expect(content.match(/run-2/g)).toHaveLength(1);
    expect(content.startsWith('| id | n |')).toBe(true);
  });
});
