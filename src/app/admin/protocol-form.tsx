"use client";

import {
  Alert, Button, Divider, FormControlLabel, MenuItem, Paper, Stack,
  Switch, TextField, Typography,
} from "@mui/material";
import { FormEvent, useMemo, useRef, useState } from "react";

import { buildMethodologyBody, type MethodologyFormValues } from "../../lib/methodology";
import { changedProtocolFields, type ProtocolValues } from "../../lib/protocol";
import type { ProtocolDetails } from "./admin-types";
import { DeleteProtocolDialog } from "./protocol-admin";
import { SnapshotAdmin } from "./snapshot-admin";

const emptyProtocol: ProtocolValues = { name: "", ticker: "", sector: "LENDING", chains: [], contracts: {}, defillamaSlug: null, coingeckoId: null, isPublished: false };
const emptyMethodology: MethodologyFormValues = { version: 1, revenueDefinition: "", adapterUrl: "", incentivesSource: "", buybackPolicy: "", excludedAddresses: [], whaleThresholdPct: "", reserveFactorSource: "", feeStructureSource: "" };

async function request(path: string, method: "POST" | "PUT", body: unknown) {
  const response = await fetch(`/api/admin${path}`, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const payload = await response.json();
  if (!response.ok) throw Object.assign(new Error(payload?.message ?? `HTTP ${response.status}`), { status: response.status });
  return payload;
}

const nullable = (value: string) => value.trim() || null;

export function ProtocolForm({ initial, onCancel, onSaved }: { initial: ProtocolDetails | null; onCancel(): void; onSaved(): void }) {
  const baseline = useMemo<ProtocolValues>(() => initial ? { name: initial.name, ticker: initial.ticker, sector: initial.sector, chains: initial.chains, contracts: initial.contracts, defillamaSlug: initial.defillamaSlug, coingeckoId: initial.coingeckoId, isPublished: initial.isPublished } : emptyProtocol, [initial]);
  const [slug, setSlug] = useState(initial?.slug ?? ""); const [protocol, setProtocol] = useState(baseline);
  const [chains, setChains] = useState(baseline.chains.join("\n")); const [contracts, setContracts] = useState(JSON.stringify(baseline.contracts, null, 2));
  const source = initial?.methodology;
  const [methodology, setMethodology] = useState<MethodologyFormValues>(source ? { ...source, adapterUrl: source.adapterUrl ?? "", incentivesSource: source.incentivesSource ?? "", buybackPolicy: source.buybackPolicy ?? "", excludedAddresses: source.excludedAddresses ?? [], whaleThresholdPct: source.whaleThresholdPct?.toString() ?? "", reserveFactorSource: source.reserveFactorSource ?? "", feeStructureSource: source.feeStructureSource ?? "" } : emptyMethodology);
  const [addresses, setAddresses] = useState((source?.excludedAddresses ?? []).join("\n"));
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string>(); const [slugError, setSlugError] = useState<string>();
  const requestInFlight = useRef(false);

  function parsedProtocol(): ProtocolValues {
    return { ...protocol, chains: chains.split("\n").map((v) => v.trim()).filter(Boolean), contracts: JSON.parse(contracts), defillamaSlug: nullable(protocol.defillamaSlug ?? ""), coingeckoId: nullable(protocol.coingeckoId ?? "") };
  }
  async function saveProtocol(event: FormEvent) {
    event.preventDefault();
    if (requestInFlight.current) return;
    requestInFlight.current = true; setBusy(true); setError(undefined); setSlugError(undefined);
    try {
      const value = parsedProtocol(); const body = initial ? changedProtocolFields(baseline, value) : { slug, ...value };
      if (initial && Object.keys(body).length === 0) { setError("В паспорте нет изменений."); return; }
      await request(initial ? `/protocols/${encodeURIComponent(initial.slug)}` : "/protocols", initial ? "PUT" : "POST", body); await onSaved();
    } catch (reason) {
      if ((reason as { status?: number }).status === 409) setSlugError("Такой slug уже существует. Выберите другой.");
      else setError(reason instanceof Error ? reason.message : "Не удалось сохранить паспорт.");
    } finally { requestInFlight.current = false; setBusy(false); }
  }
  async function saveMethodology(mode: "append" | "replace") {
    if (!initial || requestInFlight.current) return;
    requestInFlight.current = true; setBusy(true); setError(undefined);
    try {
      const values = { ...methodology, excludedAddresses: addresses.split("\n").map((v) => v.trim()).filter(Boolean) };
      const body = buildMethodologyBody(values, mode === "replace");
      const path = mode === "append" ? `/protocols/${encodeURIComponent(initial.slug)}/methodology` : `/protocols/${encodeURIComponent(initial.slug)}/methodology/${methodology.version}`;
      await request(path, mode === "append" ? "POST" : "PUT", body); await onSaved();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось сохранить методику."); }
    finally { requestInFlight.current = false; setBusy(false); }
  }
  const field = (key: keyof MethodologyFormValues, label: string, required = false) => <TextField fullWidth label={label} onChange={(event) => setMethodology((old) => ({ ...old, [key]: event.target.value }))} required={required} value={String(methodology[key])} />;
  return <Paper sx={{ p: 3 }}>
    <Stack component="form" onSubmit={saveProtocol} spacing={2}>
      <Typography variant="h5">{initial ? `Паспорт: ${initial.slug}` : "Новый протокол"}</Typography>
      {error ? <Alert severity="error">{error}</Alert> : null}
      <TextField disabled={Boolean(initial)} error={Boolean(slugError)} helperText={slugError ?? (initial ? "Slug — адрес страницы и после создания не меняется." : undefined)} label="Slug" onChange={(e) => setSlug(e.target.value)} required value={slug} />
      <TextField label="Название" onChange={(e) => setProtocol({ ...protocol, name: e.target.value })} required value={protocol.name} />
      <TextField label="Тикер" onChange={(e) => setProtocol({ ...protocol, ticker: e.target.value })} required value={protocol.ticker} />
      <TextField label="Сектор" onChange={(e) => setProtocol({ ...protocol, sector: e.target.value as ProtocolValues["sector"] })} select value={protocol.sector}><MenuItem value="LENDING">LENDING</MenuItem><MenuItem value="PERPS">PERPS</MenuItem></TextField>
      <TextField helperText="Одна сеть на строку" label="Сети" multiline minRows={2} onChange={(e) => setChains(e.target.value)} value={chains} />
      <TextField helperText="JSON-объект адресов и метаданных по сетям" label="Контракты" multiline minRows={3} onChange={(e) => setContracts(e.target.value)} value={contracts} />
      <TextField label="DefiLlama slug" onChange={(e) => setProtocol({ ...protocol, defillamaSlug: e.target.value })} value={protocol.defillamaSlug ?? ""} />
      <TextField label="CoinGecko ID" onChange={(e) => setProtocol({ ...protocol, coingeckoId: e.target.value })} value={protocol.coingeckoId ?? ""} />
      <FormControlLabel control={<Switch checked={protocol.isPublished} onChange={(e) => setProtocol({ ...protocol, isPublished: e.target.checked })} />} label="Опубликован" />
      <Stack direction="row" spacing={1}><Button disabled={busy} type="submit" variant="contained">{busy ? "Сохранение…" : "Сохранить паспорт"}</Button><Button disabled={busy} onClick={onCancel}>Отмена</Button>{initial ? <DeleteProtocolDialog onDeleted={onSaved} slug={initial.slug} /> : null}</Stack>
    </Stack>
    {initial ? <><Divider sx={{ my: 4 }} /><Stack spacing={2}>
      <Typography variant="h5">Методика расчёта</Typography>
      <Alert severity="info">Пустые необязательные поля будут сохранены как null. Замена отправляет методику целиком.</Alert>
      <TextField disabled label="Текущая версия" type="number" value={methodology.version} />
      {field("revenueDefinition", "Определение выручки", true)}{field("adapterUrl", "URL адаптера")}{field("incentivesSource", "Источник стимулов")}{field("buybackPolicy", "Политика выкупа")}
      <TextField helperText="Один адрес на строку; пустой список будет сохранён как null" label="Исключённые адреса" multiline minRows={3} onChange={(e) => setAddresses(e.target.value)} value={addresses} />
      {field("whaleThresholdPct", "Порог кита, %")}{field("reserveFactorSource", "Источник reserve factor")}{field("feeStructureSource", "Источник структуры комиссий")}
      <Stack direction="row" spacing={1}><Button disabled={busy} onClick={() => void saveMethodology("replace")} variant="contained">Заменить версию {methodology.version}</Button><Button disabled={busy} onClick={() => void saveMethodology("append")} variant="outlined">Создать следующую версию</Button></Stack>
    </Stack><SnapshotAdmin sector={initial.sector} slug={initial.slug} /></> : null}
  </Paper>;
}
