// The JSON API under /api, which the CLI uses too.

import { toast } from "./toast";

/**
 * Where the API is, and what each request carries besides: this page's
 * /api/ and its cookie, for the web UI; a server's address and a token,
 * for the mobile app (which calls configureApi as it starts).
 */
const target: { base: string; headers: () => Record<string, string>; failed: (status: number, data: any) => void } = {
  base: "/api/",
  headers: () => ({}),
  failed: () => {},
};
export function configureApi(c: Partial<typeof target>) {
  Object.assign(target, c);
}

/** An error from the API, with its status (0: the server wasn't reached). */
export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly data: any) { super(message); }
}

export async function api(method: string, path: string, body?: unknown): Promise<any> {
  const res = await fetch(target.base + path, {
    method,
    headers: { ...target.headers(), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    target.failed(res.status, data);
    throw new ApiError(data.error || `${res.status} ${res.statusText}`, res.status, data);
  }
  return data;
}
export const get = (p: string) => api("GET", p);
export const post = (p: string, b?: unknown) => api("POST", p, b);
export const patch = (p: string, b?: unknown) => api("PATCH", p, b);
export const del = (p: string) => api("DELETE", p);
export const put = (p: string, b?: unknown) => api("PUT", p, b);
export const enc = encodeURIComponent;

/** Run an API action; on failure, say why and return undefined. */
export async function attempt<T>(fn: () => Promise<T> | T): Promise<T | undefined> {
  try {
    return await fn();
  } catch (e) {
    toast((e as Error).message, "error");
    return undefined;
  }
}
