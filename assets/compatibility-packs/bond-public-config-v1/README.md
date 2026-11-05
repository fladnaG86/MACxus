# 007 First Light public configuration compatibility candidate

This optional recipe targets Store ID `9PN198B459VB` and the Rosetta CrossOver
Preview `20261015` build `cxpreview-20261015-rc1`. It uses our own MIT-licensed
WinHTTP forwarder and the application's unchanged, fingerprinted runtime WinHTTP.
It includes no game code, account data, game binaries or developer installation
paths. The complete small source recipe is included beside the manifest.

## Evidence and acceptance

The shared endpoint/authentication candidate in [fork PR #26](https://github.com/zachspartofaday/MACxus/pull/26) allowed Xbox token
requests to succeed, but 007 configuration still failed. A private diagnostic
identified unsigned Azure Blob GET/HEAD requests with an unsupported Authorization
value supplied in the title's inline header block. Azure returned HTTP 400 and
`InvalidAuthenticationInfo`. Omitting that value in an isolated comparison
returned HTTP 200, downloaded configuration and allowed user-reported online
access. See `experiments/xsts-endpoint-routing/azure-anonymous-control.json`.

**This packaged candidate has not been game-tested.** Its scope is tighter than
the successful private control: it excludes every query-bearing URL, additional
recognized authentication schemes, non-GET/HEAD requests, non-HTTPS requests,
other executables and launches without the explicit environment switch. Offline
contracts and build reproduction do not establish live acceptance. This is a
007 configuration compatibility recipe, not a universal multiplayer fix.

The exact inappropriate value and why the title supplied it remain unresolved.
The public Microsoft libHttpClient source has explicit cross-origin credential
handling, but that does not establish a redirect cause or the identity of the
network implementation used here. No vendor DLL is replaced in the game folder.

The pack addresses configuration retrieval only. It does not install the shared
authentication runtime; keep a matching runtime selected when validating the
combined setup. The grouped [upstream runtime PR #21](https://github.com/fladnaG86/MACxus/pull/21) contains that shared foundation;
this pack is [upstream PR #23](https://github.com/fladnaG86/MACxus/pull/23). Neither
publication nor offline tests establish live portable-pack acceptance. The earlier
fork PRs #22–#24 alone did not provide 007 online acceptance. Preserve the
[separate offline, ARM/FEX and private-online reports](https://github.com/zachspartofaday/MACxus/blob/upstream/fh5-preview-pack/docs/compatibility/games/007-first-light.md) when comparing results.

## Build and portability

Install MinGW-w64 GCC **16.2.0**, then run from the pack directory:

```
node source/build.mjs --out /path/to/new-output-directory
```

The output directory must not exist. `CC` can select the compiler executable.
The build uses relative input names, an explicit PE image base, a zero PE
timestamp and link-time stripping. Its entry point is the existing C `DllMain`;
there is no TLS, constructor or CRT-managed state to initialize. C helpers are
imported from `msvcrt`, and the compiler's stack-probe helper is linked explicitly.
This avoids bottle-specific CRT startup objects. It verifies source hashes and
the accepted output hash. Different
compiler versions or changed sources require new validation before updating the
manifest. This proves reproduction with the recorded compiler, not a clean
compiler/toolchain rebuild. No SDK, game installation or network access is used.

From the repository, `node scripts/prepare-runtime-pack.mjs` prepares the ignored
payload directory. The macOS build includes this step and ships the source,
license and verified DLL; users need no compiler. No vendor DLL is included in
this pack. At launch, the exact native runtime WinHTTP is copied into the private
bottle as `mxhttp.dll`, then our wrapper is installed as `winhttp.dll`.

## Runtime isolation and rollback

The selected game gets a dedicated bottle under the application's data root.
The installed CrossOver/MACxus bundles, other bottles, game files and global
runtime override directory are not modified. Prefix destinations and component
hashes are checked before staging; incompatible custom WinHTTP overrides fail
with an error. The dependency is installed before the wrapper. This is not a
transaction against concurrent external filesystem edits or installation changes.

Only the selected game receives `MACXUS_007_PUBLIC_CONFIG=1`; the DLL additionally
checks the executable basename. To disable filtering while retaining this bottle,
set the game's launch options to `MACXUS_007_PUBLIC_CONFIG=0 %command%` (preserve
any other options you use). No networking headers are logged. The wrapper leaves
recognized schemes and all query-bearing URLs untouched. Duplicate Authorization
fields and requests with an already installed Authorization field are forwarded
unchanged to avoid exposing a credential suppressed by an override. Requests
that use WinHttpSetCredentials are also excluded, since the original sender may
materialize those credentials only after the presence check. Requests outside the
narrow rule use the original transport. Table exhaustion and unrecognized header
syntax preserve the original request. The effective URL is checked again before
each send, and reused handle identities replace old metadata. Existing
WinHTTP-added headers are not removed; this candidate only handles the inline block implicated by the trace.

The original DLL remains available as `mxhttp.dll` in that private bottle. Using
a MACxus build without the entire pack directory selects the normal engine/bottle
on a subsequent launch; dedicated bottle data is retained. A present directory
with missing or invalid manifest metadata still fails validation. Do not delete a bottle to roll back.

## Offline contract probe

```
x86_64-w64-mingw32-gcc -O2 source/test.c -o /path/to/test.exe -Wl,--no-insert-timestamp
```

Run the probe in an account-free disposable Wine prefix. It tests the production
source with mock transport calls; it never contacts a service or starts a game.
A separate real WinHTTP loopback suite checks forwarding and callback behavior.
