import { add, div, mul, round, sub } from '../money';
import type { EvaluationComponentName } from '../evaluation/evaluation.types';
import { COMPOSITE_MIN_COMPONENTS, COMPOSITE_MIN_WEIGHT_SUM } from './ranking.constants';

export interface CompositeComponent {
  component: EvaluationComponentName;
  score: number | null;
  weight: number;
  /** Едет тем же массивом: тиру нужно то же нормированное среднее, что и score, а вторая реализация того же алгоритма разъедется с этой за один шаг. */
  dataQuality: number;
}

export interface CompositeResult {
  /** Взвешенное среднее известных компонентов до вычета flagPenalty. null — гейт не пройден. */
  composite: number | null;
  /** Взвешенное качество данных тех же компонентов, посчитано всегда, даже когда composite null. */
  dataQuality: number;
  componentsUsed: EvaluationComponentName[];
  weightSum: number;
  reason: string | null;
}

/**
 * Взвешенное среднее известных компонентов. Отсутствующий компонент не входит
 * ни в числитель, ни в знаменатель веса — не получает ноль.
 */
export function composite(components: CompositeComponent[]): CompositeResult {
  const available = components.filter((item) => item.score !== null);
  const componentsUsed = available.map((item) => item.component);
  const weightSum = round(available.reduce((sum, item) => add(sum, item.weight), 0), 4);
  const dataQuality = weightedQuality(available, weightSum);

  if (available.length < COMPOSITE_MIN_COMPONENTS || weightSum < COMPOSITE_MIN_WEIGHT_SUM) {
    return {
      composite: null,
      dataQuality,
      componentsUsed,
      weightSum,
      reason:
        available.length < COMPOSITE_MIN_COMPONENTS
          ? `Известно компонентов: ${available.length} из минимум ${COMPOSITE_MIN_COMPONENTS}.`
          : `Сумма весов известных компонентов ${weightSum} ниже порога ${COMPOSITE_MIN_WEIGHT_SUM}.`,
    };
  }

  const weighted = available.reduce((sum, item) => add(sum, mul(item.score as number, item.weight)), 0);
  return {
    composite: round(div(weighted, weightSum), 2),
    dataQuality,
    componentsUsed,
    weightSum,
    reason: null,
  };
}

function weightedQuality(available: CompositeComponent[], weightSum: number): number {
  if (available.length === 0 || weightSum === 0) return 0;
  const weighted = available.reduce((sum, item) => add(sum, mul(item.dataQuality, item.weight)), 0);
  return round(div(weighted, weightSum), 3);
}

/** Штраф вычитается из уже нормированного композита и не опускает итог ниже нуля. */
export function applyPenalty(base: number | null, penalty: number): number | null {
  if (base === null) return null;
  return round(Math.max(0, Math.min(100, sub(base, penalty))), 1);
}
