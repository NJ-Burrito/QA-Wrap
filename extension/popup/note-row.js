/* QA Wrap — local-first QA toolkit in the ISTQB shape. */
/**
 * The note row (REQ-P1-3): type, press Enter, it is saved as a Bug.
 * Contract C6: `noteRowModel({lastType}) -> {controls}` and `defaultNoteType(stored)`.
 */
export const NOTE_TYPE_KEY = 'noteType';
export const NOTE_TYPES = ['bug', 'issue', 'question', 'note'];

/**
 * The stored value if it is one of the four, else Bug.
 * @param {unknown} stored
 */
export function defaultNoteType(stored) {
  const v = typeof stored === 'string' ? stored.trim().toLowerCase() : '';
  return NOTE_TYPES.includes(v) ? v : 'bug';
}

/** @param {unknown} type the wire tag popup.js sends: 'bug' | 'issue' | 'question' | '' */
export function tagForType(type) {
  const v = defaultNoteType(type);
  return v === 'note' ? '' : v;
}

/** The chip value for a wire tag ('' is the plain note). @param {unknown} tag */
export function typeForTag(tag) {
  return tag === '' || tag == null ? 'note' : defaultNoteType(tag);
}

/**
 * What the row shows before anything is pressed: the text box, the type chevron and the Add button are the three controls; the four chips only exist…
 * @param {{ lastType?: unknown }} [o]
 */
export function noteRowModel({ lastType } = {}) {
  const type = defaultNoteType(lastType);
  return {
    controls: 3,
    type,
    tag: tagForType(type),
    chips: NOTE_TYPES.slice(),
    chipsOpen: false,
  };
}

/**
 * The last chosen type, persisted. `area` is `chrome.storage.local` in the popup.
 * @param {{ get(k: string): Promise<any>, set(o: object): Promise<void> }} [area]
 */
export function createNoteType(area) {
  const store = area ?? globalThis.chrome?.storage?.local;
  let current = 'bug';
  return {
    get: () => current,
    tag: () => tagForType(current),
    async load() {
      try { current = defaultNoteType((await store?.get(NOTE_TYPE_KEY))?.[NOTE_TYPE_KEY]); } catch { current = 'bug'; }
      return current;
    },
    async set(type) {
      current = defaultNoteType(type);
      try { await store?.set({ [NOTE_TYPE_KEY]: current }); } catch { /* the choice lasts this popup */ }
      return current;
    },
  };
}

/** True for the Enter that means "save": not Shift-held composition, not an IME confirm. @param {{key?: string, isComposing?: boolean, keyCode?: number}} e */
export function isNoteSubmit(e) {
  return e.key === 'Enter' && !e.isComposing && e.keyCode !== 229;
}

/**
 * Enter in `input` calls `submit(tag)` with the wire tag of the current type.
 * Returns the unbind function.
 * @param {{ addEventListener: Function, removeEventListener: Function }} input
 */
export function bindNoteEnter(input, noteType, submit) {
  const onKey = (/** @type {any} */ e) => {
    if (!isNoteSubmit(e)) return;
    e.preventDefault?.();
    submit(noteType.tag());
  };
  input.addEventListener('keydown', onKey);
  return () => input.removeEventListener('keydown', onKey);
}
