import { useEffect, useSyncExternalStore } from 'react';
import { getLanguage, LANGUAGE_STORAGE_KEY, readLanguage, setLanguage, subscribeLanguage } from './language.js';

export { translateText } from './language.js';

export function useLanguage() {
  const language = useSyncExternalStore(subscribeLanguage, getLanguage, () => 'en');
  return { language, setLanguage };
}

export function LanguageProvider({ children }) {
  useEffect(() => {
    setLanguage(getLanguage(), { persist: false });
    const sync = (event) => {
      if (event.key === LANGUAGE_STORAGE_KEY || event.key === null) setLanguage(readLanguage(), { persist: false });
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  return children;
}
