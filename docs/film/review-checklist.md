# Director's sign-off checklist (qaw-1109, D8)

What the film director checks on each animatic (stills or snapshot strip on the timed voice or scratch track) and each render, before it may render final. One review round per film (D9 devil change); each check is PASS / FAIL with a frame time. A FAIL names the beat, the rule (`directing.md` section) and the fix. Measured checks are run by script on the file, never eyeballed (R16).

## A. Animatic (before animation polish)

1. Beat list matches the treatment: same number of shots, each within 0.5 s of its treatment time. (treatment)
2. Each shot states one idea; the focal point named in the treatment is where the strongest contrast sits in the still. (directing §1)
3. Size changes between consecutive shots, or the treatment gives the reason it does not. (§1)
4. Each act opens wider than it continues; the end card is centred and stable. (§1)
5. Light: warm until the tool acts, green after; one hero accent per beat. (§2)
6. Arc: hook inside 3 s; the turn lands where the treatment puts it; one call to action or end card. (§3)
7. Screen direction is consistent; in AR, time and progress run right to left in every beat. (§3)
8. Voice runs continuously through caption changes; no silence at a caption's last word (machine rule 2026-11-08); the only silences are the ones the treatment names. (§5)
9. Every caption window gives at least 0.3 s per word; at most two lines; no caption straddles a beat change. (§5)
10. The words on screen are the treatment's words (frozen UI strings), nothing invented, no lorem. (§7, D1)
11. Websites look like Sauce Demo, Practice Software Testing or the-internet; no copied logos. (bible §9)
12. Cut any beat that does not earn its time here. (§8)

## B. Render (16:9 and 9:16 where both exist)

1. ffprobe: resolution, 30 fps, duration (commercial 40.000 s; tutorials 40-60 s), video and audio streams present.
2. Fonts: rendered glyphs come from Thmanyah only; no Cairo, no fallback face (font list from the render log or the page's loaded fonts).
3. Arabic on-screen text, every string: 0 tashkeel (U+064B-U+0652, U+0670), 0 tatweel (U+0640), 0 Persian letters (U+06A9 U+06CC U+06AF U+067E U+0686 U+0698), 0 Latin , ; ? next to Arabic, 0 Arabic-Indic digits. Run the gate script in `work/sdlc/direct/` on the source strings.
4. Latin runs inside Arabic lines render in the right order (QA Wrap, Jira, 500, +212 ms, file names, dates, versions): check a still of each such line.
5. Caption windows: on-set times measured from the render (ink detector) match the treatment within 2 frames.
6. No ghosting at split captions: on the swap frame only one line is readable.
7. Motion: one lead move per beat; stamps slam (power4.in), arrivals overshoot (back.out), time draws linearly; anything that flies follows an arc. Snapshot strip at 0.25 s steps around each lead move.
8. The bookend and graphic matches named in the treatment are present (commercial: shots 1 and 12; scatter into mark).
9. Frame 0 and the last frame are designed frames (poster-worthy), not a blank or mid-move.
10. 9:16: a re-layout, not a crop; captions and the call to action sit inside the Reels/Shorts safe area (not in the bottom 20 % or the right-edge button column).
11. Audio: voice peaks about -14 to -16 dBFS, the bed at least 10 dB under the voice; no clipping; the tail fades by 39.5 s (commercial).
12. Honesty: the seal film says it hides nothing and does not prove identity; the KPI film shows no severity split or trend verdict; no number is a claim about users.
13. The EN and AR files of a pair carry the same beats and the same meaning line by line; a fix to one side is made on the other.

## C. Verdict

- PASS: render final.
- FAIL: list each failing check with frame time, rule and fix; the builder fixes once; the director checks only the failed items on the re-render (D9 devil change: snapshots, not full re-renders, wherever possible).
- Record each verdict in `work/sdlc/direct/DETAIL.md` under "Reviews".
