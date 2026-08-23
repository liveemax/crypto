export type SortDirection = "asc" | "desc";

export type SectorTableRow = {
  slug: string;
  name: string;
  ticker: string;
  sector: "LENDING" | "PERPS";
  protocolRevenue12m: number | null;
  netRevenue12m: number | null;
  fdvRevenue: number | null;
  varPct: number | null;
  sprPct: number | null;
  netTokenFlowPct: number | null;
  riskLabel: "LOW" | "MEDIUM" | "HIGH" | null;
  takenAt: string | null;
};

export type SectorSortKey =
  | "name"
  | "protocolRevenue12m"
  | "netRevenue12m"
  | "fdvRevenue"
  | "varPct"
  | "sprPct"
  | "netTokenFlowPct"
  | "riskLabel";

/** Sorts without mutating API data and always keeps missing values at the bottom. */
export function sortSectorRows(
  rows: readonly SectorTableRow[],
  key: SectorSortKey,
  direction: SortDirection,
): SectorTableRow[] {
  const multiplier = direction === "asc" ? 1 : -1;
  return [...rows].sort((left, right) => {
    const a = left[key];
    const b = right[key];
    if (a === null && b === null) return 0;
    if (a === null) return 1;
    if (b === null) return -1;
    const comparison = typeof a === "number"
      ? a - (b as number)
      : a.localeCompare(b as string);
    return comparison * multiplier;
  });
}
