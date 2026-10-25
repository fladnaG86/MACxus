import { useI18n } from './i18n';
import { useEffect, useRef, useState } from 'react';
import { Check, CircleAlert, LoaderCircle, RefreshCw } from 'lucide-react';
import type { KeyringStatus } from '../shared/types';

export function KeyringSetup({ disabled = false, compact = false }: { disabled?: boolean; compact?: boolean }) {
  const { t, localize } = useI18n();
  const [status, setStatus] = useState<KeyringStatus>();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const generation = useRef(0);
  async function check(start = false, create = false) {
    const id = ++generation.current;
    setBusy(true); setFailed(false);
    try {
      const result = await (create ? window.launcher.createKeyringCollection() : start ? window.launcher.startKeyring() : window.launcher.checkKeyring());
      if (id === generation.current) setStatus(result);
    } catch {
      if (id === generation.current) setFailed(true);
    } finally { if (id === generation.current) setBusy(false); }
  }
  useEffect(() => { void check(); return () => { generation.current++; }; }, []);
  useEffect(() => window.launcher.onKeyringStatus?.(result => {
    generation.current++;
    setStatus(result); setFailed(false); setBusy(false);
  }), []);
  const message = failed
    ? t("Keyring status could not be checked. Open your desktop wallet settings and ensure the wallet is enabled and unlocked.")
    : status?.message ?? t("Checking the system wallet without reading saved credentials…");
  const actions = <div className="button-row">
    {status?.state === 'needs-setup' && status.canCreate ? <button className="secondary" aria-label={t("Create wallet")} title={t("Open the system wallet dialog. Choose your password there, not in Nexus.")} disabled={busy || disabled} onClick={() => void check(false, true)}>{t("Create wallet")}</button> : null}
    {status?.canStart || status?.canUnlock ? <button className="secondary" aria-label={status.canUnlock ? t("Unlock wallet") : t("Start keyring service")} title={t("Start or unlock the installed wallet using its own password window. Security settings are unchanged.")} disabled={busy || disabled} onClick={() => void check(true)}>{status.canUnlock ? t("Unlock wallet") : compact ? t("Start service") : t("Start keyring service")}</button> : null}
    <button className="secondary" aria-label={t("Check keyring")} title={t("Check keyring")} disabled={busy || disabled} onClick={() => void check()}><RefreshCw />{compact ? null : t("Check keyring")}</button>
  </div>;
  const icon = busy ? <LoaderCircle className="spin" /> : status?.state === 'ready' ? <Check /> : <CircleAlert />;
  const safety = t("Your wallet provider handles its password window. Nexus does not receive the password, enable a disabled wallet or reset stored credentials.");
  const gameModeHelp = t("Use Start service or Unlock wallet for this session. Create wallet opens your provider’s setup dialog when no collection exists. If setup is unavailable here, complete it in Desktop Mode.");
  if (compact) {
    const problem = failed || Boolean(status && !['ready', 'stopped'].includes(status.state));
    const label = busy ? t("Checking…") : failed ? t("Unavailable") : status ? {
      ready: t("Ready"), stopped: t("Not running"), locked: t("Locked"), disabled: t("Disabled"),
      missing: t("Not installed"), 'needs-setup': t("Setup needed"), unavailable: t("Unavailable"),
    }[status.state] : t("Checking…");
    return <section className="keyring-setup keyring-compact" aria-label={t("System keyring")}>
      <div className="keyring-compact-row"><div className="keyring-status" role="status" aria-live="polite">{icon}<div><strong>{t("System keyring")}</strong><small>{label}</small></div></div>{actions}</div>
      {problem ? <>
        <p className="keyring-problem">{localize(message)}</p>
        <details className="keyring-help"><summary>{t("Help")}</summary>{status?.gameMode ? <p className="fine-print">{gameModeHelp}</p> : null}<p className="fine-print">{safety}</p></details>
      </> : null}
    </section>;
  }
  return <section className="keyring-setup" aria-label={t("System keyring")}>
    <div className="keyring-status" role="status" aria-live="polite">
      {icon}
      <div><strong>{t("System keyring")}</strong><p>{localize(message)}</p></div>
    </div>
    {status?.gameMode && status.state !== 'ready' ? <p className="fine-print">{gameModeHelp}</p> : null}
    {actions}
    <p className="fine-print">{safety}</p>
  </section>;
}
