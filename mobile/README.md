# hunt for iOS and Android

A React Native (Expo) app for hunt: what's due, your applications, and
your stash, with hunt in the phone's share sheet to keep a posting's link
for later.

It talks to any hunt you can reach, through the same JSON API as the web
UI and the CLI. Signing in sends your address and password once, for a
personal access token (it shows in Settings → Connected apps, as
"hunt app (iOS)" or "(Android)"); the phone keeps the token, never the
password.

## Running it

Needs Node, and Xcode (iOS) or Android Studio (Android). The share sheet
is native code, so the app runs as a development build, not in Expo Go.

```sh
npm install
npm run ios        # or: npm run android
```

Then point it at a hunt: `make dev-demo` in the repository's root runs one
on 127.0.0.1:4848 (sign in as user@example.com, password huntdemo). From
an Android emulator, that's http://10.0.2.2:4848.

`npm run check` typechecks it; `npm run doctor` checks Expo's setup.

## Shared with the web UI

The web UI's data layer, `src/web/src/lib` (the API client, dates and
money, the board and its filters), is imported here as `@web/…`, not
copied: see `metro.config.js`. Those files must load without a page (no
`document`, `window` or `location` as they load), so the app can use
them.
