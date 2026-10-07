import { translateText, useLanguage } from '../../i18n/LanguageContext.jsx';
import { PLUGINS } from '../../config/plugins.js';

export default function SupportMessage({ plugin }) {
  useLanguage();
  const pluginMessage = PLUGINS[plugin]?.supportMessage
    ?? 'Maintaining integrations for future engines takes ongoing development work.';

  return (
    <div className="support-download-message">
      <p>{translateText("Procedural Terrains and its plugins are free and open source.")}</p>
      <p>{translateText(pluginMessage)}</p>
      <p>{translateText("If you would like to support development, you can leave a small tip on Ko-fi.")}</p>
    </div>
  );
}
