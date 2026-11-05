# FH5 Preview source pack

An opt-in, source-built compatibility pack for the **FH5 Microsoft Store package**
(`9NNX1VVR3KNQ`) on **M3 or newer**, macOS 26+, CrossOver Preview **Rosetta 20261015**
(build `cxpreview-20261015-rc1`). Metal 4 is required. This is the portable
packaging of components previously exercised in private FH5 driving, benchmark
and online tests. **Only M5 Max has been game-tested. Other M3 or newer Macs
are experimental and untested: startup, rendering and GPU timing may fail.**
Apple documents the required Metal 4 command/counter features on earlier GPU
families than M3; this makes M3/M4 plausible candidates, not verified FH5 targets.
See the [hardware assessment](https://github.com/zachspartofaday/MACxus/blob/upstream/fh5-preview-pack/docs/FH5-PREVIEW-HARDWARE.md).
The launcher retains the exact engine fingerprints and native counter/calibration
checks; the model gate does not substitute for those checks. M1/M2 remain outside
this pack's experimental scope. These are unpublished test builds, with separate acceptance:

- The original normal-Play portable pack reached an online session and multiplayer.
  Store/DLC entries were visible, but marketplace purchase details returned an error.
- A later normal-Play calibration build completed driving/benchmark with a plausible
  displayed average latency of 35 ms. An earlier private diagnostic displayed
  61.1 ms; these are different runs, not a controlled comparison or independently
  measured input-to-display latency.
- A separate normal-Play identity build retained DLSS/DLAA and displayed
  `Apple M5 Max (D3DMetal)`. Preview still supplies NVIDIA compatibility IDs in
  DLSS mode; native Apple vendor identity with DLSS remains unvalidated.
- The latest installed combined build passed user-confirmed launch after the
  pinned-provider alias fix. Multiplayer and marketplace were not retested on
  that exact build.

See the [per-configuration reports](https://github.com/zachspartofaday/MACxus/blob/upstream/fh5-preview-pack/docs/compatibility/games/forza-horizon-5.md),
`experiments/fh5-preview-portable/normal-play-acceptance.json`,
`experiments/fh5-clock-calibration/normal-play-acceptance.json`,
`experiments/fh5-apple-identity/normal-play-acceptance.json` and
`experiments/fh5-compat-followups/installed-play-acceptance.json` in the repository.

Only FH5's launch settings on macOS expose “FH5 Preview compatibility pack.”
It is off by default; unrelated games ignore stale values of this setting.
Enabling it requires an app build containing the verified payload. The launcher
validates the engine/renderer fingerprints, makes a private engine copy, signs
only that copy, and uses a dedicated bottle. It does not modify the installed
Preview app or the original game. The launcher installs the new runtime/proxy
only into that bottle and enables native injection only for the game command;
registry/locale/prerequisite tools and Stop retain the ordinary vendor runner.
The native Metal bridge and signing inputs are materialized outside app.asar.
Paths come from the selected engine, app assets, backend, game and data directory.

Turn the setting off to use the ordinary engine/profile and bottle again. The
pack bottle, including its saved data, is retained. Nothing is copied from a
private test bottle, and no credentials or game/vendor binary is redistributed.
The private engine/bottle cache may be removed manually after preserving saves
and ensuring its Wine processes have stopped; disabling the setting needs no
uninstall script or modification of the original game/application.

## Components and bounds

- Shared authentication, readiness and product-query compatibility, plus the
  add-on license adapter and bounded installation-root mapping. The source pack
  retains its own validated runtime base; updating the shared runtime alone
  does not replace this payload.
- Native authenticated discovery through the selected backend and launcher
  bridge. Catalog metadata supplies candidates; the runtime separately
  verifies fresh signed exact-SKU receipts. Unknown/incomplete inventory fails
  conservatively. Public metadata never grants ownership.
- Real Metal 4 GPU query timestamps and paired GPU/QPC calibration through an
  owned Wine PE/Unix companion. GPU samples are converted to query-frequency
  ticks; absolute CPU samples are mapped into Preview's continuous 10 MHz QPC
  domain on each call and checked against guest QPC brackets. Missing support,
  sleep transitions or invalid pairs fail without replacing caller outputs.
- FH5 opts into a default-profile fallback for the pinned Preview NVAPI provider.
  When its current-global-profile getter is absent, the adapter delegates that
  lookup to the provider's existing base-profile getter. Native implementations
  take precedence; missing base support and native errors remain failures. This
  is an explicit policy for this compatibility pack, not an assertion that base
  and current-global profiles are equivalent on arbitrary NVIDIA drivers. No
  settings are written, profile handles remain provider-owned, and driver
  versions are obtained from the native API. The isolated full GPU/calibration
  trial reached the benchmark without the startup dialog and displayed `576.2`
  with DLAA/frame generation retained. The latest integrated-build launch
  acceptance is separate from that benchmark trial. The displayed version is
  Preview's compatibility version, not an NVIDIA macOS driver. No version
  number or dialog is overridden.
- Both NVAPI adapters require the pinned provider PE, matching loaded executable
  bytes and its expected query entry point. The launcher copies the verified PE
  from the user's selected engine into the dedicated bottle; no vendor binary
  is redistributed. The accepted module is pinned while adapters can refer to it.
- Missing legacy `NvAPI_GPU_GetMemoryInfo` delegates to native `GetMemoryInfoEx`.
  Exact V1/V2/V3 layouts are supported. Byte counts become KiB with floor division
  and saturation; eviction counts remain counts. Native legacy support wins,
  and unsupported versions or native failures leave output data unchanged.
- A private `CX_HOME` snapshots only complete compatibility-database/signature
  pairs from the user's CrossOver support directory. Preview still verifies the
  vendor signatures with its own key. Missing caches are logged; no rules are
  invented, and no account or license files are copied. Restoring database access
  does not establish that this cache contains a matching FH5 rule.
- `MACXUS_FH5_HEAP_TRACE=1` is a bounded, read-only diagnostic for heap import and
  nearby successful allocations. It is off in normal Play. The native synthetic
  control returns `E_NOTIMPL` for address import and succeeds with an ordinary
  heap. A private game diagnostic completed the benchmark despite the observed
  import failures and made successful ordinary allocations afterward. The exact
  fallback branch remains unproven; no fake heap-import implementation is added.
- Explicit input-layout offsets; the tested
  absent-render-target blend adjustment; guest committed-memory accounting and
  dual-stack UDP TTL handling. Normal diagnostic observers remain off.
- The FH5 descriptor adapter checks the executable name, x64 PE timestamp and
  image size, code-region SHA-256 guards and allocator/caller invariants before
  changing allocator data. It uses the game’s own functions and does not write
  game instructions. Other executable builds are refused by that adapter.

The pack shows the Apple GPU name while retaining Preview-selected NVIDIA
compatibility IDs in DLSS mode. Native Apple identity with DLSS is unvalidated;
it is not enabled by this recipe. Black road regions and marketplace errors remain,
actual sleep/resume and long-session calibration drift remain unvalidated, and
Metal query-identity retirement remains a bounded 4096-slot implementation.
No all-modes, all-game-builds, Steam-edition or long-session acceptance is claimed.

## Maintainer build

Requirements: Python 3.12+, Git, the recorded MinGW toolchain, Apple command-line
tools/Metal 4 SDK, and a generated Wine SDK at the exact commit in
`source.lock.json`. The SDK must contain matching PE headers, Wine compiler
helpers and import libraries. Prepare it using the standalone bootstrap and
instructions in `scripts/fh5-pack/SDK.md`; this builder checks its revision/generated inputs.
The recipe retains its validated runtime base in
`scripts/fh5-pack/runtime-patches.lock.json`, independently of newer shared
runtime changes. It reads the SDK’s generated rules without invoking make regeneration, compiles
all 23 runtime C objects afresh, and rebuilds XML and Windows JSON support from
pinned Wine Git objects. No cached runtime or XML implementation object is linked.
The SDK is a maintainer input, not an end-user requirement or shipped binary.
In the source release, run the Python build/verification commands from
`corresponding-source/recipe`. The Node staging command below requires the full
MACxus application checkout; it is not part of standalone source reconstruction.

From the repository root, with new build/evidence directories:

```sh
python3 scripts/fh5-pack/build.py work/fh5-portable-build \
  --runtime-mirror /path/to/pinned/xgameruntime-git \
  --sdk-source /path/to/pinned/wine-source \
  --sdk-build /path/to/generated/wine-build
python3 scripts/fh5-pack/verify.py work/fh5-portable-build \
  --engine /path/to/Preview.app/Contents/SharedSupport/CrossOver \
  --output work/fh5-portable-evidence
node scripts/prepare-compatibility-packs.mjs --pack fh5-preview-v1 \
  --bundle-dir work/fh5-portable-build
```

`--sources-only` on the build command reconstructs and verifies the locked
runtime/graphics sources without compiling. Full builds produce `build.json`,
six payload modules, synthetic probes, and the corresponding-source archive.
Staging accepts only the committed manifest hashes; changed artifacts require
validation and a reviewed manifest update. Source-path mappings, stable PE time
settings and a stable Mach-O install name prevent checkout paths from becoming
artifact dependencies. Different compilers/SDKs are not assumed equivalent.

The verification command starts only synthetic account-free probes in a new
prefix and stops only that prefix afterward. It never starts an account service
or FH5. It covers allocator guards, layout/blend contracts, memory clock-reporting
contracts, async lifetime, add-on proof/provider behavior, and native Metal 4
counter/state/order/lifetime probes, calibration math/native counter brackets and
missing-bridge PE semantics. The enabled guest calibration and D3D12 hook are
validated separately with the prepared private loader, because the installed
vendor loader ignores DYLD injection. Offline checks do not replace game acceptance.

## Source distribution

The proxy/native bridge derive from the Highball timestamp shim under GPL-3.0;
see `COPYING.GPL-3.0` and `source/shim/ORIGIN.md`. Runtime changes retain
LGPL-2.1-or-later; see `COPYING.LGPL-2.1` and the pinned upstream repositories.
The build emits `fh5-preview-v1-source.tar.gz` with the reconstructed runtime,
owned graphics source, pinned Wine source (including XML), patch inputs and exact
build recipes. Release staging verifies and publishes it alongside the DMG.
The large source archive is excluded from app.asar; source instructions, patches
and notices remain available in the app/repository. Installed vendor loaders and
D3DMetal are copied only on the user’s Mac and are not included in this archive.
