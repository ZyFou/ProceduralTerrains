import { exportError } from './ExportDiagnostics.js';

export async function serializeGlb(model, exporter) {
  try {
    if (!exporter) {
      const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
      exporter = new GLTFExporter();
    }
    const result = await exporter.parseAsync(model, { binary: true, animations: [] });
    if (!(result instanceof ArrayBuffer) || result.byteLength === 0) throw new Error('GLB encoder returned an empty or invalid model');
    return new Uint8Array(result);
  } catch (reason) {
    throw exportError(reason, 'GLB serialization failed without an error message');
  }
}

export async function canvasPngBytes(canvas) {
  const blob = typeof canvas.convertToBlob === 'function'
    ? await canvas.convertToBlob({ type: 'image/png' })
    : await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('PNG encoding failed: the browser returned no image data');
  return new Uint8Array(await blob.arrayBuffer());
}
