import { PLUGINS } from '../../config/plugins.js';

export default function SupportMessage({ plugin }) {
  const pluginMessage = PLUGINS[plugin]?.supportMessage
    ?? 'Maintaining integrations for future engines takes ongoing development work.';

  return (
    <div className="support-download-message">
      <p>Procedural Terrains and its plugins are free and open source.</p>
      <p>{pluginMessage}</p>
      <p>If you would like to support development, you can leave a small tip on Ko-fi.</p>
    </div>
  );
}
