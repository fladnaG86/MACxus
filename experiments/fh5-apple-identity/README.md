# FH5 Apple GPU description and Preview-selected IDs

The FH5 Preview pack reports `Apple M5 Max (D3DMetal)` using the host chip name
already checked by its M5 Max activation guard. It no longer labels that GPU as
an RTX 4070. This is a launch-wrapper change; all six accepted calibration,
rendering and runtime module hashes and the corresponding-source archive are
unchanged.

With MACxus's CrossOver DLSS option enabled, the game wrapper clears manual
`D3DM_VENDOR_ID` / `D3DM_DEVICE_ID` overrides, including inherited values. The
fingerprinted Preview MetalFX mode supplies its own compatibility IDs: the owned
DXGI probe reports NVIDIA `10de/2684`. The user confirms driving/benchmark and
DLSS/DLAA work with this configuration. A separate display-name-only control
retaining the previous `10de/2786` IDs also passed and showed Apple M5 Max in
the benchmark. See the two acceptance JSON files and adapter matrix.

With MetalFX mode off or unspecified, the wrapper retains the previously accepted
`10de/2786` compatibility fallback. Preview's default `1002/66af` AMD mode caused
an earlier FH5 AGS startup fault and has not been accepted. The feature flag is
set explicitly from the user's DLSS launch option by the ordinary launcher;
this change does not enable DLSS for an off game. Prefix setup and Stop retain
the ordinary runner. No global environment, installed engine, game file or
shared runtime is modified.

This is **not native Apple vendor identity with DLSS**. Prior `106b/0000` trials
reached driving/benchmark but lacked the DLSS menu despite the feature flags.
Device zero was an unknown diagnostic value, not an established physical PCI ID.
The current adapter matrix confirms Apple IDs can be exposed; it does not prove
DLSS can operate with them. Resolving that capability gating remains separate.

Private game controls used cloned bottles, the original AGS DLL, the accepted
Metal 4/calibration/runtime modules, and the shared account/add-on bridge. The
installed calibrated application and accepted managed bottles were preserved.
No performance improvement, multiplayer retest, long-session or black-road
repair is claimed. Private controllers, prefixes, game/vendor binaries and raw
account logs are excluded from contributions. Paths in the production wrapper
continue to derive from the selected engine/assets/data root; no developer
installation path is introduced.
