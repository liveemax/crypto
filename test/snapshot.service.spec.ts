import { NotFoundException } from "@nestjs/common";
import { SnapshotService } from "../src/core/fetch/snapshot.service";
import { StoreService } from "../src/core/store/store.service";
import { CoingeckoService } from "../src/core/fetch/coingecko.service";
import { DefillamaService } from "../src/core/fetch/defillama.service";
import { SnapshotRow } from "../src/core/types";

describe("SnapshotService", () => {
  const saved: SnapshotRow[][] = [];
  const store = {
    loadSnapshot: jest.fn<Promise<SnapshotRow[] | null>, []>(),
    saveSnapshot: jest.fn(async (_name: string, rows: SnapshotRow[]) => {
      saved.push(rows);
      return "/tmp/snapshot.json";
    }),
  } as unknown as StoreService;
  const defillama = {
    getFees: jest
      .fn()
      .mockResolvedValue({
        total24h: 1,
        total30d: 30,
        total1y: 365,
        sourceUrl: "https://fees",
      }),
    getTvl: jest
      .fn()
      .mockResolvedValue({ tvlUsd: 1_000, sourceUrl: "https://tvl" }),
  } as unknown as DefillamaService;
  const coingecko = {
    getMarket: jest.fn().mockResolvedValue({
      priceUsd: 10,
      mcapUsd: 100,
      fdvUsd: 120,
      vol24hUsd: 5,
      circulating: 10,
      totalSupply: 12,
      sourceUrl: "https://market",
    }),
  } as unknown as CoingeckoService;
  const service = new SnapshotService(store, defillama, coingecko);

  beforeEach(() => {
    jest.clearAllMocks();
    saved.length = 0;
  });

  it("собирает реальную форму строки со ссылками на источники", async () => {
    const [row] = await service.build(["aave"]);

    expect(row).toMatchObject({
      ticker: "AAVE",
      mcapUsd: 100,
      revenue1y: 365,
      tvlUsd: 1_000,
      mcapSource: "https://market",
      feesSource: "https://fees",
      tvlSource: "https://tvl",
      errors: [],
    });
    expect(saved).toHaveLength(1);
  });

  it("не обращается к API в offline-режиме при отсутствии строки", async () => {
    (store.loadSnapshot as jest.Mock).mockResolvedValueOnce([]);

    await expect(
      service.getRow("AAVE", { offline: true }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(defillama.getFees).not.toHaveBeenCalled();
    expect(coingecko.getMarket).not.toHaveBeenCalled();
  });

  it("не подставляет числа при сбое одного источника", async () => {
    (defillama.getFees as jest.Mock).mockResolvedValueOnce(null);
    const [row] = await service.build(["AAVE"]);

    expect(row.revenue1y).toBeNull();
    expect(row.feesSource).toBeNull();
    expect(row.errors).toContain("Не удалось получить выручку DeFiLlama");
  });
});
