# Maintaining compatibility reports / Gestire i resoconti

`reports.json` is the source of truth. `docs/COMPATIBILITY.md` and `games/*.md`
are generated views. Edit a record, then run:

```sh
npm run compatibility:generate
npm run compatibility:check
```

The check also runs in source CI. GitHub renders all views as Markdown: an A–Z
matrix with a column per compatibility layer and a detail page per game. Each
language uses one continuous table in alphabetical order; use browser Find to
locate a title. The compact index has one row per game; test details grow on
game pages rather than in the index.

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
- `works-offline`: working offline play, shown with a green check. Keep the
  online limitation in `checks.online` and explain it in the summary; do not
  infer its cause. Offline-only play alone does not make the game a warning.
- `issues`: runs with other reported problems, such as graphics or audio issues.
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
against M5. The main matrix keeps every layer’s results on the same game row,
so a failure cannot hide a working alternative. It shows all reported outcomes
within a layer, including conflicting results. Counts in parentheses group
reports with the same outcome; links open either that report or the game’s
configuration comparison. A dash means no report for that layer, never failure.
Reports with an unknown layer stay in a separate column and are never assigned
to one of the known layers.

The per-game comparison keeps each configuration on its own row; never combine
one report’s chip with another report’s layer. macOS and chip belong to these
individual configurations, so the main matrix does not present them as a
universal environment for the entire game.

## Adding or retesting a game

1. Collect the updated bilingual game-report issue form. Ask for missing required
   context rather than filling it from an unrelated report.
2. Find the game by exact Store ID/source, then title. Edition/store variants with
   different executables or content should have their own game identity.
3. Add a report using the fields of a nearby record. Keep English and Italian
   summaries/requirements aligned. New layers/results require a model/form update.
4. Link the supporting issue/PR and distinguish maintainer, community and migrated
   historical evidence. Retain partial/unknown fields exactly as the evidence permits.
5. Generate and review the game page and layer comparison matrix together. Run
   `npm run test:compatibility` and `npm run compatibility:check`; review the diff for accidental
   upgrades of limited tests to general support.

The initial migration preserves 14 games / 17 reports, including the separate
Bond ARM failure, both Deep Rock Galactic layers, the original Halo Highball
report and the later Preview movie/controller experiment. Nine Sols' source issue
provided CrossOver 26.3 but no macOS version; that version remains unknown.

## Italiano

`reports.json` è la fonte unica; matrice Markdown e schede `games/*.md`
sono generate. Un resoconto riguarda una sola configurazione di motore,
architettura, chip, macOS e build del gioco. Conserva ID e fonti delle prove;
non sostituire una vecchia prova negativa con un risultato positivo su un altro
ambiente. I controller hanno osservazioni separate per modello/connessione.

Usa `null` per dati ambientali non riportati, `unknown` per risultati non
riportati e `untested` solo per funzioni esplicitamente non provate. Non dedurre
la connessione del controller, la versione macOS o il supporto di un chip da
altri resoconti. Le prove limitate (`partial`) di filmati/menu/input non verificano
il gioco completo. La data di un’issue non è automaticamente la data della prova.

`works-offline` indica gioco offline funzionante con spunta verde; conserva il
limite online nei dettagli senza dedurne la causa. Il solo limite offline non
richiede un avviso giallo.

La matrice affianca tutti i motori nella stessa riga del gioco. Mostra tutti gli
esiti, anche discordanti; i numeri tra parentesi contano resoconti con lo stesso
esito. Il trattino indica assenza di resoconti, non incompatibilità. I motori non
riportati restano in una colonna separata. macOS e chip sono nelle singole prove.

Aggiorna entrambe le lingue, esegui i comandi sopra e controlla matrice e schede. Non modificare a mano le viste generate. Non pubblicare log grezzi,
identificativi account o file dei giochi. GitHub visualizza tutte le pagine Markdown;
ogni lingua usa un’unica tabella in ordine alfabetico. Usa Trova nel browser
per cercare un titolo.
