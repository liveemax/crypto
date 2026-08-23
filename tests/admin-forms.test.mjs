import assert from "node:assert/strict";
import test from "node:test";

import { buildMethodologyBody } from "../src/lib/methodology.ts";
import { changedProtocolFields } from "../src/lib/protocol.ts";
import { findProtocolFixture } from "../src/contract/fixture-resolver.ts";

test("methodology replacement includes every field and preserves null semantics", () => {
  const body = buildMethodologyBody({
    version: 3,
    revenueDefinition: " Fees minus incentives ",
    adapterUrl: "",
    incentivesSource: " source ",
    buybackPolicy: "",
    excludedAddresses: [" 0xabc "],
    whaleThresholdPct: "0",
    reserveFactorSource: "",
    feeStructureSource: "",
  }, true);

  assert.deepEqual(body, {
    version: 3,
    revenueDefinition: "Fees minus incentives",
    adapterUrl: null,
    incentivesSource: "source",
    buybackPolicy: null,
    excludedAddresses: ["0xabc"],
    whaleThresholdPct: 0,
    reserveFactorSource: null,
    feeStructureSource: null,
  });
});

test("protocol update contains changed fields only", () => {
  const initial = { name: "Aave", ticker: "AAVE", sector: "LENDING", chains: ["ethereum"], contracts: {}, defillamaSlug: null, coingeckoId: null, isPublished: false };
  assert.deepEqual(changedProtocolFields(initial, { ...initial, name: "Aave V3", isPublished: true }), { name: "Aave V3", isPublished: true });
});

test("updated scenario fixtures resolve a protocol by payload slug", async () => {
  assert.equal(
    await findProtocolFixture("seed-lending", "contract/fixtures"),
    "protocol-current.json",
  );
  assert.equal(
    await findProtocolFixture("does-not-exist", "contract/fixtures"),
    undefined,
  );
});
