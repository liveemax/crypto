export interface MethodologyFormValues {
  version: number;
  revenueDefinition: string;
  adapterUrl: string;
  incentivesSource: string;
  buybackPolicy: string;
  excludedAddresses: string[];
  whaleThresholdPct: string;
  reserveFactorSource: string;
  feeStructureSource: string;
}

export interface MethodologyBody {
  version?: number;
  revenueDefinition: string;
  adapterUrl: string | null;
  incentivesSource: string | null;
  buybackPolicy: string | null;
  excludedAddresses: string[] | null;
  whaleThresholdPct: number | null;
  reserveFactorSource: string | null;
  feeStructureSource: string | null;
}

const nullable = (value: string) => value.trim() || null;

/** Builds the full-replacement body. No optional methodology field is omitted. */
export function buildMethodologyBody(
  values: MethodologyFormValues,
  includeVersion: boolean,
): MethodologyBody {
  return {
    ...(includeVersion ? { version: values.version } : {}),
    revenueDefinition: values.revenueDefinition.trim(),
    adapterUrl: nullable(values.adapterUrl),
    incentivesSource: nullable(values.incentivesSource),
    buybackPolicy: nullable(values.buybackPolicy),
    excludedAddresses: values.excludedAddresses.length
      ? values.excludedAddresses.map((address) => address.trim()).filter(Boolean)
      : null,
    whaleThresholdPct: values.whaleThresholdPct.trim()
      ? Number(values.whaleThresholdPct)
      : null,
    reserveFactorSource: nullable(values.reserveFactorSource),
    feeStructureSource: nullable(values.feeStructureSource),
  };
}
