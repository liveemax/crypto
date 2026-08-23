import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const origin = process.env.SMOKE_BASE_URL?.replace(/\/$/, "");
if (!origin || !origin.startsWith("https://")) {
  console.error("SMOKE_BASE_URL with an https:// deployment URL is required.");
  process.exit(2);
}

const protocol = JSON.parse(await readFile("contract/fixtures/protocol-current.json", "utf8"));
const sectorRows = JSON.parse(await readFile("contract/fixtures/sector-table.json", "utf8"));
const paths = [
  "/ru",
  `/ru/protocols/${encodeURIComponent(protocol.protocol.slug)}`,
  `/ru/sectors/${encodeURIComponent(sectorRows[0].sector.toLowerCase())}`,
  "/admin/login",
];

for (const path of paths) {
  const response = await fetch(`${origin}${path}`, { redirect: "manual", signal: AbortSignal.timeout(10_000) });
  assert.equal(response.status, 200, `${path} returned HTTP ${response.status}`);
}

const admin = await fetch(`${origin}/admin`, { redirect: "manual", signal: AbortSignal.timeout(10_000) });
assert.ok([301, 302, 303, 307, 308].includes(admin.status), `/admin returned HTTP ${admin.status}, expected a redirect`);
assert.match(admin.headers.get("location") ?? "", /\/admin\/login(?:\?|$)/, "/admin must redirect to /admin/login");
console.log(`Deployment smoke check passed for ${origin}.`);
