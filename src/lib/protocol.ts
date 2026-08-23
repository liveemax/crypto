export interface ProtocolValues {
  name: string;
  ticker: string;
  sector: "LENDING" | "PERPS";
  chains: string[];
  contracts: Record<string, unknown>;
  defillamaSlug: string | null;
  coingeckoId: string | null;
  isPublished: boolean;
}

/** PUT for a protocol passport is intentionally a partial update. */
export function changedProtocolFields(
  initial: ProtocolValues,
  current: ProtocolValues,
): Partial<ProtocolValues> {
  return Object.fromEntries(
    (Object.keys(current) as (keyof ProtocolValues)[])
      .filter((key) => JSON.stringify(initial[key]) !== JSON.stringify(current[key]))
      .map((key) => [key, current[key]]),
  );
}
