import "server-only";

import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { paths } from "./api";
import { findProtocolFixture, sectorTableFixture } from "./fixture-resolver";

const REQUEST_TIMEOUT_MS = 10_000;
const RETRYABLE_STATUS = 500;
const FIXTURES_DIRECTORY = join(process.cwd(), "contract", "fixtures");

export type ApiErrorStatus = 400 | 401 | 403 | 404 | 409 | 429;

export type ApiResult<T> =
  | { ok: true; status: number; data: T }
  | {
      ok: false;
      status: ApiErrorStatus | number | null;
      message: string;
      kind: "api" | "network";
    };

type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

export interface RequestOptions<TBody = unknown> {
  method?: HttpMethod;
  body?: TBody;
  query?: Record<string, boolean | number | string | undefined>;
}

type ApiPath = keyof paths;

export function researchApi<TResponse, TBody = unknown>(
  path: ApiPath | (string & {}),
  options?: RequestOptions<TBody>,
): Promise<ApiResult<TResponse>> {
  return request(path, options, process.env.RESEARCH_API_KEY);
}

/** Use only for the protocol deletion endpoint that requires the admin key. */
export function researchAdminApi<TResponse, TBody = unknown>(
  path: ApiPath | (string & {}),
  options?: RequestOptions<TBody>,
): Promise<ApiResult<TResponse>> {
  return request(path, options, process.env.RESEARCH_API_ADMIN_KEY);
}

async function request<TResponse, TBody>(
  path: string,
  options: RequestOptions<TBody> = {},
  apiKey: string | undefined,
): Promise<ApiResult<TResponse>> {
  const method = options.method ?? "GET";
  const baseUrl = process.env.RESEARCH_API_BASE_URL?.replace(/\/$/, "");

  if (!baseUrl) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "RESEARCH_API_BASE_URL is required in production; fixture mode is disabled.",
      );
    }
    return requestFixture<TResponse, TBody>(path, method, options.body);
  }

  if (!apiKey) {
    return {
      ok: false,
      status: null,
      kind: "network",
      message: "The Research API key is not configured.",
    };
  }

  const url = new URL(`${baseUrl}${path}`);
  for (const [name, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined) url.searchParams.set(name, String(value));
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(url, {
        method,
        headers: {
          "x-api-key": apiKey,
          ...(options.body === undefined ? {} : { "content-type": "application/json" }),
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        cache: "no-store",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (response.status >= RETRYABLE_STATUS && attempt === 0) continue;

      const payload = await readResponseBody(response);
      if (response.ok) {
        return { ok: true, status: response.status, data: payload as TResponse };
      }

      return {
        ok: false,
        status: response.status,
        kind: "api",
        message: errorMessage(payload, response.status),
      };
    } catch (error) {
      if (attempt === 0) continue;
      return {
        ok: false,
        status: null,
        kind: "network",
        message: error instanceof Error ? error.message : "Research API request failed.",
      };
    }
  }

  throw new Error("Unreachable retry state.");
}

async function requestFixture<TResponse, TBody>(
  path: string,
  method: HttpMethod,
  body: TBody | undefined,
): Promise<ApiResult<TResponse>> {
  if (method === "POST" && path.split("?")[0] === "/api/v1/preview/metrics") {
    return readFixture<TResponse>("preview-metrics.json");
  }

  if (method !== "GET") {
    console.warn(`[fixtures] ${method} ${path} was simulated; no data was persisted.`);
    return {
      ok: true,
      status: method === "POST" ? 201 : method === "DELETE" ? 204 : 200,
      data: (method === "DELETE" ? null : body) as TResponse,
    };
  }

  const fixtureName = await fixtureFor(path);
  if (!fixtureName) {
    return { ok: false, status: 404, kind: "api", message: `No fixture maps to GET ${path}.` };
  }

  return readFixture<TResponse>(fixtureName);
}

async function readFixture<TResponse>(fixtureName: string): Promise<ApiResult<TResponse>> {
  try {
    const contents = await readFile(join(FIXTURES_DIRECTORY, fixtureName), "utf8");
    return { ok: true, status: 200, data: JSON.parse(contents) as TResponse };
  } catch (error) {
    return {
      ok: false,
      status: 404,
      kind: "api",
      message: `Fixture ${fixtureName} is unavailable: ${error instanceof Error ? error.message : "read failed"}`,
    };
  }
}

async function fixtureFor(path: string): Promise<string | undefined> {
  const pathname = path.split("?")[0];
  if (pathname === "/api/v1/protocols") return "protocols.json";
  if (pathname === "/api/v1/metric-fields") return "metric-fields.json";
  if (/\/verdicts$/.test(pathname)) return "verdicts.json";
  if (/\/snapshots$/.test(pathname)) return "snapshots.json";
  const sector = pathname.match(/^\/api\/v1\/sectors\/([^/]+)\/table$/)?.[1];
  if (sector) return sectorTableFixture(decodeURIComponent(sector));

  const protocol = pathname.match(/^\/api\/v1\/protocols\/([^/]+)$/)?.[1];
  return protocol
    ? findProtocolFixture(decodeURIComponent(protocol), FIXTURES_DIRECTORY)
    : undefined;
}

async function readResponseBody(response: Response): Promise<unknown> {
  if (response.status === 204) return null;
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function errorMessage(payload: unknown, status: number): string {
  if (typeof payload === "string" && payload) return payload;
  if (payload && typeof payload === "object" && "message" in payload) {
    const message = payload.message;
    if (Array.isArray(message)) return message.join(", ");
    if (typeof message === "string") return message;
  }
  if (status === 429) return "Превышен лимит запросов, подождите и повторите попытку.";
  return `Research API returned HTTP ${status}.`;
}
