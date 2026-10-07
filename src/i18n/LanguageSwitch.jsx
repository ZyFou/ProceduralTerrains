import { useLanguage } from './LanguageContext.jsx';
import { translateText } from './language.js';
import './language.css';

export default function LanguageSwitch({ className = 'language-switch' }) {
  const { language, setLanguage } = useLanguage();
  const next = language === 'en' ? 'fr' : 'en';
  const label = translateText(next === 'fr' ? 'Switch to French' : 'Switch to English');
  return (
    <button type="button" className={className} onClick={() => setLanguage(next)} aria-label={label} title={label} lang={next}>
      {next.toUpperCase()}
    </button>
  );
}
