// Per-viewer conveniences, kept in this browser.

export function stored(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

export function store(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* private mode */ }
}

export function forget(key: string) {
  try { localStorage.removeItem(key); } catch { /* private mode */ }
}

/** Kept in this tab alone, for as long as it's open: across its reloads, not in another tab. */
export function storedHere(key: string): string | null {
  try { return sessionStorage.getItem(key); } catch { return null; }
}

export function storeHere(key: string, value: string) {
  try { sessionStorage.setItem(key, value); } catch { /* private mode */ }
}

export function forgetHere(key: string) {
  try { sessionStorage.removeItem(key); } catch { /* private mode */ }
}
