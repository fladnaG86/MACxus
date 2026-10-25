import { useI18n } from './i18n';
import { Trash2 } from 'lucide-react';
import type { Game } from '../shared/types';

export function GameRemovalContents({ game, busy, close, remove }: {
  game: Game; busy: boolean; close: () => void; remove: (mode: 'library' | 'delete-files') => void;
}) {
  const { t } = useI18n();
  return <><h2>{t("Remove")}{' '}{game.title}?</h2>
    <p>{t("Keep the files, or permanently delete this installation folder. Deleted files and saves inside it cannot be restored from Trash. Saves stored outside this folder are not affected.")}</p>
    <code className="remove-path">{game.path}</code>
    <div className="dialog-actions"><button className="secondary" disabled={busy} data-gamepad-cancel onClick={close}>{t("Cancel")}</button>
      <button className="secondary" disabled={busy} onClick={() => remove('library')}>{t("Keep files")}</button>
      <button className="secondary danger" disabled={busy} onClick={() => remove('delete-files')}><Trash2 />{t("Delete files permanently")}</button></div>
  </>;
}
