# Contributing to Harndock

## Development setup

Use the tool versions declared by the repository: Node.js from `.node-version`, pnpm from `packageManager`, and Rust from `rust-toolchain.toml`.

```sh
git clone --recurse-submodules https://github.com/harndock/harndock.git
cd harndock
pnpm install --frozen-lockfile
CI=true pnpm --dir vendor/deepseek-harness install --frozen-lockfile
CI=true DSH_CLIENT_TITLE=Harndock pnpm --dir vendor/deepseek-harness build
```

Do not modify the `vendor/deepseek-harness` working tree. Product behavior belongs in Harndock applications, packages, adapters, or build-time compatibility patches.

## Before opening a pull request

Run the relevant focused tests while developing, followed by the repository checks:

```sh
pnpm check
pnpm build:web
```

Keep changes scoped, update contracts and documentation when behavior changes, and describe any platform-specific validation that could not be run locally.

## Repository hygiene

- Never commit `.env` files, credentials, signing material, runtime artifacts, build output, user data, or local plugin checkouts.
- Use `.env.example` for documented configuration names and safe placeholder values.
- Keep third-party source as a declared, pinned submodule or dependency; do not copy an untracked checkout into the repository.
- Report security issues through the process in `SECURITY.md`.

## Pull requests

Explain the problem, the chosen approach, verification performed, and any remaining risk. A pull request must pass required checks before merge. Signed release packaging is maintained separately from source validation until protected release credentials are configured.
