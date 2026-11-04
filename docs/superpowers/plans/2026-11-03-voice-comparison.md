# Voice comparison in the existing editor

Continue the approved storyboard/voice/editing UX plan. Retain current app layout, Core operations and three creative gates. This increment is local only.

- Add a VoiceTakeComparison view for current voice, optional unsaved replacement and inspected saved voice. Keep current voice visible when a replacement is picked. Show source filename and hash/version details, with no inferred approval status. Existing read/pick operations supply all data; no new API.
- One take plays at a time within the comparison. Stop playback when compared sources change or the view unmounts. Show load failures per take and clear failures for a changed source.
- Reuse existing Preview change/Save and Preview restore/Restore controls. Listening neither selects a version nor grants approval. Keep existing accessible audio labels for callers/tests.
- Tests first: current/candidate/saved identity, exclusive playback, stale/unmounted playback, media failure recovery; parent integration verifies current retained after picking replacement. Verify full tests/types/build and actual Electron with real saved Brilliant Care audio; no generation, replacement or creative approval required for browsing/comparing. Record exact scope.

## Local result

Implemented current/candidate/saved comparison, source identity details, individual load errors and exclusive playback. Current voice remains visible after replacement selection; previous comparison audio stops when sources change or the view unmounts. Existing save/restore and creative approvals unchanged. Integration regression failed for the missing retained-current player before implementation, then passed.

198 suites / 1,693 Desktop tests pass; typecheck, new component/test lint and renderer build pass. No Core change for this increment.

Actual Electron test: the older editing fixture was unusable (missing current input and unresolved user bundle), so created a fresh minimal voice-review fixture through local Core MCP with real original and revised Brilliant Care auditions. Imported original, then used preview/write to preserve it as a saved version and make revised audition current inside that isolated test. No generation or creative approval. Compared current 1.486077s and saved 1.532517s files via real media playback (muted), confirmed the first pauses when the second starts, and project current-file/event-log hashes remain unchanged during comparison. Replacement-candidate retention is covered by unit integration tests, not a native-picker acceptance claim. Screenshot and JSON report in outputs. All local; no push.
