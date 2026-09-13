# Harndock

Product name: **Harndock**. Official website: **https://harndock.com**. See [branding and compatibility](docs/branding.md) for naming conventions.

Harndock is a Tauri 2 desktop host for DeepSeek Harness. The desktop shell owns installation, process lifecycle, updates, and recovery; the selected Harness Runtime serves the product GUI and loads Host and Client Cordis plugins.

The repository currently supports source development and validation. Signed desktop and mobile release artifacts are not available yet; release signing and publishing remain tracked work.

## Prerequisites

- Node.js 22.22.3
- pnpm 11.9.0
- Rust 1.96.0
- Platform prerequisites required by Tauri 2

Initialize the pinned Harness source and install dependencies:

```sh
git submodule update --init --recursive
pnpm install
CI=true pnpm --dir vendor/deepseek-harness install --frozen-lockfile
CI=true DSH_CLIENT_TITLE=Harndock pnpm --dir vendor/deepseek-harness build
```

Run the desktop host. It builds the external desktop plugins, prepares the Harness `desktop` profile, starts it on a random loopback port, and opens the served GUI in the main window:

```sh
pnpm dev
```

Run the project checks:

```sh
pnpm check
pnpm build:web
```

Architecture and delivery milestones are documented in [docs/](docs/README.md).

Browser automation and image recognition setup is documented in [docs/browser-automation.md](docs/browser-automation.md).

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. Report suspected vulnerabilities through GitHub's private security advisory flow as described in [SECURITY.md](SECURITY.md), not through a public issue.

The project license is being finalized. Until a license file is added, the source is publicly viewable but no additional license grant is implied.
