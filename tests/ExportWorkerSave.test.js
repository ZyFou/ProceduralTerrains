import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EngineClient, WorkerEngineTransport } from '../src/engine/EngineProxy.js';
import { saveBlob } from '../src/platform/DesktopBridge.js';

vi.mock('../src/platform/DesktopBridge.js', () => ({ saveBlob: vi.fn() }));
beforeEach(() => vi.resetAllMocks());

async function clientFixture() {
  const transport = new WorkerEngineTransport();
  transport.initialize = async () => ({});
  transport.invoke = async () => {
    transport.onEvent('onArtifact', [{ blob: new Blob(['data']), filename: 'terrain.zip' }], null, 1);
    return true;
  };
  const client = new EngineClient({ callbacks: {} }, transport);
  await client.initialize();
  return client;
}

describe('worker export saving', () => {
  it('keeps the export pending until the main thread save finishes', async () => {
    let finishSave;
    saveBlob.mockImplementation(() => new Promise((resolve) => { finishSave = resolve; }));
    const client = await clientFixture();
    let completed = false;
    const exportPromise = client.command('export3DTerrain', [{}]).then(() => { completed = true; });
    await vi.waitFor(() => expect(finishSave).toBeTypeOf('function'));
    expect(completed).toBe(false);
    finishSave({ canceled: false });
    await exportPromise;
    expect(completed).toBe(true);
  });
  it.each(['rejection', 'cancellation'])('propagates save %s to the export UI', async (failure) => {
    if (failure === 'rejection') saveBlob.mockRejectedValue(new Error('Disk full'));
    else saveBlob.mockResolvedValue({ canceled: true });
    const client = await clientFixture();
    await expect(client.command('export3DTerrain', [{}])).rejects.toThrow(failure === 'rejection' ? 'Disk full' : 'canceled');
    expect(client.exportArtifactSaves).toBeNull();
  });
});
