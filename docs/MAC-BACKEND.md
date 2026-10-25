# Bundled Apple Silicon backend

Packaged MACxus builds include a ready-made Xodus backend. End users do not need
Git, Rust, protoc, Homebrew or a local signing certificate to use it. Install the
app, install the Nexus runtime from Settings, then sign in. CrossOver and Rosetta
remain required for games. Highball remains an optional in-app download.

The backend lives outside ASAR in `MACxus.app/Contents/Resources/backend`. Startup
checks its exact source/recipe identity, Apple Silicon executable headers,
SHA-256 hashes and CLI capabilities before making sign-in available. It does not
probe developer tools or copy/re-sign the bundled executables. A missing or
corrupt bundle asks the user to reinstall MACxus. An explicitly configured
external developer checkout remains supported.

## Maintainer build

On an Apple Silicon Mac, install the build tools once:

```sh
brew install protobuf gnu-tar
rustup toolchain install "$(node -p "require('./assets/backend-source.lock.json').rust")" --profile minimal
npm ci
npm run build
npm run dist:mac
node scripts/verify-mac-bundle.mjs release/mac-arm64/MACxus.app
```

`dist:mac` first builds the backend from the commit, Cargo lock and checked
patches in `assets/backend-source.lock.json`, using the locked Rust version and
macOS 13 deployment target. Native account-free Rust tests use a disposable
case-sensitive APFS image so ambiguity/security tests run on normal macOS hosts.
The image is detached after testing. The CLI is checked using help commands;
`xodus-service`, accounts and games are never started by this build procedure.
Both executables must link only macOS system libraries and carry valid code
signatures. The existing beta distribution is still unsigned at the app level.

The generated `bundled/mac-backend` directory is ignored by Git. It contains the
CLI, service, GPL-3.0 license, manifest and a complete corresponding-source archive
with vendored dependency sources/licenses, patched upstream source and recipe.
That archive is included in the app so recipients receive the source with the
executables. Offline rebuild instructions are inside its `recipe/BUILD.txt`.
A valid cache is reused only for the exact current source/build recipe. Remove
this generated directory to rebuild after a recipe change.

`npm run build:mac-backend -- --check` runs native validation without creating a
shipping bundle. PR CI uses this mode. The **Native Mac backend** workflow's manual
run on `main` produces and verifies a DMG candidate and its checksum; it does not
publish a GitHub release. The owner must review and approve the exact tested
candidate before official publication. Do not rebuild between approval and
publication.

`scripts/verify-mac-bundle.mjs` selects the backend from the actual packaged app
using an empty PATH and a fresh disposable profile. It verifies that the backend
is ready with no compiler tools, account/service startup or backend-install state.
