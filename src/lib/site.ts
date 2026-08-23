import type { components } from "@/contract/api";

export const publicLocales = ["ru", "en"] as const;
export type SiteLocale = (typeof publicLocales)[number];

type ProtocolPage = components["schemas"]["ResearchProtocolPageDto"];

export function preferredLocale(acceptLanguage: string | null): SiteLocale {
  if (!acceptLanguage) return "ru";

  const languages = acceptLanguage
    .split(",")
    .map((part) => {
      const [tag, ...parameters] = part.trim().toLowerCase().split(";");
      const quality = parameters.find((parameter) => parameter.trim().startsWith("q="));
      return { tag, quality: quality ? Number(quality.split("=")[1]) : 1 };
    })
    .filter(({ quality }) => Number.isFinite(quality) && quality > 0)
    .sort((left, right) => right.quality - left.quality);

  for (const { tag } of languages) {
    if (tag === "ru" || tag.startsWith("ru-")) return "ru";
    if (tag === "en" || tag.startsWith("en-")) return "en";
  }
  return "ru";
}

export function pageHasLocale(page: ProtocolPage, locale: SiteLocale): boolean {
  if (!page.verdict) return locale === "ru";
  return page.verdict.availableLocales.includes(locale.toUpperCase() as "RU" | "EN");
}

export function siteOrigin(): string {
  const productionHost = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (productionHost) return `https://${productionHost}`;
  const deploymentHost = process.env.VERCEL_URL;
  if (deploymentHost) return `https://${deploymentHost}`;
  return "http://localhost:3000";
}
