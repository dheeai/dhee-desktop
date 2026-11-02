export function SceneIntentSummary({ value }: { value?: unknown }) {
  const contract = value as
    | {
        requirements?: { id: string; description: string; expected: string }[];
        sources?: { id: string; evidence: string }[];
      }
    | undefined;
  if (value === undefined)
    return (
      <p>
        Scene intent has not been checked for this attempt. Review actor roles,
        reference images and motion before generation.
      </p>
    );
  if (
    !contract ||
    !Array.isArray(contract.requirements) ||
    !Array.isArray(contract.sources) ||
    !contract.requirements.every(
      (r) =>
        r &&
        typeof r.id === 'string' &&
        typeof r.description === 'string' &&
        typeof r.expected === 'string',
    ) ||
    !contract.sources.every(
      (r) => r && typeof r.id === 'string' && typeof r.evidence === 'string',
    )
  )
    return (
      <p role="alert">
        Saved scene intent is invalid. Repair the contract before using this
        attempt.
      </p>
    );
  return (
    <details>
      <summary>Scene intent and reference evidence</summary>
      <p>
        These are recorded observations, not automatic image understanding or
        creative approval. Changed inputs must be reviewed again; conflicts
        block checked attempts.
      </p>
      <ul>
        {contract.requirements.map((r) => (
          <li key={r.id}>
            {r.description}: {r.expected}
          </li>
        ))}
      </ul>
      <ul>
        {contract.sources.map((s) => (
          <li key={s.id}>
            {s.id}: {s.evidence}
          </li>
        ))}
      </ul>
    </details>
  );
}
export default SceneIntentSummary;
SceneIntentSummary.defaultProps = { value: undefined };
