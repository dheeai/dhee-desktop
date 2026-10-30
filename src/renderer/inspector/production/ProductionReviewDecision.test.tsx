/* eslint-disable compat/compat -- Electron supports native Promise. */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ProductionReviewDecision } from './ProductionReviewDecision';

const request = {
  projectDir: '/one',
  gate: 'storyboard' as const,
  targets: [{ nodeId: 'story' }],
};
const previews = [
  {
    key: 'story',
    versionId: 'v1',
    previewPath: '.dhee/review-previews/old.png',
    format: 'image',
  },
];
const read = jest.fn<any>();
const record = jest.fn<any>();
beforeEach(() => {
  read.mockReset().mockResolvedValue({
    ok: true,
    review: { status: 'unreviewed', fingerprint: 'current', previews },
  });
  record.mockReset().mockResolvedValue({
    ok: true,
    review: { status: 'approved', fingerprint: 'current', previews },
  });
  Object.defineProperty(window, 'dhee', {
    configurable: true,
    value: { readProductionReview: read, recordProductionReview: record },
  });
});
describe('saved review controls', () => {
  it('saves the displayed fingerprint only after an explicit click', async () => {
    render(
      <ProductionReviewDecision
        request={request}
        revision="1"
        ready
        title="Script & storyboard"
      />,
    );
    await screen.findByText('Not reviewed');
    expect(record).not.toHaveBeenCalled();
    fireEvent.load(await screen.findByAltText('story (v1)'));
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Record approval' }));
    await screen.findByText('Approved for these versions');
    expect(record).toHaveBeenCalledWith({
      ...request,
      expectedFingerprint: 'current',
      decision: 'approved',
      notes: '',
    });
  });
  it('disables approval for incomplete criteria', async () => {
    render(
      <ProductionReviewDecision
        request={request}
        revision="1"
        ready={false}
        title="Script & storyboard"
      />,
    );
    await screen.findByText('Not reviewed');
    expect(
      (
        screen.getByRole('button', {
          name: 'Record approval',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });
  it('surfaces stale saves and requires a refresh', async () => {
    record.mockResolvedValue({
      ok: false,
      error: 'Artifacts changed. Refresh.',
    });
    render(
      <ProductionReviewDecision
        request={request}
        revision="1"
        ready
        title="Script & storyboard"
      />,
    );
    await screen.findByText('Not reviewed');
    fireEvent.load(await screen.findByAltText('story (v1)'));
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Record approval' }));
    await screen.findByRole('alert');
    expect(
      (
        screen.getByRole('button', {
          name: 'Record approval',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    read.mockResolvedValue({
      ok: true,
      review: {
        status: 'stale',
        fingerprint: 'new',
        previews: [
          { ...previews[0], previewPath: '.dhee/review-previews/new.png' },
        ],
      },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh review' }));
    await waitFor(() =>
      expect(screen.getByAltText('story (v1)').getAttribute('src')).toContain(
        'new.png',
      ),
    );
    expect(
      (
        screen.getByRole('button', {
          name: 'Record approval',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    fireEvent.load(screen.getByAltText('story (v1)'));
    fireEvent.click(screen.getByRole('checkbox'));
    await waitFor(() =>
      expect(
        (
          screen.getByRole('button', {
            name: 'Record approval',
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false),
    );
  });
  it('ignores responses from the previous project', async () => {
    let resolveOld: (v: any) => void = () => {};
    read.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    );
    const { rerender } = render(
      <ProductionReviewDecision
        request={request}
        revision="1"
        ready
        title="Script & storyboard"
      />,
    );
    rerender(
      <ProductionReviewDecision
        request={{ ...request, projectDir: '/two' }}
        revision="1"
        ready
        title="Script & storyboard"
      />,
    );
    await screen.findByText('Not reviewed');
    resolveOld({
      ok: true,
      review: { status: 'approved', fingerprint: 'old' },
    });
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('Approved for these versions')).toBeNull();
  });
  it('keeps approval disabled when an exact preview cannot load', async () => {
    render(
      <ProductionReviewDecision
        request={request}
        revision="1"
        ready
        title="Script & storyboard"
      />,
    );
    fireEvent.error(await screen.findByAltText('story (v1)'));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect((screen.getByRole('checkbox') as HTMLInputElement).disabled).toBe(
      true,
    );
    expect(
      (
        screen.getByRole('button', {
          name: 'Record approval',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(record).not.toHaveBeenCalled();
  });
});
