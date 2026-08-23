import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

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

compareShape(fixture, live, "$", []);
console.log(`Live response for ${slug} has the same keys and value types as ${fixturePath}.`);

function compareShape(expected, actual, path, errors) {
  if (expected === null) return;
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) errors.push(`${path}: expected array, received ${typeOf(actual)}`);
    else if (expected.length && actual.length) compareShape(expected[0], actual[0], `${path}[0]`, errors);
  } else if (typeof expected === "object") {
    if (typeOf(actual) !== "object") errors.push(`${path}: expected object, received ${typeOf(actual)}`);
    else {
      const expectedKeys = Object.keys(expected).sort();
      const actualKeys = Object.keys(actual).sort();
      if (JSON.stringify(expectedKeys) !== JSON.stringify(actualKeys)) {
        errors.push(`${path}: keys differ\n  fixture: ${expectedKeys.join(", ")}\n  live: ${actualKeys.join(", ")}`);
      }
      for (const key of expectedKeys.filter((key) => key in actual)) compareShape(expected[key], actual[key], `${path}.${key}`, errors);
    }
  } else if (typeof expected !== typeof actual) {
    errors.push(`${path}: expected ${typeof expected}, received ${typeOf(actual)}`);
  }
  if (path === "$" && errors.length) assert.fail(`Live response shape differs from fixture:\n${errors.join("\n")}`);
}

function typeOf(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}
