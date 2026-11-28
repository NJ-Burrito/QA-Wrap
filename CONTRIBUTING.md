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

## Rules

- No client data, credentials or recordings of real sites in a commit, test or screenshot.
- Python helpers run with `uv`, never pip.
- One topic per branch, pull request into `main`.
- Deletions go to the recycle bin, never `rm -rf`.

## Commit messages

Imperative and scoped, for example `site: fix the Arabic footer link`.
