import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { compareResponseShape } from "./compare-response-shape.mjs";

const fixturePath = process.argv[2] ?? "contract/fixtures/protocol-current.json";
const baseUrl = process.env.RESEARCH_API_BASE_URL?.replace(/\/$/, "");
const apiKey = process.env.RESEARCH_API_KEY;

if (!baseUrl || !apiKey) {
  console.error("RESEARCH_API_BASE_URL and RESEARCH_API_KEY are required for the live acceptance check.");
  process.exit(2);
}
if (!baseUrl.startsWith("https://")) {
  console.error("The live Research API must use HTTPS.");
  process.exit(2);
}

const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
const slug = fixture?.protocol?.slug;
assert.equal(typeof slug, "string", `${fixturePath} is not a protocol-page fixture`);
const response = await fetch(`${baseUrl}/api/v1/protocols/${encodeURIComponent(slug)}?locale=ru`, {
  headers: { "x-api-key": apiKey },
  signal: AbortSignal.timeout(10_000),
});
assert.equal(response.ok, true, `Live API returned HTTP ${response.status}: ${await response.text()}`);
const live = await response.json();

compareResponseShape(fixture, live);
console.log(`Live response for ${slug} has the same keys and value types as ${fixturePath}.`);
