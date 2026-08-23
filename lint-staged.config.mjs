export default {
  "*.{ts,tsx}": ["eslint --fix", () => "tsc --noEmit"],
  "*.{js,mjs,cjs}": "eslint --fix",
};
