# MACxus — discoveries / scoperte

**[English](#english)** · **[Italiano](#italiano)** · **[Credits / Ringraziamenti](#credits--ringraziamenti)**

Everything below was found while bringing Xbox PC (GDK) games to Apple Silicon Macs with Xodus. Each item says what broke, why, and what MACxus does about it.
Tutto ciò che segue è emerso portando i giochi Xbox PC (GDK) sui Mac Apple Silicon con Xodus. Ogni voce dice cosa si rompeva, perché e cosa fa MACxus.

---

## English

### 1. Launching without `WINE_DLL_FILE_MAP`
`xodus-cli run` relies on `WINE_DLL_FILE_MAP`, a patch in Xodus' own Wine (`ntdll/unix/file.c`) that maps decrypted package files into the game's view. CrossOver does not have it. MACxus builds a **launch overlay on a RAM disk** (`hdiutil`, HFS+): decrypted `keep_encrypted` files plus symlinks to the rest of the package. After the game exits, files it wrote into the overlay (for example Unreal's `Saved/`) are synced back. Patch: `assets/xodus-macos-launch.patch`.

### 2. No `AF_UNIX` in CrossOver's Winsock
The game-side runtime talks to the Xodus account service over a Unix socket. CrossOver's Winsock has no `AF_UNIX`, so MACxus puts a **private loopback TCP bridge** (random port + key) in front of the socket. macOS also caps socket paths at 104 bytes, so long paths fall back to the temp folder.

### 3. Runtime DLLs must not look "builtin"
The Nexus runtime PE DLLs (`xgameruntime`, `windows.web`, `twinapi.appcore`, `gamingtcui`) carry the `Wine builtin DLL` marker, so CrossOver prefers its own builtin copy. MACxus zeroes the marker, copies the DLLs into `system32` and sets `native,builtin`.

### 4. Highball engine
Forza Horizon 6 crashes on CrossOver (`kernelbase.GetIntegratedDisplaySize` is missing). MACxus can download the **[Highball](https://github.com/gauthierpiarrette/highball-engine)** engine (Wine built from CrossOver 26.3 sources + patches, LGPL) and run it with CrossOver's D3DMetal. Highball needs CrossOver's `lib64` on `DYLD_FALLBACK_LIBRARY_PATH` for GnuTLS. Gotcha: `/usr/bin/arch` strips `DYLD_*` (SIP), so run x86 test binaries directly.

### 5. XCurl and winhttp option 140
Unreal 5 games reach PlayFab through XCurl (the GDK libcurl). Highball's winhttp rejects `WINHTTP_OPTION_IPV6_FAST_FALLBACK` (140) and XCurl treats that as fatal. MACxus installs the Nexus runtime's winhttp, which accepts it, together with `libnghttp2.dll`: without it, ALPN still negotiates `h2` and the connection closes silently (error 0021).

### 6. The `%gs:0x68` last-error bug (root cause of many silent failures)
On macOS, Highball's ntdll keeps the thread's last error in **two** places: `TEB+0x68` and a separate `%gs:0x68` slot. `RtlGetLastWin32Error` reads only `%gs:0x68`. The Nexus PE DLLs are built with `__WINESRC__`, so their inline `SetLastError` writes only the TEB, and `GetLastError` in kernelbase returns a stale 0. Visible effects: XCurl header probes and `VerifyServerCertificate` failing (error 0063). Fix: `assets/runtime-patches/wine-macos-gs-last-error.patch` makes the inline `Get/SetLastError` use `%gs:0x68`. All Nexus DLLs are rebuilt with it and shipped in `assets/mac-runtime-dlls`. This is what made Minecraft Dungeons II work.

### 7. Store queries
Nexus' `XStoreQueryAddOnLicensesAsync` and product queries were stubs (`E_NOTIMPL`). `xgameruntime-xstore-queries.patch` makes them return empty but valid results, and optionally unowned catalog entries. For Forza Horizon 6 we proved that **the store is not the blocker**: after *Start game* every GDK async completes (license, sign-in, XSTS, PlayFab 200), then the game spins at about 250% CPU and makes no further GDK calls. This matches the Linux reports. Attaching `winedbg` kills FH6 (anti-debug, exit 232), so do not try it.

### 8. Halo video (black cutscenes)
Two problems were stacked. (a) Highball's `winegstreamer.so` needs GLib 2.88 / GStreamer 1.28; CrossOver's libraries are too old (`g_once_init_enter_pointer` missing), so the module never loaded ("GStreamer doesn't support H.264"). MACxus downloads Highball's runtime frameworks (from the [Sikarugir](https://github.com/Sikarugir-App/Template) template) and sets `GST_PLUGIN_SYSTEM_PATH` / `GST_REGISTRY`. (b) Wine Media Foundation's D3D-aware NV12 output path produced black frames. Patches 0004/0005/0007 from [Jfishin/winevideo](https://github.com/Jfishin/winevideo) fix it (`assets/runtime-patches/highball-wine-mf-software-output.patch`). Highball’s rebuilt DLLs are not bundled. The [Halo Preview compatibility pack](HALO-PREVIEW-MEDIA.md) uses a separately pinned rebuild.

### 9. M1 hardware limit: 64-bit atomics
D3DMetal on M1 (Apple7 GPU family) reports 64-bit atomics on typed resources, but Metal rejects them: Halo builds about 620 pipelines that fail. Hiding the capability makes Halo refuse to start ("GPU not supported", because Nanite requires it). Turning off Lumen, virtual shadow maps or Nanite compute raster does not remove the glitches. Best settings on M1: native upscaler (no FSR) and motion blur off. M2 or newer may behave differently (untested).

### 10. Controllers
Wine exposes a DualSense as a raw HID device by default, which XInput games ignore. Xodus Nexus' "DualSense compatibility mode" sets `PROTON_DISABLE_HIDRAW`, which exists **only in Proton**. On macOS MACxus writes `HKLM\System\CurrentControlSet\Services\winebus\DisableHidraw` instead, so SDL presents the pad as an XInput gamepad. Wine stores this key under `ControlSet001`. The tested Wine `gameinput.dll` is a stub (`GameInputCreate ... stub!`), but that message does not establish that a game requires GameInput exclusively. In Halo: Campaign Evolved, Steam Controller 2 gave direct gamepad control/button prompts and was identified as a Steam Controller on CrossOver Preview Rosetta 20261015/macOS 27.2 with no GameInput replacement and no DualSense compatibility mode. A separate baseline also confirmed direct controls/button prompts with Xbox Elite Series 2 over Bluetooth under the same no-shim conditions. The exact fallback API was not established; these results do not verify other controllers, games, engines, rumble, Elite paddles or advanced features.

### 11. Per-game profiles
`assets/mac-profiles.json` holds declarative per-game settings (engine choice and whitelisted variables). Forza Horizon 6 uses Highball and reports an RTX 4070 to D3DMetal (`D3DM_VENDOR_ID` / `D3DM_DEVICE_ID`). The recipe comes from [highball-db](https://github.com/gauthierpiarrette/highball-db) (CC0).

### 12. External SSDs
Most external SSDs are exFAT, which has no symbolic links, and installed games need them. MACxus therefore lets you put games on any APFS/HFS+ drive directly, and on exFAT/FAT/NTFS drives it creates an APFS sparse bundle (`MACxus.sparsebundle`) that grows only as needed. The image is re-attached at every start (without attaching it twice), free space is checked before downloads, and games on an unplugged drive are marked "Drive disconnected" instead of failing.

### 13. Smaller lessons
- Electron app + locally built backend: Keychain prompts come back after each rebuild unless the backend is signed with a stable identity. MACxus can sign it with a local "MACxus Local Signing" certificate; Developer ID signing is planned.
- An APFS sparse bundle could get attached twice: fixed by checking existing attachments first.
- Rosetta frames do not symbolize in macOS `sample`, so studying hangs needs Wine's own traces (`WINEDEBUG=+gdkc` for xgameruntime).
- Halo (UE5) **does** read Engine.ini in `Saved/Config/WinGDK`, but the game overrides `r.ScreenPercentage`.

### 14. AVX under Rosetta
Rosetta 2 can run AVX/AVX2 code, but it only reports AVX in `CPUID` when `ROSETTA_ADVERTISE_AVX` is set. CrossOver's `wine` script sets it to 1 by default; the Highball wrapper did not, so a game with an AVX check (Gears of War: E-Day: "Your CPU must support AVX") started on CrossOver and refused to start on Highball. The Highball wrapper now defaults it to 1 as well. Rosetta treats **any** value as "on", so `ROSETTA_ADVERTISE_AVX=0` unsets the variable, as CrossOver does.

### 15. Games that ship their own `xgameruntime.dll`
Some packages (Gears of War: E-Day) include the Windows GDK runtime next to the executable. Wine loads DLLs from the executable's folder before `system32`, so the game used Microsoft's runtime instead of the Nexus one in the prefix. That runtime needs Windows Gaming Services, so `XGameRuntimeInitialize` failed. XCurl could not create its task queue and Unreal aborted with `Could not initialize libcurl (result=2)`. The `+gdkc` trace stayed empty, which is the giveaway that the Nexus runtime was never loaded. Fix in `assets/xodus-macos-launch.patch`: the RAM-disk launch view drops every `xgameruntime.dll`, so Wine falls back to the prefix copy. The installed package is untouched. The backend has to be rebuilt (Settings → Build backend).

### 16. Games that require ray tracing
Gears of War: E-Day requires a GPU with DirectX Raytracing and has no raster fallback. On M1 the game stops with a "ray tracing required" message. As far as we know, D3DMetal exposes DXR only on Apple GPUs with hardware ray tracing (M3 and newer); this was not measured with a probe. Faking the capability would only move the crash into the DXR calls. These games need M3 or newer.

### 17. Easy Anti-Cheat and offline play
Under Wine, the EAC bootstrapper downloads its **Linux** module (an ELF library) and maps it through the Unix side of Wine, as Proton does. macOS cannot load ELF, so the launch ends with "Failed to map the anti-cheat module" (Xodus exit 206; log in the prefix under `AppData/Roaming/EasyAntiCheat/.../anticheatlauncher.log`). EAC has no "Wine on macOS" variant. For games whose campaign also works offline, the per-game launch tool **Play offline without anti-cheat** (shown only for EAC games, off by default) starts the executable named in `EasyAntiCheat/Settings.json` directly, with the EOS SDK's `EOS_USE_ANTICHEATCLIENTNULL=1`. EOS then knows there is no anti-cheat client, so protected online features are refused. Do not try to play online in this mode: the game still signs in to Xbox services, and what happens to your account is your responsibility.

---

## Italiano

### 1. Avvio senza `WINE_DLL_FILE_MAP`
`xodus-cli run` usa `WINE_DLL_FILE_MAP`, una patch del Wine di Xodus (`ntdll/unix/file.c`) che mappa nella vista del gioco i file del pacchetto decifrati. CrossOver non ce l'ha. MACxus crea un **overlay di avvio su RAM disk** (`hdiutil`, HFS+): i file `keep_encrypted` decifrati più link simbolici al resto del pacchetto. Quando il gioco esce, i file che ha scritto nell'overlay (per esempio la cartella `Saved/` di Unreal) vengono risincronizzati. Patch: `assets/xodus-macos-launch.patch`.

### 2. Niente `AF_UNIX` nel Winsock di CrossOver
Il runtime del gioco parla con il servizio account di Xodus tramite un socket Unix. Il Winsock di CrossOver non supporta `AF_UNIX`, quindi MACxus mette davanti al socket un **bridge TCP loopback privato** (porta casuale + chiave). macOS limita inoltre i percorsi dei socket a 104 byte: i percorsi lunghi ripiegano sulla cartella temporanea.

### 3. Le DLL del runtime non devono sembrare "builtin"
Le DLL PE del runtime Nexus (`xgameruntime`, `windows.web`, `twinapi.appcore`, `gamingtcui`) contengono il marcatore `Wine builtin DLL`, quindi CrossOver preferisce la propria copia builtin. MACxus azzera il marcatore, copia le DLL in `system32` e imposta `native,builtin`.

### 4. Motore Highball
Forza Horizon 6 va in crash su CrossOver (manca `kernelbase.GetIntegratedDisplaySize`). MACxus può scaricare il motore **[Highball](https://github.com/gauthierpiarrette/highball-engine)** (Wine compilato dai sorgenti di CrossOver 26.3 più patch, LGPL) e usarlo con il D3DMetal di CrossOver. Highball ha bisogno della `lib64` di CrossOver in `DYLD_FALLBACK_LIBRARY_PATH` per GnuTLS. Attenzione: `/usr/bin/arch` elimina le variabili `DYLD_*` (SIP), quindi i binari x86 di test vanno lanciati direttamente.

### 5. XCurl e l'opzione winhttp 140
I giochi Unreal 5 raggiungono PlayFab tramite XCurl (la libcurl del GDK). Il winhttp di Highball rifiuta `WINHTTP_OPTION_IPV6_FAST_FALLBACK` (140) e XCurl lo considera un errore fatale. MACxus installa il winhttp del runtime Nexus, che la accetta, insieme a `libnghttp2.dll`: senza questa libreria l'ALPN negozia comunque `h2` e la connessione si chiude in silenzio (errore 0021).

### 6. Il bug del last-error `%gs:0x68` (causa di molti errori silenziosi)
Su macOS l'ntdll di Highball tiene l'ultimo errore del thread in **due** posti: `TEB+0x68` e uno slot separato `%gs:0x68`. `RtlGetLastWin32Error` legge solo `%gs:0x68`. Le DLL PE di Nexus sono compilate con `__WINESRC__`, quindi il loro `SetLastError` inline scrive solo nel TEB e `GetLastError` di kernelbase restituisce uno 0 vecchio. Effetti visibili: falliscono la verifica degli header di XCurl e `VerifyServerCertificate` (errore 0063). Correzione: `assets/runtime-patches/wine-macos-gs-last-error.patch` fa usare `%gs:0x68` ai `Get/SetLastError` inline. Tutte le DLL Nexus sono ricompilate con questa patch e incluse in `assets/mac-runtime-dlls`. È la correzione che ha fatto funzionare Minecraft Dungeons II.

### 7. Query dello Store
In Nexus `XStoreQueryAddOnLicensesAsync` e le query sui prodotti erano stub (`E_NOTIMPL`). `xgameruntime-xstore-queries.patch` le fa rispondere con risultati vuoti ma validi, e facoltativamente con voci di catalogo non possedute. Per Forza Horizon 6 abbiamo dimostrato che **lo Store non è il blocco**: dopo *Start game* ogni operazione asincrona GDK si completa (licenza, login, XSTS, PlayFab 200), poi il gioco gira a circa il 250% di CPU senza fare altre chiamate GDK. È lo stesso comportamento segnalato su Linux. Collegare `winedbg` chiude FH6 (anti-debug, uscita 232): non provateci.

### 8. Video di Halo (filmati neri)
I problemi erano due, uno sopra l'altro. (a) `winegstreamer.so` di Highball richiede GLib 2.88 / GStreamer 1.28; le librerie di CrossOver sono troppo vecchie (manca `g_once_init_enter_pointer`), quindi il modulo non si caricava mai ("GStreamer doesn't support H.264"). MACxus scarica i framework runtime di Highball (dal template [Sikarugir](https://github.com/Sikarugir-App/Template)) e imposta `GST_PLUGIN_SYSTEM_PATH` / `GST_REGISTRY`. (b) Il percorso di output NV12 "D3D-aware" di Media Foundation in Wine produceva fotogrammi neri. Lo risolvono le patch 0004/0005/0007 di [Jfishin/winevideo](https://github.com/Jfishin/winevideo) (`assets/runtime-patches/highball-wine-mf-software-output.patch`). Le DLL ricompilate **non sono ancora distribuite**: la licenza va prima confermata dall'autore.

### 9. Limite hardware di M1: atomiche a 64 bit
D3DMetal su M1 (famiglia GPU Apple7) dichiara le atomiche a 64 bit sulle risorse tipizzate, ma Metal le rifiuta: Halo crea circa 620 pipeline che falliscono. Se si nasconde la capacità, Halo non parte proprio ("GPU non supportata", perché Nanite la richiede). Spegnere Lumen, le virtual shadow map o il raster compute di Nanite non elimina i glitch. Impostazioni migliori su M1: upscaler nativo (niente FSR) e motion blur disattivato. M2 o successivi potrebbero comportarsi diversamente (non provato).

### 10. Controller
Di default Wine espone il DualSense come dispositivo HID grezzo, che i giochi XInput ignorano. La "DualSense compatibility mode" di Xodus Nexus imposta `PROTON_DISABLE_HIDRAW`, che esiste **solo in Proton**. Su macOS MACxus scrive invece `HKLM\System\CurrentControlSet\Services\winebus\DisableHidraw`, così SDL presenta il pad come gamepad XInput. Wine salva questa chiave sotto `ControlSet001`. La `gameinput.dll` Wine provata è uno stub (`GameInputCreate ... stub!`), ma il messaggio non dimostra che un gioco richieda esclusivamente GameInput. In Halo: Campaign Evolved, Steam Controller 2 ha fornito controlli gamepad diretti e indicazioni dei pulsanti ed è stato riconosciuto come Steam Controller con CrossOver Preview Rosetta 20261015/macOS 27.2, senza sostituzione di GameInput né modalità compatibilità DualSense. Una prova di base separata ha confermato controlli diretti/indicazioni dei pulsanti anche con Xbox Elite Series 2 via Bluetooth nelle stesse condizioni senza shim. L’API alternativa esatta non è stata identificata; i risultati non verificano altri controller, giochi, motori, vibrazione, palette Elite o funzioni avanzate.

### 11. Profili per gioco
`assets/mac-profiles.json` contiene impostazioni dichiarative per gioco (scelta del motore e variabili ammesse). Forza Horizon 6 usa Highball e si presenta a D3DMetal come una RTX 4070 (`D3DM_VENDOR_ID` / `D3DM_DEVICE_ID`). La ricetta viene da [highball-db](https://github.com/gauthierpiarrette/highball-db) (CC0).

### 12. SSD esterni
La maggior parte degli SSD esterni è in exFAT, che non ha link simbolici, e i giochi installati ne hanno bisogno. MACxus permette quindi di mettere i giochi direttamente su qualsiasi disco APFS/HFS+, mentre sui dischi exFAT/FAT/NTFS crea uno sparse bundle APFS (`MACxus.sparsebundle`) che cresce solo quanto serve. L'immagine viene ricollegata a ogni avvio (senza montarla due volte), lo spazio libero è controllato prima dei download e i giochi su un disco scollegato vengono segnati "Disco non collegato" invece di fallire.

### 13. Lezioni minori
- App Electron + backend compilato in locale: le richieste del Portachiavi tornano dopo ogni ricompilazione, a meno che il backend non sia firmato con un'identità stabile. MACxus può firmarlo con un certificato locale "MACxus Local Signing"; la firma Developer ID è in programma.
- Uno sparse bundle APFS poteva essere montato due volte: risolto controllando prima i montaggi esistenti.
- I frame di Rosetta non vengono simbolizzati da `sample` di macOS, quindi per studiare i blocchi servono le trace di Wine (`WINEDEBUG=+gdkc` per xgameruntime).
- Halo (UE5) **legge** Engine.ini in `Saved/Config/WinGDK`, ma il gioco sovrascrive `r.ScreenPercentage`.

### 14. AVX sotto Rosetta
Rosetta 2 sa eseguire codice AVX/AVX2, ma dichiara AVX nel `CPUID` solo se è impostata `ROSETTA_ADVERTISE_AVX`. Lo script `wine` di CrossOver la imposta a 1 di default; il wrapper Highball no. Per questo un gioco con controllo AVX (Gears of War: E-Day: "Your CPU must support AVX") partiva con CrossOver e si rifiutava di partire con Highball. Ora anche il wrapper Highball la imposta a 1 di default. Rosetta considera **qualsiasi** valore come "attivo", quindi `ROSETTA_ADVERTISE_AVX=0` toglie la variabile, come fa CrossOver.

### 15. Giochi che includono il proprio `xgameruntime.dll`
Alcuni pacchetti (Gears of War: E-Day) contengono il runtime GDK di Windows accanto all'eseguibile. Wine carica le DLL dalla cartella dell'eseguibile prima che da `system32`, quindi il gioco usava il runtime Microsoft invece di quello Nexus del prefix. Quel runtime richiede i Gaming Services di Windows, perciò `XGameRuntimeInitialize` falliva. XCurl non riusciva a creare la sua coda di task e Unreal si fermava con `Could not initialize libcurl (result=2)`. Indizio: la trace `+gdkc` restava vuota, cioè il runtime Nexus non veniva mai caricato. Correzione in `assets/xodus-macos-launch.patch`: la vista di avvio su RAM disk esclude ogni `xgameruntime.dll`, così Wine usa la copia del prefix. Il pacchetto installato non viene toccato. Il backend va ricompilato (Impostazioni → Compila il backend).

### 16. Giochi che richiedono il ray tracing
Gears of War: E-Day richiede una GPU con DirectX Raytracing e non ha un'alternativa raster. Su M1 il gioco si ferma con il messaggio "ray tracing richiesto". Per quanto ne sappiamo, D3DMetal espone DXR solo sulle GPU Apple con ray tracing hardware (M3 e successivi); non è stato misurato con un probe. Simulare il supporto sposterebbe solo il crash dentro le chiamate DXR. Per questi giochi serve un M3 o successivo.

### 17. Easy Anti-Cheat e gioco offline
Sotto Wine il bootstrapper di EAC scarica il proprio modulo **Linux** (una libreria ELF) e lo carica tramite la parte Unix di Wine, come fa Proton. macOS non può caricare gli ELF, quindi l'avvio termina con "Failed to map the anti-cheat module" (Xodus esce con 206; il log è nel prefix in `AppData/Roaming/EasyAntiCheat/.../anticheatlauncher.log`). EAC non ha una variante "Wine su macOS". Per i giochi la cui campagna funziona anche offline, l'opzione per gioco **Play offline without anti-cheat** (visibile solo per i giochi EAC, disattivata di default) avvia direttamente l'eseguibile indicato in `EasyAntiCheat/Settings.json`, con la variabile dell'SDK EOS `EOS_USE_ANTICHEATCLIENTNULL=1`. EOS sa quindi che manca il client anti-cheat e rifiuta le funzioni online protette. Non tentare di giocare online in questa modalità: il gioco accede comunque ai servizi Xbox e le conseguenze per l'account sono responsabilità tua.

---

## Credits / Ringraziamenti

MACxus exists because of these people and projects. Thank you.
MACxus esiste grazie a queste persone e progetti. Grazie.

**Projects / Progetti**
- [Xodus](https://github.com/xodus-gaming/xodus) and / e [xgameruntime](https://github.com/xodus-gaming/xgameruntime) — the Xodus team: Xbox account, licensing, packages and the GDK runtime for Wine / account Xbox, licenze, pacchetti e runtime GDK per Wine.
- [Xodus Nexus](https://github.com/domsvoboda/xodus-nexus) — domsvoboda and contributors: the launcher, backend patches and runtime MACxus is forked from / il launcher, le patch del backend e il runtime da cui MACxus deriva.
- [Highball engine](https://github.com/gauthierpiarrette/highball-engine) and / e [highball-db](https://github.com/gauthierpiarrette/highball-db) — gauthierpiarrette: the Wine engine and the per-game recipes / il motore Wine e le ricette per gioco.
- [winevideo](https://github.com/Jfishin/winevideo) — Jfishin: the Media Foundation patches that fixed Halo's cutscenes / le patch Media Foundation che hanno sistemato i filmati di Halo.
- [Sikarugir](https://github.com/Sikarugir-App/Template) — the runtime frameworks (GLib/GStreamer) Highball needs on macOS / i framework runtime (GLib/GStreamer) che servono a Highball su macOS.
- [NotProton](https://github.com/NotProtonNot/NotProton) — reference while studying the launch chain / riferimento per studiare la catena di avvio.
- [Wine](https://www.winehq.org), [CodeWeavers CrossOver](https://www.codeweavers.com/crossover), Apple D3DMetal (Game Porting Toolkit), [SDL](https://www.libsdl.org).

**Reports that guided the work / Segnalazioni che hanno guidato il lavoro** (Xodus Nexus issue tracker)
- [#13 Forza Horizon 6 Outdated Game Service](https://github.com/domsvoboda/xodus-nexus/issues/13) — Valocity373
- [#228 Forza Horizon 6 E:0-17-4 error](https://github.com/domsvoboda/xodus-nexus/issues/228) — KazamaCh
- [#236 Forza Horizon 6 crash at forzahorizon6+0xe3813f](https://github.com/domsvoboda/xodus-nexus/issues/236) — mehtaman
- [#259 Forza Horizon 5](https://github.com/domsvoboda/xodus-nexus/issues/259) — aldao1981
- [#272 Forza Horizon 6 Standard Edition won't load](https://github.com/domsvoboda/xodus-nexus/issues/272) — psestebanisla-maker
- [#64 DualSense support](https://github.com/domsvoboda/xodus-nexus/issues/64) — slobeksila (the DualSense workaround / il workaround per il DualSense)
- [#302 SDL for DualShock 4](https://github.com/domsvoboda/xodus-nexus/issues/302) — francieslima
