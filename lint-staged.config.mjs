export default {
  "*.{ts,tsx}": ["eslint --fix", () => "tsc --noEmit", () => "pnpm contract:check"],
  "*.{js,mjs,cjs}": "eslint --fix",
  "contract/openapi.json": () => "pnpm contract:check",
};
