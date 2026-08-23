import type { ProtocolValues } from "../../lib/protocol";

export interface ProtocolRow {
  slug: string;
  name: string;
  ticker: string;
  sector: "LENDING" | "PERPS";
  chains: string[];
  takenAt: string | null;
  isPublished?: boolean;
}

export interface ProtocolDetails extends ProtocolValues {
  slug: string;
  methodology?: {
    version: number;
    revenueDefinition: string;
    adapterUrl: string | null;
    incentivesSource: string | null;
    buybackPolicy: string | null;
    excludedAddresses: string[] | null;
    whaleThresholdPct: number | null;
    reserveFactorSource: string | null;
    feeStructureSource: string | null;
  } | null;
}
