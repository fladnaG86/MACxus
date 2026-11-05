# FH5 Preview hardware eligibility

The FH5 Store pack allows **Apple M3 and newer on macOS 26 or newer**, using the
fingerprinted CrossOver Preview Rosetta `20261015` / `cxpreview-20261015-rc1`.
**Only M5 Max has been game-tested. All other models are experimental and untested;
startup, rendering and GPU timing may fail.** The warning appears beside the
opt-in setting before it is enabled, and launches on other models log it again.
The separate engine/bottle, exact engine checks and normal rollback remain in use.

M3/M4 are reasonable candidates based on Apple's API documentation. This is an
engineering expectation, not measured game compatibility or a performance promise.
The [game reports](compatibility/games/forza-horizon-5.md) retain only the hardware
and test scopes actually observed. Allowing a chip does not create a passing report.

## Basis for the experimental scope

Apple's [Metal feature tables](https://developer.apple.com/metal/Metal-Feature-Set-Tables.pdf)
(October 23, 2026 edition, pages 2 and 5; consulted November 5, 2026) map M3/M4 to
Apple9 and M5 to Apple10. Their relevant minimum hardware families are:

| Pack dependency | Apple's documented availability | Consequence |
| --- | --- | --- |
| Metal 4 command allocators, decoupled queues/buffers, argument tables and barriers | Apple7 or newer | These APIs do not establish an M5-only requirement. |
| Metal 4 performance-counter heaps | Apple7 or newer | The timestamp bridge's counter-heap API is available below M3/M4's Apple9 family. Correct results in Preview still need a real test. |
| Residency sets | Apple6 or newer | The pack's probes do not require an M5-specific residency-set API. |
| GPU timestamp frequency and counter-heap methods | macOS 26.0 API minimum | Keep the macOS 26 gate; chip generation alone is insufficient. |

Apple also states that [Metal 4 supports Apple silicon Macs from M1 onward](https://developer.apple.com/metal/).
The [M3 announcement](https://www.apple.com/newsroom/2023/10/apple-unveils-m3-m3-pro-and-m3-max-the-most-advanced-chips-for-a-personal-computer/)
confirms the introduction of hardware-accelerated ray tracing and mesh shading on
Mac. That supports M3 as a conservative experimental floor for this game/renderer
combination; ray tracing itself is not what implements our timestamp bridge.
M1/M2 are left outside this change, despite their Metal 4 API availability.

The timestamp bridge uses Apple's
[command buffers](https://developer.apple.com/documentation/metal/mtldevice/makecommandbuffer()),
[counter heaps](https://developer.apple.com/documentation/metal/mtldevice/makecounterheap(descriptor:)),
[entry-size queries](https://developer.apple.com/documentation/metal/mtldevice/size(ofcounterheapentry:))
and [timestamp-frequency query](https://developer.apple.com/documentation/metal/mtldevice/querytimestampfrequency()).
It reads the actual device frequency instead of hard-coding the M5 Max's observed
24 MHz. Calibration checks matching frequency and CPU/GPU clock brackets. The
bridge requires a usable timestamp heap, eight-byte resolved entries and a nonzero
frequency at runtime; unavailable or invalid results remain failures. No timing
values, driver capabilities or GPU support flags are invented by this change.

## What remains unknown

We have no M3/M4 hardware results. Apple's API availability does not prove that
this pinned Preview build, FH5's shaders, counter ordering, resource limits or
DLSS paths work on those GPUs. M5 is Apple10 while M3/M4 are Apple9, so renderer
feature differences still matter. GPU core count, memory capacity/bandwidth and
cooling also vary. There is no minimum-memory or FPS claim from the M5 Max test.
Later M-series models passing the model gate are equally untested unless their
own configuration report says otherwise.

Before expanding a tested claim, run the account-free counter/state/order/lifetime
and native calibration probes described in the [pack README](../assets/fh5-preview/README.md),
then test normal Play, driving/benchmark, timing display and intended online/graphics
features. Record the exact chip, macOS, game build and Preview version, keeping
raw account logs and credentials out of reports. A plausible latency display alone
is not independently measured input-to-display latency. Existing black-road and
marketplace limitations remain; no game restart or new hardware test was performed
to enable this experimental option.

## Italiano

Il pack FH5 Store consente **Apple M3 o successivo con macOS 26 o successivo**,
con la build Preview Rosetta esatta indicata sopra. **Solo M5 Max è stato provato
nel gioco. Gli altri modelli sono sperimentali e non provati: avvio, rendering e
temporizzazione GPU potrebbero non funzionare.** L'avviso compare accanto
all'opzione prima dell'attivazione e nel log di avvio sugli altri modelli.

Le tabelle Apple assegnano M3/M4 alla famiglia Apple9; command buffer, barriere,
argument table e counter heap Metal 4 sono disponibili da Apple7. Le API temporali
richiedono macOS 26. M3 ha introdotto ray tracing hardware e mesh shading sui Mac,
ma questi dati non verificano il gioco né il comportamento del renderer Preview.
M1/M2 restano esclusi da questa estensione. Restano i controlli del motore,
dei contatori e della calibrazione, il bottle separato e il ripristino normale.

Non sono disponibili prove su M3/M4 né promesse su prestazioni o memoria minima.
I resoconti di compatibilità conservano le configurazioni effettivamente provate;
abilitare un modello non equivale a dichiararlo funzionante. Servono le sonde
native e una prova del gioco su ciascuna configurazione prima di estendere le
conferme. Restano i limiti noti delle strade nere e del marketplace.
