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
