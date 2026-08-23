import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { preferredLocale } from "@/lib/site";

export default function HomePage(): never {
  redirect(`/${preferredLocale(headers().get("accept-language"))}`);
}
