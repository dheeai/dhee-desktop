import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { dhee_CHANNELS as channels } from '../shared/dheeIpc';
import type { EditingResponse } from '../shared/productionEditing';
const coreModule = 'dhee-runner-production';
const actions = [
  'version.list',
  'artifact.read',
  'input.preview',
  'input.write',
  'version.restorePreview',
  'version.restore',
];
export async function hashReference(path: string): Promise<string> {
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(path)) {
    bytes += chunk.length;
    if (bytes > 64 * 1024 * 1024)
      throw Error('Choose a reference smaller than 64 MiB.');
    hash.update(chunk);
  }
  return hash.digest('hex');
}
export function registerProductionEditingIpc(
  ipc: {
    handle(
      channel: string,
      handler: (event: unknown, request: unknown) => Promise<EditingResponse>,
    ): void;
  },
  load: () => Promise<{
    executeProductionRequest(request: unknown): Promise<EditingResponse>;
  }> = () => import(/* webpackIgnore: true */ coreModule),
  pick: () => Promise<string | undefined> = async () => {
    const { dialog } = await import('electron');
    const result = await dialog.showOpenDialog({
      title: 'Choose a voice or image reference',
      properties: ['openFile'],
      filters: [
        {
          name: 'References',
          extensions: [
            'wav',
            'mp3',
            'm4a',
            'flac',
            'png',
            'jpg',
            'jpeg',
            'webp',
          ],
        },
      ],
    });
    return result.canceled ? undefined : result.filePaths[0];
  },
) {
  ipc.handle(channels.PRODUCTION_EDITING, async (_event, request) => {
    try {
      const action = (request as { action?: string } | null)?.action;
      if (action === 'reference.pick') {
        const path = await pick();
        if (!path) return { ok: true, result: { cancelled: true } };
        return {
          ok: true,
          result: {
            payload: {
              kind: 'localFile',
              sourcePath: path,
              expectedSha256: await hashReference(path),
            },
          },
        };
      }
      if (!action || !actions.includes(action))
        throw Error('Unknown editing operation.');
      return await (await load()).executeProductionRequest(request);
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
}
