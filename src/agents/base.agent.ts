import { Injectable } from '@nestjs/common';
import { add, mul, round } from '../core/money';
import { StoreService } from '../core/store/store.service';
import { Agent, AgentContext, AgentResult, SnapshotRow } from '../core/types';
import { ValidateService } from '../core/validate/validate.service';
import { fileKey } from './agent-keys';

/**
 * Каркас агента: проверка входов, вызов логики, валидатор происхождения метрик,
 * множитель качества данных и сохранение результата. Агент пишет только analyze().
 */
@Injectable()
export abstract class BaseAgent implements Agent {
  abstract readonly name: string;
  abstract readonly title: string;
  readonly needsLlm: boolean = false;
  readonly needs: (keyof SnapshotRow)[] = [];

  constructor(
    protected readonly validate: ValidateService,
    protected readonly store: StoreService,
  ) {}

  /** Вся логика агента. Возвращает частичный результат, каркас дополняет остальное. */
  protected abstract analyze(
    token: string,
    row: SnapshotRow,
    ctx: AgentContext,
  ): Promise<Partial<AgentResult>>;

  /** Прогон агента по одному токену. Исключение внутри логики не роняет запрос. */
  async run(token: string, row: SnapshotRow, ctx: AgentContext): Promise<AgentResult> {
    const missingInputs = this.needs.filter((field) => row?.[field] == null).map(String);

    let out: AgentResult = {
      agent: this.name,
      title: this.title,
      // Тикер из данных, а не из пути: 'aave' и 'AAVE' — один токен, и ключ кэша
      // с именем файла обязаны совпасть у обоих написаний.
      token: row?.ticker ?? token,
      sector: row?.sector ?? null,
      asOf: new Date().toISOString(),
      verdict: {},
      score: null,
      metrics: {},
      dataQuality: 0,
      missing: [...missingInputs],
      notes:
        missingInputs.length > 0
          ? `Нет входных данных: ${missingInputs.join(', ')}. Результат частичный.`
          : '',
    };

    try {
      out = mergeResult(out, await this.analyze(token, row, ctx));
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : String(error);
      out.notes = `ОШИБКА агента: ${reason}`;
      out.error = reason;
    }

    out = this.validate.validate(out);

    // Качество данных — множитель балла, а не строчка в отчёте.
    if (out.score !== null && out.dataQuality < 1) {
      out.scoreRaw = out.score;
      out.score = round(mul(out.score, add(0.5, mul(0.5, out.dataQuality))), 1);
    }

    await this.store.saveResult(this.name, fileKey(out.token), out);
    return out;
  }
}

/**
 * Частичный результат дополняет каркас, а не подменяет его. Ключ со значением
 * undefined обнулил бы заполненное поле, а собственный missing агента выбросил бы
 * список недостающих входов — и «неизвестно» стало бы «проверено».
 */
function mergeResult(base: AgentResult, patch: Partial<AgentResult>): AgentResult {
  const merged: AgentResult = { ...base };
  for (const key of Object.keys(patch) as (keyof AgentResult)[]) {
    const value = patch[key];
    if (value === undefined) continue;
    Object.assign(merged, { [key]: value });
  }
  merged.missing = [...new Set([...base.missing, ...(patch.missing ?? [])])];
  merged.notes = [base.notes, patch.notes].filter((text) => Boolean(text)).join(' ');
  return merged;
}