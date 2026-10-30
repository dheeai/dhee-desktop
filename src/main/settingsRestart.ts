import type { AppSettings } from '../shared/settingsTypes';

/** Queue catalog configuration is read per request and needs no engine restart. */
export async function restartForSettingsPatch(
  patch: Partial<AppSettings>,
  restart: () => Promise<void>,
): Promise<void> {
  const fields = Object.keys(patch);
  if (fields.length === 1 && fields[0] === 'gpuQueueUrl') return;
  await restart();
}
export default restartForSettingsPatch;
