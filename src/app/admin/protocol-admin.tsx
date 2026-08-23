"use client";

import {
  Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions,
  DialogContent, DialogContentText, DialogTitle, Paper, Stack, Table,
  TableBody, TableCell, TableContainer, TableHead, TableRow, TextField,
  Typography,
} from "@mui/material";
import { useCallback, useEffect, useState } from "react";

import type { ProtocolDetails, ProtocolRow } from "./admin-types";
import { ProtocolForm } from "./protocol-form";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/admin${path}`, init);
  const payload = response.status === 204 ? null : await response.json();
  if (!response.ok) throw new Error(payload?.message ?? `HTTP ${response.status}`);
  return payload as T;
}

export function ProtocolAdmin() {
  const [rows, setRows] = useState<ProtocolRow[]>([]);
  const [selected, setSelected] = useState<ProtocolDetails | null>(null);
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    setLoading(true); setError(undefined);
    try { setRows(await api<ProtocolRow[]>("/protocols?includeDrafts=true&limit=200")); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось загрузить протоколы."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function open(row: ProtocolRow) {
    setError(undefined);
    try {
      const page = await api<{ protocol: ProtocolDetails; methodology: ProtocolDetails["methodology"] }>(
        `/protocols/${encodeURIComponent(row.slug)}?includeDrafts=true`,
      );
      setSelected({ ...page.protocol, methodology: page.methodology });
      setCreating(false);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось открыть протокол."); }
  }

  return (
    <Stack spacing={3}>
      {error ? <Alert severity="error">{error}</Alert> : null}
      <Box><Button onClick={() => { setCreating(true); setSelected(null); }} variant="contained">Новый протокол</Button></Box>
      <TableContainer component={Paper}>
        <Table aria-label="Список протоколов">
          <TableHead><TableRow><TableCell>Slug</TableCell><TableCell>Название</TableCell><TableCell>Сектор</TableCell><TableCell>Публикация</TableCell><TableCell>Последний снимок</TableCell></TableRow></TableHead>
          <TableBody>
            {loading ? <TableRow><TableCell colSpan={5}><CircularProgress size={24} /></TableCell></TableRow> : null}
            {!loading && rows.length === 0 ? <TableRow><TableCell colSpan={5}>Протоколов пока нет.</TableCell></TableRow> : null}
            {rows.map((row) => (
              <TableRow hover key={row.slug} onClick={() => void open(row)} selected={selected?.slug === row.slug} sx={{ cursor: "pointer", opacity: row.isPublished === false ? 0.68 : 1 }}>
                <TableCell>{row.slug}</TableCell><TableCell>{row.name}</TableCell><TableCell>{row.sector}</TableCell>
                <TableCell><Chip color={row.isPublished ? "success" : "default"} label={row.isPublished === undefined ? "—" : row.isPublished ? "Опубликован" : "Черновик"} size="small" /></TableCell>
                <TableCell>{row.takenAt ? new Intl.DateTimeFormat("ru", { dateStyle: "medium", timeStyle: "short" }).format(new Date(row.takenAt)) : "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      {creating || selected ? (
        <ProtocolForm initial={selected} onCancel={() => { setCreating(false); setSelected(null); }} onSaved={async () => { setCreating(false); setSelected(null); await load(); }} />
      ) : <Typography color="text.secondary">Выберите строку для редактирования.</Typography>}
    </Stack>
  );
}

export function DeleteProtocolDialog({ slug, onDeleted }: { slug: string; onDeleted(): void }) {
  const [open, setOpen] = useState(false); const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string>();
  async function remove() {
    setBusy(true); setError(undefined);
    try { await api(`/protocols/${encodeURIComponent(slug)}`, { method: "DELETE" }); setOpen(false); onDeleted(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Удаление не удалось."); }
    finally { setBusy(false); }
  }
  return <>
    <Button color="error" onClick={() => setOpen(true)}>Удалить протокол</Button>
    <Dialog onClose={() => !busy && setOpen(false)} open={open}>
      <DialogTitle>Удалить {slug}?</DialogTitle>
      <DialogContent><DialogContentText>Каскадом удалится вся история протокола, а оценки соседей по сектору будут пересчитаны. Введите slug для подтверждения.</DialogContentText>
        {error ? <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert> : null}
        <TextField autoFocus fullWidth label="Slug" onChange={(event) => setConfirmation(event.target.value)} sx={{ mt: 2 }} value={confirmation} />
      </DialogContent>
      <DialogActions><Button disabled={busy} onClick={() => setOpen(false)}>Отмена</Button><Button color="error" disabled={busy || confirmation !== slug} onClick={() => void remove()}>{busy ? "Удаление…" : "Удалить навсегда"}</Button></DialogActions>
    </Dialog>
  </>;
}
