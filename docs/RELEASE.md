# Preparing the first public release

Target: a source-only, experimental 0.1.0 release. Keep the existing checkout; it can become the first public commit. Do not upload a ZIP of the whole working directory.

## Before publication

- [x] Add the MIT license, link it from the README, and set MIT in the package metadata.
- [x] Verify a clean source clone: `npm ci`, `npm run check`, and `npm run audit:public -- --staged` passed on October 7, 2026 (34 tests, zero scan findings). Local browser tests used an already-installed Playwright Chromium; new machines need `npx playwright install chromium`.
- [x] Review dependency advisories: the clean install reported zero npm vulnerabilities on October 7, 2026, including development tools.
- [ ] Smoke-test a clean source checkout on Windows: setup without a key, start one task, switch to Reels, complete three tasks, exercise the finish-reel modal, and test Back to AI. Test lessons separately with a private key and explicit sharing.
- [x] Document the integration limitations without claiming every agent version or approval state is supported.
- [x] Use the owner's GitHub no-reply commit identity in this repository.
- [x] Review and audit the initial staged source, docs, tests, configuration, and lockfile before committing.
- [x] Check the public file set for credentials, runtime files, databases, hook backups, local paths, logs, and private screenshots. The included preview contains synthetic test content.

`.gitignore` protects ordinary `git add`, not forced additions, past commits, or hand-made ZIPs. The audit script is a targeted pattern check rather than a guarantee. Local encrypted keys and lesson databases should remain private too.

## Repository and launch

- [x] Publish the reviewed source to [Hudaifa-Ghula/wAIt](https://github.com/Hudaifa-Ghula/wAIt) on `main`.
- [x] Enable private vulnerability reporting, secret scanning, and push protection. CI has read-only repository permissions and no private API keys.
- [x] Confirm the initial source commit passes [GitHub CI](https://github.com/Hudaifa-Ghula/wAIt/actions/runs/37643133805). Continue requiring successful checks when reviewing contributions.
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
