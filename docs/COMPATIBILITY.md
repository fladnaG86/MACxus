# Game compatibility / Compatibilità dei giochi

**[English](#english)** · **[Italiano](#italiano)**

Results from real tests. A game that works on one Mac may behave differently on another chip or engine. Tried a game? [Send a game report](https://github.com/fladnaG86/MACxus/issues/new?template=02-game-report.yml).

Risultati di prove reali. Un gioco che funziona su un Mac può comportarsi diversamente con un altro chip o motore. Hai provato un gioco? [Invia un resoconto](https://github.com/fladnaG86/MACxus/issues/new?template=02-game-report.yml).

---

## English

✅ Works · ⚠️ Works with issues · ❌ Doesn't work

| Game | Status | Engine | Tested on | Notes |
| --- | --- | --- | --- | --- |
| 007 First Light (Microsoft Store) | ⚠️ offline | CrossOver Preview (Rosetta) 20261015 | M5 Max · macOS 27.2 · 0.3.11-review.async-lifetime.1 | Requires CrossOver Preview **Rosetta** and a rebuilt runtime with the XAsync completion-lifetime fix (not yet in a published release). Tested with D3DMetal 4.0b3; the user confirmed gameplay. The menu reports offline; the cause is unresolved. Preview ARM/FEX still fails to launch the game. |
| Deep Rock Galactic | ✅ | CrossOver, Highball | M1 Max · 0.3.11-mac.1 | DirectX 12 through D3DMetal. |
| Mad King Redemption | ✅ | Highball | M1 Max · 0.3.11-mac.2 | |
| MARVEL Cosmic Invasion | ✅ | Highball | M1 Max · 0.3.11-mac.2 | |
| Minecraft Dungeons II | ✅ | Highball | M1 Max · 0.3.11-mac.1 | Needs Highball. |
| Nine Sols | ✅ | CrossOver | M4 Pro · 0.3.11-mac.5 | Community report ([#9](https://github.com/fladnaG86/MACxus/issues/9)). Tested with an Xbox controller. |
| Super Meat Boy 3D | ✅ | Highball | M1 Max · 0.3.11-mac.3 | |
| TUNIC | ✅ | CrossOver | M1 Max · 0.3.11-mac.1 | Tested with keyboard. |
| Vampire Survivors | ✅ | Highball | M1 Max · 0.3.11-mac.4 | |
| Warhammer 40,000: Space Marine 2 | ✅ offline | Highball | M1 Max · 0.3.11-mac.5 | Easy Anti-Cheat: enable *Play offline without anti-cheat* in the game's settings; online multiplayer is not available. Tested with a DualSense (*DualSense compatibility mode* on). |
| Halo: Campaign Evolved | ⚠️ | Highball | M1 Max · 0.3.11-mac.1 | Playable. Graphics glitches on M1 (hardware limit: 64-bit atomics); M2 or newer untested. Cutscenes need a video patch that is not shipped yet. Controller support was reported unavailable in the original Highball test; see the separate Preview controller results below. Best on M1: upscaler Native, motion blur off. |
| Halo: Campaign Evolved | ⚠️ movies (experimental) | CrossOver Preview Rosetta 20261015 | Isolated source-only test | Direct gamepad controls/button prompts confirmed with Steam Controller 2 and Xbox Elite Series 2 (Bluetooth), without a GameInput replacement or DualSense compatibility mode (macOS 27.2). Steam Controller identity preserved; rumble, Elite paddles and advanced features unverified. Startup movies have picture and audio with the [experimental media patch](HALO-PREVIEW-MEDIA.md). Automatic-pack startup movies confirmed with picture/audio; smoother with minimal logging. Later cinematics unverified. Builds with the Halo compatibility pack prepare a private patched engine and bottle automatically. |
| Forza Horizon 6 | ❌ | Highball | M1 Max · 0.3.11-mac.1 | Reaches the main menu, then hangs after *Start game*. Same problem on Linux. |
| Gears of War: E-Day | ❌ on M1 | Highball | M1 Max · 0.3.11-mac.2 | Requires hardware ray tracing, so it needs an M3 or newer (untested there). Easy Anti-Cheat: use *Play offline without anti-cheat* in the game's settings for the offline campaign only. |
| Call of Duty | ❌ | — | — | Kernel anti-cheat (Ricochet) cannot run on macOS. |

**General limits**
- Games with **kernel anti-cheat** don't work. Games with **Easy Anti-Cheat** can only run offline, with the option above.
- Games that **require ray tracing** need an M3 or newer.
- **Controllers:** Xbox controllers and DualSense work in XInput games (enable *DualSense compatibility mode* for a DualSense). GameInput stub errors alone do not establish controller incompatibility; Halo works with Steam Controller 2 and Xbox Elite Series 2 (Bluetooth) on the tested Preview build without a GameInput replacement.

---

## Italiano

✅ Funziona · ⚠️ Funziona con problemi · ❌ Non funziona

| Gioco | Stato | Motore | Provato su | Note |
| --- | --- | --- | --- | --- |
| 007 First Light (Microsoft Store) | ⚠️ offline | CrossOver Preview (Rosetta) 20261015 | M5 Max · macOS 27.2 · 0.3.11-review.async-lifetime.1 | Richiede CrossOver Preview **Rosetta** e un runtime ricompilato con la correzione della durata dei dati durante il callback di completamento XAsync (non ancora inclusa in una versione pubblicata). Provato con D3DMetal 4.0b3; l’utente ha confermato che il gioco funziona. Il menu indica offline; la causa non è ancora nota. Il gioco non si avvia ancora con Preview ARM/FEX. |
| Deep Rock Galactic | ✅ | CrossOver, Highball | M1 Max · 0.3.11-mac.1 | DirectX 12 tramite D3DMetal. |
| Mad King Redemption | ✅ | Highball | M1 Max · 0.3.11-mac.2 | |
| MARVEL Cosmic Invasion | ✅ | Highball | M1 Max · 0.3.11-mac.2 | |
| Minecraft Dungeons II | ✅ | Highball | M1 Max · 0.3.11-mac.1 | Richiede Highball. |
| Nine Sols | ✅ | CrossOver | M4 Pro · 0.3.11-mac.5 | Resoconto della community ([#9](https://github.com/fladnaG86/MACxus/issues/9)). Provato con un controller Xbox. |
| Super Meat Boy 3D | ✅ | Highball | M1 Max · 0.3.11-mac.3 | |
| TUNIC | ✅ | CrossOver | M1 Max · 0.3.11-mac.1 | Provato con la tastiera. |
| Vampire Survivors | ✅ | Highball | M1 Max · 0.3.11-mac.4 | |
| Warhammer 40,000: Space Marine 2 | ✅ offline | Highball | M1 Max · 0.3.11-mac.5 | Easy Anti-Cheat: attiva *Gioca offline senza anti-cheat* nelle impostazioni del gioco; il multiplayer online non è disponibile. Provato con un DualSense (*Modalità compatibilità DualSense* attiva). |
| Halo: Campaign Evolved | ⚠️ | Highball | M1 Max · 0.3.11-mac.1 | Giocabile. Glitch grafici su M1 (limite hardware: atomiche a 64 bit); M2 o successivi non provati. I filmati richiedono una patch video non ancora distribuita. Supporto controller segnalato come non disponibile nella prova originale con Highball; vedi sotto i risultati separati dei controller con Preview. Su M1: upscaler Nativo, motion blur disattivato. |
| Halo: Campaign Evolved | ⚠️ filmati (sperimentale) | CrossOver Preview Rosetta 20261015 | Prova isolata, solo sorgenti | Controlli gamepad diretti/indicazioni dei pulsanti confermati con Steam Controller 2 e Xbox Elite Series 2 (Bluetooth), senza sostituzione di GameInput né modalità compatibilità DualSense (macOS 27.2). Identità Steam Controller mantenuta; vibrazione, palette Elite e funzioni avanzate non verificate. I filmati iniziali hanno immagini e audio con la [patch multimediale sperimentale](HALO-PREVIEW-MEDIA.md). Filmati iniziali confermati con immagini/audio tramite pacchetto automatico; più fluidi con diagnostica minima. Filmati successivi non verificati. Le build con il pacchetto di compatibilità Halo preparano automaticamente un motore modificato e una bottle dedicati. |
| Forza Horizon 6 | ❌ | Highball | M1 Max · 0.3.11-mac.1 | Arriva al menu principale, poi si blocca dopo *Start game*. Stesso problema su Linux. |
| Gears of War: E-Day | ❌ su M1 | Highball | M1 Max · 0.3.11-mac.2 | Richiede il ray tracing hardware, quindi serve un M3 o successivo (lì non provato). Easy Anti-Cheat: usa *Gioca offline senza anti-cheat* nelle impostazioni del gioco, solo per la campagna offline. |
| Call of Duty | ❌ | — | — | L'anti-cheat a livello kernel (Ricochet) non può funzionare su macOS. |

**Limiti generali**
- I giochi con **anti-cheat a livello kernel** non funzionano. Quelli con **Easy Anti-Cheat** funzionano solo offline, con l'opzione indicata sopra.
- I giochi che **richiedono il ray tracing** hanno bisogno di un M3 o successivo.
- **Controller:** i controller Xbox e il DualSense funzionano nei giochi XInput (per il DualSense attiva *Modalità compatibilità DualSense*). Un errore stub GameInput da solo non dimostra incompatibilità del controller: Halo funziona con Steam Controller 2 e Xbox Elite Series 2 (Bluetooth) nella build Preview provata senza sostituire GameInput.
