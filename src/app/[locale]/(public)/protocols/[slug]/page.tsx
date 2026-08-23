import { Alert, Box, Chip, Container, Divider, Paper, Stack, Typography } from "@mui/material";
import Link from "next/link";
import { notFound } from "next/navigation";

import type { components } from "@/contract/api";
import { researchApi } from "@/contract/client";
import { metricLabels } from "@/lib/metric-labels";
import { formatResearchNumber, freshnessText, renderResearchText, snapshotMetric, type PublicLocale } from "@/lib/public-research";

import styles from "./styles.module.scss";

type PageData = components["schemas"]["ResearchProtocolPageDto"];
type VerdictText = { body: string; counterarguments: string; reasonTexts: string[] };
export const revalidate = 300;

function metricLabel(metric: string, locale: PublicLocale): string {
  return metricLabels[metric as keyof typeof metricLabels]?.[locale] ?? metric;
}

export default async function ProtocolPage({ params }: { params: { locale: string; slug: string } }) {
  if (params.locale !== "ru" && params.locale !== "en") notFound();
  const locale = params.locale as PublicLocale;
  const result = await researchApi<PageData>(`/api/v1/protocols/${encodeURIComponent(params.slug)}`, { query: { locale } });
  if (!result.ok) {
    if (result.status === 404) notFound();
    throw new Error(result.message);
  }
  const { protocol, methodology, snapshot, verdict, triggers, freshness } = result.data;
  const verdictText = verdict?.text as VerdictText | null | undefined;
  const copy = locale === "ru" ? ru : en;
  const fresh = freshnessText(freshness.status, locale);
  const translationMissing = Boolean(verdict && (!verdictText || !verdict.availableLocales.includes(locale.toUpperCase() as "RU" | "EN")));
  const metrics = snapshot ? [
    ["PRICE", snapshot.price], ["MARKET_CAP", snapshot.marketCap], ["FDV", snapshot.fdv],
    ["PROTOCOL_REVENUE_12M", snapshot.protocolRevenue12m], ["NET_REVENUE_12M", snapshot.netRevenue12m],
    ["FDV_REVENUE", snapshot.fdvRevenue], ["VAR_PCT", snapshot.varPct], ["SPR_PCT", snapshot.sprPct],
    ["NET_TOKEN_FLOW_PCT", snapshot.netTokenFlowPct],
  ] as const : [];

  return <Container className={styles.page} maxWidth="lg">
    <Stack spacing={3}>
      <header><Typography variant="overline">{protocol.sector}</Typography><Typography variant="h2" component="h1">{protocol.name} <span className={styles.ticker}>{protocol.ticker}</span></Typography><Typography color="text.secondary">{protocol.chains.join(", ") || copy.notSpecified}</Typography></header>
      <Alert severity={freshness.status === "CURRENT" ? "success" : freshness.status === "DATA_CHANGED" ? "warning" : "info"}>
        <strong>{fresh.title}.</strong> {fresh.description}
        {freshness.status === "DATA_CHANGED" ? freshness.deviations.map((item) => <span className={styles.deviation} key={item.metricRef}>{metricLabel(item.metricRef, locale)}: {formatResearchNumber(item.baseline, locale)} → {formatResearchNumber(item.current, locale)} ({copy.threshold} {formatResearchNumber(item.threshold, locale)}%)</span>) : null}
      </Alert>
      {snapshot ? <><Typography variant="body2"><strong>{copy.snapshotDate}:</strong> {new Intl.DateTimeFormat(locale, { dateStyle: "long", timeStyle: "short" }).format(new Date(snapshot.takenAt))}</Typography><section><Typography variant="h4" component="h2" gutterBottom>{copy.metrics}</Typography><div className={styles.metrics}>{metrics.map(([key, value]) => <Paper className={styles.metric} key={key} variant="outlined"><Typography color="text.secondary">{metricLabel(key, locale)}</Typography><Typography variant="h5">{formatResearchNumber(value, locale)}</Typography>{value === null ? <Typography variant="caption">{copy.noData}</Typography> : null}</Paper>)}</div></section></> : <Alert severity="info">{copy.noSnapshot}</Alert>}
      {snapshot?.valuation && verdict?.riskLabel !== "HIGH" ? <section><Typography variant="h4" component="h2">{copy.valuation}</Typography><div className={styles.levels}>{[["FAIR_FDV", snapshot.valuation.fairFdv], ["FLOW_NEUTRAL_PRICE", snapshot.valuation.flowNeutralPrice], ["IMPLIED_REVENUE", snapshot.valuation.impliedRevenue]].map(([key, value]) => <Paper variant="outlined" className={styles.metric} key={String(key)}><Typography>{metricLabel(String(key), locale)}</Typography><Typography variant="h6">{formatResearchNumber(value as number | null, locale)}</Typography></Paper>)}</div></section> : null}
      {translationMissing ? <Alert severity="info">{copy.russianOnly} <Link href={`/ru/protocols/${protocol.slug}`}>{copy.openRussian}</Link></Alert> : verdict && verdictText ? <section><Stack direction="row" spacing={1} alignItems="center"><Typography variant="h4" component="h2">{copy.verdict}</Typography><Chip color={verdict.riskLabel === "HIGH" ? "error" : verdict.riskLabel === "MEDIUM" ? "warning" : "success"} label={`${copy.risk}: ${verdict.riskLabel}`} /></Stack><div className={styles.reasons}>{verdict.reasons.map((reason, index) => { const metric = reason.metricRef ?? ""; return <Paper variant="outlined" className={styles.reason} key={reason.position}><Typography variant="overline">{metricLabel(metric, locale)} · {formatResearchNumber(snapshot ? snapshotMetric(snapshot as unknown as Record<string, unknown>, metric) : null, locale)}</Typography><Typography>{verdictText.reasonTexts[index] ?? "—"}</Typography></Paper>; })}</div><Typography className={styles.prose}>{renderResearchText(verdictText.body, snapshot as unknown as Record<string, unknown>, locale)}</Typography><Divider /><Typography variant="h5">{copy.counterarguments}</Typography><Typography className={styles.prose}>{renderResearchText(verdictText.counterarguments, snapshot as unknown as Record<string, unknown>, locale)}</Typography></section> : null}
      {methodology ? <section><Typography variant="h4" component="h2">{copy.passport}</Typography><Typography>{methodology.revenueDefinition}</Typography></section> : null}
      {triggers.length ? <section><Typography variant="h4" component="h2">{copy.triggers}</Typography>{triggers.map((trigger, index) => <Box className={styles.trigger} key={`${trigger.metric}-${index}`}>{metricLabel(trigger.metric, locale)} {trigger.operator} {formatResearchNumber(trigger.threshold, locale)} — {trigger.verdictEffect}</Box>)}</section> : null}
    </Stack>
  </Container>;
}

const ru = { notSpecified: "Не указано", threshold: "порог", snapshotDate: "Дата среза", metrics: "Ключевые метрики", noData: "Нет данных", noSnapshot: "Снимок данных пока отсутствует.", valuation: "Уровни оценки", russianOnly: "Этот разбор доступен на русском.", openRussian: "Открыть русскую версию", verdict: "Вердикт", risk: "Риск", counterarguments: "Контраргументы", passport: "Паспорт и методика", triggers: "Триггеры пересмотра" };
const en = { notSpecified: "Not specified", threshold: "threshold", snapshotDate: "Snapshot date", metrics: "Key metrics", noData: "No data", noSnapshot: "No data snapshot is available yet.", valuation: "Valuation levels", russianOnly: "This review is available in Russian.", openRussian: "Open Russian version", verdict: "Verdict", risk: "Risk", counterarguments: "Counterarguments", passport: "Protocol and methodology", triggers: "Review triggers" };
