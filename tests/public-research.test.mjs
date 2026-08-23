import assert from "node:assert/strict";
import test from "node:test";

import { formatResearchNumber, freshnessText, renderResearchText } from "../src/lib/public-research.ts";

test("all freshness states have distinct, localized messages", () => {
  const states = ["CURRENT", "DATA_CHANGED", "VERDICT_REVISED", "DATA_UNVERIFIED"];
  for (const locale of ["ru", "en"]) assert.equal(new Set(states.map((status) => freshnessText(status, locale).title)).size, 4);
});

test("public number rendering distinguishes unavailable data from measured zero", () => {
  assert.equal(formatResearchNumber(null, "ru"), "—");
  assert.equal(formatResearchNumber(0, "ru"), "0");
  assert.equal(renderResearchText("{{snapshot.price}} / {{snapshot.fdvRevenue}}", { price: 0, fdvRevenue: null }, "en"), "0 / —");
});
