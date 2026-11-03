export type EditPayload =
  | { kind: 'text'; content: string }
  | { kind: 'localFile'; sourcePath: string; expectedSha256: string };
export type EditingRequest =
  | { action: 'reference.pick' }
  | {
      action: 'version.list' | 'artifact.read';
      projectDir: string;
      nodeId: string;
      versionId?: string;
    }
  | {
      action: 'input.preview' | 'input.write';
      projectDir: string;
      inputId: string;
      payload: EditPayload;
      expectedFingerprint?: string;
      humanAcknowledged?: true;
    }
  | {
      action: 'version.restorePreview' | 'version.restore';
      projectDir: string;
      nodeId: string;
      versionId: string;
      expectedFingerprint?: string;
      humanAcknowledged?: true;
    };
export interface EditVersion {
  versionId: string;
  path: string;
  kind: string;
  selected: boolean;
  available: boolean;
  reason?: string;
  sha256?: string;
  absolutePath?: string;
  bytes?: number;
}
export interface EditResult {
  versions?: EditVersion[];
  text?: string;
  absolutePath?: string;
  sha256?: string;
  bytes?: number;
  fingerprint?: string;
  downstream?: { nodeId: string; itemId?: string }[];
  candidate?: EditVersion;
  payload?: EditPayload;
  cancelled?: boolean;
  started?: boolean;
}
export type EditingResponse =
  | { ok: false; error: string }
  | { ok: true; result: EditResult };
