# Bug Hunt voice: licence record

Owner decision (Nader, 2026-10-12): the Bug Hunt narration is **Kore on Gemini TTS, in English and in Arabic**. The voice
follows the UI language: the Arabic UI plays `audio/ar/vNN.wav`, the English UI plays `audio/en/vNN.wav`, and a missing
Arabic file falls back to the English one (then to captions only). This replaces the free local Kokoro voice of earlier the
same day; the Kokoro takes are archived, not deleted.

| Part | What | Terms | Source |
| --- | --- | --- | --- |
| Voice model | `gemini-3.1-flash-tts-preview`, voice `Kore` (the one TTS model of the standing voice rule) | Google Gemini API terms; the key is the owner's, read at render time from `~/.config/qa-wrap/gemini.env` (variable `GEMINI_API_KEY`), sent only in the `x-goog-api-key` header, never written to the repo, a log or the ledger | https://ai.google.dev/gemini-api/docs/speech-generation |
| Renderer | `extension/tools/voice-render.mjs` (dev-only, never packaged): one call per line per language, one retry only when no audio came back (a 429 waits 65 s first), 26 calls at most, raw 24 kHz 16-bit mono PCM turned into WAV in Node | project code | this repo |
| Takes | `audio/en/v01.wav` to `v11.wav` and `audio/ar/v01.wav` to `v11.wav`, generated output | the game ships generated audio only; the model and the key do not ship | this repo |

Text rules:
- Arabic TTS input is `tts_text_ar` in the manifest, hand-vowelled on every word (case endings, shadda, tanwin, hamza seats),
  with the player addressed in the masculine singular and Kore's own feminine forms where the noun is feminine; notes in
  `work/sdlc/build/notes-game/TASHKEEL-AR.md`. Captions (`caption_ar`) stay unvowelled. "QA Wrap" and "Enter" stay Latin.
- English TTS input is `tts_text` (exclamations lift the delivery); the caption and `text` are never changed.
- Style: the registered `reel` style from `nj-writer/voice-styles.json` (direction copied byte for byte) for all 22 lines,
  English and Arabic (owner, 2026-10-12: energetic everywhere). English v02 to v04 were first voiced in `manual` and were
  re-voiced in `reel`; the first takes are kept in `work/sdlc/build/notes-game/voice-kore-take1/`.
  `voice_style_gate.py --text-only` runs over all 22 lines before any call.
- No ASR, no judge, no tashkeel checker, no second TTS; each line is voiced once per language; the owner listens.

## Archived: Kokoro take (superseded 2026-10-12)

The first English voice was Kokoro-82M v1.0 (ONNX, Apache-2.0) voice `af_heart` through `kokoro-js` 1.2.1, rendered by
`extension/tools/voice-render-local.mjs`. Its eleven WAV takes and its manifest are kept in
`work/sdlc/build/notes-game/voice-kokoro-take/`; the render log is `work/sdlc/build/notes-game/voice-local-render-log.json`.
The tool is kept for history and is no longer part of the shipped voice. The open note about the GPL-3.0 espeak-ng data in
`phonemizer` no longer applies to the shipped files, because no Kokoro audio ships.

## Packaged as Ogg Opus (15 Oct 2026)

The game is the packaged practice page (`practice/practice.html`), so the 15 voice takes ship inside the extension. The renderer's 24 kHz WAV
takes (5.4 MB) were re-encoded with ffmpeg only, no model call and no re-voicing, to `audio/en/vNN.ogg` and `audio/ar/vNN.ogg`
(224 KB in all) and the manifest's `file` / `file_ar` now name the `.ogg` files. Same line ids, same languages, same durations
(each file decodes in Chromium to the manifest's `seconds` within 0.05 s). The WAV takes are in git history. Command, per file:

    ffmpeg -i vNN.wav -ac 1 -c:a libopus -b:a 16k -vbr on -application voip vNN.ogg

If `tools/voice-render.mjs` is ever run again it writes WAV and names `.wav` in the manifest: re-encode and rename the paths again.
