/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/** Product identity; block below is generated from brand/brand.json. */

// brand:begin (generated from brand/brand.json by tools/build-brand.mjs; edit that file, not this block)
const URLS = Object.freeze({
  homepage: 'https://nj-burrito.github.io/QA-Wrap/',
  support: 'https://nj-burrito.github.io/QA-Wrap/support.html',
  privacy: 'https://nj-burrito.github.io/QA-Wrap/privacy.html',
  practice: 'https://nj-burrito.github.io/QA-Wrap/try/',
  trust: 'https://nj-burrito.github.io/QA-Wrap/trust.html',
  terms: 'https://nj-burrito.github.io/QA-Wrap/terms.html',
});

export const PRODUCT = Object.freeze({
  name: 'QA Wrap',
  maker: 'Nader Alzghoul',
  publisher: 'Nader Alzghoul',
  lockup: 'QA Wrap by Nader Alzghoul',
  code: 'QAW',
  extensionId: 'dbdhilacpjeojfnmdbnpcbmohkhgaihn',
  tagline: 'Every failure, traced.',
  kind: 'Local-first QA toolkit in the ISTQB shape',
  supportEmail: 'naderalzghoulbusiness@gmail.com',
  listed: false,
  reviewUrl: '',
  urls: URLS,
  homepage: URLS.homepage,
  support: URLS.support,
  privacy: URLS.privacy,
  since: 2026,
});
// brand:end

export function productCode(version) {
  return `${PRODUCT.code}-${version || '0.0.0'}`;
}

export function describe() {
  const manifest = /** @type {{ version?: string }} */ (globalThis.chrome?.runtime?.getManifest?.() || {});
  const id = globalThis.chrome?.runtime?.id || PRODUCT.extensionId;
  return {
    name: PRODUCT.name,
    maker: PRODUCT.maker,
    publisher: PRODUCT.publisher,
    lockup: PRODUCT.lockup,
    version: manifest.version || null,
    code: productCode(manifest.version),
    extensionId: id,
    idMatchesKey: id === PRODUCT.extensionId,
    homepage: PRODUCT.homepage,
    support: PRODUCT.support,
    supportEmail: PRODUCT.supportEmail,
  };
}
