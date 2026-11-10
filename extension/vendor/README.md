# Vendored third-party code

## axe.min.js

- Package: axe-core@4.13.0
- License: MPL-2.0
- Source: https://github.com/dequelabs/axe-core
- Bytes: 580491
- SHA-256: c24f097bd2f451d4f933e8bc7d8d539f8672a2ebcb5cc9f9f3eec8ca9470a0c1

Vendored, not fetched at runtime: MV3 forbids remote code, and the whole point of
UQA is that nothing leaves the machine. Refresh with:

    npm i -D axe-core@<version>, copy node_modules/axe-core/axe.min.js over vendor/axe.min.js,
    then update Package, Bytes and SHA-256 above.

`node tools/release-check.mjs` recomputes the SHA-256 and refuses a release when it differs.
axe-core is a build-time dependency only; the file above is what ships.

## psl-data.js

- Data: the Public Suffix List, snapshot 2026-11-09 (https://publicsuffix.org/list/public_suffix_list.dat)
- License: MPL-2.0
- SHA-256 of the source list: 347b147702878a99c37f699ab796a3c8eae3e4ee648db4eae5968d6f1583b037

Compacted, not edited, by `node tools/build-psl.mjs <public_suffix_list.dat>`, which also rewrites the block between `/*PSL:BEGIN*/` and `/*PSL:END*/` in
`content/page-hooks.js` (the page hook classifies in the page and cannot import a module). `node tools/build-psl.mjs --check` and `tools/test-netfilter.mjs`
fail if the two copies differ. Used for "is this host part of the app" (core/netfilter.js, the page hook), never fetched at runtime.
