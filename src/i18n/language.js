import french from './fr.json';

export const LANGUAGE_STORAGE_KEY = 'terrain-studio.language';
export const SUPPORTED_LANGUAGES = ['en', 'fr'];

export function readLanguage(storage) {
  try {
    const saved = (storage ?? globalThis.localStorage)?.getItem(LANGUAGE_STORAGE_KEY);
    return SUPPORTED_LANGUAGES.includes(saved) ? saved : 'en';
  } catch {
    return 'en';
  }
}

let language = readLanguage();
const listeners = new Set();
export const getLanguage = () => language;
export const getLocale = () => language === 'fr' ? 'fr-FR' : 'en-US';
export const subscribeLanguage = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function setLanguage(next, { persist = true } = {}) {
  if (!SUPPORTED_LANGUAGES.includes(next)) return;
  if (persist) {
    try { globalThis.localStorage?.setItem(LANGUAGE_STORAGE_KEY, next); } catch { /* Private browsing may disable storage. */ }
  }
  if (globalThis.document) document.documentElement.lang = next;
  if (language === next) return;
  language = next;
  listeners.forEach((listener) => listener());
}

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Messages received from the engine/API may already contain their parameters.
// Match catalog templates at display time so existing notifications also switch
// language. Parameters (file names, usernames, sizes…) remain untouched.
const templates = Object.entries(french)
  .filter(([key]) => /\{\d+\}/.test(key) && key.replace(/\{\d+\}/g, '').trim().length > 2)
  .sort(([a], [b]) => b.replace(/\{\d+\}/g, '').length - a.replace(/\{\d+\}/g, '').length)
  .map(([key, value]) => ({
    pattern: new RegExp(`^${key.split(/\{\d+\}/).map(escapeRegExp).join('(.*?)')}$`, 's'),
    slots: [...key.matchAll(/\{(\d+)\}/g)].map((match) => match[1]),
    value,
  }));

const translatedCache = new Map();

export function translateText(value, parameters, targetLanguage = language) {
  if (typeof value !== 'string') return value;
  if (targetLanguage === 'en' && !parameters) return value;
  const key = value.trim().replace(/\s+/g, ' ');
  if (!key) return value;
  let translated = targetLanguage === 'fr'
    ? (Object.hasOwn(french, key) ? french[key] : translatedCache.get(key))
    : key;
  if (targetLanguage === 'fr' && translated === undefined) {
    for (const template of templates) {
      const match = key.match(template.pattern);
      if (!match) continue;
      const values = Object.fromEntries(template.slots.map((slot, i) => [slot, match[i + 1]]));
      translated = template.value.replace(/\{(\d+)\}/g, (token, slot) => values[slot] ?? token);
      break;
    }
  }
  if (translated === undefined) translated = key;
  if (targetLanguage === 'fr' && !translatedCache.has(key)) {
    if (translatedCache.size >= 2048) translatedCache.clear();
    translatedCache.set(key, translated);
  }
  if (parameters) translated = translated.replace(/\{([^}]+)\}/g, (token, slot) => parameters[slot] ?? token);
  // JSX uses leading/trailing spaces to separate adjacent text and icons.
  return `${value.match(/^\s*/)[0]}${translated}${value.match(/\s*$/)[0]}`;
}

export function formatDate(value, options) {
  return new Intl.DateTimeFormat(getLocale(), options).format(new Date(value));
}

export function formatRelativeTime(value) {
  if (!value) return translateText('Not saved');
  if (!Number.isFinite(new Date(value).getTime())) return translateText('Unknown date');
  const seconds = Math.max(0, (Date.now() - new Date(value).getTime()) / 1000);
  if (seconds < 60) return translateText('just now');
  const units = [[60, 3600, 'minute'], [3600, 86400, 'hour'], [86400, 604800, 'day'], [604800, 2629800, 'week']];
  for (const [divisor, limit, unit] of units) {
    if (seconds < limit) return new Intl.RelativeTimeFormat(getLocale(), { numeric: 'always', style: 'short' }).format(-Math.floor(seconds / divisor), unit);
  }
  return formatDate(value, { month: 'short', day: 'numeric', year: 'numeric' });
}

export const normalizeSearch = (value) => String(value ?? '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

// Search both the original metadata and the translated labels. IDs and saved
// documents remain language independent, and accents are optional in queries.
export function matchesTranslatedSearch(query, ...values) {
  const terms = normalizeSearch(query).split(/\s+/).filter(Boolean);
  const text = normalizeSearch(values.flatMap((value) => [value, translateText(value)]).join(' '));
  return terms.every((term) => text.includes(term));
}
