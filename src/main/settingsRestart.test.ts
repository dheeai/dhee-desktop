import { it, expect, jest } from '@jest/globals';
import { restartForSettingsPatch } from './settingsRestart';

it('saving only the queue endpoint preserves active engine sessions', async () => {
  const restart = jest.fn(async () => {});
  await restartForSettingsPatch(
    { gpuQueueUrl: 'http://localhost/mcp' },
    restart,
  );
  expect(restart).not.toHaveBeenCalled();
});
it('still restarts for mixed patches that change generation providers', async () => {
  const restart = jest.fn(async () => {});
  await restartForSettingsPatch(
    { gpuQueueUrl: 'http://localhost/mcp', openaiModel: 'new-model' },
    restart,
  );
  expect(restart).toHaveBeenCalledTimes(1);
});
