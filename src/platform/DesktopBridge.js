const desktop = () => globalThis.window?.proceduralTerrainsDesktop ?? null;

export const isDesktopApp = () => !!desktop();

export async function saveBlob(blob, suggestedName, { mime = blob?.type || 'application/octet-stream' } = {}) {
  const bridge = desktop();
  if (bridge) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return bridge.saveArtifact({ data: bytes, suggestedName, mime });
  }
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = suggestedName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return { canceled: false, path: null };
}

export async function saveDataUrl(dataUrl, suggestedName, mime = 'image/png') {
  const blob = await (await fetch(dataUrl)).blob();
  return saveBlob(blob, suggestedName, { mime });
}

export async function openDesktopDocument() {
  return desktop()?.openDocument() ?? null;
}

export async function takeStartupDesktopDocument() {
  return desktop()?.takeStartupDocument() ?? null;
}

export async function openRecentDesktopDocument(documentPath) {
  return desktop()?.openRecentDocument(documentPath) ?? null;
}

export async function saveDesktopDocument(payload) {
  return desktop()?.saveDocument(payload) ?? null;
}

export async function listRecentDesktopDocuments() {
  return desktop()?.listRecentDocuments() ?? [];
}

export async function getDesktopBackendSettings() {
  return desktop()?.getBackendSettings() ?? null;
}

export async function setDesktopBackendSettings(settings) {
  return desktop()?.setBackendSettings(settings) ?? null;
}

export function onDesktopDocumentOpen(listener) {
  return desktop()?.onOpenDocument(listener) ?? (() => {});
}

export function onDesktopCloseRequested(listener) {
  return desktop()?.onCloseRequested(listener) ?? (() => {});
}

export function resolveDesktopClose(action) {
  desktop()?.resolveClose(action);
}
