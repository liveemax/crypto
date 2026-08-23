import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

/** Finds a recorded protocol response by its payload, not its scenario filename. */
export async function findProtocolFixture(
  slug: string,
  directory: string,
): Promise<string | undefined> {
  const names = (await readdir(directory))
    .filter((name) => /^protocol-.+\.json$/.test(name))
    .sort(
      (left, right) =>
        Number(left !== "protocol-current.json") -
        Number(right !== "protocol-current.json"),
    );

  for (const name of names) {
    try {
      const fixture = JSON.parse(await readFile(join(directory, name), "utf8")) as {
        protocol?: { slug?: unknown };
      };
      if (fixture.protocol?.slug === slug) return name;
    } catch {
      // Ignore unrelated malformed scenario files while looking for the slug.
    }
  }
  return undefined;
}
