# Training guides

Two guides for GroundWorks customers, served by the site itself.

| Guide | Who it is for | Live address | File |
|---|---|---|---|
| Index | Everyone | `/guides` | `public/guides/index.html` |
| Barista Guide (Part 1) | Baristas and day-one staff | `/guides/barista` | `public/guides/barista.html` |
| Owner Guide (Part 2) | Owners and managers | `/guides/owner` | `public/guides/owner.html` |

On the live site that is `https://www.groundworksinventory.dev/guides`.

## How they work

- Each guide is one self-contained HTML file. The screenshots are embedded in it as images, so there is nothing else to deploy.
- The clean URLs (no `.html`) come from `rewrites()` in `next.config.ts`.
- They are marked `noindex`, so they stay out of search results but anyone with the link can open them.
- Signed-in users see links to both guides at the bottom of the dashboard.
- Both guides print well (use the browser's print dialog). The barista guide ends with a one-page counter card that prints on its own sheet.

## Editing

Edit the HTML files in `public/guides/` directly. The text is ordinary HTML; only the embedded screenshots are long blocks of encoded data. The screenshots show an example shop ("Sunrise Coffee"), so if the app's screens change a lot, retake them.

The guides are written as suggestions, not rules: "Suggestion" boxes describe common approaches and "Your call" boxes mark choices that belong to the shop. Keep that tone when editing.
