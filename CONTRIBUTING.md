# Contributing to wAIt

wAIt turns agent waiting time into a short lesson or a bounded Reels break. Good contributions make starting, stopping, and returning reliable and understandable.

The source is public and [MIT licensed](LICENSE); contributions are welcome under that license. The [best PR challenge](docs/PR-CHALLENGE.md) is being prepared. Its remaining prize and participation details are TBA; competition entries open after those details are finalized and the opening is announced.

## Local development

Use Windows and Node.js 22.13 or newer:

```powershell
npm ci
npx playwright install chromium
npm run check
npm run audit:public
```

Tests run with synthetic agent events and an isolated headless browser. They need no API key, Instagram login, native-host registration, or live model call. Follow the README only when testing the real integration.

## A useful pull request

1. Explain the problem in an issue first for larger changes. Small, reproducible fixes can go straight to a PR.
2. Keep one coherent change per PR. Include the trigger, expected behavior, and actual behavior.
3. Add a regression test for behavior changes. For browser behavior, include a short recording with private content removed and list the browser/agent versions tested.
4. Run the commands above. Say what was tested live and what was simulated.
5. Describe any changes to permissions, stored data, network requests, or setup steps.

AI-assisted contributions are welcome. You are responsible for understanding and validating the code and for having the right to contribute it. Do not submit generated bulk changes without a reproducible benefit.

## Behaviors to preserve

- Only the selected task and managed waiting tab control the feed.
- Stale events or timers cannot reopen or stop another run.
- A completed task locks new reels; an identified current reel can play during the fixed return countdown. Refreshing or switching modes must not extend that deadline.
- Returning stays responsive even if a tutor request hangs or fails.
- Context sharing is opt-in and scoped to the selected project. Never add credentials to the browser or logs.
- A hook must not approve agent tools, change their prompts, or block the coding task when wAIt fails.

## Good first areas to investigate

- Reproducible multi-turn tests using sanitized lifecycle fixtures.
- Clearer setup and diagnostics for missing/cancelled agent hooks.
- Accessible keyboard controls and focus management in the Reels modal.
- A wider range of controlled Reels DOM fixtures, including ambiguous players.
- The optional VS Code extension's installation and packaging path.

Discuss new agent providers, OS support, or detection fallbacks before implementing them. Never infer completion solely from elapsed time or lack of activity.

See [architecture](docs/ARCHITECTURE.md) for the file map and [security](SECURITY.md) for private reporting guidance.
