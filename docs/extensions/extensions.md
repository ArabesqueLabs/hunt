# Browser extensions

![hunt's browser extension: the popup, keeping the page you're on in your stash](../screenshots/browser-extension-intro.png)

The hunt extension keeps what you find while you browse (a job posting, a
link, an image, or a few lines you've selected) in your
[stash](../cli/stash.md), to sort later. One click from the toolbar, a
right-click, or a keyboard shortcut, and it's in your hunt; hunt says what it
thinks it could become, and you sort it when you're ready.

It's one extension for Chrome, Edge, Firefox and Safari, in light and dark,
and in English or Arabic, following your hunt account's language.

> The extensions are still in active development, and will be in your
> browser's extension store soon. Until then, you can
> [build and load them yourself](#building-the-extensions).

## Connecting it to your hunt

The extension needs to know where your hunt is, and a token to send with.

1. In hunt, go to **Settings → Connected apps → New token**. A token that
   only adds to your stash is enough. Copy it: hunt shows it once.
2. The extension's settings open when you install it. (Later, use the
   settings button in its popup.) Give it hunt's address as you open it,
   such as `https://hunt.example.com` or `http://localhost:4848`, and the
   token, then press **Connect**.
3. The browser asks to let the extension reach that address, and nothing
   else. Allow it, and the extension checks the address and token with hunt,
   then says whose stash it's connected to.

![The extension's settings: hunt's address, the token, Cloudflare Access, and the keyboard shortcuts](../screenshots/extension-settings-light.png#gh-light-mode-only)
![The extension's settings: hunt's address, the token, Cloudflare Access, and the keyboard shortcuts](../screenshots/extension-settings-dark.png#gh-dark-mode-only)

The token is kept in this browser's local storage, and isn't synced. Give
each browser its own token, so you can revoke one alone in hunt's Settings.

Until it's connected, the popup points you to its settings:

![The popup before it's connected: Connect your hunt first, and Open settings](../screenshots/extension-connect-light.png#gh-light-mode-only)
![The popup before it's connected: Connect your hunt first, and Open settings](../screenshots/extension-connect-dark.png#gh-dark-mode-only)

## Keeping something in your stash

### From the toolbar

Press hunt's button in the browser's toolbar, or
<kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>H</kbd>. The popup has the page's
address and title, and a note: what you'd selected on the page is in it
already. Change what you like, then press **Stash** (or
<kbd>Ctrl</kbd>+<kbd>Enter</kbd>, <kbd>⌘</kbd>+<kbd>Enter</kbd> on a Mac).

![The popup on a job posting: its address, title, and the selected text as the note](../screenshots/extension-popup-light.png#gh-light-mode-only)
![The popup on a job posting: its address, title, and the selected text as the note](../screenshots/extension-popup-dark.png#gh-dark-mode-only)

Untick **Keep the page's link** to keep just the note, without the page.

Once it's kept, the popup says what hunt thinks it could become: an
application, a person, a company, a task, or a note on something already in
hunt. **Sort it in hunt** opens your stash.

![Kept: hunt says it looks like a job posting, with a link to sort it in hunt](../screenshots/extension-kept-light.png#gh-light-mode-only)
![Kept: hunt says it looks like a job posting, with a link to sort it in hunt](../screenshots/extension-kept-dark.png#gh-dark-mode-only)

### From the right-click menu

Right-click a page, a link, an image or some selected text, and choose:

| Right-click on | Choose | What's kept |
|---|---|---|
| A page | **Stash this page to hunt** | The page's address and title |
| A link | **Stash this link to hunt** | The link, with its text as the title |
| An image | **Stash this image to hunt** | The image's address, from the page it's on |
| Selected text | **Stash the selection to hunt** | The page, with the selection as the note |

### With a keyboard shortcut

| Shortcut | What it does |
|---|---|
| <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>K</kbd> | Keeps the page you're on, at once, without the popup |
| <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>H</kbd> | Opens the popup |

Change them in your browser's own shortcut settings: the extension's
settings show them as they are, and **Change them** takes you there.

Without the popup, hunt's toolbar button says how it went for a few seconds:
**✓** when it's kept, or **!** when it isn't, with the reason in its
tooltip.

## Adding someone from LinkedIn

LinkedIn only shows a profile to people signed in to it, so hunt can't read
one itself. On someone's LinkedIn profile, the popup offers to bring them
in: press **Add to hunt's people** (or right-click the page, and choose
**Add this person to hunt**).

![The popup on a LinkedIn profile: Add to hunt's people, above the usual form](../screenshots/extension-linkedin-light.png#gh-light-mode-only)
![The popup on a LinkedIn profile: Add to hunt's people, above the usual form](../screenshots/extension-linkedin-dark.png#gh-dark-mode-only)

The extension collects the profile's text from the page, and opens hunt
beside it, where you tick what to keep: their name, role, company,
location, about and photo. What to do when there's someone of that name
already is in hunt's **Settings → Connected apps → LinkedIn profiles**.

You can still keep the profile in your stash instead, with the form below.

## Behind Cloudflare Access

Cloudflare Access turns away anything that hasn't signed in, before hunt
sees it. The extension sends the browser's cookies, so it gets in whenever
you're signed in to hunt in the same browser. When that sign-in has
expired, the popup says so, and **Open hunt to sign in** takes you there.

Or, to get in without your sign-in, open **Behind Cloudflare Access** in
the extension's settings, and give it an Access service token's client ID
and secret. Access needs a Service Auth policy that lets that token in.
With a service token, the extension leaves the browser's cookies out, so
your own sign-in to hunt in that browser stays as it is.

## What it sends, and where

Only what you choose to send, and only to your hunt:

- **When you keep something:** the address, the title and your note, to
  your hunt's stash, marked as from the extension.
- **When the popup opens, or you connect:** it asks your hunt whose stash
  it is, and in what language, to show you.
- **On the page:** it reads what you've selected only when you open the
  popup, and nothing else on the page. On a LinkedIn profile, it reads the
  profile's text only when you ask to add the person.

The browser lets it reach your hunt's address alone. Disconnecting in its
settings forgets the token and that permission; the token itself works
until you revoke it in hunt.

## When something's wrong

| The popup says | What to do |
|---|---|
| **Connect your hunt first** | Open its settings, and [connect it](#connecting-it-to-your-hunt). |
| Couldn't reach your hunt | Check hunt's running, and that the address in the extension's settings is the one you open hunt at. |
| That isn't hunt at … | The address answers, but it isn't hunt: check it in the extension's settings. |
| hunt didn't take the token | It may have been revoked, or mistyped: make a new one in hunt, and give it to the extension. |
| The browser hasn't allowed the extension to reach your hunt | Press **Connect** again in the extension's settings, and allow it. |
| Your hunt is behind Cloudflare Access | Sign in to hunt in this browser, or give the extension a [service token](#behind-cloudflare-access). |

## Building the extensions

Until they're in the stores, you can build them and load them in your
browser yourself. From hunt's source, go to the `extension` directory, and
build them:

```sh
cd extension
make            # Chrome and Firefox, in dist/chrome and dist/firefox
make safari     # an Xcode project for Safari, in dist/safari (needs Xcode)
```

Each browser's build is in `extension/dist/<browser>`, unpacked, and zipped
as `hunt.zip` for its store. Then load it:

- **Chrome or Edge:** open `chrome://extensions`, turn on **Developer
  mode**, press **Load unpacked**, and choose `extension/dist/chrome`[^2].
- **Firefox:** open `about:debugging#/runtime/this-firefox`, press **Load
  Temporary Add-on**, and choose `extension/dist/firefox/manifest.json`[^1].
  Firefox forgets it when it restarts.
- **Safari:** run `make safari`, open the project in Xcode, and run it. Then
  turn the extension on in Safari's settings (with **Developer → Allow
  unsigned extensions**, until it's signed)[^3].

Then [connect it to your hunt](#connecting-it-to-your-hunt).

[^1]: https://extensionworkshop.com/documentation/develop/temporary-installation-in-firefox/
[^2]: https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked
[^3]: https://developer.apple.com/documentation/safariservices/running-your-safari-web-extension
