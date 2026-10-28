// The extension's settings: which hunt to send to, and how to get in. Kept
// in this browser's local storage, not synced: the token is a secret, and
// each browser gets a token of its own (so one can be revoked alone).

export const DEFAULTS = {
  server: '',        // hunt's address: https://hunt.example.com
  token: '',         // a personal access token, from Settings → Connected apps
  accessId: '',      // behind Cloudflare Access: a service token's client ID…
  accessSecret: '',  // …and its secret (optional: the browser's own sign-in works too)

  // Who it was last, as hunt said: shown in the popup, and its language.
  email: '',
  language: '',
};

export function load() {
  return chrome.storage.local.get(DEFAULTS);
}

export function save(changes) {
  return chrome.storage.local.set(changes);
}

/** Whether there's a hunt to send to, and a token to send with. */
export function connected(settings) {
  return Boolean(settings.server && settings.token);
}

/**
 * hunt's address as typed, made an origin: `hunt.example.com/` is
 * `https://hunt.example.com`. Null when it isn't an address.
 */
export function originOf(typed) {
  let text = (typed || '').trim();
  if (!text) {
    return null;
  }
  if (!/^https?:\/\//i.test(text)) {
    // This machine, or one on the local network, is seldom HTTPS.
    const local = /^(localhost|127\.|\[::1\]|[^/:]+\.local\b)/i.test(text);
    text = (local ? 'http://' : 'https://') + text;
  }
  try {
    const url = new URL(text);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : null;
  } catch {
    return null;
  }
}

/** What the browser has to allow for the extension to reach hunt at `origin`. */
export function accessTo(origin) {
  return { origins: [origin + '/*'] };
}
