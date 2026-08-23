import { writeFile } from "node:fs/promises";

const baseUrl = process.env.RESEARCH_API_BASE_URL?.replace(/\/$/, "");
if (!baseUrl) {
  throw new Error("RESEARCH_API_BASE_URL is required to pull the contract.");
}

const response = await fetch(`${baseUrl}/api/v1/docs-json`, {
  headers: process.env.RESEARCH_API_KEY
    ? { "x-api-key": process.env.RESEARCH_API_KEY }
    : undefined,
});

if (!response.ok) {
  throw new Error(`Contract download failed with HTTP ${response.status}.`);
}

const contract = await response.json();
await writeFile("contract/openapi.json", `${JSON.stringify(contract, null, 2)}\n`);
console.log("Updated contract/openapi.json. Run `pnpm contract:types` next.");
