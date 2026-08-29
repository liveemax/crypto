/**
 * Число с происхождением. Без sourceUrl и asOf валидатор его обнуляет: это код,
 * а не договорённость. Метрики создаются только через metric().
 */
export interface Metric {
  value: number | string | null;
  unit: string;
  sourceUrl: string | null;
  asOf: string | null;
  droppedReason?: 'no_source' | 'no_as_of';
  staleDays?: number;
}

/**
 * Результат одного анализа: общая форма для кодовой оценки и будущих LLM-агентов.
 *
 * SnapshotRow, Agent и AgentContext удалены вместе со SnapshotService: это был
 * второй слой тех же чисел, с asOfFees, равным времени запроса. Вход агентов
 * собирается из UniverseView и EvaluationRun и объявляется на шаге 13, когда
 * появится первый настоящий агент.
 */
export interface AgentResult {
  agent: string;
  title: string;
  token: string;
  sector: string | null;
  asOf: string;
  verdict: Record<string, unknown>;
  score: number | null;
  scoreRaw?: number;
  metrics: Record<string, Metric>;
  dataQuality: number;
  missing: string[];
  notes: string;
  validator?: { dropped: string[]; stale: string[] };
  error?: string;
}