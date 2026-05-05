# Make Cloud Mode Evaluable End-to-End

## Problem

The desktop has full plumbing for cloud mode — auth-token parsing
(`desktopAuthToken.ts`), account/balance manager (`accountManager.ts`),
runtime-config loading from `assets/runtime-config.json`,
`serverConnectionManager` for cloud URLs — but the cloud backend the
desktop talks to is not in this repo and not in `kshana-ink` either.
A new evaluator (or a teammate) cannot exercise cloud mode end-to-end
without a release-configured URL, an account that has been provisioned
out of band, and a cloud GPU pool wired up somewhere we don't see.

This is the difference between "we have the client" and "we have a
product." Today: client only.

## Evidence

- `src/main/desktopAuthToken.ts` + `desktopAuthToken.test.ts` — token
  parsing and verification, fully implemented.
- `src/main/accountManager.ts` — `getAccount`, `setAccount`,
  `clearAccount`, `refreshBalance`. Stub-shaped, hits the website.
- `src/renderer/components/SettingsPanel/AccountTab.tsx` — UI for
  signed-in account + balance + sign-out.
- `src/main/main.ts` reads `assets/runtime-config.json` for
  `kshanaWebsiteUrl` / `websiteUrl`. The website is referenced
  but is not in this repo.
- README: *"Cloud connects to the configured cloud URL"* —
  i.e. trust the release config, hope the GPU is up.

## Done means

One of two paths:

**Path A — make cloud mode shippable:**
- Cloud backend exists, is reachable from a fresh install, and runs the
  full pipeline (story → screenplay → ... → assembled video) without
  the user having to configure ComfyUI locally.
- `runtime-config.json` defaults point at a working endpoint.
- A new account can be created, top up balance, and run a project
  end-to-end.
- Per-action cost is debited from the balance and reflected in the UI
  (depends on `cost-surfacing.md`).

**Path B — descope cloud mode for now:**
- Cloud-mode UI surfaces (mode toggle, account tab, balance,
  desktop-auth flow) hidden behind a build flag or settings flag.
- README and Settings copy clarify "Local mode only at present."
- Cloud-mode code stays compiled but inert — no unfinished UI shipping
  to users.

## Out of scope

- Building a new payments stack from scratch (covered by Path A but
  treated as a separate sub-todo if pursued).
- Choosing the cloud GPU provider (RunPod / Modal / Anthropic compute
  / etc.) — that's an upstream decision for the cloud backend, not
  desktop.

## Effort

Path B: ~1 day (feature flag + copy).
Path A: weeks-to-months (depends on existing cloud backend state).
