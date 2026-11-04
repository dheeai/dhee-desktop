import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ProductionReviewPreview } from './ProductionReviewPreview';
import type {
  ProductionReviewRequest,
  ProductionReviewState,
} from '../../../shared/productionReview';
import styles from './ProductionReviewPanel.module.scss';

const labels: Record<ProductionReviewState['status'], string> = {
  approved: 'Approved for these versions',
  'changes-requested': 'Changes requested',
  unreviewed: 'Not reviewed',
  stale: 'Approval out of date — review again',
  unavailable: 'Review unavailable',
};
function Decision({
  request,
  ready,
  title,
}: {
  request: ProductionReviewRequest;
  ready: boolean;
  title: string;
}) {
  const notesId = useId();
  const acknowledgementId = useId();
  const [acknowledged, setAcknowledged] = useState(false);
  const [loaded, setLoaded] = useState<Record<string, boolean>>({});
  const onLoaded = useCallback(
    (key: string, value: boolean) =>
      setLoaded((prior) => ({ ...prior, [key]: value })),
    [],
  );
  const [review, setReview] = useState<ProductionReviewState>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState('');
  const [refresh, setRefresh] = useState(0);
  const active = useRef(false);
  const saving = useRef(false);
  useEffect(() => {
    let cancelled = false;
    active.current = true;
    setAcknowledged(false);
    setLoaded({});
    setBusy(true);
    setReview(undefined);
    setError('');
    const load = async () => {
      try {
        if (!window.dhee?.readProductionReview)
          throw new Error(
            'Saved reviews are unavailable in this Desktop build.',
          );
        const result = await window.dhee.readProductionReview(request);
        if (cancelled) return;
        if (!result.ok) throw new Error(result.error);
        setReview(result.review);
        setNotes(result.review.notes ?? '');
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setBusy(false);
      }
    };
    load();
    return () => {
      cancelled = true;
      active.current = false;
    };
  }, [request, refresh]);
  const save = async (decision: 'approved' | 'changes-requested') => {
    if (
      saving.current ||
      busy ||
      !review?.fingerprint ||
      (decision === 'approved' &&
        ((!ready && !review?.authoritative) ||
          !acknowledged ||
          !review.previews?.length ||
          !review.previews.every((p) => loaded[p.key])))
    )
      return;
    saving.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await window.dhee.recordProductionReview({
        ...request,
        expectedFingerprint: review.fingerprint,
        decision,
        notes,
      });
      if (!active.current) return;
      if (!result.ok) throw new Error(result.error);
      setReview(result.review);
    } catch (e) {
      if (active.current) {
        setError(e instanceof Error ? e.message : String(e));
        setReview(undefined);
      }
    } finally {
      saving.current = false;
      if (active.current) setBusy(false);
    }
  };
  return (
    <div className={styles.decision} aria-label={`${title} decision`}>
      <p aria-live="polite">
        {busy ? 'Checking review…' : review && labels[review.status]}
      </p>
      {review?.reason ? <p>{review.reason}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {review?.previews?.length ? (
        <details open>
          <summary>
            Review exact artifact previews ({review.previews.length})
          </summary>
          {review.previews.map((preview) => (
            <ProductionReviewPreview
              key={preview.previewPath + preview.key}
              projectDir={request.projectDir}
              preview={preview}
              relatedPreviews={review.previews}
              onLoaded={onLoaded}
            />
          ))}
        </details>
      ) : null}
      <label htmlFor={acknowledgementId}>
        <input
          id={acknowledgementId}
          type="checkbox"
          checked={acknowledged}
          disabled={
            busy ||
            !review?.previews?.length ||
            !review.previews.every((p) => loaded[p.key])
          }
          onChange={(event) => setAcknowledged(event.target.checked)}
        />
        I reviewed these exact previews, including playback and audio where
        present.
      </label>
      <label htmlFor={notesId}>
        Review notes for {title}
        <textarea
          id={notesId}
          value={notes}
          maxLength={4000}
          disabled={busy}
          onChange={(event) => setNotes(event.target.value)}
        />
      </label>
      <div className={styles.actions}>
        <button
          type="button"
          disabled={
            busy ||
            (!ready && !review?.authoritative) ||
            !review?.fingerprint ||
            !acknowledged ||
            !review.previews?.length ||
            !review.previews.every((p) => loaded[p.key])
          }
          onClick={() => save('approved')}
        >
          Record approval
        </button>
        <button
          type="button"
          disabled={busy || !review?.fingerprint}
          onClick={() => save('changes-requested')}
        >
          Request changes
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => setRefresh((n) => n + 1)}
        >
          Refresh review
        </button>
      </div>
      <small>
        Saved for these artifacts. The project review policy controls when runs
        pause.
      </small>
    </div>
  );
}
export function ProductionReviewDecision({
  request,
  revision,
  ready,
  title,
}: {
  request: ProductionReviewRequest;
  revision: string;
  ready: boolean;
  title: string;
}) {
  const serialized = JSON.stringify(request);
  const stableRequest = useMemo(
    () => JSON.parse(serialized) as ProductionReviewRequest,
    [serialized],
  );
  return (
    <Decision
      key={`${serialized}:${revision}`}
      request={stableRequest}
      ready={ready}
      title={title}
    />
  );
}
export default ProductionReviewDecision;
