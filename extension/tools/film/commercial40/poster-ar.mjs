#!/usr/bin/env node
/* The Arabic posters (this film's and the six tutorials') are made by one script since 2026-11-10:
   videos-tut/posters-ar.mjs, which writes site/media/qa-wrap-commercial-40s-ar.jpg (1920x1080) and -ar-1280.jpg.
   This file forwards to it so the old command still works:  node poster-ar.mjs */
await import(new URL("../../../../videos-tut/posters-ar.mjs", import.meta.url).href);
