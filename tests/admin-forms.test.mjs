import assert from "node:assert/strict";
import test from "node:test";

import { buildMethodologyBody } from "../src/lib/methodology.ts";
import { changedProtocolFields } from "../src/lib/protocol.ts";
import { buildSnapshotBody, debounce } from "../src/lib/snapshot.ts";
import { findProtocolFixture } from "../src/contract/fixture-resolver.ts";
import { buildVerdictBody, mayDeleteTranslation, nextVerdictRequest, renderPreview, unknownPlaceholders } from "../src/lib/verdict.ts";

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

test("snapshot body preserves the distinction between an empty value and zero", () => {
  const body = buildSnapshotBody({
    takenAt: "2026-08-23T12:00", sourceStatus: "OK", sourceErrors: "",
    price: "0", circulatingSupply: "", totalSupply: "1", marketCap: "2", fdv: "3",
    protocolRevenue12m: "4", tokenIncentives12m: "5", buybackAnnualUsd: "6",
    emissions12mTokens: "7", unlocks12mTokens: "8",
  });
  assert.equal(body.price, 0);
  assert.equal(body.circulatingSupply, null);
  assert.equal(body.sourceErrors, null);
});

test("debounce collapses ten rapid edits into one preview request", async () => {
  let calls = 0; let last = -1;
  const request = debounce((value) => { calls += 1; last = value; }, 20);
  for (let index = 0; index < 10; index += 1) request(index);
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(calls, 1); assert.equal(last, 9);
});

const verdictValues = {
  snapshotTakenAt: "2026-08-23T12:00:00.000Z", isPublished: false, riskLabel: "LOW",
  killersFired: [], changeReason: "", publishedAt: "", metricRefs: ["PRICE", "FDV", "VAR_PCT"],
  ru: { body: "Цена {{snapshot.price}}", counterarguments: "Нет", reasonTexts: ["A", "B", "C"], changeSummary: "Пересмотр", isMachineTranslated: false },
};

test("verdict body is atomic, retains the legacy field, and rejects duplicate metrics", () => {
  const body = buildVerdictBody(verdictValues);
  assert.deepEqual(body.reasons, {}); assert.equal(body.content.reasons.length, 3); assert.equal(body.content.texts[0].locale, "RU");
  assert.throws(() => buildVerdictBody({ ...verdictValues, metricRefs: ["PRICE", "PRICE", "VAR_PCT"] }), /не должны повторяться/);
});

test("a successful create version switches subsequent saves from POST to PUT", () => {
  assert.deepEqual(nextVerdictRequest("seed-lending"), { method: "POST", path: "/protocols/seed-lending/verdicts" });
  assert.deepEqual(nextVerdictRequest("seed-lending", "1.0"), { method: "PUT", path: "/protocols/seed-lending/verdicts/1.0" });
});

test("preview distinguishes null from zero and flags unknown placeholders", () => {
  assert.equal(renderPreview("{{snapshot.price}} / {{snapshot.fdv}}", { "snapshot.price": 0, "snapshot.fdv": null }), "0 / —");
  assert.deepEqual(unknownPlaceholders("{{snapshot.price}} {{snapshot.typo}}", ["snapshot.price"]), ["snapshot.typo"]);
});

test("the final translation of a published verdict cannot be removed", () => {
  assert.equal(mayDeleteTranslation(true, ["RU"]), false); assert.equal(mayDeleteTranslation(true, ["RU", "EN"]), true); assert.equal(mayDeleteTranslation(false, ["RU"]), true);
});
