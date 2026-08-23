"use client";

import {
  Alert, Button, Dialog, DialogActions, DialogContent, DialogContentText,
  DialogTitle, Divider, MenuItem, Paper, Stack, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, TextField, Typography,
} from "@mui/material";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  buildSnapshotBody, debounce, snapshotNumberFields, type SnapshotFormValues,
} from "../../lib/snapshot";

type NullableNumber = number | null;
interface Preview {
  metrics: Record<string, NullableNumber>;
  valuation: Record<string, NullableNumber> & { sectorSampleSize: number };
}
interface Snapshot extends Record<string, unknown> {
  takenAt: string;
  sourceStatus: "OK" | "PARTIAL" | "FAILED";
  sourceErrors: unknown;
}

const labels: Record<string, string> = {
  price: "Цена", circulatingSupply: "Циркулирующее предложение", totalSupply: "Полное предложение",
  marketCap: "Market cap", fdv: "FDV", protocolRevenue12m: "Выручка за 12 мес.",
  tokenIncentives12m: "Стимулы за 12 мес.", buybackAnnualUsd: "Выкуп за год",
  emissions12mTokens: "Эмиссия за 12 мес.", unlocks12mTokens: "Разблокировки за 12 мес.",
  netRevenue12m: "Чистая выручка", fdvRevenue: "FDV / Revenue", varPct: "VAR, %",
  sprPct: "SPR, %", netTokenFlowPct: "Чистый поток, %", sectorMedianFdvRevenue: "Медиана сектора",
  fairFdv: "Справедливый FDV", premiumPct: "Премия, %", flowNeutralPrice: "Нейтральная цена потока",
  impliedRevenue: "Подразумеваемая выручка", impliedGrowthX: "Подразумеваемый рост",
};

function localDate(value: string) {
  const date = new Date(value); const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}
function emptyValues(): SnapshotFormValues {
  return { takenAt: localDate(new Date().toISOString()), sourceStatus: "OK", sourceErrors: "", ...Object.fromEntries(snapshotNumberFields.map((key) => [key, ""])) } as SnapshotFormValues;
}
function fromSnapshot(snapshot: Snapshot): SnapshotFormValues {
  return { takenAt: localDate(snapshot.takenAt), sourceStatus: snapshot.sourceStatus, sourceErrors: snapshot.sourceErrors == null ? "" : JSON.stringify(snapshot.sourceErrors, null, 2), ...Object.fromEntries(snapshotNumberFields.map((key) => [key, snapshot[key] == null ? "" : String(snapshot[key])])) } as SnapshotFormValues;
}
async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/admin${path}`, init); const payload = response.status === 204 ? null : await response.json();
  if (!response.ok) throw Object.assign(new Error(payload?.message ?? `HTTP ${response.status}`), { status: response.status });
  return payload as T;
}
const json = (method: string, body: unknown, signal?: AbortSignal): RequestInit => ({ method, signal, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const display = (value: NullableNumber) => value == null ? "—" : new Intl.NumberFormat("ru", { maximumFractionDigits: 4 }).format(value);

export function SnapshotAdmin({ slug, sector }: { slug: string; sector: "LENDING" | "PERPS" }) {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]); const [values, setValues] = useState(emptyValues);
  const [originalTakenAt, setOriginalTakenAt] = useState<string>(); const [preview, setPreview] = useState<Preview>();
  const [error, setError] = useState<string>(); const [busy, setBusy] = useState(false); const [removing, setRemoving] = useState<Snapshot>();
  const controller = useRef<AbortController>();
  const load = useCallback(async () => { try { setSnapshots(await call<Snapshot[]>(`/protocols/${encodeURIComponent(slug)}/snapshots`)); } catch (e) { setError(e instanceof Error ? e.message : "Не удалось загрузить снимки."); } }, [slug]);
  useEffect(() => { void load(); }, [load]);

  const requestPreview = useMemo(() => debounce(async (next: SnapshotFormValues) => {
    controller.current?.abort(); controller.current = new AbortController();
    try { setPreview(await call<Preview>("/preview/metrics", json("POST", { ...buildSnapshotBody(next), sector }, controller.current.signal))); setError(undefined); }
    catch (e) { if ((e as { name?: string }).name !== "AbortError") setError(e instanceof Error ? e.message : "Не удалось пересчитать метрики."); }
  }, 500), [sector]);
  useEffect(() => { requestPreview(values); return () => { requestPreview.cancel(); controller.current?.abort(); }; }, [requestPreview, values]);

  const update = (key: keyof SnapshotFormValues, value: string) => setValues((old) => ({ ...old, [key]: value }));
  async function save() {
    setBusy(true); setError(undefined);
    try {
      const body = buildSnapshotBody(values); const editing = originalTakenAt !== undefined;
      await call(`/protocols/${encodeURIComponent(slug)}/snapshots${editing ? `/${encodeURIComponent(originalTakenAt)}` : ""}`, json(editing ? "PUT" : "POST", body));
      setValues(emptyValues()); setOriginalTakenAt(undefined); await load();
    } catch (e) { setError((e as { status?: number }).status === 409 ? "Снимок с таким временем уже существует." : e instanceof Error ? e.message : "Не удалось сохранить снимок."); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (!removing) return; setBusy(true); setError(undefined);
    try { await call(`/protocols/${encodeURIComponent(slug)}/snapshots/${encodeURIComponent(removing.takenAt)}`, { method: "DELETE" }); setRemoving(undefined); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : "Не удалось удалить снимок."); } finally { setBusy(false); }
  }

  return <><Divider sx={{ my: 4 }} /><Stack spacing={2}>
    <Typography variant="h5">Снимки и живой пересчёт</Typography>
    {error ? <Alert severity="error">{error}</Alert> : null}
    <Alert severity="info">Пустое числовое поле сохраняется как null, измеренный ноль — как 0. Превью ничего не записывает.</Alert>
    <Stack direction={{ xs: "column", md: "row" }} spacing={3} alignItems="flex-start">
      <Stack spacing={2} flex={1} width="100%">
        <TextField label="Время снимка" type="datetime-local" value={values.takenAt} onChange={(e) => update("takenAt", e.target.value)} InputLabelProps={{ shrink: true }} required />
        {snapshotNumberFields.map((key) => <TextField key={key} label={labels[key]} type="number" value={values[key]} onChange={(e) => update(key, e.target.value)} inputProps={{ step: "any" }} />)}
        <TextField label="Статус источников" select value={values.sourceStatus} onChange={(e) => update("sourceStatus", e.target.value)}>{["OK", "PARTIAL", "FAILED"].map((item) => <MenuItem key={item} value={item}>{item}</MenuItem>)}</TextField>
        <TextField label="Ошибки источников (JSON)" multiline minRows={2} value={values.sourceErrors} onChange={(e) => update("sourceErrors", e.target.value)} />
        <Stack direction="row" spacing={1}><Button disabled={busy} variant="contained" onClick={() => void save()}>{originalTakenAt ? "Сохранить полную замену" : "Добавить снимок"}</Button>{originalTakenAt ? <Button onClick={() => { setValues(emptyValues()); setOriginalTakenAt(undefined); }}>Отмена</Button> : null}</Stack>
      </Stack>
      <Paper sx={{ p: 2, flex: 1, width: "100%" }}><Typography variant="h6">Производные</Typography>
        {preview ? <Stack spacing={1} mt={2}>{Object.entries({ ...preview.metrics, ...preview.valuation }).filter(([key]) => key !== "sectorSampleSize").map(([key, value]) => <div key={key}><strong>{labels[key] ?? key}:</strong> {display(value)}{value == null ? <Typography component="span" color="text.secondary"> — {key === "sectorMedianFdvRevenue" ? `недостаточно протоколов в секторе (выборка: ${preview.valuation.sectorSampleSize})` : "недостаточно исходных данных для расчёта"}</Typography> : null}</div>)}</Stack> : <Typography color="text.secondary">Расчёт появится через 500 мс после ввода.</Typography>}
      </Paper>
    </Stack>
    <TableContainer component={Paper}><Table size="small"><TableHead><TableRow><TableCell>Время</TableCell><TableCell>Статус</TableCell><TableCell>Цена</TableCell><TableCell align="right">Действия</TableCell></TableRow></TableHead><TableBody>
      {snapshots.length === 0 ? <TableRow><TableCell colSpan={4}>Снимков пока нет.</TableCell></TableRow> : snapshots.map((snapshot) => <TableRow key={snapshot.takenAt}><TableCell>{new Intl.DateTimeFormat("ru", { dateStyle: "medium", timeStyle: "short" }).format(new Date(snapshot.takenAt))}</TableCell><TableCell>{snapshot.sourceStatus}</TableCell><TableCell>{display(snapshot.price as NullableNumber)}</TableCell><TableCell align="right"><Button onClick={() => { setValues(fromSnapshot(snapshot)); setOriginalTakenAt(snapshot.takenAt); }}>Изменить</Button><Button color="error" onClick={() => setRemoving(snapshot)}>Удалить</Button></TableCell></TableRow>)}
    </TableBody></Table></TableContainer>
  </Stack>
  <Dialog open={Boolean(removing)} onClose={() => !busy && setRemoving(undefined)}><DialogTitle>Удалить снимок?</DialogTitle><DialogContent><DialogContentText>Если на снимок опирается вердикт, разбор потеряет опору и перейдёт в состояние «Данные не подтверждены». Медиана сектора пересчитается, поэтому оценки соседних протоколов могут измениться.</DialogContentText></DialogContent><DialogActions><Button disabled={busy} onClick={() => setRemoving(undefined)}>Отмена</Button><Button disabled={busy} color="error" onClick={() => void remove()}>Удалить</Button></DialogActions></Dialog>
  </>;
}
