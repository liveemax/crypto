export type PublicLocale = "ru" | "en";
export type FreshnessStatus = "CURRENT" | "DATA_CHANGED" | "VERDICT_REVISED" | "DATA_UNVERIFIED";

const freshnessCopy = {
  ru: {
    CURRENT: ["Актуально", "Вердикт вынесен по свежим данным, расхождений нет."],
    DATA_CHANGED: ["Данные обновились", "Новый срез вышел за порог, использованный в разборе."],
    VERDICT_REVISED: ["Вердикт пересмотрен", "Данные новее опоры разбора; вердикт менялся, но ещё не перенесён на новый срез."],
    DATA_UNVERIFIED: ["Данные не подтверждены", "Актуальность данных, на которых основан разбор, пока не подтверждена."],
  },
  en: {
    CURRENT: ["Current", "The verdict uses current data and no material deviations were found."],
    DATA_CHANGED: ["Data updated", "A new snapshot crossed a threshold used by the review."],
    VERDICT_REVISED: ["Verdict revised", "The data is newer than the review baseline; the verdict has not been moved to the new snapshot."],
    DATA_UNVERIFIED: ["Data unverified", "The currency of the data behind this review has not been confirmed."],
  },
} as const;

export function freshnessText(status: FreshnessStatus, locale: PublicLocale) {
  const [title, description] = freshnessCopy[locale][status];
  return { title, description };
}

export function formatResearchNumber(value: number | null, locale: PublicLocale): string {
  if (value === null) return "—";
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value);
}

export function snapshotMetric(snapshot: Record<string, unknown>, metric: string): number | null {
  const key = metric.toLowerCase().replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
  const value = snapshot[key];
  return typeof value === "number" ? value : null;
}

export function renderResearchText(text: string, snapshot: Record<string, unknown>, locale: PublicLocale): string {
  return text.replace(/\{\{\s*snapshot\.([a-zA-Z0-9]+)\s*\}\}/g, (_, key: string) => {
    const value = snapshot[key];
    return typeof value === "number" ? formatResearchNumber(value, locale) : "—";
  });
}
