import type { Metric } from '../types';
import { add, mul, round } from '../money';
import { checkMetrics } from '../validate/validate.service';
import type { EvaluationBlock, EvaluationComponentName } from './evaluation.types';

export interface BlockInput {
  verdict: Record<string, unknown>;
  score: number | null;
  metrics: Record<string, Metric>;
  missing?: string[];
  notes: string;
  adjustScoreForQuality?: boolean;
}

/**
 * Общий хвост любого блока: валидатор происхождения, множитель качества данных
 * и отсортированный missing. Множитель тот же, что у агентов, иначе одна и та же
 * дыра в данных стоила бы разного в разных частях отчёта.
 */
export function finishBlock(
  component: EvaluationComponentName,
  title: string,
  input: BlockInput,
): EvaluationBlock {
  const checked = checkMetrics(input.metrics, input.missing ?? []);
  const block: EvaluationBlock = {
    component,
    title,
    verdict: input.verdict,
    score: input.score,
    metrics: checked.metrics,
    dataQuality: checked.dataQuality,
    missing: checked.missing,
    notes: input.notes,
    validator: checked.validator,
  };

  if (input.adjustScoreForQuality !== false && block.score !== null && block.dataQuality < 1) {
    block.scoreRaw = block.score;
    block.score = round(mul(block.score, add(0.5, mul(0.5, block.dataQuality))), 1);
  }
  return block;
}