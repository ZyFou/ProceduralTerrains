import { SiBlender, SiUnity } from 'react-icons/si';
import SupportDownloadModal from '../../components/support/SupportDownloadModal.jsx';
import useSupportPrompt from '../../hooks/useSupportPrompt.js';
import BlenderPluginPage from './BlenderPluginPage.jsx';
import UnityPluginPage from './UnityPluginPage.jsx';

export default function PluginsPage({ activePlugin, onSelectPlugin, onOpenEditor }) {
  const supportPrompt = useSupportPrompt();
  const active = activePlugin === 'blender' ? 'blender' : 'unity';
  return (
    <>
      <div className="plugins-page-shell">
        <nav className="plugin-engine-tabs" aria-label="Engine plugins" role="tablist">
          <span className="plugin-engine-tabs-label">Engine plugins</span>
          <div>
            <button
              type="button"
              role="tab"
              aria-selected={active === 'unity'}
              aria-controls="unity-plugin-panel"
              className={active === 'unity' ? 'active unity' : ''}
              onClick={() => onSelectPlugin('unity')}
            >
              <SiUnity size={15} aria-hidden /> Unity
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={active === 'blender'}
              aria-controls="blender-plugin-panel"
              className={active === 'blender' ? 'active blender' : ''}
              onClick={() => onSelectPlugin('blender')}
            >
              <SiBlender size={15} aria-hidden /> Blender
            </button>
          </div>
        </nav>
        <div
          key={active}
          id={`${active}-plugin-panel`}
          className="plugin-engine-panel"
          role="tabpanel"
        >
          {active === 'blender'
            ? <BlenderPluginPage onOpenEditor={onOpenEditor} onDownload={supportPrompt.openSupportDownload} />
            : <UnityPluginPage onOpenEditor={onOpenEditor} onDownload={supportPrompt.openSupportDownload} />}
        </div>
      </div>
      <SupportDownloadModal
        download={supportPrompt.pendingDownload}
        onContinue={supportPrompt.continueWithoutDonating}
        onDownload={supportPrompt.downloadAfterSupport}
        onClose={supportPrompt.closeSupportPrompt}
      />
    </>
  );
}
