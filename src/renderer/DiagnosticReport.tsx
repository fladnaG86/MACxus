import { useI18n } from './i18n';
import { useState } from 'react';
import { Download, LoaderCircle } from 'lucide-react';
import type { DiagnosticReport, Game } from '../shared/types';

export function DiagnosticReportDialog({ report, close }: { report: DiagnosticReport; close: () => void }) {
  const { t, localize } = useI18n();
  const [content, setContent] = useState(report.content);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  async function save() {
    setSaving(true); setMessage('');
    try { if (await window.launcher.saveDiagnosticReport(content)) setMessage(t("Report saved. Attach the text file to your issue report.")); }
    catch { setMessage(t("Could not save the report. Choose a new .txt filename in a writable folder.")); }
    finally { setSaving(false); }
  }
  return <div className="dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !saving) close(); }}>
    <section className="game-dialog diagnostic-dialog" role="dialog" aria-modal="true" aria-label={t("Review diagnostic report")}>
      <h2>{t("Review diagnostic report")}</h2>
      <p>{t("Automatic redaction is best effort. Review and remove any private information before sharing. Nothing is uploaded automatically.")}</p>
      <label className="diagnostic-report-editor">{t("Report contents")}<textarea value={content} onChange={event => setContent(event.target.value)} spellCheck={false} /></label>
      {message ? <p role="status">{localize(message)}</p> : null}
      <div className="dialog-actions"><button className="secondary" disabled={saving || !content.trim()} onClick={() => void save()}>{saving ? <LoaderCircle className="spin" /> : <Download />}{t("Save report")}</button><button className="secondary" disabled={saving} data-gamepad-cancel onClick={close}>{t("Close")}</button></div>
    </section>
  </div>;
}

export function DiagnosticReportButton({ games }: { games: Game[] }) {
  const { t, localize } = useI18n();
  const [gameId, setGameId] = useState('');
  const [report, setReport] = useState<DiagnosticReport>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  async function create() {
    setLoading(true); setError('');
    try { setReport(await window.launcher.createDiagnosticReport(gameId || undefined)); }
    catch { setError(t("Could not create the report. Check that the selected game is still in your library, then try again.")); }
    finally { setLoading(false); }
  }
  return <section>
    <h3>{t("Diagnostic report")}</h3><p className="fine-print">{t("Versions, system information, backend and recent download logs. Optionally include one game’s latest logs.")}</p>
    <div className="button-row"><select aria-label={t("Game logs for report")} value={gameId} disabled={loading} onChange={event => setGameId(event.target.value)}><option value="">{t("No game logs")}</option>{games.map(game => <option key={game.id} value={game.id}>{game.title}</option>)}</select><button className="secondary" disabled={loading} onClick={() => void create()}>{loading ? <LoaderCircle className="spin" /> : <Download />}{t("Export diagnostic report")}</button></div>
    {error ? <p role="alert">{localize(error)}</p> : null}
    {report ? <DiagnosticReportDialog report={report} close={() => setReport(undefined)} /> : null}
  </section>;
}
