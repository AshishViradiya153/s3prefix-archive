# Contributing to s3-archive-download

Thank you for helping improve s3-archive-download. This document describes how to set up a development environment and what we expect in pull requests.

## Prerequisites

- **Node.js** `>=20.19.0` (see `engines` in `package.json`).
- **pnpm** `9.x` (see `packageManager` in `package.json`). If you use Corepack: `corepack enable` then `pnpm` will match the repo.

## Getting started

```bash
pnpm install
pnpm run verify
```

`verify` runs typecheck, lint, format check, knip, tests, publint, and attw. **`pnpm run verify` must pass** before a pull request is merged. **CI** (GitHub Actions) runs the same script on Node.js **20, 22, and 24** for pushes and pull requests to `main` or `master` (see `.github/workflows/ci.yml`).

Other useful commands:

| Command                 | Purpose                          |
| ----------------------- | -------------------------------- |
| `pnpm run build`        | ESM + CJS + types (`tsup`)       |
| `pnpm test`             | Release build + Vitest           |
| `pnpm run lint`         | ESLint                           |
| `pnpm run typecheck`    | `tsc --noEmit`                   |
| `pnpm run pack:dry-run` | Inspect the npm tarball contents |

## Pull requests

1. **Fork** the repository and create a **branch** for your change.
2. **Behavioral changes** should include **tests** (new cases or updated expectations) in `test/` unless the change is documentation-only or clearly non-functional.
3. Match existing **style**: run `pnpm run format` if Prettier reports issues, or fix what `pnpm run format:check` flags.
4. Keep the diff **focused** on the problem you are solving; avoid unrelated refactors in the same PR.
5. Describe **what** changed and **why** in the PR description. Link a related issue if one exists.

## Where things live

- **Source:** `src/`
- **Tests:** `test/` (Vitest; some suites use in-memory storage or chaos helpers—see README “Developing s3-archive-download”).
- **Examples:** `examples/` (illustrative; not always executed in CI).
- **Documentation hub:** `docs/README.md` (guides, troubleshooting; published in the npm package under `docs/`).
- **Error catalog:** `docs/errors.md`

## Questions and bugs

- **Questions or feature ideas:** open a [GitHub issue](https://github.com/AshishViradiya153/s3download/issues) (update the URL if the repository moves).
- **Security issues:** do **not** open a public issue; see [SECURITY.md](SECURITY.md).
