# QA Wrap, the public site

Four static pages, one stylesheet, one small toggle script, no build step. Copy
the contents of this folder onto any static host and it works. Every page is
bilingual: an English block and an Arabic block on the same page, switched by
the button in the header (`assets/site.js`), each block carrying its own
`lang`/`dir` so a screen reader, a search engine, or a plain view-source finds
correct markup either way.

```text
site/
  index.html       the product page: what QA Wrap is, the nineteen tools, screenshots
  privacy.html     the privacy policy the Chrome Web Store fetches at review
  terms.html       the terms of service and the licensing model
  support.html     how to get help, the Report a problem flow, and the mailbox
  assets/site.css  every page loads this and nothing else (plus assets/thmanyah.css)
  assets/site.js   the language toggle: flips one attribute, remembers the choice, nothing else
  assets/favicon.svg
  assets/thmanyah.css  Thmanyah as base64 data: URIs, copied from extension/ui/fonts.css
                    (the licence forbids loose font files); no third-party font host
  assets/shots/    the five store screenshots, copied from extension/store/shots/
  try/index.html   the practice page (three planted faults); try/sw.js answers its save with a 500
```

Every link inside the site is a bare filename (`privacy.html`, not
`privacy/`), so the whole folder can sit at the web root or under any prefix
without a single edit, and a plain static file server needs no rewrite rules
to serve it.

## The paths are a contract

`PRODUCT.urls` in `extension/lib/product.js` names three of these addresses,
and `manifest.json` repeats the first one. `tools/release-check.mjs` fails the
build if the manifest and the module disagree, and — since this round — also
checks that the three files below exist at the repository root and that each
`PRODUCT.urls` path resolves to one of them, by path only. Nothing offline can
check that the address actually answers over the network, so that part is on
whoever runs the deploy.

| `PRODUCT.urls` entry | Path | Must be served by |
| --- | --- | --- |
| `homepage` | `<your site>/` | `index.html` |
| `support` | `<your site>/support` | `support.html` |
| `privacy` | `<your site>/privacy` | `privacy.html` |

The addresses are set in `extension/brand/brand.json` (`urls`). They are empty today: no website is set, and the extension hides every link that would read one.

`terms.html` exists on the site (decision 11 in
`research/56-decisions-2026-09-07.md` asks for it, alongside privacy and
support) but has no `PRODUCT.urls` entry to answer to: nothing currently reads
`PRODUCT.urls.terms`, and this folder does not add one on its own, per this
round's instruction not to change `extension/` unless a path here disagrees
with what `lib/product.js` already claims. It does not. If a `terms` entry is
wanted later, add it beside the other three in `URLS` and it will resolve to
`terms.html` the same way.

**Extensionless URLs.** `PRODUCT.urls` writes paths with no trailing slash and
no `.html` (`/qa-wrap/support`, not `/qa-wrap/support.html` or
`/qa-wrap/support/`). Most static hosts serve a clean path like that by trying
`<path>.html` when `<path>` itself is not a directory — Netlify, Cloudflare
Pages and GitHub Pages all do this by default, and nginx needs one `try_files`
line:

```nginx
location /qa-wrap/ {
  try_files $uri $uri.html $uri/ =404;
}
```

Apache needs `MultiViews` on, or an explicit rewrite to the same effect. Check
this before anything else if a page 404s after deploy: the file is present,
the rewrite is what is missing.

## Deploy

Push this folder's **contents** (not the `site/` folder itself) to any static host, or copy them into a
folder on your own web server: framework preset **None**, no build command, publish directory `/`. Add the
extensionless-URL rewrite above if the server does not already try `<path>.html` for a clean path. Check the
three addresses in the table in a browser, then `/terms`, then that `assets/site.css` and one font file return
200 rather than an HTML error page. Nothing here needs PHP, a database, or write access.

GitHub Pages additionally needs an empty `.nojekyll` file at the root, so Jekyll does not drop files whose name
starts with an underscore (there is none today; that is not a reason to leave the trap set).

Once it is live, put its address in `extension/brand/brand.json` (`urls`) and run
`node tools/build-brand.mjs --write`.

## The contact

There is no mailbox yet: the pages name "the developer contact on the Chrome Web Store listing". When a mailbox
exists, set `emails.support` and `emails.security` in `extension/brand/brand.json`; the extension then shows its
mail links.

## When you change something

- The colours, radii and type in `assets/site.css` are **copied** from
  `identity/tokens/tokens.css`, because a static site cannot import the
  extension's stylesheet. The copy is dated: it matches the tokens as of
  5 September 2026. If the tokens change, change them here by hand and say so
  in `research/23-site.md`.
- `privacy.html` carries the same content as `extension/PRIVACY.md` in both
  languages, which ships inside the package. The store compares the English
  text on this page with the file. Change them in the same change.
- `terms.html` carries a handful of sentences that go beyond what
  `extension/LICENSE`, `extension/TERMS.md` and decision 27 state outright —
  each is marked in the page source with an HTML comment reading
  `drafted, needs the owner's legal review`. The owner's legal counsel should read those
  specific sentences before this page is relied on in a dispute; nothing else
  on the page needs that review because nothing else says more than its
  source already does.
- The screenshots are copies of `extension/store/shots/*.png`. Regenerate them
  with `node tools/store-shots.mjs` in the extension, then copy them across
  again, and update the `alt` text — in both languages — if what is in the
  picture changed.
- The Arabic block on every page was drafted from the English block beside it,
  by a person, not machine-translated at build time. A correction to the
  English prose is not done until its Arabic pair is corrected too; the two
  are one unit, not two documents that happen to share a page.
