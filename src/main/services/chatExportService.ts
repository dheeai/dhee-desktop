import type { ChatExportPayload, ChatExportResult } from '../../shared/chatTypes';

interface SaveDialogResult {
  canceled: boolean;
  filePath?: string;
}

interface SaveDialogOptions {
  title: string;
  defaultPath: string;
  filters: Array<{ name: string; extensions: string[] }>;
}

export interface ChatExportDependencies {
  showSaveDialog: (options: SaveDialogOptions) => Promise<SaveDialogResult>;
  writeFile: (
    filePath: string,
    content: string,
    encoding: BufferEncoding,
  ) => Promise<void>;
}

function buildDefaultFileName(now: Date): string {
  const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, -5);
  return `dhee-chat-${timestamp}.json`;
}

export async function exportChatJsonWithDialog(
  payload: ChatExportPayload,
  deps: ChatExportDependencies,
): Promise<ChatExportResult> {
  const saveResult = await deps.showSaveDialog({
    title: 'Export Chat History',
    defaultPath: buildDefaultFileName(new Date()),
    filters: [
      { name: 'JSON Files', extensions: ['json'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });

  if (saveResult.canceled || !saveResult.filePath) {
    return { success: false, canceled: true };
  }

  try {
    const content = JSON.stringify(payload, null, 2);
    await deps.writeFile(saveResult.filePath, content, 'utf-8');
    return {
      success: true,
      filePath: saveResult.filePath,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
