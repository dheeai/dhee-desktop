# H3 prompt profile verification — 2026-11-04

Implemented locally in Desktop on `feat/rtx-5090-queue`; Core unchanged. Nothing newly pushed; no PR.

The optional `h3-six-section` generation profile uses the six-section format from the earlier real bottle-film test. It compiles structured scene location, camera, framing, actor movements, stationary constraints and property states. Picture/audio tokens are derived from actual ordered workflow inputs. Wrong modality, labels, slot names, durations or workflow configuration are refused. Generic prompt mode remains the default.

Only visible dialogue includes quoted spoken text, its owning character, audio reference and lip-sync interval. Narration, off-screen, phone and radio speech text is omitted from synthesis instructions and retained for approved-audio assembly. On-screen voice references guide generation; they do not certify exact voice preservation.

## Evidence

Tests observed failing before formatter and compiler integration. Code review caught an unnecessary phone/radio generation-input requirement; two regressions failed before the fix and pass afterward. Generic requirements remain unchanged.

Actual Core MCP accepted the generated six-section preparation request against available RTX `h3_video_final`, version `ed4e55a5e30f`, using real existing bottle references. Repeating it returned the same selection ID. A changed reference was rejected as stale, and original bytes were restored. The generated prompt has all six sections, correctly ordered Picture labels and no narration sentence. Three creative gates remained required; only earlier approvals for byte-identical material snapshots were reused. The target remains pending. No new GPU job or rendered clip.

Evidence/scripts are in the task's work/h3-acceptance; exported prompt and verification are in outputs/Dhee-H3-Prompt-Profile.

Final checks: 204 Desktop suites / 1,784 tests passed. Production build, Desktop typecheck, touched lint and integration audit passed; lint retained only the existing old Browserslist-data warning. Fresh review confirmed the phone/radio fix with no remaining scoped blockers.

## Limits and next work

This proves prompt construction and preparation acceptance, not rendered multi-character identity, natural movement, timing or lip-sync. The integration fixture is a static technical continuity plan using bottle-film materials; it is not a replacement for the original approved action prompt. Do not submit it as a new film without the intended complete scene plan. Use an approved multi-character scene for the next output benchmark. Temporal semantic review service configuration and bounded repair orchestration remain unfinished.
