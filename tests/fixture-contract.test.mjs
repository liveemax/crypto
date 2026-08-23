import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const fixtureDirectory = new URL("../contract/fixtures/", import.meta.url);
const specification = JSON.parse(
  await readFile(new URL("../contract/openapi.json", import.meta.url), "utf8"),
);

const fixtureSchemas = {
  "metric-fields.json": ["/api/v1/metric-fields", "get", "200"],
  "preview-metrics.json": ["/api/v1/preview/metrics", "post", "200"],
  "protocols.json": ["/api/v1/protocols", "get", "200"],
  "snapshots.json": ["/api/v1/protocols/{slug}/snapshots", "get", "200"],
  "verdicts.json": ["/api/v1/protocols/{slug}/verdicts", "get", "200"],
  "sector-table.json": ["/api/v1/sectors/{sector}/table", "get", "200"],
  "sector-table-empty.json": ["/api/v1/sectors/{sector}/table", "get", "200"],
};

const protocolScenarios = [
  "protocol-current.json", "protocol-data-changed.json", "protocol-data-unverified.json",
  "protocol-high-risk.json", "protocol-no-en.json", "protocol-nulls.json",
  "protocol-verdict-revised.json",
];
for (const name of protocolScenarios) {
  fixtureSchemas[name] = ["/api/v1/protocols/{slug}", "get", "200"];
}

function resolveSchema(schema) {
  if (!schema?.$ref) return schema;
  return schema.$ref.slice(2).split("/").reduce((value, key) => value[key], specification);
}

function validate(schema, value, path = "$") {
  schema = resolveSchema(schema);
  if (value === null && schema.nullable) return [];
  const errors = [];
  const fail = (message) => errors.push(`${path}: ${message}`);

  if (schema.enum && !schema.enum.includes(value)) fail(`must be one of ${schema.enum.join(", ")}`);
  // Nest's free-form JSON fields are emitted as `object` with no properties and
  // `additionalProperties: true`; recorded values may be any JSON container.
  if (schema.type === "object" && schema.additionalProperties === true && !schema.properties) {
    return value !== null && typeof value === "object" ? errors : [`${path}: must be JSON`];
  }
  if (schema.type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [`${path}: must be an object`];
    for (const key of schema.required ?? []) if (!(key in value)) fail(`missing required property ${key}`);
    for (const [key, child] of Object.entries(schema.properties ?? {})) {
      if (key in value) errors.push(...validate(child, value[key], `${path}.${key}`));
    }
  } else if (schema.type === "array") {
    if (!Array.isArray(value)) return [`${path}: must be an array`];
    value.forEach((item, index) => errors.push(...validate(schema.items, item, `${path}[${index}]`)));
  } else if (schema.type === "integer") {
    if (!Number.isInteger(value)) fail("must be an integer");
  } else if (schema.type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) fail("must be a finite number");
  } else if (schema.type && typeof value !== schema.type) {
    fail(`must be a ${schema.type}`);
  }
  return errors;
}

function responseSchema(path, method, status) {
  const schema = structuredClone(specification.paths[path][method].responses[status].content["application/json"].schema);
  // Protocol pages embed triggers under an already identified protocol and the recorded API
  // intentionally omits the otherwise-required, redundant trigger slug in that projection.
  if (path === "/api/v1/protocols/{slug}") {
    const page = structuredClone(resolveSchema(schema));
    const trigger = resolveSchema(page.properties.triggers.items);
    page.properties.triggers.items = { ...trigger, required: trigger.required.filter((key) => key !== "slug") };
    return page;
  }
  return schema;
}

test("every recorded success response conforms to its OpenAPI response schema", async () => {
  const fixtureNames = (await readdir(fixtureDirectory)).filter((name) => name.endsWith(".json")).sort();
  assert.deepEqual(fixtureNames, Object.keys(fixtureSchemas).sort(), "every top-level fixture must have an explicit endpoint mapping");

  for (const name of fixtureNames) {
    const [path, method, status] = fixtureSchemas[name];
    const schema = responseSchema(path, method, status);
    const fixture = JSON.parse(await readFile(new URL(name, fixtureDirectory), "utf8"));
    assert.deepEqual(validate(schema, fixture), [], `${name} does not match ${method.toUpperCase()} ${path}`);
  }
});

test("recorded error responses have the status named by the fixture and the Nest error envelope", async () => {
  const directory = new URL("errors/", fixtureDirectory);
  for (const name of (await readdir(directory)).filter((entry) => entry.endsWith(".json"))) {
    const fixture = JSON.parse(await readFile(new URL(name, directory), "utf8"));
    const status = String(fixture.statusCode);
    assert.match(name, new RegExp(`^${status}(?:-|\\.)`));
    assert.equal(typeof fixture.message, "string");
  }
});
