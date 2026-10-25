import { describe, expect, it } from 'vitest';
import { appLanguage, translate, translateMessage } from './i18n';
import { italianMessages, legacyMessages, type MessageKey } from './messages';

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();

describe('launcher translations', () => {
  it('defaults old and invalid preferences to English', () => {
    for (const value of [undefined, null, '', 'fr', 'IT', {}, 1]) expect(appLanguage(value)).toBe('en');
    expect(appLanguage('it')).toBe('it');
  });
  it('has nonempty translations with the same interpolation parameters', () => {
    for (const [english, italian] of Object.entries(italianMessages)) {
      expect(italian.trim(), english).not.toBe('');
      expect(placeholders(italian), english).toEqual(placeholders(english));
      expect(translate('en', english as MessageKey)).toBe(english);
    }
    for (const [source, key] of Object.entries(legacyMessages)) {
      expect(placeholders(source), source).toEqual(placeholders(key));
    }
  });
  it('interpolates user data literally without recursively translating it', () => {
    const title = 'Settings $& {value1} <TUNIC>';
    expect(translate('it', 'Update {value0}?', { value0: title })).toBe(`Aggiornare ${title}?`);
  });
  it('normalizes existing Italian backend errors in either language while preserving paths', () => {
    const path = '/Volumes/Games $&/Wine';
    const error = `Il runtime Xodus selezionato non è disponibile: ${path}. Reinstalla Xodus Runtime nelle Impostazioni.`;
    expect(translateMessage('en', error)).toBe(`The selected Xodus runtime is unavailable: ${path}. Reinstall Xodus Runtime in Settings.`);
    expect(translateMessage('it', error)).toBe(error);
    expect(translateMessage('en', 'Download del motore Highball…')).toBe('Downloading the Highball engine…');
    expect(translateMessage('en', 'Download del motore Highball non riuscito (HTTP 404).')).toBe('Download Highball engine failed (HTTP 404).');
    expect(translateMessage('it', 'Runtime is ready.')).toBe('Il runtime è pronto.');
  });
  it('leaves unknown diagnostic text intact', () => {
    const output = 'error[E0425]: cannot find value `abc` in scope\n/private/tmp/compiler.rs:42';
    expect(translateMessage('it', output)).toBe(output);
    expect(translateMessage('en', 'constructor')).toBe('constructor');
    expect(translateMessage('it', 'toString')).toBe('toString');
  });
});
