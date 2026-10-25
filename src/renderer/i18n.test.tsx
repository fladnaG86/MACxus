import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { demoSnapshot } from '../shared/demo-data';
import { FirstRunWizard, HomePage, SettingsPage, Sidebar } from './App';
import { I18nProvider } from './i18n';
import { MacEngineCard } from './MacEngineCard';

const data = demoSnapshot();
data.platform = 'darwin';
data.backend.available = false;
data.backend.signingIdentity = false;
data.backend.blockReason = 'Su macOS il backend Nexus si compila dal codice sorgente: in Impostazioni premi «Compila il backend». Servono Git, Rust (Cargo) e protoc.';

describe('English and Italian interface', () => {
  it('defaults to English with a discoverable native-name language selector', () => {
    const html = renderToStaticMarkup(<SettingsPage data={data} toast={() => {}} />);
    expect(html).toContain('Interface language');
    expect(html).toMatch(/<option value="en" lang="en" selected="">English<\/option>/);
    expect(html).toContain('Italiano');
    expect(html).toContain('Build backend');
    expect(html).toContain('Game storage');
    expect(html).toContain('Keychain Access');
    expect(html).not.toContain('Compila il backend');
    expect(html).not.toContain('Motore Wine');
  });
  it('renders settings, navigation and setup in Italian when selected', () => {
    const html = renderToStaticMarkup(<I18nProvider language="it">
      <SettingsPage data={data} toast={() => {}} />
      <Sidebar data={data} page="settings" go={() => {}} />
      <FirstRunWizard data={data} toast={() => {}} />
    </I18nProvider>);
    expect(html).toContain('Lingua dell’interfaccia');
    expect(html).toMatch(/<option value="it" lang="it" selected="">Italiano<\/option>/);
    expect(html).toContain('Impostazioni');
    expect(html).toContain('La mia libreria');
    expect(html).toContain('Compila il backend');
    expect(html).toContain('Motore Wine');
    expect(html).toContain('Configura Xodus Nexus');
    expect(html).not.toContain('Build backend');
    expect(html).not.toContain('Interface language');
  });
  it('preserves game titles and filesystem paths rather than translating user data', () => {
    const custom = { ...data, games: [{ ...data.games[0], title: 'Settings', publisher: 'Game storage' }] };
    const html = renderToStaticMarkup(<I18nProvider language="it"><HomePage data={custom} go={() => {}} action={() => {}} /></I18nProvider>);
    expect(html).toContain('<h1>Settings</h1>');
    expect(html).toContain('Game storage');
    const settings = renderToStaticMarkup(<I18nProvider language="it"><SettingsPage data={data} toast={() => {}} /></I18nProvider>);
    expect(settings).toContain(data.settings.installRoot);
  });
  it('translates app-owned Italian engine status and errors in English', () => {
    const html = renderToStaticMarkup(<MacEngineCard status={{ highballInstalled: false, highballTag: 'test', installing: false, phase: 'Motore Highball installato e verificato.', error: 'Il motore Highball è disponibile solo su macOS.' }} />);
    expect(html).toContain('The Highball engine is only available on macOS.');
    expect(html).not.toContain('Il motore Highball');
  });
});

it.each([true, false])('shows bundled delivery without first-run build or certificate requirements (available: %s)', available => {
  const bundled = { ...data, backend: { ...data.backend, source: available ? 'bundled' as const : 'none' as const, delivery: 'bundled' as const, available, blockReason: available ? undefined : 'Reinstall MACxus' } };
  const html = renderToStaticMarkup(<SettingsPage data={bundled} toast={() => {}} />);
  const main = html.replace(/<details\b[^>]*>[\s\S]*?<\/details>/, '');
  expect(main).toContain('The backend is included with MACxus');
  expect(main).not.toContain('Build backend');
  expect(main).not.toContain('MACxus Local Signing');
  expect(html).toContain(available ? 'Included with MACxus' : 'Reinstall MACxus');
});
