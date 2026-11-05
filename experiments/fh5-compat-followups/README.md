# FH5 compatibility follow-ups

These changes retain the full Metal 4 GPU timestamp/calibration patch chain and
leave black-road rendering outside the investigation. No DirectX feature level
or driver capability is invented.

## Provider identity and legacy memory

Sol found that the original profile fallback accepted any loaded `nvapi64.dll`.
The launcher now installs the already fingerprinted vendor PE into the dedicated
bottle. The shim verifies its whole-file SHA256, compares the loaded executable
section with those verified bytes, checks the query export's expected RVA, and
pins the accepted module. Tests use an actual foreign DLL of identical size, and
a foreign mapped image whose backing file is replaced with the genuine PE.
Both must retain native query results without gaining either adapter.

The missing legacy memory API forwards to native Ex V1, then converts to exact
legacy V1/V2/V3 layouts. Quantities are measured by the provider, not constants.
Bytes become KiB (floor, saturating unsigned 32-bit); eviction counts only
saturate. Native legacy implementations take precedence. Failure leaves output
unchanged. The public ABI reference is NVIDIA/nvapi commit
`70d337db9186e968eab622f7e786de7e437faf3d`, `nvapi_lite_common.h`; only minimal
owned ABI declarations are included here.

The production-derived probe passes 918 checks. The real pinned provider
reports 112,742,896 KiB for dedicated/shared capacity on this host, matching its
Ex byte values after conversion. This follows Preview's unified-memory model;
it does not represent separate physical VRAM plus shared RAM.

## Signed compatibility database

Preview's Perl launcher sets `CX_HOME` using CXUtils' product cellar ID
(`CrossOver Preview` becomes `CrossOver`). Our direct loader omitted that
variable. A control without it produced nine missing-database errors. The
launcher now snapshots only bounded complete `compatdb-N.dat` / `.sha256` pairs
into a private, content-keyed home, using the current user's support directory.
It never copies license/account files or changes the source cache.

A snapshot produced by the actual helper loads database 27 with zero database
errors. A deliberately corrupted signature produces native `invalid signature`
errors and does not load database 27. Signature enforcement is retained.
No assertion is made that this particular signed cache contains an FH5 rule;
the game trace now shows FH5 database lookups, but a specific matching rule is
still not established.

## Existing heap import

`OpenExistingHeapFromAddress` is observed without changing its arguments,
HRESULT, output or capabilities. Metadata uses bounded per-operation samples,
thread/tick/caller RVA, alignment and successful ordinary allocation descriptors;
no address contents or raw pointers are recorded. Normal Play leaves it off.

A real D3DMetal control returns `0x80004001` (`E_NOTIMPL`) for address import,
then successfully creates a normal 64 KiB upload heap. This proves the tracing
and ordinary allocation path, not FH5's fallback behavior. The combined private game trial completed a benchmark without the startup
dialog. Two observed initializations each made five imports from the same caller
RVA, all returning `E_NOTIMPL`, followed by successful ordinary allocations.
The exact fallback branch is not proven; this trace shows that the unsupported
operation is tolerated in this benchmark, so no fake implementation was added.

## Validation and limits

Run the portable builder and `scripts/fh5-pack/verify.py` as documented by the
pack. The verifier includes actual provider-identity, memory-conversion and
native heap probes. Launcher checks cover cache isolation, absent/incomplete
pairs, linked/oversized files, damaged snapshots and NVAPI setup destinations.

Local evidence remains under `work/fh5-followup-audit` and
`work/fh5-followup-production`; raw logs, vendor data, prefixes and vendor
binaries are not published. Fresh Sol review of the exact functional candidate found no actionable
findings, and the user completed the combined private benchmark without a
startup dialog. `game-acceptance.json` records the bounded evidence. Integrated
normal Play remains pending. No performance improvement, universal
Windows parity, or restored FH5 title-specific vendor rule is claimed.
