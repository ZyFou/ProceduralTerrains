# Site languages

English is the default. `LanguageSwitch` offers FR/EN in the landing and editor headers. The choice is stored under `terrain-studio.language`, synchronized between tabs, and applied to `<html lang>`.

## Adding interface text

- Call `useLanguage()` in components that display translated text so they update immediately when the language changes.
- Render labels, descriptions, tooltips and accessible names with `translateText(englishText)` and add the English source text and its French translation to `fr.json`.
- Keep model values, IDs, project documents and authored names in their original form. Translate built-in metadata only where it is displayed.
- Use numbered placeholders for dynamic messages, such as `translateText('Actions for {0}', { 0: projectName })`. Preserve every placeholder in the French translation. Already formatted engine notifications can also match these templates.
- Use the locale helpers for dates and numbers, and `matchesTranslatedSearch` when searching built-in labels.

Unknown text falls back to its original form. JSX edge whitespace is preserved, and changing language does not remount the editor or clear form input.

## Verification

Run `npm test` and `npm run build`. For browser checks, start `npm run dev` in another terminal and run `node tools/test-language-browser.mjs`. Set `CHROMIUM_PATH` when using a system Chromium, or `LANGUAGE_TEST_URL` when Vite uses a different address.
