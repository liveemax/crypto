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

@Injectable()
export class ValidateService {
  /** Проверяет происхождение и актуальность всех метрик результата агента. */
  validate(result: AgentResult, maxStaleDays = MAX_STALE_DAYS): AgentResult {
    const dropped: string[] = [];
    const stale: string[] = [];
    const missing = new Set(result.missing);
    const now = Date.now();

    const metrics = Object.fromEntries(
      Object.entries(result.metrics).map(([name, original]) => {
        const checked: Metric = { ...original };

        if (checked.value === null) {
          missing.add(name);
        } else if (!checked.sourceUrl) {
          checked.value = null;
          checked.droppedReason = 'no_source';
          dropped.push(name);
          missing.add(name);
        } else if (!checked.asOf) {
          checked.value = null;
          checked.droppedReason = 'no_as_of';
          dropped.push(name);
          missing.add(name);
        } else {
          const timestamp = Date.parse(checked.asOf);
          const staleDays = Math.floor((now - timestamp) / DAY_MS);
          if (Number.isFinite(staleDays) && staleDays > maxStaleDays) {
            checked.staleDays = staleDays;
            stale.push(name);
          }
        }

        return [name, checked];
      }),
    );

    const metricValues = Object.values(metrics);
    const populated = metricValues.filter((item) => item.value !== null).length;
    const completeShare = metricValues.length === 0 ? 0 : populated / metricValues.length;
    const dataQuality = stale.length > 0 ? completeShare * 0.85 : completeShare;

    return {
      ...result,
      metrics,
      dataQuality,
      missing: [...missing].sort(),
      validator: { dropped: dropped.sort(), stale: stale.sort() },
    };
  }
}
