/**
 * extractRehydratedMedia — when a rehydrated tool call produced a viewable
 * artifact (dhee_show_node_output / show_file / read_artifact), pull out the
 * file path + kind so the restore path can emit a `media` row and render the
 * image/video inline — exactly as the LIVE tool_result path does. Without
 * this, reopening a project shows the artifact tool card with only the file
 * path as text, never the picture (issue surfaced during the #161 visual pass).
 */

export interface RehydratedMedia {
  path: string;
  kind: 'image' | 'video';
  createdAt?: number;
}

const IMAGE_EXT = /^(png|jpg|jpeg|gif|webp|bmp)$/;
const VIDEO_EXT = /^(mp4|mov|webm|mkv|m4v)$/;
const PATH_IN_TEXT =
  /(\/[^\s()]+\.(?:png|jpe?g|gif|webp|bmp|mp4|mov|webm|mkv|m4v))/i;

export function extractRehydratedMedia(tc: {
  details?: Record<string, unknown>;
  resultText?: string;
}): RehydratedMedia | null {
  const d = tc.details;
  let filePath = d && typeof d.file_path === 'string' ? d.file_path : undefined;
  const createdAt = d && typeof d.created_at === 'number' ? d.created_at : undefined;
  const assetType = d && typeof d.asset_type === 'string' ? d.asset_type : undefined;

  if (!filePath && tc.resultText) {
    const m = PATH_IN_TEXT.exec(tc.resultText);
    if (m) filePath = m[1];
  }
  if (!filePath) return null;

  const ext = filePath.toLowerCase().match(/\.(\w+)$/)?.[1] ?? '';
  const isImage = assetType === 'image' || IMAGE_EXT.test(ext);
  const isVideo = assetType === 'video' || VIDEO_EXT.test(ext);
  if (!isImage && !isVideo) return null;

  return {
    path: filePath,
    kind: isImage ? 'image' : 'video',
    ...(createdAt ? { createdAt } : {}),
  };
}
