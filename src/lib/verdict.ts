export type VerdictLocale = "RU" | "EN";

export interface VerdictTextValues {
  body: string;
  counterarguments: string;
  reasonTexts: [string, string, string];
  changeSummary: string;
  isMachineTranslated: boolean;
}

export interface VerdictFormValues {
  snapshotTakenAt: string;
  isPublished: boolean;
  riskLabel: "LOW" | "MEDIUM" | "HIGH";
  killersFired: string[];
  changeReason: string;
  publishedAt: string;
  metricRefs: [string, string, string];
  ru: VerdictTextValues;
}

export function duplicateMetricRefs(metricRefs: readonly string[]): string[] {
  return Array.from(new Set(metricRefs.filter((item, index) => item && metricRefs.indexOf(item) !== index)));
}

export function buildVerdictBody(values: VerdictFormValues) {
  if (!values.snapshotTakenAt) throw new Error("Выберите опорный снимок.");
  if (values.metricRefs.some((item) => !item)) throw new Error("Выберите метрику для каждой из трёх причин.");
  if (duplicateMetricRefs(values.metricRefs).length) throw new Error("Метрики причин не должны повторяться.");
  return {
    snapshotTakenAt: values.snapshotTakenAt,
    isPublished: values.isPublished,
    riskLabel: values.riskLabel,
    killersFired: values.killersFired,
    reasons: {},
    changeReason: values.changeReason.trim() || null,
    publishedAt: values.publishedAt || null,
    content: {
      reasons: values.metricRefs.map((metricRef, index) => ({ position: index + 1, metricRef })),
      texts: [{ locale: "RU" as const, body: values.ru.body, counterarguments: values.ru.counterarguments,
        reasonTexts: values.ru.reasonTexts, changeSummary: values.ru.changeSummary || null,
        isMachineTranslated: values.ru.isMachineTranslated }],
    },
  };
}

export function unknownPlaceholders(text: string, allowed: readonly string[]): string[] {
  const found = Array.from(text.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g), (match) => match[1]);
  return Array.from(new Set(found.filter((placeholder) => !allowed.includes(placeholder))));
}

export function renderPreview(text: string, values: Record<string, unknown>): string {
  return text.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (token, key: string) => {
    if (!(key in values)) return token;
    const value = values[key];
    return value == null ? "—" : typeof value === "number" ? new Intl.NumberFormat("ru", { maximumFractionDigits: 4 }).format(value) : String(value);
  });
}

export function nextVerdictRequest(slug: string, version?: string) {
  const root = `/protocols/${encodeURIComponent(slug)}/verdicts`;
  return version ? { method: "PUT", path: `${root}/${encodeURIComponent(version)}` } : { method: "POST", path: root };
}

export function mayDeleteTranslation(isPublished: boolean, availableLocales: readonly string[]) {
  return !isPublished || availableLocales.length > 1;
}
