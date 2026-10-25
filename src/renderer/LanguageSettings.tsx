import { useState } from 'react';
import { Languages, LoaderCircle } from 'lucide-react';
import type { AppLanguage } from '../shared/i18n';
import { useI18n } from './i18n';

/** Save only this preference: switching languages must not save other form edits. */
export function LanguageSettings() {
  const { t, language } = useI18n();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  async function choose(next: AppLanguage) {
    if (next === language) return;
    setSaving(true); setError(false);
    try { await window.launcher.updateSettings({ language: next }); }
    catch { setError(true); }
    finally { setSaving(false); }
  }
  return <section className="settings-card language-card">
    <div className="settings-heading"><div className="settings-icon"><Languages /></div><div><h2>{t('Language')}</h2><p>{t('Changes apply immediately. Game language and Store market are set separately.')}</p></div></div>
    <label>{t('Interface language')}<select value={language} disabled={saving} onChange={event => void choose(event.target.value as AppLanguage)}>
      <option value="en" lang="en">English</option><option value="it" lang="it">Italiano</option>
    </select></label>
    {saving ? <p role="status"><LoaderCircle className="spin" />{t('Saving language…')}</p> : null}
    {error ? <p className="error-text" role="alert">{t('Could not save the language. Try again.')}</p> : null}
  </section>;
}
