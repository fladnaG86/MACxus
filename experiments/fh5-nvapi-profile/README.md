# FH5 Preview NVIDIA initialization

With Preview's DLSS enabler, FH5 initializes NVAPI and loads a profile session,
then requests the unavailable current-global-profile getter. It destroys the
session before asking for a driver version. The benchmark shows `-1.-1`, and the
startup TaskDialog receives empty primary strings.

The FH5 pack explicitly opts into using the existing base-profile getter when
that native getter is missing. It forwards the native session, output buffer,
status and profile handle, writes no settings, and leaves existing native
functions in charge. Other exports/IDs pass through, and bindings from different
provider modules are not mixed. The launcher fingerprints the provider PE and
Unix components. The shim also checks the loaded module's backing-file SHA256,
executable bytes and query entry point before returning an adapter. The launcher
materializes the verified PE from the selected engine in the private bottle;
Wine's tiny placeholder is insufficient for this check. A same-name, same-size
foreign provider and a foreign loaded module with a replaced backing file are
rejected in real runtime controls. No driver number, warning result, game instruction or vendor
binary is supplied by this change.

The full-patch-chain prototype then reached the native driver-version API and
received `57602`; the user confirmed a benchmark showing `576.2`, no blank
startup dialog, and DLAA/frame generation retained. Real 24 MHz GPU queries and
successful paired calibration were captured. This is a compatibility-provider
version, not a physical NVIDIA driver installed on the Mac.

The earlier diagnostic game builds omitted the three timing patches. Their
reporting traces identified the path but are excluded from rendering, timing
and performance acceptance. The full prototype was reconstructed with all three
patches and tested separately; `prototype-acceptance.json` records that scope.

`validation.json` records the production payload/source reproduction, synthetic
contracts and GPU/calibration checks. Normal MACxus Play remains pending. Fresh Sol review of the functional
candidate `105216a` found no actionable findings; the combined private benchmark
completed without a startup dialog. The follow-up evidence is recorded in
`../fh5-compat-followups/game-acceptance.json`. Default/base-profile fallback is a deliberate
FH5 policy for this provider, not a universal assertion about NVIDIA profiles.
Black roads, unrelated vendor APIs, sleep/resume and universal Steam acceptance
are outside this change. The test binary is built from
`assets/fh5-preview/source/tests/nvapi-profile.c`; source and build paths are
supplied by the normal portable pack recipe.
