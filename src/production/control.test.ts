/** @jest-environment node */
/* Tests exercise the workspace package source before packaging. */
/* eslint-disable import/no-relative-packages */
import { join } from 'node:path';
import { it, expect, jest } from '@jest/globals';
import {
  createDesktopProductionControl,
  configureProductionRuntime,
} from '../../packages/dhee-runner-production/src/control.js';

it('routes execution and cancellation to the existing engine', async () => {
  const { signal } = new AbortController();
  const execute = jest.fn(async () => ({
    ok: true as const,
    result: { gatedAfter: 'review:references' },
  }));
  const request = { action: 'assembly.run', nodeId: 'clip' };
  expect(
    await createDesktopProductionControl(execute)(request, { signal }),
  ).toEqual({ ok: true, result: { gatedAfter: 'review:references' } });
  expect(execute).toHaveBeenCalledWith(request, { signal });
});
it('routes scene validation through the shared Core controller', async () => {
  const response = { ok: false as const, error: 'Invalid scene intent' };
  const execute = jest.fn(async () => response);
  const request = {
    action: 'scene.check',
    sceneIntent: { requirements: [], sources: [] },
  };
  expect(await createDesktopProductionControl(execute)(request)).toEqual(
    response,
  );
  expect(execute).toHaveBeenCalledWith(request, {});
});
it('preserves external runner locations and adds the Desktop package location once', () => {
  const before = process.env.DHEE_NODE_MODULES_DIRS;
  try {
    process.env.DHEE_NODE_MODULES_DIRS = '/test/external';
    configureProductionRuntime();
    const once = process.env.DHEE_NODE_MODULES_DIRS;
    configureProductionRuntime();
    expect(process.env.DHEE_NODE_MODULES_DIRS).toBe(once);
    expect(once).toContain('/test/external');
    expect(JSON.parse(once!)).toHaveLength(2);
  } finally {
    if (before === undefined) delete process.env.DHEE_NODE_MODULES_DIRS;
    else process.env.DHEE_NODE_MODULES_DIRS = before;
  }
});

it('keeps default cwd node_modules when adding shipped runners', () => {
  const before = process.env.DHEE_NODE_MODULES_DIRS;
  try {
    delete process.env.DHEE_NODE_MODULES_DIRS;
    configureProductionRuntime();
    expect(JSON.parse(process.env.DHEE_NODE_MODULES_DIRS!)).toContain(
      join(process.cwd(), 'node_modules'),
    );
  } finally {
    if (before === undefined) delete process.env.DHEE_NODE_MODULES_DIRS;
    else process.env.DHEE_NODE_MODULES_DIRS = before;
  }
});
it('preserves Windows roots in a JSON path list', () => {
  const before = process.env.DHEE_NODE_MODULES_DIRS;
  const win = String.raw`C:\Users\Person\node_modules`;
  try {
    process.env.DHEE_NODE_MODULES_DIRS = JSON.stringify([win]);
    configureProductionRuntime();
    expect(JSON.parse(process.env.DHEE_NODE_MODULES_DIRS!)).toContain(win);
  } finally {
    if (before === undefined) delete process.env.DHEE_NODE_MODULES_DIRS;
    else process.env.DHEE_NODE_MODULES_DIRS = before;
  }
});
