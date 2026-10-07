# Preparing the first public release

Target: a source-only, experimental 0.1.0 release. Keep the existing checkout; it can become the first public commit. Do not upload a ZIP of the whole working directory.

## Before publication

- [x] Add the MIT license, link it from the README, and set MIT in the package metadata.
- [ ] Run `npm ci`, `npx playwright install chromium`, `npm run check`, and `npm run audit:public`.
- [ ] Run `npm audit` and review any remaining dependency advisories, including build and packaging tools.
- [ ] Smoke-test a clean source checkout on Windows: setup without a key, start one task, switch to Reels, complete three tasks, exercise the finish-reel modal, and test Back to AI. Test lessons separately with a private key and explicit sharing.
- [ ] Confirm the README's integration limitations match the actual release. Do not claim all agent versions or approval states are supported.
- [ ] Choose a Git commit identity. Use a GitHub-provided no-reply address if you do not want a personal email in public commit metadata.
- [ ] Inspect the candidate file list, then stage only the intended source, docs, tests, configuration, and lockfile. Run `npm run audit:public -- --staged` and review `git diff --cached` before the first commit.
- [ ] Confirm no API keys, runtime files, databases, agent-hook backups, local paths, logs, or private screenshots appear in that diff.

`.gitignore` protects ordinary `git add`, not forced additions, past commits, or hand-made ZIPs. The audit script is a targeted pattern check rather than a guarantee. Local encrypted keys and lesson databases should remain private too.

## Repository and launch

- [ ] Create an empty GitHub repository with the chosen name and description; connect this checkout and publish the reviewed first commit.
- [ ] Enable private vulnerability reporting and available secret scanning/push protection. Use read-only CI permissions; never supply private API keys to competition PRs.
- [ ] Confirm CI passes on GitHub. Consider protecting the default branch and requiring review/checks before merging external contributions.
- [x] Set the deadline to the end of November 7, 2026, Tripoli time (before November 8 at 00:00, UTC+2), and confirm that merging is not required to qualify or win.
- [ ] Finalize the remaining challenge details: prize tier/duration/delivery, eligibility, and submission rules. Announce direct judging versus voting before judging/voting begins.
- [ ] Tag the approved commit and publish release notes as an experimental release. Source downloads should come from Git's committed tree. Do not upload local runtime directories or unreviewed VSIX/browser packages.
- [ ] Post the announcement from PR-CHALLENGE.md after replacing all placeholders.

The optional VS Code package is not the supported onboarding path for this release. It needs separate clean-install and packaged-runtime validation before offering a binary release.

## Release-note draft

**wAIt 0.1.0 — experimental public source release**

- Agent-aware waiting companion for Windows and Opera GX.
- Optional Groq lessons and managed Instagram Reels breaks.
- Selected-task state, run-aware return timers, and a finish-reel countdown.
- Local lesson memory and opt-in project context sharing.
- Automated backend, lifecycle, and headless-browser regression coverage.

Known limits: cancelled/missing host hooks, incomplete approval-wait detection, changing Instagram DOM, Windows focus restrictions, and an optional VS Code development path that needs more validation. See README and SECURITY.md.

Nothing in this checklist creates a GitHub repository, publishes a release, or announces the competition automatically.
