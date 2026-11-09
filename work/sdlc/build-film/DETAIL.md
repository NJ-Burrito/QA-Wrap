# DETAIL: qaw-1109 film-ar (append-only log)

## Step 1 archaeology (done)
- Shipped EN 40 s film = HyperFrames 0.8.186 render (mp4 tag), 1920x1080/30fps, 17 captions, illustrated motion graphics (BUG-1042 ticket, stamp, icon chips, timeline, Jira RTL demo, update week, end card). NOT the 52 s product-shot film of extension/tools/film (qa-wrap.cues.json = 52 s, 13 shots, old pipeline).
- 9x16 EN is a re-layout of the same composition (not a crop).
- SOURCE IS LOST: searched QA-Wrap git history all branches (-S BUG-1042 none), Linkedin repo + worktrees, O:\Temp, O:\tmp, O:\videos, ~/.claude transcripts, other worktrees. Only identity/banner (a different HyperFrames project) and Linkedin videos/2026-10-25-qa-wrap-ad (a GIF ad) exist. Decision: rebuild the composition from the shipped MP4 (shot table measured below), parametrised by lang and aspect.
- Existing site -ar.mp4 (16:9 only) is the same film in Arabic (old voice, a visible shadda on the end card); no AR 9x16 exists.
- Caption windows measured from EN mp4 (crop ink detection, 30 fps): 0.37 / 2.47 / 4.03 / 8.20-9.27 / 10.37 / 13.07 / 15.47 / 16.97 / 17.77 / 20.07 / 21.60 / 22.70 / 24.77 / 26.40 / 28.67 / 30.10 / 31.50 / 33.07 / 36.37 / 37.43-39.27.
- Voice key ~/.config/openrouter/ not present when first listed (re-check at end).

## Step 2 rebuild (done)
- New: extension/tools/film/commercial40/{composition.template.html,build.mjs,snap.mjs,vo-ar.json,voice-ar.py,mix.py,poster-ar.mjs}; extension/tools/film/audio/cues/qa-wrap-40.cues.json (bed re-cut to 40 s, bed.py output work/film/c40/audio/bed.wav, 40.000 s).
- One HyperFrames 0.8.144 composition, `--lang en|ar` x `--aspect 16x9|9x16`; GSAP paused timeline, seek-safe (no callbacks), seeded jitter. Renders: `npx hyperframes@0.8.144 render . -q delivery --crf 14 --browser-gpu` (GPU, ~45 s each).
- D4 reproduction (EN 16x9 rebuilt vs shipped EN mp4, ssim over 1200 frames): mean 0.957; first shot 0-4 s 0.93-0.94; per 2 s window range 0.932-0.978. Known diffs: chip scatter/bokeh/ghost-block positions are re-authored (source lost), icon glyph shapes are Lucide-like approximations, caption font is Thmanyah Sans (shipped looked IBM Plex-like), stamp/card geometry measured within a few px.
- Gate G1 ffprobe: site/media/qa-wrap-commercial-40s-ar.mp4 1920x1080 40.000 s; -ar-9x16.mp4 1080x1920 40.000 s (h264 + aac).
- Gate G2 caption-window parity (ink on-set detector at 30 fps, same crop method): AR starts 0.40 2.50 4.07 8.23 10.40 13.10 15.50 17.00 17.80 20.10 21.63 22.73 24.80 26.43 28.70 30.13 31.53 33.10 36.40 37.47 vs shipped EN 0.37 2.47 4.03 8.20 10.37 13.07 15.47 16.97 17.77 20.07 21.60 22.70 24.77 26.40 28.67 30.10 31.50 33.07 36.37 37.43: every diff 1 frame (detector latency), limit 2.
- Gate G3 text: on-screen AR strings: tashkeel 0, Persian letters 0, Latin punctuation in Arabic 0, tatweel 0, Arabic-Indic digits 0, Cairo 0; tashkeel only inside vo-ar.json "tts". Foreign words glossed first use (Jira, Data Center, QA Wrap).
- compose/verify.mjs is the old 52 s pipeline's gate; not applicable to this composition (not run).
- 9x16 is a re-layout (world scaled .66, captions/titles in screen space) of the same timeline; EN 9x16 not compared frame by frame (not verified).
- Voice: key file ~/.config/openrouter/qa-wrap-1109.env ABSENT at end of run (checked twice). Delivered a no-voice timing master (music bed only). One-command voice step: `PYTHONUTF8=1 python extension/tools/film/commercial40/voice-ar.py` then `uv run --with numpy python mix.py --lang ar --aspect 16x9` and `--aspect 9x16`, then copy work/film/c40/ar-*-final.mp4 to site/media/qa-wrap-commercial-40s-ar{,-9x16}.mp4. mix.py speeds a long take at most 1.15x and writes work/film/c40/audio/mix-report.json (overruns reported, never re-voiced).
- Existing 52 s old pipeline (voice.mjs etc.) untouched.

## Round 2 (qaw-1109/film-ar-2, stop 1: animatic), 2026-11-10
Treatment docs/film/treatments/commercial-ar.md applied to extension/tools/film/commercial40/composition.template.html (both aspects):
- Captions: bible §8 AR set (21 lines): 1, 10, 13, 19 rewritten; bridge 3b at 6.0-8.0 added (AR only; EN slot null). Latin runs isolated (<bdi>): QA Wrap, Jira, Data Center, NJ-Burrito; +212 isolated inside the RTL ms pill.
- Ghosting: a caption that hands over at the same instant (15.47, 31.5) fades out from in-0.12 to in-0.04 s; stills at 15.45 and 31.48 show no caption, 15.6 shows only the new line.
- Mirror (AR): ticket card layout RTL (id right, tag left, row icons right, bars fill right to left); bug icon drifts left; timeline draws from its right end, dots land right to left, clock label at the left end, mark slides right; click right of the 500, arc path drawn right to left; clk/500 slide right; HIGH beside the 500; card flies on an arc (x power2.in, y power2.out, scale to .12) left into the J chip, which sits left; doc exits right; fields/key/403/sentence card mirrored; update scene mirrored. Days row already RTL.
- s09 AR: line laid out RTL from the start, linear clip wipe from the right 20.3-21.7 with the caret on the wipe edge (no letter-by-letter Arabic, shaping intact); Login/API bracketed at 21.9; underline grows from the right.
- Titles AR wipe in from the right (clip-path), EN keeps the mask rise. START: anticipation dip 8.9-9.05 before the press. World pulls out to .93 during the scatter (5.9-8.0), back at 9.4 (fromTo, lint-clean; CSS scale(.66) on #world removed, the timeline sets it).
- 9:16 captions moved to y 1268 (66 %), AR right margin 170 px (clear of the Reels button column), width 840.
- Not done (not in the treatment's words): no "الخط الزمني" label added (no timeline label exists on screen; Lead ruling kept for tutorials).
Gates (stop 1):
- hyperframes@0.8.144 check: ar-16x9 0 errors 1 warning (file size), 18/18 contrast; ar-9x16 same. Check passed.
- ffprobe draft-ar-16x9.mp4 1920x1080 30/1 40.000000 s 4.2 MB; draft-ar-9x16.mp4 1080x1920 30/1 40.000000 s 3.5 MB (video only, silent).
- gate_captions.py: 16x9 21 on-sets max diff 1.1 fr PASS; 9x16 21 on-sets max diff 1.9 fr PASS (limit 2).
- gate_text.mjs: 59 Arabic strings; tashkeel 0, tatweel 0, Persian 0, Latin punctuation 0, Arabic-Indic digits 0; fonts used (CDP platform fonts) Thmanyah Sans/Serif Display/Serif Text only; non-Thmanyah 0; Cairo 0. Both aspects PASS.
- hyperframes snapshot --describe false (Gemini vision off): stills at 0, 1.2, 3.2, 4.8, 6.8, 8.6, 11.5, 15.45, 15.6, 18.25, 18.9, 20.9, 23, 27, 31.48, 31.5, 34.8, 38.5, 38.8 per aspect + contact sheets.
Open for the director (sign-off focus): AR stamp 84 px fits the card at -9 deg (still 1.2 s); 9:16 world sits in the lower half with an empty top third (inherited layout); frame 0 shows the stamp mid-flight at 40 % opacity.
Stop 2 blocker to settle before any voice call: machine rule bans Gemini (2026-10-23, ~/.claude/CLAUDE.md); the exception exists only as a Lead ruling in the brief. Needs Nader's own confirmation.

## Round 2, stop 2 (AMEND: director notes, final render), 2026-11-10
Notes (O:\VScode Projects\QA-Wrap-wt-direct\work\sdlc\direct\reviews\commercial-ar.md):
- 1 done: #stamp2 = s01 stamp box (class stamp, left 560 top 497 w 800, -9 deg, scale 1.4 -> .86 power4.in .25 s at 34.4, 84 px AR), z-index 5 on a card-coloured fill; card bump at impact. Still 34.8: word whole, centred.
- 2 done: at 16.0 the click slides toward the 500 (centre gap 220 px), #arcp d re-drawn between them (attr tween), arc held until 16.95 (fades with the group); HIGH centred under the 500. Still 16.6: click, arc, 500, عالية one group.
- 3 done: 9:16 world scale per beat: .9 at y -96 (centre 45 %) for 0-5.5, 16.9-24.4 (card, Jira, document), 32.85-40 (FIXED card, end card); .66 for 5.5-16.9 and 24.4-32.85 (scatter, line, data center, days); power2.inOut .5 s. Labels in 9:16 >= 28 px on the frame (CSS .v block: pills 44 world px, buttons 44, tags/id 32, 500/403 46/44, days 44, token sentence 44, end card 32-36, screen pills 30). J chip moved inward in 9:16 (JX 470 AR). End-card lockup 160 px in 9:16 (about 72 % of width at 38.5).
- 4 not done (optional; J chip CU would need the check and attachment re-anchored; left for a later round).
- 5 done (both aspects): day tiles edge #4b525a, letters 24 px #c9cdd1.
- Card flight to Jira moved to 18.2-18.65 so the card reads at 18.25.
Voice: `test -f ~/.config/openrouter/qa-wrap-1109.env` -> ABSENT (2026-11-10). Per D10: no voice call; finals carry burned-in Arabic captions + music bed (mix.py --no-voice, loudnorm -16 LUFS, max -0.7 dB, mean -19.9 dB).
vo-ar.json rewritten to bible §8 V1-V10 (10 continuous phrases with anchors 0.4/2.5/8.22/13.08/16.98/20.1/24.8/28.7/33.1/36.4).
One-command voice + mix (only when the owner has written the key file):
  PYTHONUTF8=1 python extension/tools/film/commercial40/voice-ar.py && cd extension/tools/film/commercial40 && uv run --with numpy python mix.py --lang ar --aspect 16x9 && uv run --with numpy python mix.py --lang ar --aspect 9x16 && copy work/film/c40/ar-16x9-final.mp4 -> site/media/qa-wrap-commercial-40s-ar.mp4, ar-9x16-final.mp4 -> -ar-9x16.mp4 (re-mux only; picture unchanged). Then re-run gate_captions.py on both.
Final gates (finals in site/media):
- hyperframes check ar-16x9 / ar-9x16: 0 error(s), 1 warning(s) (file length) - Check passed.
- render -q delivery --browser-gpu: 63 s / 56 s.
- ffprobe -ar.mp4 h264 1920x1080 30/1 + aac, 40.000000 s, 7.7 MB; -ar-9x16.mp4 h264 1080x1920 30/1 + aac, 40.000000 s, 8.3 MB.
- CAPTIONS PASS 16x9: 21 on-sets, max diff 1.9 fr; CAPTIONS PASS 9x16: 21 on-sets, max diff 1.9 fr.
- TEXT PASS x2: 59 Arabic strings, 0 tashkeel/tatweel/Persian/Latin punctuation/Arabic-Indic digits; fonts Thmanyah only; Cairo 0.
- Posters: site/media/qa-wrap-commercial-40s-ar.jpg + -ar-1280.jpg (poster-ar.mjs; no 9x16 poster exists for EN either).
- Stills: work/sdlc/build-film/final-stills/ (16.6 and 34.8 both aspects; 9:16 card beats 1.2, 18.25, 38.5; wide beats 11.5, 30.3).
