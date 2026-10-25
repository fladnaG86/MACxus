import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { appLanguage, translate, translateMessage, type AppLanguage } from '../shared/i18n';

const LanguageContext = createContext<AppLanguage>('en');

export function I18nProvider({ language: value, children }: { language?: AppLanguage; children: ReactNode }) {
  const language = appLanguage(value);
  useEffect(() => { document.documentElement.lang = language; }, [language]);
  return <LanguageContext.Provider value={language}>{children}</LanguageContext.Provider>;
}

export function useI18n() {
  const language = useContext(LanguageContext);
  return useMemo(() => ({
    language,
    t: translate.bind(null, language),
    localize: translateMessage.bind(null, language),
  }), [language]);
}
