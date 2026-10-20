# Arabesque, the Arabesque Labs design system, vendored

From the design system at **0.6.0** (https://design.arabesquelabs.com/,
`v/0.6.0/`), copied unchanged. (0.6.0 made the type scale larger, its base
17px where it was 15, in `arabesque.css`'s tokens; 0.5.1 made the sidebar a
bar with a menu button on a phone, in `arabesque.css` and `js/sidebar.js`,
the menu button being `js/nav-menu.js`.) Don't edit these:
to update, copy the new version's files over them and change the version
here. The sidebar's markup is hunt's own, in `../../index.html`: a new
version may ask for it to change too (its changelog says).

| File | From | Served as |
|---|---|---|
| `arabesque.css` | `dist/arabesque.css`: the tokens, base, layout, components and utilities, in cascade layers | first in `/style.css` |
| `js/datepicker.js`, `js/format.js`, `js/position.js` | `js/`: the date picker and what it imports | `/vendor/arabesque/js/…` |
| `js/tooltip.js`, `js/chart.js` | `js/`: the charts' tooltips, and their marks from the keyboard (Stats) | `/vendor/arabesque/js/…` |
| `js/sidebar.js`, `js/nav-menu.js` | `js/`: the sidebar's menu, under the md width, and its menu button | `/vendor/arabesque/js/…` |
| `dist/icons.svg` | `dist/icons.svg`: the icon sprite (the date picker's chevrons, the sidebar's toggle, search, notices, the menu) | `/vendor/arabesque/dist/icons.svg` |

The lattice (`../../tokens.css`) is the system's pattern tile,
`dist/patterns/tile.svg`, drawn as a mask in a colour of hunt's.

`js/datepicker.js` is the system's with one fix that 0.6.0 doesn't have
yet: the calendar's dialog is in the page only while it's open, which hunt
needs as it redraws its forms. Replace it with the system's once a release
has that fix.

hunt's own CSS is unlayered, so it wins over the system's layers wherever
both style something; `../../style.css` keeps only what's hunt's own.
