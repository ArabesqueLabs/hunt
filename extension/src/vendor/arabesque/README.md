# Arabesque Labs design system (vendored)

The popup and the settings page are built on the Arabesque Labs design
system, the same version hunt's web UI uses. An extension page can't load
CSS or fonts from a remote origin under its content security policy, so
the files are copied in here rather than linked.

| File | From |
|---|---|
| `arabesque.css` | hunt's `src/web/vendor/arabesque/arabesque.css` (the design system's `dist/arabesque.css`, 0.9.0) |
| `fonts/jost.woff2` | hunt's `src/web/fonts/`: interface text and headings |
| `fonts/plex-arabic-{400,500}.woff2` | hunt's `src/web/fonts/`: Arabic, when hunt's account is in Arabic |
| `fonts/ibm-plex-mono-latin.woff2` | the design system's `fonts/`: keyboard keys and tokens |
| `fonts/fonts.css` | hunt's `src/web/tokens.css`'s `@font-face` rules, for these faces |

Don't edit these files. When hunt's web UI takes a new version of the
design system, copy its `arabesque.css` here too, and check the popup and
the settings page in light and dark, and in Arabic.

The extension's own rules live in `../../popup/popup.css` and
`../../options/options.css`. They're unlayered, so they win over the
system's layers without `!important`; keep them to layout and to the few
things the system has no component for.

## Fonts

Jost, IBM Plex Sans Arabic and IBM Plex Mono are licensed under the SIL
Open Font License 1.1: `fonts/OFL-*.txt`.
