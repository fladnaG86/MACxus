# Halo movies with CrossOver Preview (experimental)

Halo: Campaign Evolved (`9N683TDT5M7R`) played startup movies with picture and
sound using this source patch in a separate **CrossOver Preview Rosetta
20261015** engine and disposable bottle. The automatic-pack test also had picture/audio, and the user reported smoother
playback with minimal logging. Later cinematics still need testing. This does not establish compatibility with FEX/ARM Preview.

## Automatic compatibility pack

Halo is the first entry in the [game compatibility-pack catalog](GAME-COMPATIBILITY-PACKS.md).
The shared handler reads its Store/build route and declarative settings from the
manifest; its existing engine cache and bottle paths are preserved.

macOS distribution builds include the two verified Wine DLLs, their LGPL license,
source patch and build recipe. The complete original source archive
(`crossover-sources-26.3.0.tar.gz`, SHA-256 in the manifest) is published as an
asset of the same GitHub release as the DMG. Users do not need compilers
or manual engine/configuration edits. On Halo's first launch, MACxus verifies the
installed Preview build and prepares a locally signed engine copy and a dedicated
Halo bottle under its application data. Bottle initialization uses unmodified
Preview first; the patched engine is selected for game execution after setup. The game profile recommends Preview
Rosetta when it is installed; an explicit FEX selection remains respected.

The pack is selected by Halo's Store ID, never by the title or folder name.
The metadata-free engine copy must pass the original vendor resource seal before
any DLL or bundle metadata is changed. Older engine copies created without that
check are ignored, while their dedicated bottle is retained. Bottle directories,
registry/configuration files, setup destinations and the C: mapping are checked
before both stock and patched-engine setup; linked paths fail before setup writes. Only
that launch receives the software-output setting and only that bottle receives
the Electra configuration. Stable CrossOver, FEX and other games keep their normal
runners. The installed CrossOver app, shared bottles and game files are not
modified. The dedicated bottle has its own game settings/save locations; existing
shared-bottle saves are not migrated by this feature. Normal Xodus cloud-save
behavior still depends on the active runtime and account.

Unrecognized Preview versions/build tags use the normal selected engine with an
explanation in the launch log. Modified vendor DLLs, corrupt pack components or
an invalid signature stop preparation with an error instead of executing an
unverified copy. Ordinary source checkouts without generated payloads keep using
the selected engine; packaged builds verify the pack is complete.

The media patch changes Wine's decoder, not Halo's executable or movie files.
This remains an experimental compatibility feature; the same limitations on
later cinematics, FEX and playback pacing apply.

## Supported experiment

The exact source, patch, original engine DLLs and tested output hashes are in
[`preview-media-experiment.lock.json`](../scripts/preview-media-experiment.lock.json).
The build uses the publicly available **CrossOver 26.3.0 Wine sources**, because
matching Preview sources were unavailable. Two private-interface fields are
adapted for the tested Preview: `wg_sample.stride` and
`wg_transform_attrs.output_plane_stride`. They are required even when the
software-output opt-in is off. Do not use these replacement DLLs with stable
26.3, another Preview build or an ARM64 engine.

The software-output opt-in exposes system-memory NV12, reports no D3D awareness,
rejects a D3D device manager and provides decoder-owned `IMF2DBuffer` samples.
Without the opt-in, the patched decoder retains its base-source format and
D3D-awareness behavior. This is not proof that every other media interface
matches Preview; keep the experiment isolated to Halo.

## Maintainer build preparation

`npm run dist:mac` runs `npm run prepare:mac-media-pack` automatically. The latter
downloads the checksum-pinned source archive, applies and verifies the patch,
builds the two PE DLLs and requires the accepted output hashes. The build sets
`SOURCE_DATE_EPOCH` separately for each DLL using the recorded tested timestamps.
The manifest's `relative-source-v1` build-path policy invokes configure as
`../sources/wine/configure` from the adjacent `build/` directory. Wine preserves
that spelling in its Makefile; `libs/strmbase` uses it in `__FILE__` string literals
which survive stripping. Do not invoke configure with an absolute source path.
This relative policy reproduces the original tested DLL hashes without requiring
a shared fixed temporary directory or a changed payload.
Generated DLLs and the source archive remain ignored by Git, and the actual app
ASAR is checked for both DLLs, the source patch and the LGPL license, and must
not contain the complete source archive. `npm run dist:mac` ends with
`npm run stage:mac-release-sources`, which verifies the archive and copies it to
`release/`; upload it with the DMG on every release.
A different toolchain that produces different bytes requires candidate
revalidation and a manifest update; packaging never accepts it silently.

For a cached official source archive, add `-- --source-archive /path/to/archive`
to the preparation command. Maintainers may reuse an exact accepted build with
`--dll-dir /path/to/dlls`; both hashes are checked before payload files change.
Use `--rebuild` to bypass cached DLLs and force a fresh source build; it cannot be
combined with `--dll-dir`. Repeat with a different `TMPDIR` to verify the path
policy. Both runs must match every accepted manifest hash. PR CI runs a stripped
PE `__FILE__` regression on Linux; the media-pack workflow additionally builds
the actual Wine DLLs twice under different temporary roots on macOS.

### Manual source reproduction

Use macOS with Xcode command-line tools, GNU Bison 3.8 or later, GNU Make and
MinGW-w64's `x86_64-w64-mingw32-strip`. Homebrew Bison is keg-only, so put its
`bin` directory on the build process's `PATH`.

1. Create a new temporary experiment directory outside the repository and
   download the source archive specified by the lock. Verify its SHA-256 before
   extracting `sources/wine/` there.
2. Verify the three original source hashes in the lock. From the extracted Wine
   source directory, apply
   `assets/runtime-patches/crossover-preview-halo-mf-software-output.patch`
   using `patch -p1`. Verify the three resulting hashes in the lock.
3. From the experiment root, create `build/` beside `sources/`, then `cd build`.
   Keep configure's path relative exactly as shown, and run:

   ```sh
   CC="clang -arch x86_64" CXX="clang++ -arch x86_64" \
     ../sources/wine/configure \
     --host=x86_64-apple-darwin --enable-win64 --enable-archs=x86_64 \
     --without-x --without-wayland --without-gstreamer --enable-winegstreamer \
     --without-cups --without-pulse --without-alsa --without-oss --without-dbus \
     --without-gphoto --without-sane --without-v4l2 --without-pcap --without-usb \
     --without-capi --without-freetype --without-gnutls --without-opengl \
     --without-vulkan --disable-tests
   SOURCE_DATE_EPOCH=1792987496 make -j8 \
     dlls/mfplat/x86_64-windows/mfplat.dll
   SOURCE_DATE_EPOCH=1792989507 make -j8 \
     dlls/winegstreamer/x86_64-windows/winegstreamer.dll
   ```

4. Copy those two PE DLLs into a separate output directory and strip their debug
   symbols using `x86_64-w64-mingw32-strip --strip-debug`. Record their hashes.
   The tested hashes identify the accepted local artifacts; different compiler
   versions can produce different bytes and require new candidate validation.

Only PE DLLs are built. Retain Preview's own Unix `winegstreamer.so` and its
GStreamer libraries. The recorded patch was applied to clean source and verified
to reproduce all three candidate source files exactly.

## Isolated game test

- First verify the installed Preview version and original DLL hashes against the
  lock. Make a separate copy with `ditto --noqtn --noextattr --norsrc`. Give it a
  unique name only. Before changing its bundle identifier or DLLs, verify the
  metadata-free copy with `codesign --verify --deep --strict`; this checks the
  original vendor resource seal. After it passes, assign a unique bundle
  identifier and replace only that copy's two DLLs in
  `Contents/SharedSupport/CrossOver/lib/wine/x86_64-windows/`.
- Locally ad-hoc sign the test app with `codesign --force --sign - --timestamp=none`
  and verify it with `codesign --verify --deep --strict` before execution. Do not
  disable Gatekeeper or modify the original app to resolve a signature failure.
- Use a disposable bottle and a separate game clone. Preserve game files, saves
  and credentials in the normal installation. Run Halo through the same signed
  Xodus backend, with save synchronization disabled (`XODUS_SAVE_SYNC=none`).
  Never re-sign the backend or broaden Keychain access for this experiment.
- Set `MACXUS_MF_SOFTWARE_OUTPUT=1` only for the isolated Halo process. In its
  disposable bottle, add the following to Meteorite's
  `Saved/Config/WinGDK/Engine.ini` (and `Windows/Engine.ini` if that configuration
  directory is used), then make those test files read-only:

  ```ini
  [SystemSettings]
  Electra.Win.H264UseOldOutputPath=1
  Electra.Win.H265UseOldOutputPath=1
  ```

- Compare startup movies and an opening cinematic with minimal logging first.
  Enable `+mfplat,+winegstreamer` only for a bounded diagnostic capture. The
  confirmed run produced about 77 MB of trace logs; it is unsuitable for a
  performance conclusion. Stop only the disposable prefix after the test.

The direct H.264 decoder test returned 90 frames from 90 compressed packets,
including 90 `IMF2DBuffer` samples. Four additional file-decoding comparisons
passed for the logo and opening-cinematic files with the opt-in on and off. The
full game test exited cleanly, and the user confirmed picture and audio. Raw
logs, movie packets, prefixes and game files are intentionally not committed.

## Source and attribution

Wine's LGPL license is included in the pack. The winevideo author documents that
Wine-derived source changes and DLLs follow Wine's LGPL terms; see
[THIRD_PARTY.md](THIRD_PARTY.md#winevideo-patches). The complete original source
archive is shipped alongside the generated DLLs, and this repository provides
the exact patch and build instructions. CrossOver itself, game files and optional
third-party media frameworks are not distributed by this pack.

Exact Preview source compatibility outside the tested interfaces and later
cinematics remain unverified. The automatic launcher path passed a minimal-log startup-movie test with user
confirmation of picture/audio and smoother playback. This is not a stable
release claim or validation of every cinematic.
