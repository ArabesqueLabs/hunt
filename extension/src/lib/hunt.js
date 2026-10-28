// Talking to hunt: keeping something in the stash, and asking whose stash
// it is. Every request carries the token (Authorization: Bearer), and,
// behind Cloudflare Access, the service token if one's set, and the
// browser's own cookies (so Access lets through someone signed in to it in
// this browser).

/** Why a request didn't work, for the popup and the settings to say. */
export class HuntError extends Error {
  /**
   * `kind` is one of: 'unreachable' (no answer), 'access' (Cloudflare
   * Access wants a sign-in), 'token' (not a good token), 'refused' (the
   * token can't do that), 'permission' (the browser hasn't allowed the
   * extension to reach hunt), or 'failed' (anything else hunt said).
   */
  constructor(kind, message) {
    super(message);
    this.kind = kind;
  }
}

function headers(settings, json) {
  const h = { Authorization: 'Bearer ' + settings.token.trim() };
  if (json) {
    h['Content-Type'] = 'application/json';
  }
  if (settings.accessId && settings.accessSecret) {
    h['CF-Access-Client-Id'] = settings.accessId.trim();
    h['CF-Access-Client-Secret'] = settings.accessSecret.trim();
  }
  return h;
}

async function call(settings, method, path, body) {
  const origin = settings.server;
  const allowed = await chrome.permissions.contains({ origins: [origin + '/*'] });
  if (!allowed) {
    throw new HuntError('permission', 'The browser hasn’t allowed the extension to reach ' + origin + '.');
  }
  let res;
  try {
    res = await fetch(origin + path, {
      method,
      headers: headers(settings, body !== undefined),
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'include',
      // Access answers someone it hasn't signed in with a redirect to its
      // sign-in page; hunt's API never redirects.
      redirect: 'manual',
      cache: 'no-store',
    });
  } catch {
    throw new HuntError('unreachable', 'Couldn’t reach hunt at ' + origin + '.');
  }
  if (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400)) {
    throw new HuntError('access', 'This hunt is behind Cloudflare Access: sign in to it in this browser, then try again.');
  }
  const data = await res.json().catch(function () {
    return null;
  });
  if (res.ok && data) {
    return data;
  }
  const said = (data && data.error) || 'hunt said ' + res.status + '.';
  if (res.status === 401) {
    throw new HuntError('token', said);
  }
  if (res.status === 403) {
    throw new HuntError('refused', said);
  }
  throw new HuntError(res.ok ? 'unreachable' : 'failed', res.ok ? 'That isn’t hunt at ' + origin + '.' : said);
}

/**
 * Keep something in the stash: `{url?, title?, body?}`. Returns the item,
 * with hunt's suggestion of what it could become.
 */
export function keep(settings, capture) {
  return call(settings, 'POST', '/api/stash', Object.assign({ source: 'extension' }, capture));
}

/** Whose stash it is: `{email, name, language, token: {name, scope}}`. */
export function whoami(settings) {
  return call(settings, 'GET', '/api/stash/me');
}

/** A page of hunt's, at the address the settings give. */
export function page(settings, path) {
  return settings.server + path;
}
