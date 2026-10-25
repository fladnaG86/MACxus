<div align="center">

<img src="assets/icon.png" width="96" alt="MACxus" />

# MACxus

Your Microsoft Store / PC Game Pass games, on Apple Silicon Macs.<br>
I tuoi giochi PC del Microsoft Store / PC Game Pass, sui Mac Apple Silicon.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**[English](#english)** · **[Italiano](#italiano)** · [Discoveries / Scoperte](docs/DISCOVERIES.md)

<img src="docs/screenshots/macxus-home.png" width="49%" alt="MACxus Home on macOS" /> <img src="docs/screenshots/macxus-library.png" width="49%" alt="MACxus My Library on macOS" />

*MACxus running on a MacBook Pro M1 Max / MACxus su un MacBook Pro M1 Max.*

</div>

> [!CAUTION]
> MACxus is an independent, unofficial macOS port of [Xodus Nexus](https://github.com/domsvoboda/xodus-nexus), which is built on [Xodus](https://github.com/xodus-gaming/xodus). It is **not** made by the Xodus or Xodus Nexus developers, and it is not affiliated with Microsoft, Xbox, Apple or CodeWeavers. Report MACxus problems **only** [here](https://github.com/fladnaG86/MACxus/issues).
>
> MACxus è un port macOS indipendente e non ufficiale di [Xodus Nexus](https://github.com/domsvoboda/xodus-nexus), basato su [Xodus](https://github.com/xodus-gaming/xodus). **Non** è fatto dagli sviluppatori di Xodus o Xodus Nexus e non è affiliato a Microsoft, Xbox, Apple o CodeWeavers. Segnala i problemi di MACxus **solo** [qui](https://github.com/fladnaG86/MACxus/issues).

---

## English

MACxus signs in with your Microsoft account, shows your library (owned and Game Pass games), downloads games and launches them with Wine on macOS, with Xbox sign-in and cloud saves for supported titles. No game files are included: you need a valid purchase or subscription.

### Status: beta

Tested on one machine only (MacBook Pro M1 Max, macOS 27.2, CrossOver 26.3). Expect rough edges.

| Game | Engine | Status |
| --- | --- | --- |
| TUNIC | CrossOver | ✅ Playable, sign-in and cloud saves OK. |
| Deep Rock Galactic | Highball | ✅ Playable (D3D12 through D3DMetal), sign-in OK. |
| Minecraft Dungeons II | Highball | ✅ Playable, online services OK. |
| Halo: Campaign Evolved | Highball | ⚠️ Playable with graphics glitches on M1 (hardware limit, see Discoveries). Cutscenes need an extra video patch not yet shipped. |
| Forza Horizon 6 | Highball (automatic profile) | ❌ Reaches the main menu, hangs after *Start game* (the same unresolved hang exists on Linux). |
| Call of Duty | — | ❌ Kernel anti-cheat, will not work. |

### Requirements

- Apple Silicon Mac with **Rosetta 2** (`softwareupdate --install-rosetta --agree-to-license`).
- **[CrossOver](https://www.codeweavers.com/crossover) 26.x** in `/Applications`: it provides D3DMetal and libraries used by both engines (paid software with a free trial).
- Packaged Apple Silicon builds include the backend. Git, Rust and protoc are needed only for developer builds, not for users.
- A Microsoft account that owns the game or has PC Game Pass.

### Install

These steps apply to bundled builds. The original `0.3.11-mac.1` beta required a local backend build; use a bundled release when available.

**New to Mac or to Terminal?** Follow the step-by-step [Getting started guide](docs/GETTING-STARTED.md#english): every command is ready to copy and paste.

1. Download `MACxus-…-arm64.dmg` from [Releases](https://github.com/fladnaG86/MACxus/releases) and drag MACxus to Applications.
2. The beta is **not signed**: try opening it once, then use **System Settings → Privacy & Security → Open Anyway**, or run `xattr -dr com.apple.quarantine /Applications/MACxus.app`.
3. The included **Xodus backend** is ready automatically; no compilation or extra build tools are needed.
4. **Settings → Nexus runtime**: install the runtime. MACxus picks the release its patched DLLs were built for.
5. **Settings → Wine engine → Install Highball engine** (recommended for D3D12 / Unreal games); otherwise CrossOver is used.
6. Sign in, install a game, press **Play**. If macOS asks for Keychain access, choose **Always Allow**.

### Games on an external SSD

Short on internal disk space? Games can live on an external drive. In **Settings → Game storage** (also offered when you install a game) MACxus lists your disks with their free space:

- **APFS or Mac OS Extended (HFS+) drive**: press **Choose folder** and pick a folder.
- **exFAT / FAT / NTFS drive** (most SSDs come formatted this way): these cannot hold the symbolic links games need, so press **Create APFS image**, choose a size in GB, and MACxus creates `MACxus.sparsebundle` on that drive. The image only takes the space actually used (up to the size you chose) and the drive keeps working with Windows/other devices.

MACxus re-mounts the image every time it starts and checks the free space before each download. If the drive is unplugged, its games show **Drive disconnected** until you reconnect it. The Wine bottles and the launcher data stay on the internal disk (a few GB).

For bug reports enable **Settings → Game logging** and attach `~/Library/Application Support/MACxus/logs/<id>-latest.log` (review it first).

### Controllers

- **DualSense / DualShock**: open the game's settings and enable **DualSense compatibility mode**. The pad is then presented as an Xbox (XInput) controller; haptics and adaptive triggers are not available in this mode.
- Games that read input through **GameInput** (for example Halo: Campaign Evolved) do not see any controller yet: Wine's GameInput is still a stub.

### What is different from Xodus Nexus

Everything macOS-specific is documented in [docs/DISCOVERIES.md](docs/DISCOVERIES.md): RAM-disk launch overlay instead of `WINE_DLL_FILE_MAP`, loopback bridge to the account service, Highball engine support, the `%gs:0x68` last-error fix, patched runtime DLLs shipped in the app (`assets/mac-runtime-dlls`, patches in `assets/runtime-patches`), DualSense handling and per-game profiles.

---

## Italiano

MACxus accede con il tuo account Microsoft, mostra la libreria (giochi acquistati e Game Pass), scarica i giochi e li avvia con Wine su macOS, con login Xbox e salvataggi cloud per i titoli supportati. Nessun file di gioco è incluso: serve un acquisto o un abbonamento valido.

### Stato: beta

Provato su una sola macchina (MacBook Pro M1 Max, macOS 27.2, CrossOver 26.3). Aspettati qualche spigolo.

| Gioco | Motore | Stato |
| --- | --- | --- |
| TUNIC | CrossOver | ✅ Giocabile, login e salvataggi cloud OK. |
| Deep Rock Galactic | Highball | ✅ Giocabile (D3D12 tramite D3DMetal), login OK. |
| Minecraft Dungeons II | Highball | ✅ Giocabile, servizi online OK. |
| Halo: Campaign Evolved | Highball | ⚠️ Giocabile con glitch grafici su M1 (limite hardware, vedi Scoperte). I filmati richiedono una patch video non ancora distribuita. |
| Forza Horizon 6 | Highball (profilo automatico) | ❌ Arriva al menu, si blocca dopo *Start game* (lo stesso blocco irrisolto c'è anche su Linux). |
| Call of Duty | — | ❌ Anti-cheat a livello kernel, non funzionerà. |

### Requisiti

- Mac Apple Silicon con **Rosetta 2** (`softwareupdate --install-rosetta --agree-to-license`).
- **[CrossOver](https://www.codeweavers.com/crossover) 26.x** in Applicazioni: fornisce D3DMetal e librerie usate da entrambi i motori (a pagamento, con prova gratuita).
- Il backend è incluso nelle build Apple Silicon. Git, Rust e protoc servono solo per le build di sviluppo, non agli utenti.
- Un account Microsoft che possiede il gioco o ha PC Game Pass.

### Installazione

Questi passi valgono per le build con backend incluso. La beta originale `0.3.11-mac.1` richiedeva la compilazione locale: usa una release con backend incluso quando disponibile.

**Nuovo sul Mac o sul Terminale?** Segui la [guida passo per passo](docs/GETTING-STARTED.md#italiano): ogni comando è pronto da copiare e incollare.

1. Scarica `MACxus-…-arm64.dmg` da [Releases](https://github.com/fladnaG86/MACxus/releases) e trascina MACxus in Applicazioni.
2. La beta **non è firmata**: prova ad aprirla una volta, poi usa **Impostazioni di Sistema → Privacy e sicurezza → Apri comunque**, oppure `xattr -dr com.apple.quarantine /Applications/MACxus.app`.
3. Il **backend Xodus** incluso è pronto automaticamente: non servono compilazione o strumenti di sviluppo.
4. **Impostazioni → Runtime Nexus**: installa il runtime. MACxus sceglie la versione per cui sono state compilate le sue DLL patchate.
5. **Impostazioni → Motore Wine → Installa motore Highball** (consigliato per giochi D3D12 / Unreal); altrimenti si usa CrossOver.
6. Accedi, installa un gioco, premi **Play**. Se macOS chiede l'accesso al Portachiavi, scegli **Consenti sempre**.

### Giochi su SSD esterno

Poco spazio sul disco interno? I giochi possono stare su un disco esterno. In **Impostazioni → Dove salvare i giochi** (proposto anche quando installi un gioco) MACxus elenca i tuoi dischi con lo spazio libero:

- **Disco APFS o Mac OS esteso (HFS+)**: premi **Scegli cartella** e scegli una cartella.
- **Disco exFAT / FAT / NTFS** (la maggior parte degli SSD arriva formattata così): non supporta i link simbolici che servono ai giochi, quindi premi **Crea immagine APFS**, scegli una dimensione in GB e MACxus crea `MACxus.sparsebundle` su quel disco. L'immagine occupa solo lo spazio usato davvero (fino alla dimensione scelta) e il disco continua a funzionare con Windows e altri dispositivi.

MACxus rimonta l'immagine a ogni avvio e controlla lo spazio libero prima di ogni download. Se il disco è scollegato, i suoi giochi mostrano **Disco non collegato** finché non lo ricolleghi. Le bottle Wine e i dati del launcher restano sul disco interno (qualche GB).

Per segnalare un bug attiva **Impostazioni → Registrazione dei giochi** e allega `~/Library/Application Support/MACxus/logs/<id>-latest.log` (rileggilo prima).

### Controller

- **DualSense / DualShock**: apri le impostazioni del gioco e attiva **DualSense compatibility mode**. Il pad viene presentato come controller Xbox (XInput); in questa modalità non ci sono vibrazione avanzata e trigger adattivi.
- I giochi che leggono l'input tramite **GameInput** (per esempio Halo: Campaign Evolved) per ora non vedono nessun controller: GameInput in Wine è ancora uno stub.

### Cosa cambia rispetto a Xodus Nexus

Tutto ciò che è specifico per macOS è descritto in [docs/DISCOVERIES.md](docs/DISCOVERIES.md): overlay di avvio su RAM disk al posto di `WINE_DLL_FILE_MAP`, bridge loopback verso il servizio account, supporto al motore Highball, la correzione del last-error `%gs:0x68`, le DLL runtime patchate incluse nell'app (`assets/mac-runtime-dlls`, patch in `assets/runtime-patches`), la gestione del DualSense e i profili per gioco.

---

## Credits / Ringraziamenti

See / Vedi [docs/DISCOVERIES.md](docs/DISCOVERIES.md#credits--ringraziamenti) and / e [docs/THIRD_PARTY.md](docs/THIRD_PARTY.md). The original Xodus Nexus README / Il README originale di Xodus Nexus: [docs/README-xodus-nexus.md](docs/README-xodus-nexus.md).

MIT License — © Xodus Nexus contributors and MACxus contributors. The bundled Wine DLLs are LGPL-2.1-or-later (see [assets/mac-runtime-dlls/README.md](assets/mac-runtime-dlls/README.md)).
