# Contributing to QA-Wrap

Thanks for helping. Small pull requests with one topic each are easiest to review.

## Start here

- New? Look for issues labelled [good first issue](https://github.com/NJ-Burrito/QA-Wrap/labels/good%20first%20issue).
- Bug or idea: open an issue from the templates first, so we agree on the change before you write it.

Found a security problem? Report it privately: [SECURITY.md](SECURITY.md).

## Run the checks

```bash
cd extension
npm ci --ignore-scripts
npx playwright install chromium
npm run test:ci
```

This is the suite CI runs on every push.

Optional second opinion on a suite's verdict (off by default): set `QAW_VIBIUM_GATE=1` and `ANTHROPIC_API_KEY`, and have a suite write `traces/<suite id>.zip` (a Playwright trace) and `traces/<suite id>.claim.txt` into its run folder (`QAW_RUNDIR`). The pipeline then asks [Vibium](https://github.com/VibiumDev/vibium) (`npm i -g vibium`, Claude only) whether the trace supports the claim, and records agree, disagree or not-checked on the suite row in `run.json`. It never changes a status or the exit code; a disagreement only prints a line to look at.

## Rules

- No client data, credentials or recordings of real sites in a commit, test or screenshot.
- Python helpers run with `uv`, never pip.
- One topic per branch, pull request into `main`.
- Deletions go to the recycle bin, never `rm -rf`.

## Commit messages

Imperative and scoped, for example `site: fix the Arabic footer link`.
