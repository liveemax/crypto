import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { metricLabels } from "../src/lib/metric-labels.ts";

test("every API metric field has a non-empty label in both locales", async () => {
  const fields = JSON.parse(await readFile("contract/fixtures/metric-fields.json", "utf8"));
  assert.deepEqual(Object.keys(metricLabels).sort(), fields.map(({ metricRef }) => metricRef).sort());
  for (const { metricRef } of fields) {
    assert.equal(typeof metricLabels[metricRef].ru, "string");
    assert.ok(metricLabels[metricRef].ru.trim(), `${metricRef} needs a Russian label`);
    assert.equal(typeof metricLabels[metricRef].en, "string");
    assert.ok(metricLabels[metricRef].en.trim(), `${metricRef} needs an English label`);
  }
});
