import { useState } from 'react';
import { ExternalLink, Heart, LoaderCircle } from 'lucide-react';
import { trackPluginEvent } from '../../services/pluginAnalytics.js';

const KOFI_URL = 'https://ko-fi.com/zyfod';
const KOFI_EMBED_URL = `${KOFI_URL}/?hidefeed=true&widget=true&embed=true&preview=true`;

export default function KofiEmbed({ download }) {
  const [status, setStatus] = useState('loading');

  return (
    <div className="support-kofi">
      <div className={`support-kofi-frame is-${status}`}>
        <iframe
          title="Support Procedural Terrains on Ko-fi"
          src={KOFI_EMBED_URL}
          loading="lazy"
          referrerPolicy="strict-origin-when-cross-origin"
          onLoad={() => setStatus('loaded')}
          onError={() => setStatus('error')}
        />
        <div className="support-kofi-loading" role={status === 'error' ? 'status' : undefined}>
          {status === 'error' ? 'The embedded form is unavailable.' : <><LoaderCircle size={16} /> Loading Ko-fi…</>}
        </div>
      </div>
      <a
        className="support-kofi-fallback"
        href={KOFI_URL}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => trackPluginEvent('support_kofi_clicked', download)}
      >
        <Heart size={13} aria-hidden /> Support on Ko-fi <ExternalLink size={12} aria-hidden />
      </a>
    </div>
  );
}
