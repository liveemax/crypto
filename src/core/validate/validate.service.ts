import { Injectable } from '@nestjs/common';
import { MAX_STALE_DAYS } from '../../config/thresholds';
import { AgentResult, Metric } from '../types';

const DAY_MS = 24 * 60 * 60 * 1_000;

/** Создаёт метрику в едином формате проекта. */
export function metric(
  value: number | string | null,
  sourceUrl: string | null,
  asOf: string | null,
  unit = '',
): Metric {
  return { value, unit, sourceUrl, asOf };
}

export interface MetricsCheck {
  metrics: Record<string, Metric>;
  dataQuality: number;
  missing: string[];
  validator: { dropped: string[]; stale: string[] };
}

/**
 * Проверяет происхождение и актуальность набора метрик. Чистая функция: её же
 * зовут блоки кодовой оценки, у которых Nest-провайдера нет и быть не должно.
 * Вторая реализация этой проверки разъехалась бы с агентами за один шаг.
 */
export function checkMetrics(
  metrics: Record<string, Metric>,
  missingInput: string[] = [],
  maxStaleDays = MAX_STALE_DAYS,
): MetricsCheck {
  const dropped: string[] = [];
  const stale: string[] = [];
  const missing = new Set(missingInput);
  const now = Date.now();

  const checked: Record<string, Metric> = Object.fromEntries(
    Object.entries(metrics).map(([name, original]) => {
      const item: Metric = { ...original };

      if (item.value === null) {
        missing.add(name);
      } else if (!item.sourceUrl) {
        item.value = null;
        item.droppedReason = 'no_source';
        dropped.push(name);
        missing.add(name);
      } else if (!item.asOf) {
        item.value = null;
        item.droppedReason = 'no_as_of';
        dropped.push(name);
        missing.add(name);
      } else {
        const timestamp = Date.parse(item.asOf);
        const staleDays = Math.floor((now - timestamp) / DAY_MS);
        if (Number.isFinite(staleDays) && staleDays > maxStaleDays) {
          item.staleDays = staleDays;
          stale.push(name);
        }
      }

      return [name, item];
    }),
  );

  const values = Object.values(checked);
  const populated = values.filter((item) => item.value !== null).length;
  const completeShare = values.length === 0 ? 0 : populated / values.length;

  return {
    metrics: checked,
    dataQuality: stale.length > 0 ? completeShare * 0.85 : completeShare,
    missing: [...missing].sort(),
    validator: { dropped: dropped.sort(), stale: stale.sort() },
  };
}

@Injectable()
export class ValidateService {
  /** Проверяет происхождение и актуальность всех метрик результата агента. */
  validate(result: AgentResult, maxStaleDays = MAX_STALE_DAYS): AgentResult {
    return { ...result, ...checkMetrics(result.metrics, result.missing, maxStaleDays) };
  }
}