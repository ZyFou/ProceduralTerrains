import { useCallback, useEffect, useRef, useState } from 'react';
import { translateText, useLanguage } from '../../i18n/LanguageContext.jsx';
import { SiBlender, SiUnity } from 'react-icons/si';
import SupportDownloadModal from '../../components/support/SupportDownloadModal.jsx';
import useSupportPrompt from '../../hooks/useSupportPrompt.js';
import { cn } from '@/lib/utils';
import { SectionLabel } from '@/landing/home/HomeView.jsx';
import BlenderPluginPage from './BlenderPluginPage.jsx';
import UnityPluginPage from './UnityPluginPage.jsx';
import { DownloadStatusContext } from './PluginDoc.jsx';
import SlidingIndicator from '@/components/ui/SlidingIndicator.jsx';
import './plugins.css';

// Downloads are a programmatic link click with no completion signal, so the
// LED spinner is held briefly after the download is triggered.
const DOWNLOAD_HOLD_MS = 1200;

const TAB = 'relative z-[1] inline-flex h-8 min-w-0 items-center justify-center gap-2 rounded-md px-4 text-[13px] font-medium text-zinc-400 outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 sm:min-w-[124px]';
// The active background is the sliding pill (.plugin-tab-pill in plugins.css).
const TAB_ACTIVE = 'text-foreground';

export default function PluginsPage({ activePlugin, onSelectPlugin, onOpenEditor }) {
  useLanguage();
  const supportPrompt = useSupportPrompt();
  const active = activePlugin === 'blender' ? 'blender' : 'unity';
  const { pendingDownload, openSupportDownload, continueWithoutDonating, downloadAfterSupport, closeSupportPrompt } = supportPrompt;

  // Id of the DownloadButton that is spinning: from its click, through the
  // support prompt if one opens, until shortly after the download starts.
  const [downloadingButton, setDownloadingButton] = useState(null);
  const [clickCount, setClickCount] = useState(0);
  const holdTimer = useRef(0);
  const clickPending = useRef(false);

  const clearDownloading = useCallback(() => {
    window.clearTimeout(holdTimer.current);
    setDownloadingButton(null);
  }, []);
  const holdThenClear = useCallback(() => {
    window.clearTimeout(holdTimer.current);
    holdTimer.current = window.setTimeout(() => setDownloadingButton(null), DOWNLOAD_HOLD_MS);
  }, []);
  useEffect(() => () => window.clearTimeout(holdTimer.current), []);

  const handleDownload = useCallback((plugin, buttonId) => {
    window.clearTimeout(holdTimer.current);
    if (!openSupportDownload(plugin)) {
      setDownloadingButton(null);
      return;
    }
    setDownloadingButton(buttonId ?? null);
    clickPending.current = true;
    setClickCount((count) => count + 1);
  }, [openSupportDownload]);

  // After a click renders: no prompt means the download already started.
  useEffect(() => {
    if (!clickPending.current) return;
    clickPending.current = false;
    if (!pendingDownload) holdThenClear();
  }, [clickCount, pendingDownload, holdThenClear]);

  const handleContinue = useCallback(() => {
    if (continueWithoutDonating()) holdThenClear();
    else clearDownloading();
  }, [continueWithoutDonating, holdThenClear, clearDownloading]);
  const handleDownloadAfterSupport = useCallback(() => {
    if (downloadAfterSupport()) holdThenClear();
    else clearDownloading();
  }, [downloadAfterSupport, holdThenClear, clearDownloading]);
  const handleClose = useCallback(() => {
    closeSupportPrompt();
    clearDownloading();
  }, [closeSupportPrompt, clearDownloading]);

  return (
    <DownloadStatusContext.Provider value={downloadingButton}>
      <div className="ui w-full font-sans text-foreground">
        <nav
          className="sticky top-0 z-20 flex items-center justify-between gap-4 border-b border-border bg-background/95 py-2.5 backdrop-blur-xl sm:min-h-16 sm:py-3"
          aria-label={translateText("Engine plugins")}
          role="tablist"
        >
          <SectionLabel className="hidden sm:inline-flex">{translateText("Engine plugins")}</SectionLabel>
          <div className="has-slider relative isolate grid w-full grid-cols-2 gap-1 rounded-[10px] border border-border bg-card p-1 sm:w-auto">
            <SlidingIndicator selector='[aria-selected="true"]' className="plugin-tab-pill" />
            <button
              type="button"
              role="tab"
              aria-selected={active === 'unity'}
              aria-controls="unity-plugin-panel"
              className={cn(TAB, active === 'unity' && TAB_ACTIVE)}
              onClick={() => onSelectPlugin('unity')}
            >
              <SiUnity size={15} aria-hidden className={active === 'unity' ? 'text-brand' : undefined} />{translateText(" Unity")}</button>
            <button
              type="button"
              role="tab"
              aria-selected={active === 'blender'}
              aria-controls="blender-plugin-panel"
              className={cn(TAB, active === 'blender' && TAB_ACTIVE)}
              onClick={() => onSelectPlugin('blender')}
            >
              <SiBlender size={15} aria-hidden className={active === 'blender' ? 'text-brand' : undefined} />{translateText(" Blender")}</button>
          </div>
        </nav>
        <div
          key={active}
          id={`${active}-plugin-panel`}
          className="animate-in fade-in-0 slide-in-from-bottom-3 duration-500 ease-out motion-reduce:animate-none"
          role="tabpanel"
        >
          {active === 'blender'
            ? <BlenderPluginPage onOpenEditor={onOpenEditor} onDownload={handleDownload} />
            : <UnityPluginPage onOpenEditor={onOpenEditor} onDownload={handleDownload} />}
        </div>
      </div>
      <SupportDownloadModal
        download={pendingDownload}
        onContinue={handleContinue}
        onDownload={handleDownloadAfterSupport}
        onClose={handleClose}
      />
    </DownloadStatusContext.Provider>
  );
}
