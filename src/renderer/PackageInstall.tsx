import { useI18n } from './i18n';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { InstallPlan, InstallRequest } from '../shared/types';
import { StoragePicker } from './StoragePicker';

type Install = (request: InstallRequest) => Promise<string | undefined>;
const InstallContext = createContext<Install>(async () => { throw Error('Installation dialog is unavailable.'); });
export const usePackageInstall = () => useContext(InstallContext);

export function PackageDialog({ plan, choose }: { plan: InstallPlan; choose: (id?: string) => void }) {
  const { t } = useI18n();
  const [selected, setSelected] = useState('');
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') choose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [choose]);
  return <div className="dialog-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) choose(); }}>
    <section className="game-dialog package-dialog" role="dialog" aria-modal="true" aria-labelledby="package-dialog-title">
      <h2 id="package-dialog-title">{t("Choose files to install")}</h2>
      <p>{t("Choose the package you want to install from this Store offer. Xodus checks your license before downloading.")}</p>
      <div className="package-choices">{plan.choices.map(item => <label className={`package-choice${item.supported ? '' : ' unsupported'}`} key={`${item.productId}:${item.contentId}`}>
        <input type="radio" name="install-package" value={item.contentId} disabled={!item.supported} checked={selected === item.contentId} onChange={() => setSelected(item.contentId)} />
        <span><strong>{item.title}</strong><small>{item.platform || t("Unknown platform")} · {item.packageFormat || t("Unknown format")}{item.kind === 'GameAddOn' ? t(" · Add-on") : ''}{!item.supported ? t(" · Unsupported") : ''}</small><small>{t("Store ID")}{' '}{item.productId}</small><small className="package-content-id">{t("Package")}{' '}{item.contentId}</small></span>
      </label>)}</div>
      <div className="dialog-actions"><button className="secondary" data-gamepad-cancel onClick={() => choose()}>{t("Cancel")}</button><button className="primary" disabled={!selected} onClick={() => choose(selected)}>{t("Install selected package")}</button></div>
    </section>
  </div>;
}

function StorageDialog({ installRoot, choose }: { installRoot: string; choose: (root?: string) => void }) {
  const { t } = useI18n();
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') choose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [choose]);
  return <div className="dialog-backdrop">
    <section className="game-dialog" role="dialog" aria-modal="true" aria-label={t("Game storage")}>
      <p>{t("Choose the drive and folder for your games. You can change them later in Settings.")}</p>
      <StoragePicker installRoot={installRoot} onChosen={choose} />
      <div className="dialog-actions"><button className="secondary" data-gamepad-cancel onClick={() => choose()}>{t("Cancel")}</button></div>
    </section>
  </div>;
}

export function PackageInstallProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [storage, setStorage] = useState<string>();
  const pendingStorage = useRef<((root?: string) => void)>();
  const [plan, setPlan] = useState<InstallPlan>();
  const pending = useRef<((id?: string) => void)>();
  const busy = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; pending.current?.(); pendingStorage.current?.(); }; }, []);
  function chooseStorage(root?: string) { pendingStorage.current?.(root); pendingStorage.current = undefined; setStorage(undefined); }
  function choose(id?: string) { pending.current?.(id); pending.current = undefined; setPlan(undefined); }
  const install: Install = async request => {
    if (busy.current) throw Error(t("Finish the current package selection first."));
    busy.current = true;
    try {
      // macOS: the first download asks where games go (disk with symlink support).
      const current = await window.launcher.getSnapshot?.().catch(() => undefined);
      if (current?.platform === 'darwin' && !current.settings.storageChosen) {
        const oldRoot = current.settings.installRoot;
        const root = await new Promise<string | undefined>(resolve => { pendingStorage.current = resolve; setStorage(oldRoot); });
        if (!root || !mounted.current) return;
        if (request.destination === oldRoot || request.destination.startsWith(oldRoot.replace(/\/+$/, '') + '/')) {
          request = { ...request, destination: root.replace(/\/+$/, '') + request.destination.slice(oldRoot.replace(/\/+$/, '').length) };
        }
      }
      const result = await window.launcher.getInstallPlan(request.productId);
      if (!mounted.current) return;
      if (result.status === 'unavailable') throw Error(t("No supported Windows.Desktop MSIXVC package was found for this Store offer."));
      const selected = result.status === 'ready' ? result.choices.find(item => item.supported)!.contentId
        : await new Promise<string | undefined>(resolve => { pending.current = resolve; setPlan(result); });
      if (!selected || !mounted.current) return;
      return await window.launcher.startInstall({ ...request, selectedContentId: selected, selectionMarket: result.market });
    } finally { busy.current = false; }
  };
  return <InstallContext.Provider value={install}>{children}{plan ? <PackageDialog plan={plan} choose={choose} /> : null}{storage ? <StorageDialog installRoot={storage} choose={chooseStorage} /> : null}</InstallContext.Provider>;
}
