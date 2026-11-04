# Shared authentication endpoint investigation

007 First Light continued to run after installing the fork's merged #22–#24
runtime, but online access still failed. Its existing Play log contains six
`xsts_authorize_privilege` failures with HTTP 400. The runtime was selected from
the override directory, loaded natively from system32, and the bottle's copy
matched the installed override. The account bridge was ready and the backend
reported successful content-license parsing. Those earlier successes do not
establish that Xbox online authentication completed.

FH5's earlier XSTS requests also returned HTTP 400. Its investigation established
that the guessed game-service origin was not its registered token audience;
Windows title authentication and authenticated title-endpoint discovery resolved
that part of the failure. That work became #22. FH5 still required other fixes
before gameplay and online access worked.

The package metadata differs: FH5 omitted MSAAppId, while 007 declares one. The
latter uses the preserved SISU branch. The shared endpoint matcher is used after
either identity path. The old matcher fails synthetic catch-all/trailing-star,
repeated-suffix backtracking and DNS-case fixtures. Such a miss can route a token
request through the existing guessed-origin fallback instead of the service's
supplied audience. This is a reproduced shared defect; the current 007 log does
not contain its requested audience or endpoint-match outcome, so attribution of
007's rejection to this defect remains unproven.

The candidate repairs those wildcard cases and adds numeric refusal diagnostics.
It does not switch the SISU identity to another app, guess a replacement audience,
remove title claims, or convert an Xbox denial into success. It contains no game
code, account data, game-specific routing rules or runtime path constants.

## Validation and limits

- The old production-derived endpoint probe fails the new regressions with exit
  42; the candidate is tested against the same fixtures.
- Source reconstruction starts from pinned Git objects and verifies every patch
  and all 36 locked runtime source hashes. All 23 implementation C objects are
  rebuilt using the matching generated Wine SDK; this is not a from-zero SDK or
  toolchain reproduction claim.
- Account-free Wine probes exercise endpoint lookup, legacy title request
  construction, privilege handling, token ABI and initialization. Synthetic XSTS
  error bodies cover numeric bounds, malformed/type-mismatched values and keeping
  messages/redirects out of the new diagnostic output. Privilege refusals remain
  failures.
- The initial local review found that calling Wine's JSON decoder leaks the
  error body under `trace+web` and accepts malformed numeric JSON. The replacement
  scanner accepts a deliberately small flat-object format, performs strict
  integer/UTF-8/string syntax checks, and never sends the body to a framework
  parser. Unsupported shapes produce no metadata. The refusal-only Wine test
  checks combined stdout/stderr with `trace+web` enabled; the old candidate is
  retained as a negative control. Native ASan/UBSan mutation checks additionally
  compare accepted inputs with Python's JSON decoder.
- The build retains the existing macOS GS last-error header correction for its
  local component checks. This host-specific input is separate from the shared
  source patch.
- No game, account service or live authentication probe was started during the
  offline validation above. The subsequent user-authorized trial is recorded
  separately below; original applications and game files remain unchanged.

## Subsequent 007 Play-path trial

The reviewed candidate at `4b62105` was installed through the supported runtime
override and launched through MACxus's normal Play handler. It reached the
entrance screen but crashed around the F-to-continue transition. The log records
one game access violation at executable offset `0xa23453`, reached from the
runtime's async-completion callback, and backend exit code 5. No XSTS refusal was
recorded before that crash. This does not identify which async operation failed.

Restoring the exact pre-candidate DLL in the same bottle allowed the user to
reach the main menu without crashing, while online access still failed. Its log
again records XSTS HTTP 400. This is evidence of a candidate regression and
blocks treating the full patch as ready for use; its precise cause remains open.
PR #26 was returned to draft, and the failed trial's log was preserved locally.

A diagnostics-only comparison retains the exact old wildcard matcher while
adding the reviewed numeric refusal logging. Its five account-free probes pass,
including 1,191 privilege checks and 88 token ABI checks. Its later user trial is described below. It is an experimental local comparison,
not the full PR candidate or a newly established online fix. See
[`live-validation.json`](live-validation.json) for the path-free record.

The diagnostics-only trial reproduced the configuration-fetch error and XSTS
HTTP 400. Every observed failed token request reported `endpoint_metadata=0`;
none yielded accepted numeric `XErr` metadata. This confirms the old fallback
route was used, but does not identify its audience from the numeric trace.

A separate account-free token-result probe reproduced successful no-token
responses with null token pointers in both encodings. The follow-up source delta
returns owned empty strings for this case, including when a signature policy is
present. The test checks that no authorization request is made for these rules;
it does not fabricate a credential. The current token ABI probe passes 140
checks. The older test version reproduced eight empty-token ownership failures
before the change; its diagnostic count also included worker-thread checks that
were subsequently replaced with a main-thread authorization-call count.

The private combined comparison produced genuine XSTS HTTP 200 responses and
successful token retrieval, and continued through no-token routes. The user still
reported the game configuration-fetch error. This is authentication progress,
not proof that the no-token representation caused the original crash or that
the game's own server accepts the current session. Private HTTP observers are
being used to distinguish response delivery from game-service validation; they
are not part of this source patch or a released compatibility pack.

Before claiming an online fix, test a controlled 007 run and inspect the new
`endpoint_metadata`, `xerr_present`, `xerr` and `title` fields if authorization
still fails. A successful token request also needs validation against the game's
actual online service. Preserve the numeric refusal rather than treating HTTP
400 as proof of a particular title/audience/account problem.

## Successful private Azure configuration control

A response-time HTTP observer established that the title's Azure Blob GET and
HEAD requests carried an Authorization value outside the observer's recognized
schemes. No recognized SAS query keys were detected. Azure returned HTTP 400;
the GET's error code was `InvalidAuthenticationInfo`. This was separate from the
now-successful Xbox token exchange. Credential values were not recorded.

A private comparison omitted that unsupported header only for these unsigned
Azure Blob requests. The trace records two omissions from the inline header
block supplied to `WinHttpSendRequest`. Both requests then returned HTTP 200,
the GET delivered 344 bytes of configuration data, and the user reported that
online now works. The successful game session was left running. The control
passed 54 targeted checks, alongside forwarding, callback and privacy checks.

This establishes that inappropriate Authorization caused these observed
configuration failures. It does not establish why the game supplied that value,
Windows behavior, or a safe universal header-removal policy. The host-scoped
control remains private and is not included in this PR or a compatibility pack.
The shared runtime candidate alone still lacks demonstrated 007 online
acceptance; all online features have not been tested. See the path-free
[`azure-anonymous-control.json`](azure-anonymous-control.json) receipt.
