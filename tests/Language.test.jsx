import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import french from '../src/i18n/fr.json';
import {
  formatDate, getLanguage, LANGUAGE_STORAGE_KEY, matchesTranslatedSearch,
  readLanguage, setLanguage, subscribeLanguage, translateText,
} from '../src/i18n/language.js';
import TopBar from '../src/components/TopBar.jsx';
import LanguageSwitch from '../src/i18n/LanguageSwitch.jsx';
import ConfidentialityPage from '../src/legal/ConfidentialityPage.jsx';
import BlenderPluginPage from '../src/landing/plugins/BlenderPluginPage.jsx';
import { renderPanel } from '../src/components/panels/index.jsx';
import { searchSettings } from '../src/components/panels/settingsSearch.js';

afterEach(() => {
  setLanguage('en', { persist: false });
  vi.unstubAllGlobals();
});

describe('site language', () => {
  it('starts in English and accepts only supported saved languages', () => {
    expect(readLanguage({ getItem: () => 'fr' })).toBe('fr');
    expect(readLanguage({ getItem: () => 'de' })).toBe('en');
    expect(readLanguage({ getItem: () => null })).toBe('en');
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked'); } });
    expect(readLanguage()).toBe('en');
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get: () => { throw new Error('blocked getter'); } });
    expect(readLanguage()).toBe('en');
  });

  it('persists changes, updates HTML language and notifies mounted subscribers without reload', () => {
    const setItem = vi.fn();
    vi.stubGlobal('localStorage', { setItem });
    vi.stubGlobal('document', { documentElement: { lang: 'en' } });
    const listener = vi.fn();
    const unsubscribe = subscribeLanguage(listener);
    setLanguage('fr');
    expect(getLanguage()).toBe('fr');
    expect(document.documentElement.lang).toBe('fr');
    expect(setItem).toHaveBeenCalledWith(LANGUAGE_STORAGE_KEY, 'fr');
    expect(listener).toHaveBeenCalledOnce();
    setLanguage('fr');
    setLanguage('de');
    expect(listener).toHaveBeenCalledOnce();
    unsubscribe();
    setLanguage('en');
    expect(listener).toHaveBeenCalledOnce();
  });

  it('still switches when persistent storage is blocked', () => {
    vi.stubGlobal('localStorage', { setItem: () => { throw new Error('blocked'); } });
    setLanguage('fr');
    expect(getLanguage()).toBe('fr');
  });

  it('preserves English text, JSX spacing, unknown terms and interpolation parameters', () => {
    expect(translateText('  Save  ')).toBe('  Save  ');
    setLanguage('fr');
    expect(translateText(' Save ')).toBe(' Enregistrer ');
    expect(translateText(' ')).toBe(' ');
    expect(translateText('My terrain with mountains')).toBe('My terrain with mountains');
    expect(translateText('constructor')).toBe('constructor');
    expect(translateText('toString')).toBe('toString');
    expect(translateText('Saved Mountains')).toBe('Mountains enregistré');
    expect(translateText('Actions for {0}', { 0: 'Water' })).toBe('Actions pour Water');
    expect(translateText('Copied my-file.ptrterrain.')).toBe('my-file.ptrterrain copié.');
    const element = <span>Custom content</span>;
    expect(translateText(element)).toBe(element);
    expect(translateText(null)).toBeNull();
    expect(translateText(42)).toBe(42);
  });

  it('keeps the interpolation slots in every translation', () => {
    const slots = (value) => [...new Set(value.match(/\{\d+\}/g) ?? [])].sort();
    for (const [source, target] of Object.entries(french)) {
      expect(slots(target), source).toEqual(slots(source));
      expect(target.trim(), source).not.toBe('');
    }
  });

  it('uses the selected locale for dates and supports accented French searches', () => {
    setLanguage('fr');
    expect(formatDate('2026-07-23', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })).toBe('23 juillet 2026');
    expect(searchSettings('echelle de hauteur').some((item) => item.settingId === 'terrain.heightScale')).toBe(true);
    expect(searchSettings('Height Scale').some((item) => item.settingId === 'terrain.heightScale')).toBe(true);
    expect(matchesTranslatedSearch('erosion thermique', 'Thermal Erosion')).toBe(true);
    setLanguage('en');
    expect(searchSettings('echelle de hauteur')).toEqual([]);
  });

  it('translates editor menus and help while keeping the authored project name', () => {
    setLanguage('fr');
    const html = renderToStaticMarkup(<TopBar projectName="Water" />);
    expect(html).toContain('Fichier');
    expect(html).toContain('Enregistrer');
    expect(html).toContain('Afficher l’aide des commandes');
    expect(html).toContain('value="Water"');
    expect(html).not.toContain('value="Eau"');
  });

  it('translates settings metadata, plugin instructions and legal paragraphs', () => {
    setLanguage('fr');
    const panel = renderToStaticMarkup(renderPanel('terrain', { realTerrainMode: true, worldMode: 'studio', params: {}, perf: {} }));
    expect(panel).toContain('Échelle de hauteur');
    expect(panel).toContain('Sélectionner une zone sur la carte');
    const plugin = renderToStaticMarkup(<BlenderPluginPage />);
    expect(plugin).toContain('directement dans Blender.');
    expect(plugin).toContain('Guide d’installation');
    const policy = renderToStaticMarkup(<ConfidentialityPage />);
    expect(policy).toContain('Confidentialité et vie privée');
    expect(policy).toContain('Les mots de passe ne sont jamais stockés sous une forme lisible.');
    setLanguage('en');
    expect(renderToStaticMarkup(<ConfidentialityPage />)).toContain('Confidentiality &amp; privacy');
    expect(renderToStaticMarkup(<LanguageSwitch />)).toContain('Switch to French');
  });
});
