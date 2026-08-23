"use client";

import { Chip, Link as MuiLink, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TableSortLabel } from "@mui/material";
import Link from "next/link";
import { useMemo, useState } from "react";

import { formatResearchNumber, type PublicLocale } from "@/lib/public-research";
import { sortSectorRows, type SectorSortKey, type SectorTableRow, type SortDirection } from "@/lib/sector-table";

const columns: Array<{ key: SectorSortKey; ru: string; en: string }> = [
  { key: "name", ru: "Протокол", en: "Protocol" },
  { key: "protocolRevenue12m", ru: "Revenue", en: "Revenue" },
  { key: "netRevenue12m", ru: "Net Revenue", en: "Net Revenue" },
  { key: "fdvRevenue", ru: "FDV/Revenue", en: "FDV/Revenue" },
  { key: "varPct", ru: "VAR", en: "VAR" },
  { key: "sprPct", ru: "SPR", en: "SPR" },
  { key: "netTokenFlowPct", ru: "Net Token Flow", en: "Net Token Flow" },
  { key: "riskLabel", ru: "Риск", en: "Risk" },
];

export function SectorTable({ rows, locale }: { rows: SectorTableRow[]; locale: PublicLocale }) {
  const [sortKey, setSortKey] = useState<SectorSortKey>("name");
  const [direction, setDirection] = useState<SortDirection>("asc");
  const sortedRows = useMemo(() => sortSectorRows(rows, sortKey, direction), [rows, sortKey, direction]);
  const review = locale === "ru" ? "Разбор" : "Review";

  function selectSort(key: SectorSortKey) {
    if (key === sortKey) setDirection((current) => current === "asc" ? "desc" : "asc");
    else { setSortKey(key); setDirection("asc"); }
  }

  return <TableContainer component={Paper} variant="outlined">
    <Table aria-label={locale === "ru" ? "Секторная таблица" : "Sector table"}>
      <TableHead><TableRow>
        {columns.map((column) => <TableCell key={column.key} sortDirection={sortKey === column.key ? direction : false}>
          <TableSortLabel active={sortKey === column.key} direction={sortKey === column.key ? direction : "asc"} onClick={() => selectSort(column.key)}>
            {column[locale]}
          </TableSortLabel>
        </TableCell>)}
        <TableCell>{review}</TableCell>
      </TableRow></TableHead>
      <TableBody>{sortedRows.map((row) => <TableRow key={row.slug} hover>
        <TableCell component="th" scope="row"><strong>{row.name}</strong><br />{row.ticker}</TableCell>
        <NumberCell value={row.protocolRevenue12m} locale={locale} />
        <NumberCell value={row.netRevenue12m} locale={locale} />
        <NumberCell value={row.fdvRevenue} locale={locale} />
        <NumberCell value={row.varPct} locale={locale} />
        <NumberCell value={row.sprPct} locale={locale} />
        <NumberCell value={row.netTokenFlowPct} locale={locale} />
        <TableCell>{row.riskLabel ? <Chip size="small" label={row.riskLabel} color={row.riskLabel === "HIGH" ? "error" : row.riskLabel === "MEDIUM" ? "warning" : "success"} /> : "—"}</TableCell>
        <TableCell><MuiLink component={Link} href={`/${locale}/protocols/${encodeURIComponent(row.slug)}`}>{review}</MuiLink></TableCell>
      </TableRow>)}</TableBody>
    </Table>
  </TableContainer>;
}

function NumberCell({ value, locale }: { value: number | null; locale: PublicLocale }) {
  return <TableCell>{formatResearchNumber(value, locale)}</TableCell>;
}
