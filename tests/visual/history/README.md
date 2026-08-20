# History visual fixtures

Run the deterministic screenshot suite from the repository root:

1. Start `npm run dev:web` in one terminal.
2. Run `npx playwright test --config tests/visual/history/playwright.config.ts` in another.

Use `--update-snapshots` only after an intentional, reviewed visual change. The suite uses the installed Chrome channel because the repository does not download a separate Playwright browser binary.
