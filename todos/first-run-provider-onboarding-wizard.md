# First-Run Provider Onboarding Wizard

## Problem

Open the desktop app fresh. Click "New project." The first thing the
user has to know — but the app does not tell them — is that they need
either:

- a running ComfyUI instance (local GPU + model checkpoints + workflow
  exports) for image/video generation, **or**
- a cloud ComfyUI URL (`COMFY_MODE=cloud` / zrok tunnel), **and**
- an LLM provider configured: LM Studio (local), Gemini, OpenAI, xAI,
  or OpenRouter.

If none of those is configured, the user clicks "New project," types
their idea, and waits. The pipeline stalls on the first generation
call. There is no error splash that says "you need to configure a
provider before you can generate." There is just a stuck job.

This is the single largest first-run friction we have. Every potential
buyer who installs Kshana and doesn't already use ComfyUI quits in the
first 10 minutes.

## Evidence

- README *"Prerequisites"*: Node.js 20+, npm, sibling `kshana-core`,
  ComfyUI, LM Studio / Gemini / OpenAI credentials. The README knows
  this. The app does not.
- `src/renderer/components/SettingsPanel/SettingsPanel.tsx` — Settings
  exists, but it's reactive (you go there because something is wrong),
  not guided.
- `src/main/utils/comfyUrl.ts` — has helpers for ComfyUI URL parsing
  and the `cloud` vs URL choice. None of this is shown on first run.
- `src/renderer/components/landing/LandingScreen/LandingScreen.tsx` —
  the landing screen shows recent projects + "New project" + Settings.
  No detection of provider readiness.

## Done means

- On first launch (no recent projects, no provider config), the
  landing screen redirects to a guided wizard before "New project" is
  enabled.
- Wizard probes: is ComfyUI reachable? Is an LLM provider configured?
  For each missing piece, show actionable copy:
  - "Kshana generates images and videos through ComfyUI. Pick one:
    [Connect to running local ComfyUI] [Use cloud ComfyUI URL] [Skip
    for now and use Gemini-only mode]."
  - "Kshana writes screenplays through an LLM. Pick one: [LM Studio
    on this machine] [Gemini API] [OpenAI-compatible URL] [xAI Grok]
    [OpenRouter]."
- Each pick has a one-line "what this costs" hint
  (e.g. "Free if you have a GPU. Configure ComfyUI here…" /
  "~$0.05 per project on Gemini Flash.").
- Failure to reach the configured provider triggers a banner on the
  landing screen with a "Reconfigure" button — not silent stall on
  job submission.
- Settings panel gains a "Test all providers" button that runs the
  same probes and shows green/red per capability.

## Out of scope

- Auto-installing ComfyUI / LM Studio / model checkpoints. We point
  users to docs; we don't bundle the GPU stack.
- Building a hosted-LLM signup flow. We accept API keys; we don't
  resell.

## Effort

Medium — ~1 week. The probes are simple HTTP calls; most of the cost
is wizard UX and copy.
