import { useEffect, useRef } from 'react';
import { Download, Heart, X } from 'lucide-react';
import KofiEmbed from './KofiEmbed.jsx';
import SupportMessage from './SupportMessage.jsx';

export default function SupportDownloadModal({ download, onContinue, onDownload, onClose }) {
  const closeButtonRef = useRef(null);

  useEffect(() => {
    if (!download) return undefined;
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();

    const onKeyDown = (event) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus?.();
    };
  }, [download, onClose]);

  if (!download) return null;

  return (
    <div
      className="support-download-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="support-download-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="support-download-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="support-download-header">
          <span className="support-download-icon"><Heart size={19} aria-hidden /></span>
          <div>
            <span>Support Procedural Terrains</span>
            <h2 id="support-download-title">Keep {download.pluginName} integration growing</h2>
          </div>
          <button ref={closeButtonRef} type="button" className="support-download-close" onClick={onClose} aria-label="Close support dialog">
            <X size={17} aria-hidden />
          </button>
        </header>

        <div className="support-download-body">
          <SupportMessage plugin={download.plugin} />
          <KofiEmbed download={download} />
          <p className="support-download-optional">Donations are completely optional. Your download is ready either way.</p>
        </div>

        <footer className="support-download-footer">
          <button type="button" className="lp-secondary support-download-skip" onClick={onContinue}>
            No thanks, continue to download
          </button>
          <button type="button" className="lp-primary" onClick={onDownload}>
            <Download size={15} aria-hidden /> Download plugin
          </button>
        </footer>
      </section>
    </div>
  );
}
