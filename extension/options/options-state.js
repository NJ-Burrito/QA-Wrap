/* QA Wrap — settings page: the shared page state, split out of options.js so the parts can set it (setters, no behaviour change). */
import { DEFAULTS } from '../platform/settings.js';

/*
 * A language change repaints this page. It does not reload it.
 *
 * A settings page that reloads loses the folder somebody was half way through
 * typing, and the tester who has just discovered the language control is
 * exactly the tester in the middle of filling this form in. So the static text
 * is filled in again from the table and every function that writes words by
 * hand is called a second time; nothing reads a form field back or writes one.
 * `booted` keeps the very first change - the one `chrome.storage.sync` can
 * announce a few milliseconds after load, from another machine - from painting
 * a page whose controls do not exist yet; boot paints it correctly anyway.
 */
let booted = false;
const setBooted = (v) => { booted = v; };

let settings = { ...DEFAULTS };
const setSettings = (v) => { settings = v; };
let policyStatus = 'default';
const setPolicyStatus = (v) => { policyStatus = v; };

/**
 * Writes are coalesced: dragging a slider fires dozens of input events, and
 * every one of them would otherwise be a storage round-trip.
 */
/**
 * One debounce, and it used to eat whatever was waiting in it.
 *
 * `clearTimeout(saveTimer)` cancelled the pending commit and the next call sent
 * only *its own* patch, so a patch that was still waiting was dropped on the
 * floor. Typing a folder into "Save into" and then ticking "Ask where to save"
 * within a quarter of a second lost the folder every time; measured, with the
 * settings object read back out of `chrome.storage.sync` afterwards. The same
 * hole swallowed a half-typed `maskExtraPattern`.
 *
 * So the pending patch accumulates rather than being replaced, and whichever
 * commit runs first sends all of it. Nested objects merge the way `settings`
 * merges them, or two keymap patches in the same quarter-second would lose the
 * first binding.
 *
 * `pagehide` flushes what is still waiting. A settings page is closed the
 * moment somebody has finished changing something, which is exactly when a
 * quarter-second debounce is still holding their last edit.
 */
let integ = { repaint() {} };
const setInteg = (v) => { integ = v; };

/* --------------------------------------------------------------------- boot */

let profileUi = { paint() {} };
const setProfileUi = (v) => { profileUi = v; };

export { booted, integ, policyStatus, profileUi, setBooted, setInteg, setPolicyStatus, setProfileUi, setSettings, settings };
