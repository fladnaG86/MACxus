import { italianMessages, legacyMessages, type MessageKey } from './messages.js';

export type AppLanguage = 'en' | 'it';
export type MessageValues = Record<string, string | number | undefined>;
export type Translator = (key: MessageKey, values?: MessageValues) => string;

export function appLanguage(value: unknown): AppLanguage {
  return value === 'it' ? 'it' : 'en';
}

export function translate(language: AppLanguage, key: MessageKey, values: MessageValues = {}): string {
  const text = language === 'it' ? italianMessages[key] : key;
  // A replacement callback keeps dollar signs and braces in user data literal.
  return text.replace(/\{(\w+)\}/g, (placeholder, name: string) => values[name] === undefined ? placeholder : String(values[name]));
}

function patternFor(source: string, key: MessageKey) {
  return {
    key,
    specificity: source.replace(/\{\w+\}/g, '').length,
    names: [...source.matchAll(/\{(\w+)\}/g)].map(match => match[1]),
    pattern: new RegExp('^' + source.split(/\{\w+\}/).map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('([\\s\\S]*?)') + '$'),
  };
}
const legacyPatterns = Object.entries(legacyMessages).filter(([source]) => source.includes('{')).map(([source, key]) => patternFor(source, key));
const dynamicKeys = new Set(Object.values(legacyMessages));
const patterns = [...dynamicKeys].filter(key => key.includes('{')).map(key => patternFor(key, key as MessageKey));
const reverseMessages = new Map<string, MessageKey>(Object.entries(italianMessages).map(([key, value]) => [value, key as MessageKey]));
const reversePatterns = Object.entries(italianMessages).filter(([key, value]) => dynamicKeys.has(key as MessageKey) && value.includes('{')).map(([key, value]) => patternFor(value, key as MessageKey));
const messagePatterns = [...legacyPatterns, ...patterns, ...reversePatterns].sort((a, b) => b.specificity - a.specificity);

/** Only app-owned status/error messages pass through here; never titles, paths or raw logs. */
export function translateMessage(language: AppLanguage, text: string | undefined): string {
  if (!text) return text ?? '';
  const known = (Object.hasOwn(legacyMessages, text) ? legacyMessages[text] : undefined) ?? reverseMessages.get(text);
  if (known) return translate(language, known);
  if (Object.hasOwn(italianMessages, text)) return translate(language, text as MessageKey);
  for (const { key, names, pattern } of messagePatterns) {
    const match = pattern.exec(text);
    if (match) return translate(language, key, Object.fromEntries(names.map((name, i) => [name, match[i + 1]])));
  }
  return text;
}
