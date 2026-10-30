import type {
  ReviewCheckpoint,
  ReviewItemStatus,
} from '../../lib/runCockpit/productionReview';
import styles from './ProductionReviewPanel.module.scss';

const itemLabels: Record<ReviewItemStatus, string> = {
  ready: 'Available',
  missing: 'Not available yet',
  running: 'Generating',
  failed: 'Failed — repair needed',
  stale: 'Stale — regenerate',
  unconfigured: 'Not configured',
};
const checkpointLabels = {
  ready: 'Assets ready to review',
  attention: 'Needs attention',
  incomplete: 'Inputs incomplete',
};
export function ProductionReviewPanel({
  checkpoints,
  onNavigate,
}: {
  checkpoints: ReviewCheckpoint[];
  onNavigate: (sectionId: string) => void;
}) {
  if (!checkpoints.length) return null;
  return (
    <section className={styles.root} aria-label="Creative review readiness">
      <h2>Three creative reviews</h2>
      <p>
        Check the story, references and rough cut before moving forward.
        Availability is shown here; approval decisions are not yet recorded.
      </p>
      <ol className={styles.cards}>
        {checkpoints.map((checkpoint) => (
          <li key={checkpoint.id} className={styles.card}>
            <h3>{checkpoint.title}</h3>
            <p className={styles.status} data-status={checkpoint.status}>
              {checkpointLabels[checkpoint.status]}
            </p>
            <ul>
              {checkpoint.items.map((item) => (
                <li key={item.id}>
                  {item.sectionId ? (
                    <button
                      type="button"
                      onClick={() => onNavigate(item.sectionId!)}
                    >
                      {item.label}
                    </button>
                  ) : (
                    <span>{item.label}</span>
                  )}
                  <small>{itemLabels[item.status]}</small>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
      <p className={styles.note}>
        Scene continuity, dialogue accuracy, voice consistency and final
        audio/video quality still need review.
      </p>
    </section>
  );
}

export default ProductionReviewPanel;
