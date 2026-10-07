import { translateText, useLanguage } from '../../i18n/LanguageContext.jsx';
import { Command } from 'lucide-react';
import { getPlatformName, isMacPlatform, shortcutText } from '../../keyboardShortcuts.js';

export default function ShortcutHint({ shortcut, className = '' }) {
  useLanguage();
  const platform = getPlatformName();
  const mac = isMacPlatform(platform);
  const displayKey = shortcut.displayKey ?? String(shortcut.key).toUpperCase();

  return (
    <span className={className} aria-label={translateText(shortcutText(shortcut, platform))}>
      {mac
        ? <Command className="shortcut-command-icon" size={12} strokeWidth={1.8} aria-hidden />
        : <span>{translateText("Ctrl")}</span>}
      <span aria-hidden>+</span>
      {shortcut.shiftKey && <><span>{translateText("Shift")}</span><span aria-hidden>+</span></>}
      {shortcut.altKey && <><span>{translateText(mac ? 'Option' : 'Alt')}</span><span aria-hidden>+</span></>}
      <span>{translateText(displayKey)}</span>
    </span>
  );
}
