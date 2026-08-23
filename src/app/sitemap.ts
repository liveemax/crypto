import type { MetadataRoute } from "next";

import type { components } from "@/contract/api";
import { researchApi } from "@/contract/client";
import { pageHasLocale, siteOrigin } from "@/lib/site";

type Protocol = components["schemas"]["ResearchProtocolListItemDto"];
type ProtocolPage = components["schemas"]["ResearchProtocolPageDto"];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const result = await researchApi<Protocol[]>("/api/v1/protocols");
  if (!result.ok) throw new Error(`Cannot build sitemap: ${result.message}`);
  const origin = siteOrigin();
  const entries: MetadataRoute.Sitemap = [
    { url: `${origin}/ru`, alternates: { languages: { ru: `${origin}/ru`, en: `${origin}/en` } } },
    { url: `${origin}/en`, alternates: { languages: { ru: `${origin}/ru`, en: `${origin}/en` } } },
  ];

  for (const protocol of result.data) {
    const ru = `${origin}/ru/protocols/${protocol.slug}`;
    const languages: Record<string, string> = { ru };
    const pageResult = await researchApi<ProtocolPage>(`/api/v1/protocols/${encodeURIComponent(protocol.slug)}`, { query: { locale: "en" } });
    if (!pageResult.ok && pageResult.status !== 404) {
      throw new Error(`Cannot inspect ${protocol.slug} for sitemap: ${pageResult.message}`);
    }
    const enAvailable = pageResult.ok && pageHasLocale(pageResult.data, "en");
    if (enAvailable) languages.en = `${origin}/en/protocols/${protocol.slug}`;
    entries.push({ url: ru, lastModified: protocol.takenAt ?? undefined, alternates: { languages } });
    if (enAvailable) entries.push({ url: languages.en, lastModified: protocol.takenAt ?? undefined, alternates: { languages } });
  }

  return entries;
}
