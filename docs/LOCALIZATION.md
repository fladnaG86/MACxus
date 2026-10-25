# Interface languages

MACxus supports English and Italian. Open **Settings → Language → Interface
language** and choose **English** or **Italiano**. The selection is saved locally
and applies immediately, including navigation, settings, onboarding, dialogs,
status labels and accessibility text. Restarting the app keeps the selection.
Existing profiles and unsupported saved language values fall back to English.

This preference is separate from the Store market and each game's language.
Changing it does not restart authentication, the backend, a game or downloads.
Game titles, usernames, paths, identifiers and content returned by Microsoft keep
their original values. Raw game/compiler logs and diagnostic report contents are
left intact for troubleshooting. Unknown backend errors are displayed verbatim.
Known Italian messages from the macOS backend are translated for English users.

## Adding or changing messages

- `src/shared/messages.ts` contains English source strings as keys and their
  Italian translations. Keep every `{value0}`-style placeholder in both versions;
  complete messages can reorder their placeholders.
- React views use `useI18n().t(key, values)` for app-owned text. Use complete
  messages when interpolating values rather than concatenating translated words.
- `useI18n().localize(text)` handles known app-owned status/error strings arriving
  from the main process. Do not pass user data, Store descriptions or raw logs
  through it. `legacyMessages` maps older Italian messages to their English keys.
- Main-process native dialogs use the saved language through the same shared
  translation functions. Keep IPC data and persisted status identifiers stable.
- Add coverage for new messages in `src/shared/i18n.test.ts` and relevant renderer
  tests. The catalog test checks that interpolation parameters match.

## Verification

Run `npm run typecheck` and
`npx vitest run src/renderer src/shared/i18n.test.ts src/main/interface-language.test.ts`.
For a packaged Mac build, run `npm run dist:mac`.

Manually switch both directions in Settings, visit Home, My Library and Store,
check the backend/Wine/storage guidance, and restart to verify persistence.
Confirm that existing storage, account, backend and runtime configuration remain
available. Raw build output should remain unchanged.
