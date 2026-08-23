import type { Metadata } from "next";
import { Roboto } from "next/font/google";
import type { PropsWithChildren } from "react";

import { Providers } from "./providers";

const roboto = Roboto({
  subsets: ["cyrillic", "latin"],
  weight: ["400", "500", "700"],
  variable: "--font-roboto",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Crypto Research",
  description: "Исследования криптопротоколов",
};

export default function RootLayout({ children }: PropsWithChildren) {
  return (
    <html lang="ru" className={roboto.variable}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
