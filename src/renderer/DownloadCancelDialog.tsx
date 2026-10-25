import { useI18n } from './i18n';
import { useEffect, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import type { DownloadCancelOptions, DownloadTask } from '../shared/types';

export function DownloadCancelDialog({ task, options, loading, busy, error, close, choose }: {
  task: DownloadTask; options?: DownloadCancelOptions; loading: boolean; busy: boolean; error?: string;
  close: () => void; choose: (mode: 'keep' | 'delete-files') => void;
}) {
  const { t, localize } = useI18n();
  const [confirmed, setConfirmed] = useState(false), dialog = useRef<HTMLElement>(null);
  const state = useRef({ busy, close }); state.current = { busy, close };
  const active = ['running', 'paused', 'queued'].includes(task.status);
  const canDelete = task.kind === 'install' && !task.gameId && options?.deleteFilesAllowed === true;
  useEffect(() => {
    const origin = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    dialog.current?.querySelector<HTMLElement>('[data-gamepad-initial]')?.focus({ preventScroll: true });
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); if (!state.current.busy) state.current.close(); }
      if (event.key === 'Tab') {
        const controls = [...dialog.current!.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)')];
        if (!dialog.current?.contains(document.activeElement) || event.shiftKey && document.activeElement === controls[0] || !event.shiftKey && document.activeElement === controls.at(-1)) {
          event.preventDefault(); (event.shiftKey ? controls.at(-1) : controls[0])?.focus();
        }
      }
    };
    window.addEventListener('keydown', key, true);
    return () => { window.removeEventListener('keydown', key, true); if (origin?.isConnected) origin.focus({ preventScroll: true }); };
  }, []);
  return <div className="dialog-backdrop" onMouseDown={event => { if (!busy && event.target === event.currentTarget) close(); }}>
    <section ref={dialog} className="game-dialog download-cancel-dialog" role="dialog" aria-modal="true" aria-label={t("Cancel download")} aria-busy={busy}>
      <h2>{t("Cancel")}{' '}{task.title}?</h2>
      <p>{t("Keep the downloaded files for a later retry, or delete this new installation folder. Pausing a download keeps it in the queue.")}</p>
      <code className="remove-path">{task.destination}</code>
      <p>{loading ? t("Checking whether files can be deleted safely…") : task.kind !== 'install' || task.gameId
        ? t("Updates and DLC keep their files to protect the installed game.") : options?.reason ?? t("Only this new installation folder will be deleted. Other games are not affected.")}</p>
      {canDelete ? <label className="download-delete-confirm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} />{t("Permanently delete this new installation folder and all files inside it. This cannot be undone.")}</label> : null}
      {!active && !busy ? <p role="status">{t("This download has already ended.")}</p> : null}
      {busy ? <p role="status">{t("Stopping the download. Files will not be removed until it has fully stopped.")}</p> : null}
      {error ? <p className="error-text" role="alert">{localize(error)}</p> : null}
      <div className="dialog-actions">
        <button className="secondary" data-gamepad-cancel disabled={busy} onClick={close}>{t("Go back")}</button>
        <button className="secondary" data-gamepad-initial disabled={busy || !active} onClick={() => choose('keep')}>{t("Cancel and keep files")}</button>
        <button className="secondary danger" disabled={busy || !active || loading || !canDelete || !confirmed} onClick={() => choose('delete-files')}><Trash2 />{t("Cancel and delete files")}</button>
      </div>
    </section>
  </div>;
}
