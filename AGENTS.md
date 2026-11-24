# AGENTS.md

## Active Project Roadmap
- **Roadmap First**: Project status and backlog live in `ROADMAP.md`. Read it before starting or resuming backlog items.

## Verification Commands (`verify` Primary Source)
- **Fast Checks**: `npm run type-check` (TypeScript strict check) and targeted `npx vitest run <test-file>`.
- **Full Gate**: `npm run type-check`, `npm test` (Vitest + happy-dom), and `npm run package` (when `src/` or `addon/` changes; mirrors `.github/workflows/release.yml`).

## Git & Reporting Workflow
- **Auto-Push Before Final Report** *(Overrides workspace commit/push confirmation)*: After passing global `verify` and `open-code-review` checks on a dedicated branch (per root `AGENTS.md` branch & commit rules; never `main`), create an atomic Korean commit and push (`git push -u origin <branch>`) before reporting completion.