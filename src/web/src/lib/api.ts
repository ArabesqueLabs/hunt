// The JSON API under /api, which the CLI uses too.

import { toast } from "./toast";

export async function api(method: string, path: string, body?: unknown): Promise<any> {
  const res = await fetch("/api/" + path, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${res.status} ${res.statusText}`);
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
