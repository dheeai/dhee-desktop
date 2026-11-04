# Reusable soundtrack integration

The Desktop extension now registers `audio.mix_soundtrack`. The film-specific mixing concept is available as a portable, hash-bound runner alongside the already shipped narration preparation and audio replacement/timing operations. It uses no machine paths, GPU credentials or film assets. Core is unchanged.

## Evidence

- Final local verification: 207 suites / 1,807 tests passed; production build, TypeScript, touched-file lint and Core integration audit passed.

- Thirteen focused behavioral tests cover unity dialogue gain, ducking/fades, source preservation, no-clobber output, stale hashes, clipping, weak speech margin, missing speech coverage, intentional silence, mismatched format, escaping paths, Core JSON/file plans, overlap, short beds and directory replacement. The directory-replacement regression failed before its fix and passed afterward.
- The real Return to Sender 60-second dialogue and existing music/effects bed were tested locally through the built runner. Dialogue mono samples were explicitly duplicated into stereo for compatible input, with no resampling. The existing bed already had artistic ducking, so this acceptance used bedGain=1 and duckGain=1; the synthetic behavioral test separately verifies new ducking. The output has 2,646,000 stereo PCM16 frames at 44.1 kHz, no clipped samples, peak 30,834 and minimum spoken-interval margin 27.08 dB. This is a technical derivative, not a replacement for the accepted film or a new creative approval.
- Real-file technical metadata and media remain local. No generation jobs were submitted.
- A Core MCP project-create test successfully imported the hashed real inputs. Its bare technical bundle was refused at project.run because it lacked narrative review gates. This is expected enforcement, not a successful end-to-end MCP render. The new runner must be declared in a properly gated production bundle; guards were not disabled.

## Remaining

Automatic semantic/lip-sync evaluation, reusable visual repairs, multi-track/effect creation, fresh-checkout and packaged-app acceptance remain separate work. The mixer checks per-interval aggregate RMS balance, not moment-by-moment intelligibility or artistic quality. Parent identity is rechecked before publication; this is not a guarantee against hostile filesystem changes in the final system-call race.
