export type ProviderDiagnosticStatus =
  | 'ready'
  | 'warning'
  | 'error'
  | 'unknown';

export type ProviderDiagnosticId = 'cloud-account' | 'comfyui' | 'llm' | 'vlm';

export interface ProviderDiagnosticItem {
  id: ProviderDiagnosticId;
  label: string;
  status: ProviderDiagnosticStatus;
  message: string;
  detail?: string;
}

export interface ProviderDiagnosticsSnapshot {
  checkedAt: number;
  items: ProviderDiagnosticItem[];
}
