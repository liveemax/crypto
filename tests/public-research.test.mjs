import assert from "node:assert/strict";
import test from "node:test";

import { formatResearchNumber, freshnessText, renderResearchText } from "../src/lib/public-research.ts";
import { sortSectorRows } from "../src/lib/sector-table.ts";

test("all freshness states have distinct, localized messages", () => {
  const states = ["CURRENT", "DATA_CHANGED", "VERDICT_REVISED", "DATA_UNVERIFIED"];
  for (const locale of ["ru", "en"]) assert.equal(new Set(states.map((status) => freshnessText(status, locale).title)).size, 4);
});

test("sector sorting keeps null values last in both directions", () => {
  const rows = [
    { slug: "missing", name: "Missing", protocolRevenue12m: null },
    { slug: "low", name: "Low", protocolRevenue12m: 0 },
    { slug: "high", name: "High", protocolRevenue12m: 10 },
  ];
  assert.deepEqual(sortSectorRows(rows, "protocolRevenue12m", "asc").map((row) => row.slug), ["low", "high", "missing"]);
  assert.deepEqual(sortSectorRows(rows, "protocolRevenue12m", "desc").map((row) => row.slug), ["high", "low", "missing"]);
  assert.equal(rows[0].slug, "missing", "sorting must not mutate API data");
});

test("every sector column is sortable", () => {
  const complete = {
    slug: "b", name: "Beta", ticker: "B", sector: "LENDING", protocolRevenue12m: 2,
    netRevenue12m: 2, fdvRevenue: 2, varPct: 2, sprPct: 2, netTokenFlowPct: 2,
    riskLabel: "LOW", takenAt: null,
  };
  const lower = { ...complete, slug: "a", name: "Alpha", protocolRevenue12m: 1,
    netRevenue12m: 1, fdvRevenue: 1, varPct: 1, sprPct: 1, netTokenFlowPct: 1,
    riskLabel: null };
  for (const key of ["name", "protocolRevenue12m", "netRevenue12m", "fdvRevenue", "varPct", "sprPct", "netTokenFlowPct", "riskLabel"]) {
    const sorted = sortSectorRows([complete, lower], key, "asc");
    assert.equal(sorted.at(-1).slug, key === "riskLabel" ? "a" : "b", `${key} should sort with missing data last`);
  }
});

test("public number rendering distinguishes unavailable data from measured zero", () => {
  assert.equal(formatResearchNumber(null, "ru"), "—");
  assert.equal(formatResearchNumber(0, "ru"), "0");
  assert.equal(renderResearchText("{{snapshot.price}} / {{snapshot.fdvRevenue}}", { price: 0, fdvRevenue: null }, "en"), "0 / —");
});
