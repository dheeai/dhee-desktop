# Dhee Studio — Unifying the Desktop Design Language

> Goal: every surface of the desktop app (landing, New Project, Settings, the
> guided setup, chat, graph/inspector, timeline, status strip) speaks ONE
> visual language — one token contract, one primitive library, one brand
> character. Today it speaks five.

---

## 0. What the audit found (the fragmentation)

Three tiers of divergence, worst first:

| Tier | Surfaces | Problem |
|---|---|---|
| **1 — off the system** | New Project ("Production Slate"), graph `InstanceCard` | Own `--slate-*` vars / hardcoded hex (`#161821`, `#e5e1d8`, `#e8a33d`, `#f2c97a`). Not themeable. Fraunces display, 3px radii, amber accent — a whole second language. |
| **2 — on tokens, off the scale** | FirstRunSetup, BundleConfigurator, QuickstartTab, parts of chat | Use `--color-*` but literal px for spacing/radius, Instrument-Serif headlines, bespoke buttons/inputs. |
| **3 — tokenized, no shared primitives** | SettingsPanel (most correct), chat, InspectorCanvas | Use tokens + `mixins.scss`, but **no `ui/` component library** — each reinvents Button/Input/Card/Badge with subtly different padding/radius. |

Root causes:
1. **No shared primitive layer.** `mixins.scss` has `button-primary/secondary/ghost`, `panel-base`, `focus-ring` — but they're SCSS mixins, optional, and newer surfaces ignore them. There are **zero shared React components** (`src/renderer/components` has no `ui/`).
2. **No enforced token discipline.** Nothing stops a component from hardcoding `#161821` or `padding: 11px 22px`.
3. **No decided brand character.** Two display faces (Fraunces vs Instrument Serif), two accents (amber vs blue), two radius rhythms (3–4px vs 6/10/14) coexist with no rule for which wins where.

---

## 1. The target: one language = contract + kit + character

**(A) One token contract** — `tokens.scss` + `global.scss` are the single source of truth. Every color, space, radius, font, shadow, duration comes from a token. No raw hex, no literal px for spacing/radius in any component. (Tokens are already good; they need a few additions + total adoption.)

**(B) One primitive library** — a new `src/renderer/components/ui/` of React primitives every surface imports instead of rolling its own. This is the missing layer that makes "one language" enforceable rather than aspirational.

**(C) One brand character** — a decided position on display typeface, accent, warmth, radius rhythm, and which signature devices (grain, rec-dot, dividers) are part of the system. (See §4 — needs your call.)

**(D) One contract doc** — `docs/design-language.md` codifying all of the above so new code conforms by default.

---

## 2. Token contract (additions to finalize)

The existing scale stays (`--color-bg-*`, `--color-text-*`, `--color-accent-*`, `$spacing-*` 4→48, `$radius-*` 6→18, `--shadow-*`, fonts, 5 themes). Add:

- **Status palette (net-new):** `--color-status-{completed,running,failed,invalidated,pending}` — today the graph hardcodes these (`#6d8f7a` etc.) and chat reuses warning/error ad hoc. One semantic set, used by graph nodes, chat run-state, status strip, diagnostics.
- **Display font var:** `--font-display: 'Instrument Serif'` (§4) so headings stop hardcoding `'Instrument Serif'` / `'Fraunces'`. Fraunces is removed.
- **Recording accent (net-new):** `--color-accent-recording` = the warm amber, used ONLY for live/recording/active (rec-dot, running run-state) — replaces inline `#e8a33d`. The primary accent stays the per-theme `--color-accent-primary`.
- **Warm cinematic default theme:** fold the Production-Slate warm near-black palette into `global.scss` as the default theme's `--color-bg-*`/`--color-text-*` values (themeable), so the cinematic surfaces are expressed as tokens, not `--slate-*`. The other themes remain.
- **Ambient texture tokens:** grain/vignette opacities as tokens so `GrainOverlay`/`Vignette` stay subtle + consistent.
- **Kill list:** every `--slate-*` var (NewProjectScreen) and every hardcoded hex in `inspector/nodes/InstanceCard.tsx` maps onto the contract.

---

## 3. The primitive library (`src/renderer/components/ui/`)

Each primitive is built on tokens + the existing mixins, replaces N bespoke copies, and ships with a story in the showcase (§5). Proposed set:

**Form & action**
- `Button` — variants `primary | secondary | ghost | danger`, sizes `sm | md`, `iconOnly`, `pill`. Replaces: SettingsPanel submit/cancel, FirstRunSetup `.primary/.ghost`, Quickstart `.saveButton/.guidedButton`, BundleConfigurator `.recheck/.swapBtn`, NewProject `.rollButton`, StatusStrip icon buttons, chat send/attach.
- `Input`, `Textarea`, `Select` — one padding/radius/focus-ring. Replaces ~6 bespoke field styles.
- `Field` (label + control + hint/error) — one label treatment.
- `SegmentedControl` — replaces SettingsPanel `.modeSwitch`, FirstRunSetup `.seg`, NewProject `.pill` group.

**Surface & layout**
- `Panel` / `Card` — `@include panel-base`; replaces every ad-hoc card.
- `Overlay` / `Modal` — one backdrop + frame (SettingsPanel modal, NewProject takeover, FirstRunSetup full-screen all share it).
- `Divider` — `default` (1px) and `cinematic` (double-line) variants.
- `SectionLabel` — the mono uppercase caption used everywhere ("THE STORY", group heads).

**Status & feedback**
- `StatusDot` + `StatusBadge` / `Chip` — one set driven by `--color-status-*`.
- `Spinner`.

**Signature (cinematic) — tokenized, reusable, opt-in**
- `GrainOverlay`, `Vignette` — the film-stock atmosphere as a component, not a NewProject one-off.
- `RecDot` — the pulsing "ready to roll/live" indicator.
- `DisplayHeading` / `RotatingHeadline` — the editorial headline (+ the rotating-noun animation) on `--font-display`.

> The point of the signature set: the most *distinctive* thing in the app (the Production-Slate cinematic identity) becomes reusable system vocabulary instead of being trapped in one screen — so unifying doesn't mean flattening to generic dark-SaaS.

---

## 4. Brand character — LOCKED (re-based on the Production Slate)

> Revised after review: the New Project "Production Slate" screen read as
> more polished than the first (restrained) synthesis, so the language is
> re-based directly on its recipe — full cinematic commitment.

1. **Direction: Cinematic studio = the Production Slate, app-wide.** Warm near-black film-stock surfaces (the `cinematic` default theme), full atmosphere.
2. **Display face: Fraunces** → `--font-display` (variable, optical sizing — New Project's headline face). Loaded app-wide in `index.ejs`; Instrument Serif kept as fallback + for the wordmark.
3. **Accent: warm amber `#e8a33d`** is the cinematic theme's primary accent (selection/focus/primary actions). **Recording/live is RED `#e84538`** (`--color-accent-recording`) — the rec-dot pulse — distinct from the amber accent (matches the Slate's amber-accent + red-rec split).
4. **Radius: tight / architectural** — `$radius-sm/md/lg` = 4 / 6 / 8 (clip 3, xl 12). Applies as the language across themes.
5. **Atmosphere: app-wide.** Film grain + vignette on the app root, gated by `--grain-opacity` / `--vignette-strength` (cinematic turns them up; pointer-events:none). Signature devices (rec-dot, double-divider, rotating headline) are `ui/` components.

Net character: **the Production Slate, everywhere** — warm film-stock surfaces, Fraunces display, amber accent + red rec, tight radii, ambient grain/vignette.

---

## 5. Align before migrating: a living showcase

Before touching 8 surfaces, build a **showcase / "kitchen sink"** that renders every token, every primitive, and each signature device in the chosen character — first as a static `design/design-language/index.html` (fast to iterate, like the onboarding prototype), then promoted to an in-app dev route (`?showcase=1`) so primitives are reviewed in the real renderer. This is the single artifact we sign off on; it becomes the regression reference.

---

## 6. Migration sequence (phased, lowest-risk first)

Each phase ends with `tsc --noEmit` clean + `jest` green + a visual diff against the showcase. Primitives are introduced once, then adopted.

- **P0 — Foundation.** Lock §4 decisions; finalize token additions (§2); write `docs/design-language.md`; build `ui/` primitives + signature components + the showcase (§5). No surface changes yet. *(De-risks everything; nothing else starts until the kit exists.)*
- **P1 — Prove the kit on the most-tokenized surfaces.** Migrate SettingsPanel, FirstRunSetup, BundleConfigurator, QuickstartTab to `ui/` primitives. These already use tokens, so it's mostly swapping bespoke buttons/inputs/cards for primitives — validates the API on friendly ground.
- **P2 — Re-theme the off-system surfaces (highest visual payoff).** New Project: drop `--slate-*`, express the cinematic look via theme tokens + signature components (keep the rotating headline + rec-dot as `ui/` pieces). Graph `InstanceCard`: hardcoded hex → `--color-status-*` + tokens; make it themeable.
- **P3 — Chat.** Adopt primitives where it rolls its own (composer buttons, question/option buttons, pills); keep the distinctive treatments (assistant left-rail, tool-call marginalia, phase banners) but tokenize their colors/spacing.
- **P4 — Finish the chrome.** StatusStrip, Timeline, Landing, ProjectCard onto primitives + status tokens.
- **P5 — Lock it in.** Add a stylelint rule banning raw hex + literal px for spacing/radius in `components/**/*.scss` (allow only `var(--*)` / `$tokens`), so the language can't silently re-fragment.

Rough size: P0 is the bulk of the design work; P1–P4 are mechanical swaps gated by tests; P5 is a guardrail.

---

## 7. Guardrails (so it doesn't re-fragment)

- `docs/design-language.md` as the contract (tokens, primitives, when to use the display face / signature devices).
- A stylelint rule: no raw hex, no literal px for spacing/radius/font-size outside `tokens.scss` (P5).
- PR checklist item: "new UI uses `ui/` primitives; no bespoke button/input/card."
- The showcase as the living reference + visual-regression anchor.

---

## 8. Open decisions blocking P0
The five in §4 (direction, display face, accent, radius, device reach). Once locked, P0 (tokens + `ui/` kit + showcase) can start; everything else is gated on the showcase sign-off.
