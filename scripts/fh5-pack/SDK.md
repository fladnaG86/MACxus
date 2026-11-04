# Preparing the FH5 Wine build SDK

The archive's `corresponding-source/recipe` directory is a standalone recipe root.
Run its commands from that directory. No MACxus checkout, installed Wine SDK,
account, bottle, or game files are needed for source reconstruction and SDK
preparation. The generated SDK is a maintainer build input, never an application
or user runtime installation.

Use an Apple Silicon Mac with Xcode command-line tools and the exact compiler/SDK
versions in `assets/fh5-preview/source.lock.json`. Install Git, Python 3.12+,
Autoconf, Automake, pkg-config, MinGW-w64, Bison 3+, and Flex. On Homebrew:

```sh
brew install autoconf automake pkg-config mingw-w64 bison flex
export PATH="$(brew --prefix bison)/bin:$(brew --prefix flex)/bin:$PATH"
```

The SDK bootstrap fetches the three exact Git object IDs (Wine, xgameruntime and
nghttp2 declarations) from the public repositories
in `scripts/fh5-pack/runtime-patches.lock.json` (the FH5-specific pinned base,
independent of updates to the launcher's shared runtime lock). It applies only the locked Wine/runtime
patches and builds the native compiler helpers, generated headers and PE import
libraries. Optional local mirrors supply those Git objects without using their
working trees. Both output directories below must be new:

```sh
python3 scripts/fh5-pack/prepare-sdk.py /path/to/new-sdk --jobs 4
python3 scripts/fh5-pack/build.py /path/to/new-build \
  --runtime-mirror /path/to/new-sdk/wine-src/dlls/xgameruntime \
  --sdk-source /path/to/new-sdk/wine-src \
  --sdk-build /path/to/new-sdk/wine-build
python3 scripts/fh5-pack/verify.py /path/to/new-build \
  --engine /path/to/Preview.app/Contents/SharedSupport/CrossOver \
  --output /path/to/new-evidence
```

For offline Git object access, add `--wine-mirror /path/to/wine-git` and
`--runtime-mirror /path/to/xgameruntime-git` and `--nghttp2-mirror /path/to/nghttp2-git`
to `prepare-sdk.py`. These must contain
the locked commits. The full pinned Wine source archive and reconstructed runtime
source are also distributed beside the recipe for inspection; the bootstrap
requires Git objects to establish the exact source identity used by the builder.

The source release includes `assets/fh5-preview/verification.json`, containing
engine, payload and source-lock hashes. It intentionally omits the source
archive's own hash to avoid a recursive hash. The verifier uses that descriptor
when the application release manifest is absent. The application checkout uses
its stricter full `manifest.json`, including the separately locked source archive.
Verification executes only synthetic probes in a new prefix. An installed pinned
Preview engine is needed for those probes; it is not needed to rebuild sources.
