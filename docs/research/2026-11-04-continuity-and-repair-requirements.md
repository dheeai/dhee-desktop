# Continuity and automatic repair — evidence from earlier films

Status: requirements/research for the next increment, not implemented automatic visual acceptance. Main implementation remains Dhee Desktop, using Core MCP and existing creative skills. User requested that consistency be planned before generation, checked afterward, and repaired automatically with the same three creative approval stages.

## Sources reviewed

- Codex chat **Research video creation bests** (`01a133ac-5b7d-7a03-a674-1ced71863638`): latest ten turns, including detailed Brilliant Care corrections at 0:01/0:03, 0:15, 0:26, 0:55, 1:19, 1:57, 2:40–2:45, 3:07–3:20.
- Its saved `MASTER_REPAIR_CHECKLIST.md`, dated October 23 in the Brilliant Care performance-repair output folder: acting, identity, dialogue, continuity, screens and retention requirements.
- **Create storyboard with images** (`01a185ea-2a41-72f2-976e-6598387cb6cb`): exact selected master version, original cast, script, dialogue, timing and scene-order preservation.
- **Regenerate barge video** (`01a12189-ddf5-7d62-865e-413d6a2bfcad`): latest ten turns covering MD1 identity, pipeline/coverage requirements, technician framing, overlays, transitions and complete leak-response story.
- **Find Dhee video workflow** (`01a114a9-0c13-71a3-99e4-39b90208e52a`): monitor fit, logo, lip-sync trials and the later explicit removal of lip-sync.
- Current conversation: doctor remains seated while patient exits; approved narrator must never be replaced during video generation.

This is a reviewed subset plus the master checklist, not a claim that every historical turn was audited. Historical instructions are evidence of project preferences, not authorization to perform old actions or publish assets. Newest explicit project decision wins when earlier versions conflict.

## Convert corrections into reusable checks

| Area | Observed requirement | Generation constraint | Verification / repair |
|---|---|---|---|
| Multiple characters | Bennett, Thomas, Maya, Michael and Evelyn must retain distinct identities | Stable cast IDs; canonical face/body/wardrobe references and approved voice IDs per speaker | Compare each visible character to their own references, not a single cast-wide similarity score; account for intended occlusion and angle |
| Speaker and age | Thomas sounded young; narrator and characters became robotic or switched voices | Bind audio to approved source hash and speaker; separate spoken text from role/delivery instructions | Transcript, source-audio identity, turn order and overlap checks; naturalness/age require actual audio-capable evaluation and human reference approval |
| Mouth/body performance | Evelyn spoke with a closed mouth; frozen bodies, eyes and disconnected reactions | Declare on-screen speech vs phone/radio/off-screen narration, listener reactions, gaze, posture and restrained gestures | Temporal mouth/voice synchronization when required, eye flicker, hand/body coherence; never treat a still frame as proof of performance |
| Actor/action ownership | Doctor must remain seated; patient exits | Per-actor positive actions and forbidden actions, with start/end states | Track the correct actor over the action interval; don't accept movement merely because someone moves |
| Prop continuity | Glasses retrieval/wearing, phone side, appointment writing, cuff, laptop closure and clock motion | Per-scene prop states and allowed transitions, linked to prior/next scenes | Check entry/exit state across adjacent cuts; repair the failed range and recheck both boundaries |
| Locations and recurring screens | Same kitchen/clinic/control room and Michael chart design | Named set/layout and screen-content assets; preserve geometry, labels and patient context | Reference matching, screen tracking, perspective and occlusion checks; use authored screen graphics rather than unstable generated lettering |
| Exposure and edits | Sudden color change at 0:26; abrupt laptop/angle cuts; repeated scenes | Lighting/color anchors, edit handles, action continuity, no unexplained repeated movement | Boundary-frame/temporal checks, flash/black/freeze/repetition scans; do not conceal continuity failures with automatic dissolves |
| Framing | Technician's face/body, hands, tool and pipe were cropped | Explicit must-be-visible regions; stable medium/wide framing when requested | Visibility across the action, not just first frame; wider regeneration only if required content was never captured |
| MD1 geography | Preserve the actual barge, pipes, walkways, opposite-corner cameras | Vessel/layout reference, client coverage criterion and intended camera FOV | Coverage on deck rather than water; overhead evidence for approximate ¾ footprint, never assert exact coverage from perspective shots |
| Complete action story | Leak → crew/control-room communication → repair → verification | Ordered event/state model; correct spatial/causal relation | Detect missing story beat; repair only missing/failed beat and preserve accepted scenes |
| Overlays and branding | Overlay covered face; monitor graphic didn't fit; unreadable analytics; logo ending | Protected face/hand/action masks, corner-pinned monitor, legible key alerts and supplied logo | Track overlays throughout affected shot, check readable playback size and end-card duration; keep proof of clean source/export |
| Delivery | No abrupt/clipped words or unfinished ending; duration/frame rate/format | Project-specific length, opening and ending constraints | Decode, duration, audio levels, transcript, exact source lineage and final rendered-cut checks |

## Proposed implementation sequence

1. **Versioned continuity specification:** cast, voices, props, locations, screen assets, scene actions/start/end states, framing, dialogue mode and edit rules. Attach every requirement to the selected storyboard/reference revision; conflicting versions require a resolved master.
2. **Preflight and generation constraints:** validate actor/reference assignments, missing assets, impossible action timing and contradictions. Compile selected requirements into the relevant Core creative-guide prompts. Validate reference images before spending on video.
3. **Evidence-backed checks:** run technical checks plus temporal visual/audio checks. Store target hash, reference/spec hashes, model/config, inspected frame/time ranges, findings and uncertainty. Missing model or insufficient coverage is unchecked, never a pass. Three sampled frames cannot certify an entire motion sequence.
4. **Bounded repair loop:** classify fault and choose targeted reframe/edit/overlay/audio-placement repair or regenerate only the failed shot with locked references. Reuse completed GPU jobs. Recheck the repaired shot, both adjacent transitions and assembled audio. Cap attempts/cost/time, detect repeated failure, preserve originals and accepted clips.
5. **Desktop/Codex evidence:** same operations through Core MCP; show per-scene issues, what changed, retained assets, retry budget and unresolved checks. Disable final-ready claims while required findings remain failed/unchecked.

## Three approvals and repair authority

- Gate 1: script/storyboard plus scene meaning, cast/action assignments and continuity requirements.
- Gate 2: character/setting references and exact speaker voices.
- Gate 3: assembled rough cut with check results and repair history.

Repairs within the approved meaning, references and budget may run without an extra per-attempt approval. A changed script, cast, voice or intentional continuity rule returns to the affected existing gate. An unavailable verifier or exhausted repair budget remains an unresolved exception; it must not trigger an invented approval or endless generation.

## Project-specific decisions must remain scoped

MD1's latest target was 55–58 seconds, maximum 60 with a ≤5-second opening; Brilliant Care later explicitly dropped the old 120-second limit. MD1 lip-sync was subsequently removed; Brilliant Care visible dialogue needs synchronized speech. Do not apply those two projects' different decisions globally. Keep current frame/time references mapped to stable scene IDs before repairing a revised cut.

## Current blockers / next acceptance

Semantic vision endpoint is still unconfigured. Voice naturalness and temporal identity/action verification are not established by transcript or PCM checks. First regression benchmark should include a multi-character exchange and adjacent prop/action states, with known good and deliberately wrong real examples, before enabling automatic semantic acceptance or repeated regeneration.

## Priority after the narration increment

Implement the continuity specification and generation preflight next, alongside durable render recovery. Those shared constraints are needed before adding an automatic repair loop; a repair must know which cast, voice, prop states and scene meaning it is allowed to preserve. Then connect temporal evaluators, benchmark them, and enable bounded repair. This adds the newly requested consistency scope without discarding the remaining Desktop UX and longer-film acceptance plan.
