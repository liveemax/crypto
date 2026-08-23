import { Alert, Container, Stack, Typography } from "@mui/material";
import { notFound } from "next/navigation";

import type { components } from "@/contract/api";
import { researchApi } from "@/contract/client";
import type { PublicLocale } from "@/lib/public-research";
import type { SectorTableRow as SectorRow } from "@/lib/sector-table";

import { SectorTable } from "./sector-table";
import styles from "./styles.module.scss";

type ApiSectorRow = components["schemas"]["ResearchSectorTableRowDto"];
export const revalidate = 300;

export default async function SectorPage({ params }: { params: { locale: string; sector: string } }) {
  if (params.locale !== "ru" && params.locale !== "en") notFound();
  const locale = params.locale as PublicLocale;
  const sector = decodeURIComponent(params.sector);
  const result = await researchApi<ApiSectorRow[]>(`/api/v1/sectors/${encodeURIComponent(sector)}/table`);
  if (!result.ok) {
    if (result.status === 404) notFound();
    throw new Error(result.message);
  }
  const copy = locale === "ru"
    ? { title: "Протоколы сектора", empty: "В этом секторе пока нет протоколов для сравнения." }
    : { title: "Sector protocols", empty: "There are no protocols to compare in this sector yet." };

  return <Container className={styles.page} maxWidth="xl"><Stack spacing={3}>
    <header><Typography variant="overline">{sector}</Typography><Typography component="h1" variant="h2">{copy.title}</Typography></header>
    {result.data.length === 0 ? <Alert severity="info">{copy.empty}</Alert> : <SectorTable rows={result.data as SectorRow[]} locale={locale} />}
  </Stack></Container>;
}
