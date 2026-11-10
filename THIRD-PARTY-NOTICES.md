# Third-party notices

QA Wrap itself is MIT (see [LICENSE](LICENSE)). The components below were not
written by Nader Alzghoul, keep their own licences, and are **not** relicensed
by the MIT file. The full wording, with source locations, is in
[extension/NOTICE](extension/NOTICE).

| Component | Where | Licence | Notes |
|---|---|---|---|
| Public Suffix List snapshot 2026-11-09 (Mozilla Foundation and contributors, publicsuffix.org) | `extension/vendor/psl-data.js`, and the same data inside `extension/content/page-hooks.js` | MPL-2.0 | Compacted by `extension/tools/build-psl.mjs` (rules only, hosts in punycode), otherwise unmodified. SHA-256 of the source file: 347b147702878a99c37f699ab796a3c8eae3e4ee648db4eae5968d6f1583b037. Source: https://publicsuffix.org/list/public_suffix_list.dat |
| axe-core 4.13.0 (Deque Systems, Inc.) | `extension/vendor/axe.min.js` | MPL-2.0 | Unmodified. Source: https://github.com/dequelabs/axe-core (tag v4.13.0). |
| thmanyah Sans and Serif Display (thmanyah Publishing and Distribution, Reserved Font Name "thmanyah") | embedded as base64 `data:` URIs in `extension/ui/fonts.css` and in exported documents; the lockup `extension/brand/lockup.svg` holds outlines only | thmanyah's Font License. **Not an open licence.** | The MIT licence does not cover these fonts. They stay under their publisher's licence; no standalone font file is in this repository. If you fork, check that licence before redistributing the embedded faces, or replace them. |
| UI sound layers ("Glass & Air" set, recorded layers from freesound.org) | `extension/ui/sfx/` | CC0 1.0 (public domain dedication) for each recorded layer; the synthesis is QA Wrap's own (MIT) | Author, URL, retrieval date and sha256 of every file: `extension/ui/sfx/CREDITS.txt`. |
| Helper and development dependencies | `helper/npm-shrinkwrap.json`, `extension/package-lock.json` | each package's own licence | Not redistributed in the extension package. |
