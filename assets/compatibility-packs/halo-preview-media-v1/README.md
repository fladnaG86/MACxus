# Halo Preview media compatibility pack (experimental)

Wine PE DLLs, LGPL-2.1-or-later. Modified from the official CrossOver 26.3.0
Wine sources using the source patch at
`assets/runtime-patches/crossover-preview-halo-mf-software-output.patch`.
The complete original source archive (`crossover-sources-26.3.0.tar.gz`) is
published as an asset of the same MACxus GitHub release as the app, and the LGPL
license is `COPYING.LIB`. The manifest records all source/artifact hashes, the
accepted Preview build and the per-DLL reproducible build timestamps. The
`relative-source-v1` policy invokes configure using `../sources/wine/configure`
from `build/`, preserving the original tested `__FILE__` literals without embedding
a random absolute build path. `--rebuild` forces a clean source build for
reproducibility checks; both accepted DLL hashes remain unchanged.

Attribution: Wine/CodeWeavers; Jfishin/winevideo patches 0004, 0005 and 0007
(commit 523a3dd7d5af0a5feec34a7433180129bd9ece6a); MACxus's per-process opt-in and
Preview interface adaptations. The winevideo author's licensing statement is at
https://github.com/Jfishin/winevideo/wiki/Building-and-Patch-Provenance#licensing-and-attribution

Complete build instructions and limitations:
https://github.com/zachspartofaday/MACxus/blob/main/docs/HALO-PREVIEW-MEDIA.md
The build recipe is included under `source/build-scripts/`; restore it into the
repository's `scripts/` directory and `source/src/shared/` into `src/shared/`
when reconstructing the source layout. The
corresponding patch and manifest are supplied with this pack and the complete
Wine source archive with the same release, so the original source download need
not remain available to rebuild.

Users supply their own CrossOver app. MACxus makes and signs a private copy for
Halo only. This pack does not contain CrossOver, game files, GStreamer or FFmpeg.
Startup movie picture/audio were confirmed through the automatic preparation
path, and the user reported smoother playback with minimal logging. Later
cinematics remain unverified. Preview FEX/ARM and other Preview builds are unsupported.
