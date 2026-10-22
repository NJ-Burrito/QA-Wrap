// Ambient declarations for the type ratchet (tools/test-types.mjs). Types only: no runtime, never shipped code.
// Globals set by classic scripts / other pages; DOM lookups by id or selector are untyped by design (the callers cast nowhere, they assume the element kind).
export {};
declare global {
  interface Window {
    UQABootTimings: any;
    UQACharts: any;
    UQADownload: any;
    UQAFiling: any;
    UQAFolder: any;
    UQAIcon: any;
    UQAIconMirror: any;
    UQAIcons: any;
    UQAIstqb: any;
    UQAMotion: any;
    UQAReport: any;
    UQAScenes: any;
    UQASound: any;
    UQATheme: any;
    UQAVfx: any;
    __njbFullPage: any;
    __njbHidden: any;
    __uqaGuided: any;
    __vfxWired: any;
    axe: any;
  }
  interface Document {
    getElementById(id: string): any;
    querySelector(selectors: string): any;
    querySelectorAll(selectors: string): NodeListOf<any>;
  }
  interface Element {
    querySelector(selectors: string): any;
    querySelectorAll(selectors: string): NodeListOf<any>;
    closest(selectors: string): any;
  }
  interface EventTarget { [k: string]: any }
  interface Event { key: string; [k: string]: any }
  var QAWi18n: any; var UQAFiling: any; var UQAEml: any;
}
