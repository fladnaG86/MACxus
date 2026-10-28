# Game compatibility packs

MACxus can apply a tested compatibility fix to one Store product and one exact
CrossOver build. Halo's movie fix is the first bundled pack. Adding another
supported Wine PE overlay uses the same handler; it does not require another
branch in the launcher. A pack does not establish compatibility for other games.

## Selection and isolation

`assets/compatibility-packs/catalog.json` routes a Store ID, engine, version and
build tag to a unique pack ID. The launcher reads only the selected manifest.
Unknown games and unsupported engine versions use their normal runner. A corrupt
selected manifest, mismatched fingerprints or failed signature stops preparation.
Source checkouts without generated DLLs can use the normal runner; macOS packaging
requires every registered pack to be complete inside the actual ASAR, except the
complete source archive, which is published as an asset of the same release.

The current `wine-engine-overlay` handler supports **x86_64 Rosetta CrossOver and
CrossOver Preview**. It verifies original PE DLLs and Unix companion libraries,
checks the vendor resource seal before modification, then replaces DLLs only in
a locally signed private engine copy. Stock CrossOver initializes its dedicated
bottle before the patched engine runs. ARM/FEX, Highball and other handlers are
not implemented by this schema.

Each pack has its own directory and bottle:

```text
compatibility-packs/<id>/
  <engineDirectory>/<appName>
  bottles/xbox/
```

Halo retains `halo-preview-media-v1/verified-engine-v2/MACxus Halo Video.app` and
`halo-preview-media-v1/bottles/xbox`. This refactor preserves its existing settings
and saves. Do not rename an existing pack ID or bottle as part of a routine
update. Change `engineDirectory` when the immutable engine cache must change;
retaining the same pack ID retains that game's bottle. Separate version routes
need separate pack IDs in schema 1 and therefore separate bottles. Save migration
between packs/shared bottles is not automatic.

Only the selected launch receives the pack's environment and INI changes. Bottle
setup paths and configured destinations are checked before either engine writes;
normal Wine document/Z: links remain allowed. These checks do not provide
isolation from concurrent external filesystem mutation.

## Adding a pack

1. Reproduce the problem with a specific Store product and engine build. Test
   the candidate in disposable directories, preserve the user's engine/game
   files and record the limits of the result.
2. Create a lowercase, hyphenated ID under `assets/compatibility-packs/` and add
   its exact route to `catalog.json`. Duplicate IDs or ambiguous routes fail
   validation. IDs are also used in private bundle identifiers.
3. Add a schema-1 manifest using Halo's manifest as a structural example. Record
   original/replacement DLL SHA-256 values, required Unix library SHA-256 values,
   source archive URL/filename/hash, source patch path/hash, original/patched
   source-file hashes, per-DLL reproducible timestamps and LGPL license hash.
   Record `buildPathPolicy: "relative-source-v1"`: configure must be invoked with
   its path relative to the build directory so `__FILE__` literals cannot embed
   the random temporary root. Supply the license and a README with attribution,
   reproduction and limitations.
4. Declare only the actions the game needs. `environment` accepts `MACXUS_*`
   feature opt-ins with simple values, never loader, PATH or WINEPREFIX overrides.
   `configuration` accepts `unreal-ini` actions with a project, Windows/WinGDK,
   Engine.ini/Game.ini, section, key/value map and explicit `readOnly` flag.
   Other settings/sections survive. Actions cannot name arbitrary paths or run
   commands. Halo's read-only Electra settings are one instance of this action.
5. Use `recipe: "wine-pe-v1"` for the existing macOS x86_64 Wine PE build recipe.
   It builds declared DLL targets using fixed configure flags and verifies all
   accepted output hashes. A fix needing a different recipe, architecture or
   action requires a separately reviewed handler change; metadata cannot supply
   scripts. Engine recommendation metadata remains in `assets/mac-profiles.json`.
6. Run `npm run prepare:mac-media-pack`. This prepares every registered pack.
   To prepare one pack, use `npm run prepare:mac-media-pack -- --pack <id>`.
   Local `--source-archive` and `--dll-dir` options require one selected pack.
   They reuse only checksum-matching inputs. Use `--rebuild` (without `--dll-dir`)
   to force clean source compilation in a fresh temporary directory, and repeat
   under a different `TMPDIR` when validating reproducibility. Generated payloads
   and source directories
   remain outside Git; distribution builds include them with source and recipes.
7. Run the contributing checks and add routing, safety and game-specific tests.
   Package verification must reject a missing/corrupt payload or source in any
   registered pack, not just Halo. Test real gameplay before claiming support.

Schema validation is shared by runtime, preparation and package verification in
`src/shared/compatibility-pack-schema.mjs`. Synthetic multi-game tests demonstrate
routing and isolation; they do not claim that another real game is fixed.

There is no remote pack installation, arbitrary mod execution, automatic save
migration or game-file patching in this system. Users supply CrossOver themselves.
See [Halo's tested behavior and source provenance](HALO-PREVIEW-MEDIA.md) and
[third-party licenses](THIRD_PARTY.md).
