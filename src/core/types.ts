export interface Metric {
  value: number | string | null;
  unit: string;
  sourceUrl: string | null;
  asOf: string | null;
  droppedReason?: 'no_source' | 'no_as_of';
  staleDays?: number;
}

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

export interface SnapshotRow {
  ticker: string;
  name: string;
  sector: string;
  asOf: string;
  priceUsd: number | null;
  mcapUsd: number | null;
  fdvUsd: number | null;
  vol24hUsd: number | null;
  circulating: number | null;
  totalSupply: number | null;
  revenue1y: number | null;
  revenue30d: number | null;
  tvlUsd: number | null;
  mcapSource: string | null;
  feesSource: string | null;
  tvlSource: string | null;
  errors: string[];
}

export interface AgentContext {
  snapshot: SnapshotRow[];
  docsText?: string;
  docsSources?: string[];
  priorResults?: Record<string, AgentResult>;
  buyback12mUsd?: number;
  incentives12mUsd?: number;
  cashDistrib12mUsd?: number;
  burn12mUsd?: number;
}

export interface Agent {
  readonly name: string;
  readonly title: string;
  readonly needsLlm: boolean;
  readonly needs: (keyof SnapshotRow)[];
  run(token: string, row: SnapshotRow, ctx: AgentContext): Promise<AgentResult>;
}

export interface SnapshotRowExtension {
  /** Капитализация, посчитанная кодом: price × circulating. */
  mcapCalcUsd?: number | null;
  /** Время обновления рыночных данных на стороне CoinGecko. */
  asOfMarket?: string | null;
  /** Время обновления выручки на стороне DeFiLlama. */
  asOfFees?: string | null;
  /** Время обновления TVL на стороне DeFiLlama. */
  asOfTvl?: string | null;
  /** Основание расчёта выручки за 12 месяцев. */
  revenueBasis?: 'reported_1y' | 'run_rate_30d' | 'none';
  /** Версия вселенной, в составе которой собрана строка. */
  universeVersion?: string | null;
}
