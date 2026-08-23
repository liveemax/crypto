import { Container, Typography } from "@mui/material";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { publicLocales, siteOrigin, type SiteLocale } from "@/lib/site";

export function generateStaticParams() {
  return publicLocales.map((locale) => ({ locale }));
}

export function generateMetadata({ params }: { params: { locale: string } }): Metadata {
  if (!publicLocales.includes(params.locale as SiteLocale)) return {};
  const locale = params.locale as SiteLocale;
  return {
    title: locale === "ru" ? "Исследования криптопротоколов" : "Crypto protocol research",
    alternates: {
      canonical: `${siteOrigin()}/${locale}`,
      languages: { ru: `${siteOrigin()}/ru`, en: `${siteOrigin()}/en` },
    },
  };
}

export default function LocaleHome({ params }: { params: { locale: string } }) {
  if (!publicLocales.includes(params.locale as SiteLocale)) notFound();
  return <Container component="main" sx={{ py: 6 }}><Typography component="h1" variant="h3">
    {params.locale === "ru" ? "Исследования криптопротоколов" : "Crypto protocol research"}
  </Typography></Container>;
}
