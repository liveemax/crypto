import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "research-contract-"));
const generated = join(directory, "api.d.ts");

try {
  execFileSync(
    process.platform === "win32" ? "pnpm.cmd" : "pnpm",
    ["exec", "openapi-typescript", "contract/openapi.json", "-o", generated],
    { stdio: "inherit" },
  );

  const expected = readFileSync("src/contract/api.d.ts", "utf8");
  const actual = readFileSync(generated, "utf8");

  if (expected !== actual) {
    console.error(
      "Contract types are stale. Run `pnpm contract:types` and commit src/contract/api.d.ts.",
    );
    try {
      execFileSync("git", ["--no-pager", "diff", "--no-index", "--", "src/contract/api.d.ts", generated], {
        stdio: "inherit",
      });
    } catch (error) {
      if (error.status !== 1) throw error;
    }
    process.exitCode = 1;
  }
} finally {
  rmSync(directory, { recursive: true, force: true });
}
