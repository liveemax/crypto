"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { ADMIN_SESSION_COOKIE, createAdminSession, passwordsMatch } from "../../../lib/admin-auth";

export interface LoginState {
  error?: string;
}

export async function login(_state: LoginState, formData: FormData): Promise<LoginState> {
  const configuredPassword = process.env.ADMIN_PASSWORD;
  const candidate = formData.get("password");

  if (!configuredPassword || typeof candidate !== "string") {
    return { error: "Вход временно недоступен." };
  }

  if (!(await passwordsMatch(candidate, configuredPassword))) {
    return { error: "Неверный пароль." };
  }

  cookies().set(ADMIN_SESSION_COOKIE, await createAdminSession(configuredPassword), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });

  const requestedPath = formData.get("next");
  redirect(typeof requestedPath === "string" && requestedPath.startsWith("/admin") ? requestedPath : "/admin");
}
