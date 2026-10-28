# Send to hunt: the browser extension

Keep the page you're on, a link, an image or what you've selected in your
hunt [stash](../docs/cli/stash.md), to sort later. It works from:

- **the toolbar button:** a popup with the page's title, a note (what's
  selected on the page is put in it already), and **Keep in stash**. Then
  it says what hunt thinks the item could become ("It looks like a job
  posting"), with a link to sort it in hunt;
- **the right-click menu:** **Send this page / link / image / the selection
  to hunt**;
- **a keyboard shortcut:** <kbd>Alt</kbd><kbd>Shift</kbd><kbd>K</kbd> keeps
  the page at once, and <kbd>Alt</kbd><kbd>Shift</kbd><kbd>H</kbd> opens the
  popup. Change them in the browser's own shortcut settings.

Without the popup, the toolbar button says how it went for a few seconds:
✓, or ! with the reason in its tooltip.

It's one Manifest V3 extension for Chrome, Edge, Firefox and Safari: plain
JavaScript, no bundler and no packages. It's built on the Arabesque Labs
design system (vendored in [`src/vendor/arabesque/`](src/vendor/arabesque/README.md)),
in light and dark, and in English or Arabic (right to left), following the
hunt account's language.

## Connecting it

1. In hunt, **Settings → Connected apps → New token**. One that adds to
   your stash is enough. Copy it: it's shown once.
2. The extension's settings open when it's installed (or use the popup's
   settings button). Give it hunt's address as you open it
   (`https://hunt.example.com`, or `http://localhost:4848`) and the token,
   then **Connect**. The browser asks to let the extension reach that
   address, and nothing else.
3. Connecting checks both with hunt, and says whose stash it is.

The token is kept in this browser's local storage, not synced. Give each
browser its own token, so you can revoke one alone in hunt.

### Behind Cloudflare Access

Access turns away anything it hasn't signed in, before hunt sees it. The
extension sends the browser's cookies, so it gets in when you're signed in
to hunt in this browser. When that sign-in has expired, the popup says so
and opens hunt for you to sign in again. Or, under **Behind Cloudflare
Access**, give it an Access service token's client ID and secret (with a
Service Auth policy that lets the token in), and it gets in without your
sign-in. See the main [README](../README.md#cloudflare-access).

## What it sends, and where

Only what you choose to send, and only to your hunt: `POST /api/stash`
with the page's address, its title and your note, marked as from the
extension. When it's connecting or the popup opens, it also asks
`GET /api/stash/me` whose stash it is and in what language. It reads the
selected text on a page only when you open the popup there, and nothing
else on the page.

## Building

```sh
make            # dist/chrome/ and dist/firefox/, unpacked and zipped (send-to-hunt.zip)
make chrome     # or just one
make firefox
make validate   # the manifests are JSON, and the scripts parse
make safari     # an Xcode project for Safari, in dist/safari/ (needs Xcode)
```

To try it out without a store:

- **Chrome or Edge:** `chrome://extensions` → Developer mode → **Load
  unpacked** → `dist/chrome`.
- **Firefox:** `about:debugging#/runtime/this-firefox` → **Load Temporary
  Add-on** → `dist/firefox/manifest.json`. `npx web-ext lint --source-dir
  dist/firefox` checks it as addons.mozilla.org will.
- **Safari:** `make safari`, open the project in Xcode and run it. Then
  enable the extension in Safari's settings (Developer → Allow unsigned
  extensions, until it's signed). Sharing it needs an Apple developer
  account.

## Layout

| | |
|---|---|
| `src/manifest-chrome.json`, `src/manifest-firefox.json` | each browser's manifest (Firefox: background scripts, its theme icons, its id) |
| `src/background.js` | the right-click menu and the keyboard shortcut that keeps the page at once |
| `src/popup/` | the toolbar popup |
| `src/options/` | the settings page: hunt's address, the token, Access, the shortcuts |
| `src/lib/settings.js` | the settings, in local storage |
| `src/lib/hunt.js` | hunt's API: keeping something, and whose stash it is |
| `src/lib/i18n.js` | the Arabic, looked up by the English, as hunt's web UI does |
| `src/icons/` | hunt's logo (`mark.svg`, from `src/web/img/logo.svg`) at each size, and reversed for Firefox's dark toolbars |
| `src/vendor/arabesque/` | the design system's CSS and fonts |

The icons are drawn from the logo with `rsvg-convert` (`brew install
librsvg`): in ink, and white for `*-reversed.png`.
