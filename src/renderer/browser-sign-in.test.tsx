import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { demoSnapshot } from '../shared/demo-data';
import { FirstRunWizard, SettingsPage } from './App';

describe('alternative browser sign-in', () => {
  it.each(['settings', 'wizard'])('keeps one regular sign-in entry in %s, with browser fallback in the auth window', location => {
    const data = demoSnapshot(); data.auth.stored = false;
    const html = renderToStaticMarkup(location === 'settings' ? <SettingsPage data={data} toast={() => {}} /> : <FirstRunWizard data={data} toast={() => {}} />);
    expect(html).not.toContain('Sign in through browser');
    expect(html).not.toContain('Phone passkeys also need Bluetooth');
    expect(html).toContain('Passkey sign-in requires Google Chrome installed on this computer. Other browsers are not supported.');
    expect(html).toContain('choose Continue in browser in the sign-in window.');
    expect(html).toContain(location === 'settings' ? 'Sign in with Xodus' : '>Sign in</button>');
  });
  it.each(['settings', 'wizard'])('on macOS does not ask for Chrome in %s and points to other sign-in methods', location => {
    const data = demoSnapshot(); data.auth.stored = false; data.platform = 'darwin';
    const html = renderToStaticMarkup(location === 'settings' ? <SettingsPage data={data} toast={() => {}} /> : <FirstRunWizard data={data} toast={() => {}} />);
    expect(html).not.toContain('Google Chrome');
    expect(html).not.toContain('Continue in browser');
    expect(html).toContain('No browser is needed. Passkey sign-in is not available on macOS yet');
    expect(html).toContain('Other ways to sign in');
  });
  it.each(['settings', 'wizard'])('disables sign-in during authentication or with an incompatible backend in %s', location => {
    for (const running of [true, false]) {
      const data = demoSnapshot(); data.auth.running = running; data.backend.capabilities.login = running;
      const html = renderToStaticMarkup(location === 'settings' ? <SettingsPage data={data} toast={() => {}} /> : <FirstRunWizard data={data} toast={() => {}} />);
      expect(html).toMatch(/<button[^>]*disabled=""[^>]*><svg[^]*?Sign in again<\/button>/);
    }
  });
});
