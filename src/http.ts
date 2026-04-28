import { CliError, EXIT, type ExitCode } from "./exit-codes.js";
import { baseUrl as defaultBaseUrl } from "./config.js";

const VERSION = "0.2.0";

export interface VapiFetchOptions {
  apiKey: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  baseUrl?: string;
  retry?: boolean;
}

export interface PlannedRequest {
  method: string;
  url: string;
  body: unknown;
}

export function planRequest(
  method: string,
  resourcePath: string,
  opts: Pick<VapiFetchOptions, "query" | "body" | "baseUrl">,
): PlannedRequest {
  const url = buildUrl(resourcePath, opts.query, opts.baseUrl);
  return { method, url, body: opts.body ?? null };
}

export interface VapiUploadOptions {
  apiKey: string;
  formData: FormData;
  baseUrl?: string;
  retry?: boolean;
}

export function planUpload(
  method: string,
  resourcePath: string,
  opts: { fields: Record<string, string | number>; baseUrl?: string },
): PlannedRequest {
  const url = buildUrl(resourcePath, undefined, opts.baseUrl);
  return { method, url, body: { multipart: opts.fields } };
}

export async function vapiUpload<T = unknown>(
  method: string,
  resourcePath: string,
  opts: VapiUploadOptions,
): Promise<T> {
  const url = buildUrl(resourcePath, undefined, opts.baseUrl);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${opts.apiKey}`,
    "User-Agent": `bvapi/${VERSION}`,
    Accept: "application/json",
  };
  // Intentionally do NOT set Content-Type — fetch/undici fills in the
  // multipart boundary for us when body is a FormData.
  const init: RequestInit = { method, headers, body: opts.formData };

  const shouldRetry = opts.retry !== false;
  const res = await doFetch(url, init, shouldRetry);

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const data = text.length > 0 ? safeJson(text) : undefined;

  if (!res.ok) {
    throw new CliError(statusToExit(res.status), formatHttpError(method, url, res.status, data, text));
  }
  return data as T;
}

export async function vapiFetch<T = unknown>(
  method: string,
  resourcePath: string,
  opts: VapiFetchOptions,
): Promise<T> {
  const url = buildUrl(resourcePath, opts.query, opts.baseUrl);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${opts.apiKey}`,
    "User-Agent": `bvapi/${VERSION}`,
    Accept: "application/json",
  };
  const init: RequestInit = { method, headers };
  if (opts.body !== undefined && opts.body !== null) {
    headers["Content-Type"] = "application/json";
    init.body = typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body);
  }

  const shouldRetry = opts.retry !== false;
  const res = await doFetch(url, init, shouldRetry);

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const data = text.length > 0 ? safeJson(text) : undefined;

  if (!res.ok) {
    throw new CliError(statusToExit(res.status), formatHttpError(method, url, res.status, data, text));
  }
  return data as T;
}

async function doFetch(url: string, init: RequestInit, shouldRetry: boolean): Promise<Response> {
  const res = await fetch(url, init);
  if (shouldRetry && (res.status === 429 || res.status >= 500)) {
    await sleep(1000);
    return fetch(url, init);
  }
  return res;
}

function buildUrl(
  resourcePath: string,
  query: VapiFetchOptions["query"],
  baseOverride?: string,
): string {
  const base = baseOverride || defaultBaseUrl();
  const url = new URL(resourcePath.replace(/^\//, ""), base.endsWith("/") ? base : `${base}/`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null) continue;
      url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

function statusToExit(status: number): ExitCode {
  if (status === 401) return EXIT.AUTH;
  if (status === 403) return EXIT.FORBIDDEN;
  if (status === 404) return EXIT.NOT_FOUND;
  if (status === 429) return EXIT.RATE_LIMIT;
  if (status >= 500) return EXIT.RETRYABLE;
  return EXIT.ERR;
}

function formatHttpError(
  method: string,
  url: string,
  status: number,
  data: unknown,
  rawText: string,
): string {
  const detail = data && typeof data === "object" ? JSON.stringify(data) : rawText.slice(0, 500);
  return `${method} ${url} → ${status}\n${detail}`;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
