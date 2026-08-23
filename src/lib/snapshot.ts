export const snapshotNumberFields = [
  "price", "circulatingSupply", "totalSupply", "marketCap", "fdv",
  "protocolRevenue12m", "tokenIncentives12m", "buybackAnnualUsd",
  "emissions12mTokens", "unlocks12mTokens",
] as const;

export type SnapshotNumberField = (typeof snapshotNumberFields)[number];
export type SnapshotNumberValues = Record<SnapshotNumberField, string>;

export interface SnapshotFormValues extends SnapshotNumberValues {
  takenAt: string;
  sourceStatus: "OK" | "PARTIAL" | "FAILED";
  sourceErrors: string;
}

export function buildSnapshotBody(values: SnapshotFormValues) {
  let sourceErrors: unknown = null;
  if (values.sourceErrors.trim()) sourceErrors = JSON.parse(values.sourceErrors);

  return {
    takenAt: new Date(values.takenAt).toISOString(),
    ...Object.fromEntries(snapshotNumberFields.map((key) => [
      key,
      values[key].trim() === "" ? null : Number(values[key]),
    ])),
    sourceStatus: values.sourceStatus,
    sourceErrors,
  };
}

export function debounce<T extends unknown[]>(callback: (...args: T) => void, delay: number) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const run = (...args: T) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => callback(...args), delay);
  };
  run.cancel = () => clearTimeout(timeout);
  return run;
}
