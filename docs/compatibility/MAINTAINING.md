# Maintaining compatibility reports / Gestire i resoconti

`reports.json` is the source of truth. `docs/COMPATIBILITY.md`, `games/*.md` and
`layers/*.md` are generated views. Edit a record, then run:

```sh
npm run compatibility:generate
npm run compatibility:check
```

The check also runs in source CI. GitHub renders all views as Markdown: an A–Z
index, tables by compatibility layer and a detail page per game. Use the file
outline, letter links and browser Find to navigate. The compact index has one
row per game; test details grow on game pages rather than in the index.

## One record is one configuration

A game groups configuration reports; it does not have a universal compatibility
score. Use a stable game slug and preserve report IDs when editing. Separate
layer editions, architecture, macOS/chip combinations and game builds into their
own reports. A report may contain multiple controller observations **only when
the game/environment/settings are the same**; each controller keeps its own
connection, test scope and result.

Record these fields separately:

| Section | Fields |
| --- | --- |
| Identity | Exact title, store/source, Store product ID, game build |
| Result | Reported result and actual test scope |
| Compatibility layer | Highball, CrossOver, Preview Rosetta or Preview ARM64/FEX; exact version/build and architecture |
| Mac | Exact chip, model, macOS version |
| Software | MACxus and Xodus runtime builds |
| Graphics | D3DMetal, DXMT, DXVK or WineD3D and version when known |
| Features | Launch, gameplay, video, audio and online results |
| Controllers | Model, connection, direct gamepad versus emulation, basic controls versus advanced features |
| Requirements | Per-game settings, patches/packs, offline/anti-cheat limitations |
| Evidence | Test date and maintainer/community/historical source links |

Use JSON `null` for unreported environmental values and `unknown` for unreported
feature results. Use `untested` only when the source explicitly says it was not
tested. Do not copy a macOS version, controller connection or build from another
record merely because the game title matches. A newer chip being required is
not evidence that it passed. A source/issue date is not automatically the test
date. Keep evidence links; do not commit raw logs, account IDs or game files.

## Results and coverage

- `works`: reported working. New reports should describe actual gameplay; older
  green reports may have unknown scope. Does not imply every feature was tested.
- `issues`: runs with reported limitations, such as offline-only play.
- `partial`: a limited experiment, such as startup movies or menu/controller
  input, which does not establish general gameplay compatibility.
- `fails`: the attempted scope fails, crashes or hangs.
- `blocked`: a known requirement prevents the attempted scope.

The separate `checks` object records what is known about individual features;
`unknown` is never rendered as a pass. Older green rows stay reported green but
retain unknown details and `not-reported` scope when coverage was not recorded.
Do not infer gameplay coverage from a green icon alone. Contradictory reports
should coexist with their own configuration, date and source; do not replace an old failure with an unrelated
new success. Use separate records to compare Highball against Preview or M1
against M5. Layer and per-game comparison tables keep each configuration on its
own row; never combine one report’s chip with another report’s layer.

## Adding or retesting a game

1. Collect the updated bilingual game-report issue form. Ask for missing required
   context rather than filling it from an unrelated report.
2. Find the game by exact Store ID/source, then title. Edition/store variants with
   different executables or content should have their own game identity.
3. Add a report using the fields of a nearby record. Keep English and Italian
   summaries/requirements aligned. New layers/results require a model/form update.
4. Link the supporting issue/PR and distinguish maintainer, community and migrated
   historical evidence. Retain partial/unknown fields exactly as the evidence permits.
5. Generate and review the game page, compact index and layer tables together. Run
   `npm run test:compatibility` and `npm run compatibility:check`; review the diff for accidental
   upgrades of limited tests to general support.

The initial migration preserves 14 games / 17 reports, including the separate
Bond ARM failure, both Deep Rock Galactic layers, the original Halo Highball
report and the later Preview movie/controller experiment. Nine Sols' source issue
provided CrossOver 26.3 but no macOS version; that version remains unknown.

## Italiano

`reports.json` è la fonte unica; indice Markdown, schede `games/*.md` e tabelle
`layers/*.md` sono generati. Un resoconto riguarda una sola configurazione di motore,
architettura, chip, macOS e build del gioco. Conserva ID e fonti delle prove;
non sostituire una vecchia prova negativa con un risultato positivo su un altro
ambiente. I controller hanno osservazioni separate per modello/connessione.

Usa `null` per dati ambientali non riportati, `unknown` per risultati non
riportati e `untested` solo per funzioni esplicitamente non provate. Non dedurre
la connessione del controller, la versione macOS o il supporto di un chip da
altri resoconti. Le prove limitate (`partial`) di filmati/menu/input non verificano
il gioco completo. La data di un’issue non è automaticamente la data della prova.

Aggiorna entrambe le lingue, esegui i comandi sopra e controlla indice, schede e
tabelle per motore. Non modificare a mano le viste generate. Non pubblicare log grezzi,
identificativi account o file dei giochi. GitHub visualizza tutte le pagine Markdown;
usa lettere, struttura del file e Trova nel browser per navigare.
