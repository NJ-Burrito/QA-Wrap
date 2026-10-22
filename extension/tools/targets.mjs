/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * Build targets (T-046): moved out of core/capabilities.js so the service worker no longer parses ~4.7 KB
 * only the build reads. Kept next to the build; test-capabilities checks it against CAPABILITIES.
 */
import { readFileSync } from 'node:fs';

const BRAND = JSON.parse(readFileSync(new URL('../brand/brand.json', import.meta.url), 'utf8'));

/**
 * The manifest keys each engine needs, for the build to apply.
 *
 * Kept beside the capability list on purpose: the two go out of step the moment
 * they live in different files, and the symptom is a package that installs and
 * then cannot do the thing its manifest asked permission for.
 */
export const TARGETS = {
  chrome: {
    label: 'Chrome',
    engine: 'chromium',
    drop: [],
    note: 'The reference build. Every capability in this list is present, and this is the one every suite runs against.',
  },
  edge: {
    label: 'Edge',
    engine: 'chromium',
    drop: [],
    note: 'Chromium, so identical to the Chrome build. Listed separately only because the store is.',
  },
  brave: {
    label: 'Brave',
    engine: 'chromium',
    drop: [],
    note:
      'Chromium, and it installs the Chrome package from the Web Store. Brave Shields block ' +
      'third-party requests on the page under test, which changes what the network panel sees. ' +
      'That is the page being shielded, not the tool missing a request.',
  },
  opera: {
    label: 'Opera',
    engine: 'chromium',
    drop: [],
    note:
      'Chromium. Installs from the Chrome Web Store once "Install Chrome extensions" is enabled, ' +
      'or from Opera add-ons, which reviews separately.',
  },
  operagx: {
    label: 'Opera GX',
    engine: 'chromium',
    drop: [],
    note:
      'The same build as Opera. Its resource limiter can throttle a background tab mid-recording, ' +
      'so a long clip is best taken with the tab in front.',
  },
  duckduckgo: {
    label: 'DuckDuckGo',
    engine: 'chromium',
    drop: [],
    note:
      'The desktop browser is Chromium and takes this package. Its tracker protection blocks ' +
      'requests before they leave, which the network panel reports as blocked rather than failed.',
  },
  firefox: {
    label: 'Firefox',
    engine: 'gecko',
    /* Firefox rejects a manifest naming a permission it does not implement, and
       an install-time rejection is worse than a disabled button. */
    drop: ['offscreen', 'tabCapture', 'desktopCapture', 'debugger'],
    background: 'scripts',
    // A readable id from brand/brand.json (`geckoId`) — this one is chosen, unlike the
    // Chromium id, which is a hash of the signing key and cannot be picked.
    gecko: {
      id: BRAND.geckoId,
      strict_min_version: '140.0',
      /**
       * Required for every new AMO submission from 3 Nov 2025: what the
       * extension collects and transmits *off the user's machine*, not what
       * it stores locally (IndexedDB and `chrome.storage.local` are not this
       * key's subject — see PRIVACY.md). Categories, `required`/`optional`
       * shape, and the `none` special value are exactly as published at
       * https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/
       * and https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/browser_specific_settings
       * (both checked 2026-09-08).
       *
       * QA Wrap has no server, no analytics and no telemetry (SECURITY.md
       * "Threat model", PRIVACY.md "The one-sentence version"): nothing is
       * ever required to leave the machine for the extension to work, so
       * `required` is `none`. The only egress at all is a tester configuring
       * a tracker or a chat webhook in Settings and then pressing File/Send
       * on one session (PRIVACY.md "When data does leave your machine") —
       * every category below can only ever be sent on that explicit press:
       *
       *   websiteContent      the defect report / test case body, screenshots
       *   websiteActivity     the clicks, typing and navigation it is built from
       *   authenticationInfo  the tracker token or webhook URL the tester pasted
       *
       * `technicalAndInteraction` (the one category this key allows even for a
       * "no collection" extension to mark optional) is deliberately absent:
       * QA Wrap collects no usage analytics or crash reports at all, so
       * declaring it would claim a category that does not apply.
       */
      data_collection_permissions: {
        required: ['none'],
        optional: ['websiteContent', 'websiteActivity', 'authenticationInfo'],
      },
    },
    note:
      'MV3 with an event page rather than a service worker, and no offscreen document, so ' +
      'recording, GIF, full-page stitching and coverage are unavailable and say so.',
  },
  safari: {
    label: 'Safari',
    engine: 'webkit',
    drop: ['offscreen', 'tabCapture', 'desktopCapture', 'debugger'],
    /* Safari implements neither (BCD); the converter warns on both. Not in `drop`, which test-capabilities pins to
       core/capabilities.js: these two are guarded at the call site, not a CAPABILITIES entry. */
    omit: ['downloads', 'notifications'],
    note:
      'Safari loads MV3, but only after Xcode’s safari-web-extension-converter wraps it in an ' +
      'app. That is a macOS build step this project cannot run, so the folder is prepared and ' +
      'the command is printed rather than the package being claimed as built.',
  },
};
