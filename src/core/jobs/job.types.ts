/** Словарь шагов принадлежит jobs: состояние задачи живёт ровно в одном месте. */
export type JobStep =
  | 'idle'
  | 'markets'
  | 'categories'
  | 'protocols'
  | 'chains'
  | 'fees'
  | 'prices'
  | 'tokenomics'
  | 'join'
  | 'filter'
  | 'save'
  | 'done'
  | 'failed';

export type JobState = 'idle' | 'running' | 'done' | 'error';

/** Событие прогресса, которое исполнитель задачи отдаёт наружу. */
export interface JobProgressEvent {
  step: JobStep;
  label: string;
  current: number;
  total: number;
  loaded: number;
  failed: boolean;
  error: string | null;
}

/** Полное состояние слота — то, что показывает GET /status. */
export interface JobSnapshot {
  /** Имя идущей задачи, а после завершения — последней. null только до первого запуска. */
  operation: string | null;
  state: JobState;
  step: JobStep;
  label: string;
  current: number;
  total: number;
  percent: number;
  loaded: number;
  failures: number;
  startedAt: string | null;
  finishedAt: string | null;
  elapsedSec: number;
  etaSec: number | null;
  lastError: string | null;
}