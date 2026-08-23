import type { Metadata } from "next";
import { Roboto } from "next/font/google";
import { headers } from "next/headers";
import type { PropsWithChildren } from "react";

import { Providers } from "./providers";

const roboto = Roboto({
  subsets: ["cyrillic", "latin"],
  weight: ["400", "500", "700"],
  variable: "--font-roboto",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(
    process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : "http://localhost:3000",
  ),
  title: "Crypto Research",
  description: "Исследования криптопротоколов",
};

export default function RootLayout({ children }: PropsWithChildren) {
  const locale = headers().get("x-site-locale") === "en" ? "en" : "ru";
  return (
    <html lang={locale} className={roboto.variable}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
