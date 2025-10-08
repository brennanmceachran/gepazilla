# Contributing to GEPAzilla

Thanks for your interest in improving GEPAzilla! This guide explains how to get a development environment running, the checks we expect before submitting changes, and the conventions we follow across the codebase.

## Prerequisites

- **Node.js 20.x** (match the version used in CI).
- **pnpm 10.x** (the repository is pinned to pnpm via `packageManager`).
- macOS, Linux, or Windows with a POSIX-compatible shell.

## Getting Started

```bash
pnpm install
pnpm prepare        # installs Husky and pre-commit hooks
```

The pre-commit hook runs `pnpm lint-staged`, which applies ESLint with `--fix` to staged files. You can bypass the hook with `HUSKY=0` if necessary, but the commit will still have to pass checks in CI.

## Core Scripts

| Command | Description |
| --- | --- |
| `pnpm dev` | Run the Next.js dev server with Turbopack |
| `pnpm lint` | Lint the entire workspace with ESLint |
| `pnpm exec tsc --noEmit` | Type-check the codebase |
| `pnpm test` | Run the Vitest suite once |
| `pnpm test -- --run --coverage` | Run the suite with coverage reporting |

CI executes `pnpm lint`, `pnpm exec tsc --noEmit`, and `pnpm test -- --run` on every push/PR via `.github/workflows/ci.yml`.

## Coding Conventions

- Use the existing TypeScript configuration (`tsconfig.json`). Keep `strict` mode green when adding new files.
- Follow the ESLint rules inherited from `next/core-web-vitals` and `next/typescript`. If a rule feels too restrictive, open an issue instead of disabling it locally.
- Prefer pure functions and declarative React components. Add minimal comments ahead of genuinely tricky logic, and keep tests close to the feature they exercise.

## Testing Expectations

- Add or update unit tests when changing behaviour in `src/lib`, API routes, or optimizer state logic. The existing suites demonstrate how to mock external dependencies.
- For UI changes, favour behavior-driven tests via Testing Library over snapshots.
- Run `pnpm test` and `pnpm lint` before pushing. CI will block merges if either fails.

## Pull Requests

1. Open an issue describing the proposed change, or comment on an existing issue to claim it.
2. Create a feature branch (`git checkout -b feature/my-change`).
3. Make your edits, keeping commits focused. Run `pnpm lint` and `pnpm test` locally.
4. Update docs or examples when behaviour changes.
5. Submit a PR with a clear summary, breaking changes, and testing notes.

We use conventional review cues:
- ✅ all green checks and reviewer approval required before merging.
- 🔁 address requested changes promptly or discuss alternatives.

## Communication

Questions, bug reports, or ideas? Open a GitHub issue or start a discussion. For security-sensitive reports, use GitHub’s private security advisory workflow and add `@brennanmceachran` as a collaborator.

Thanks for helping build a better GEPAzilla!
