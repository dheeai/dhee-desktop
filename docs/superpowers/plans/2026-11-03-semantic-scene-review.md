# Semantic scene review increment

Continue the approved production plan. Desktop owns review; Core only accepts the additional source-bound criteria. Work stays local until verified. Do not repeat GPU generation or infer human approval.

1. Add optional per-segment visualRequirements (1–10 nonempty strings, at most 500 characters each). Sample three chronological frames within each configured segment from the snapshotted final video. Review at most 20 segments/120 seconds, sequentially.
2. Add Desktop visualReview.ts: explicit OpenAI-compatible vision endpoint/model environment configuration, no cloud/default fallback. JSON observations must cover each requirement exactly once, with confidence and valid sampled-frame evidence. Contradictions with strong evidence fail; supported/uncertain findings remain review-only, never semantic certification. Bound network timeout/response size, reject redirects, propagate cancellation, sanitize transport errors.
3. Integrate observations into analyzer-v3 immutable reports. Core accepts the new criteria and rejects older analyzer reports. Missing model/endpoint or incomplete sampling remains unchecked. Display detailed findings through existing automatic-check UI.
4. Test wrong-actor contradiction, unknown/duplicate/missing IDs, invalid frame evidence, low confidence, unavailable service and integration without a configured model. Run relevant builds/typechecks/tests. Live acceptance must use the actual RTX vision service; the online generation catalog alone does not establish it.

Endpoint discovery: RTX generation MCP is online, exposes no semantic review workflow. API discovery on its advertised gateway returned HTTP 403. No vision endpoint has been verified; do not invent or probe service ports.

## Verification and review outcome

Desktop: 194 suites / 1,666 tests pass. Core: 1,783 pass, three known missing external bundle failures, one todo. Actual 14-second existing-clips MCP run passed technical assembly and approved-audio comparisons; semantic review correctly remained unchecked without a configured endpoint. Opening ASR remains uncertain; silence padding did not resolve it.

Fresh review identified the 64 KiB report-reader ceiling. Reproduced with a failing test, fixed through an internal-only 8 MiB read cap plus writer cap; 20 focused Core tests pass. Public preview cap remains unchanged.

Deferred: model/configuration-aware report freshness, mid-request timeout/cancellation and duplicate-frame-index test cases, compact findings UI, and live vision acceptance. Codex frame inspection supports seated-doctor staging but identifies patient-clothing discontinuity between shots. This is still an existing-clips test, not film acceptance. Changes remain local.

## Follow-up implementation

Resolved the three code follow-ups: endpoint/model-aware report freshness, explicit pending cancellation/deadline/duplicate-frame coverage, and expandable long findings. Regression tests reproduced stale-model reuse and missing evidence disclosure before fixes. Desktop full suite: 1,670 pass. Both typechecks, production extension build, Core dist build and targeted Desktop lint pass. The package-level Core build wrapper stalled before frontend build output and was stopped; the affected Core dist was built directly with tsup.

Fresh real 14-second existing-clips run through Core MCP produced the configuration fingerprint and passed duration, decoding, picture order and approved narration checks. Semantic service and uncertain transcript remain unchecked; rough-cut gate remains pending. No GPU jobs were submitted. Live model accuracy remains the external acceptance gap.

Final Core suite: 1,784 passed, three known missing external illustrated-story bundle failures, one todo. No new suite failures. All changes remain local/uncommitted.

## Opening-word investigation

Base.en float32 beam sizes 1/5/10 did not improve recognition. Explicit workspace-only small.en comparison reduced three opening differences to one (A vs and at 0–0.12s, .63–.64 confidence) on both source and final. Known Narrator-prefix audition still fails and corrected audition passes. All source hashes unchanged; no default model/config edits. Opening remains unchecked; this is diagnostic evidence, not human approval or new film acceptance.

## Targeted opening revision

User explicitly requested fixing the remaining opening issue. One RTX speech audition cloned the approved longer voice reference through Core MCP. Exact line recognized with zero differences by base.en and small.en; technical media check passes. Original audio unchanged. New 1.486-second candidate awaits human voice approval before any final-film replacement, then assembly checks must rerun.
