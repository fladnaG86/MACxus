# Third-party notices (macOS)

## Highball engine — LGPL-2.1

MACxus can optionally download the Highball Wine engine
(<https://github.com/gauthierpiarrette/highball-engine>), a Wine build made from
the CrossOver 26.3 sources plus patches. It is licensed under the GNU Lesser
General Public License v2.1; its source code is available from that repository.
MACxus does not bundle or modify it: the pinned release
`engine-wine-11.0-20261014T003801Z-0024-app-packages-0023-spatial-mixer` is
downloaded on request, checked against a pinned size and SHA-256, and installed
under `<MACxus data>/engines/highball/`.

D3DMetal is not part of the Highball engine; MACxus uses the copy shipped with
the user's own CrossOver installation.

## highball-db — CC0

The per-game launch profiles in `assets/mac-profiles.json` (for example the
Forza Horizon 6 D3DMetal GPU identity and msync settings) come from the
highball-db recipes, dedicated to the public domain under CC0 1.0.

## Bundled runtime DLLs — LGPL-2.1-or-later

`assets/mac-runtime-dlls` contains PE builds of `xgameruntime.dll`, `windows.web.dll`,
`twinapi.appcore.dll`, `gamingtcui.dll` and `winhttp.dll` from the Xodus Nexus runtime release
`runtime-11.0-20261022-gf4adc821` (Wine 11.0 sources, LGPL-2.1-or-later; xgameruntime from
<https://github.com/xodus-gaming/xgameruntime>, LGPL-2.1), modified by the patches in
`assets/runtime-patches`. The corresponding source is that runtime release plus those patches;
rebuild steps are in `assets/mac-runtime-dlls/README.md`.

## Sikarugir runtime frameworks

When the Highball engine is installed, MACxus downloads the GLib/GStreamer frameworks from the
Sikarugir template release (<https://github.com/Sikarugir-App/Template>, `Template-1.0.11.tar.xz`,
pinned SHA-256). They are not bundled.

## winevideo patches

`assets/runtime-patches/highball-wine-mf-software-output.patch` contains patches 0004, 0005 and
0007 from <https://github.com/Jfishin/winevideo>, which modify Wine (LGPL-2.1-or-later). The
repository has no license file; DLLs built from it are not distributed until the author confirms
the license.

## Bundled Xodus backend — GPL-3.0

Apple Silicon app bundles include `xodus-cli` and `xodus-service` built from the
pinned Xodus source and MACxus patches. Their GPL license and complete
corresponding source (including vendored dependency sources/licenses and build
recipe) ship beside the executables under `Contents/Resources/backend/`.
See [the maintainer guide](MAC-BACKEND.md) for verification and offline rebuilds.
