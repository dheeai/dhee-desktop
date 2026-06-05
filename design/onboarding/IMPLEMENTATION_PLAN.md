# Dhee Studio — First-Run Setup & Bundle Configuration: Implementation Plan

> Companion to the clickable prototype in `./index.html`.
> Grounded in the actual code of `dhee-core` and `dhee-desktop` (file paths cited inline).

---

## 0. The reframe that drives the whole design

The "match a workflow to your rig" step from the prototype is **not** an onboarding step. It is a
reusable subsystem — call it the **Bundle Configurator** — that reconciles *what a bundle needs*
against *what a given ComfyUI endpoint actually has* (models **and** custom nodes), and persists the
resolution. It has **three entry points** that share one core engine and one React surface:

| Entry point | When | What's being configured |
|---|---|---|
| **First-run setup** | brand-new install | a shipped bundle, on the user's first endpoint |
| **Community bundle install** | user imports a public bundle later | a freshly-installed bundle, on an existing endpoint |
| **Bring-your-own workflow** | user swaps in their own ComfyUI graph | a single workflow inside a bundle |

This is why caveats #1 and #2 are the same problem. "Configuring a bundle" = (a) does this endpoint
have the **models** the workflow references, (b) does it have the **custom nodes** the workflow
references, (c) if not, can we **download / install / remap** to close the gap, (d) for BYO, can we
**map the workflow's inputs** to the parameters the runner will feed it. Build it once, mount it three times.

```
                      ┌─────────────────────────────────────────────┐
   first-run ───┐     │            BundleConfigurator (UI)           │
   install   ───┼────▶│  models gap · custom-node gap · param map    │
   BYO wf    ───┘     │  download · install hint · remap · swap      │
                      └───────────────────┬─────────────────────────┘
                                          │ IPC: bundle:check / bundle:resolve
                      ┌───────────────────▼─────────────────────────┐
   dhee-core engine   │  checkBundle()  =  per-workflow:             │
   (pure, testable)   │    checkWorkflow()      ← models  (EXISTS)   │
                      │    checkWorkflowNodes() ← nodes   (NET-NEW)  │
                      │  + workflowAliases (name_aliases/class_swaps) │
                      │  + per-endpoint/per-bundle resolution stamp   │
                      └──────────────────────────────────────────────┘
```

---

## 1. What already exists vs. what's net-new

### Reusable as-is (no changes)
- **`ComfyUIClient`** — `src/services/comfyui/ComfyUIClient.ts`. Hits `/prompt`, `/object_info`,
  `/system_stats`, `/history`, `/view`, `/queue`, `/interrupt`, `/ws`. Has `getGpuVramTotalBytes()`.
  This is our probe + inventory source.
- **Model gap detection** — `src/dag/workflowVerify.ts`: `extractModelRefs()` + `checkWorkflow()`
  returning `{ workflow_refs, missing_refs, available_by_class }`. **Pure, no agent entanglement.**
- **Aliasing** — `src/dag/workflowAliases.ts`: `name_aliases` (model→model) **and** `class_swaps`
  (node-class→node-class, per-workflow/per-node, validated against `/object_info`). Persisted at
  `~/.dhee/workflow-aliases/<endpoint-slug>/aliases.json`.
- **Bundle discovery** — `src/dag/listBundles.ts` (searches `DHEE_USER_BUNDLES_DIR`,
  `DHEE_APP_BUNDLES_DIR`, `~/.kshana/bundles`, repo `src/dag/bundles`). `pickerEligible` gate.
- **Bundle resolution** — `src/dag/bundleSource.ts` (`built-in:` / `user:` / reserved `registry:`).
- **Desktop wiring** — `settings:update` (applies `Partial<AppSettings>` + restarts engine +
  rebroadcasts), `provider-diagnostics:run`, `account:sign-in`, `bundle:list`, `project:initialize`.
- **dheeCoreManager facade** — `ManagerModule` type + wrapper method + IPC handler + preload bridge
  is the established pattern for exposing a new core function to the renderer.

### Net-new (the actual work)
1. **Custom-node detection** in dhee-core (`checkWorkflowNodes()`) — *the missing half of caveat #1.*
2. **`checkBundle()` aggregator** — runs model + node checks across every workflow in a bundle.
3. **Bundle requirements manifest** (`requirements` block) + a **generator** that auto-derives it.
4. **Per-endpoint/per-bundle resolution stamp** so a configured bundle shows "✓ ready on this ComfyUI".
5. **Bundle install** (`installBundle()` from folder/zip/git into `DHEE_USER_BUNDLES_DIR`) — *caveat #2.*
6. **BYO-workflow import** (validate API-format JSON + map inputs) — *caveat #1, "their own workflow".*
7. Desktop: a **full-screen `FirstRunSetupFlow`**, a reusable **`<BundleConfigurator/>`**, a
   **ComfyUI programmatic-access helper**, and the IPC/manager glue for the above.

---

## 2. dhee-core changes (the engine of truth)

### 2a. Custom-node detection — `src/dag/workflowVerify.ts` (net-new)

`/object_info`'s **keys are the set of installed node classes.** A workflow node whose `class_type`
is not a key = a missing custom node (e.g. an LTX Director pack). Add alongside `checkWorkflow`:

```ts
export interface MissingNodeClass { nodeId: string; class_type: string; }

export function extractNodeClasses(wf: ComfyWorkflow): { nodeId: string; class_type: string }[] {
  return Object.entries(wf)
    .filter(([, n]) => n && typeof n === 'object' && 'class_type' in n)
    .map(([nodeId, n]) => ({ nodeId, class_type: (n as any).class_type }));
}

/** Pure: which of the workflow's class_types are absent from /object_info keys. */
export function findMissingNodeClasses(
  wf: ComfyWorkflow,
  objectInfoKeys: Set<string>,
  classSwaps?: Record<string, string>,        // nodeId -> swapped class (from aliases)
): MissingNodeClass[] {
  return extractNodeClasses(wf)
    .map(({ nodeId, class_type }) => ({ nodeId, class_type: classSwaps?.[nodeId] ?? class_type }))
    .filter(({ class_type }) => !objectInfoKeys.has(class_type));
}
```

Extend `CheckResult` → `missing_node_classes: MissingNodeClass[]` and fold it into `ok`. Reuse the
same `/object_info` payload `checkWorkflow` already fetches (one round-trip gives both model lists
*and* the class-key set). **One new pure function + a few fields. Fully unit-testable against a fixture
`/object_info` (no live Comfy).**

> ComfyUI has **no standard endpoint** that lists installed *packs* (ComfyUI-Manager adds its own,
> not guaranteed present). So detection = "class_type missing from `/object_info`"; the *remediation
> hint* (which pack, where to get it) comes from the curated `requirements` manifest in §2c.

### 2b. `checkBundle()` aggregator — `src/dag/checkBundle.ts` (net-new)

Lifts the thin logic from the `dheeCheckWorkflow` agent tool into a plain function the desktop can call:

```ts
export interface BundleFit {
  bundleId: string;
  endpoint: string;
  workflows: Array<{
    workflowKey: string;          // e.g. "workflows/ltx_director_local.json"
    missing_refs: WorkflowModelRef[];        // models
    missing_node_classes: MissingNodeClass[]; // custom nodes
    available_by_class: Record<string, string[]>; // for the remap dropdowns
  }>;
  modelsMissing: number;
  nodesMissing: number;
  status: 'ready' | 'fixable' | 'blocked';   // blocked = missing nodes with no swap candidate
}

export async function checkBundle(opts: {
  bundleDir: string;            // from resolveBundleDir(bundleSource)
  endpoint: string;
  fetchObjectInfo: (url: string) => Promise<ObjectInfo>;
}): Promise<BundleFit>;
```

It enumerates the bundle's `workflows/*.json`, applies the saved `name_aliases`/`class_swaps`, runs
`checkWorkflow` + `findMissingNodeClasses` per workflow, and rolls up a status. `available_by_class`
feeds the "use a model I have ▾" / "swap to a node I have ▾" dropdowns in the UI.

### 2c. Bundle requirements manifest — `bundle.json` `requirements` (net-new) + generator

Add an **optional** block to the `DagBundle` schema (`src/dag/schema.ts:242-316`). It is **curation
metadata** — download URLs, sizes, install hints — that the auto-checks can't infer:

```jsonc
"requirements": {
  "customNodes": [
    { "classType": "LTXVDirector", "pack": "ComfyUI-LTXVideo",
      "installVia": "manager",                       // or "git"
      "gitUrl": "https://github.com/Lightricks/ComfyUI-LTXVideo",
      "note": "LTX Director relay node" }
  ],
  "models": [
    { "classField": "UNETLoader.unet_name", "type": "unet",
      "canonicalFilename": "ltx-2.3-22b-distilled-1.1_transformer_only_fp8_scaled.safetensors",
      "downloadUrl": "https://huggingface.co/…", "sizeGb": 11, "optional": false },
    { "classField": "CLIPLoader.clip_name", "type": "clip",
      "canonicalFilename": "gemma_3_12B_it_heretic_fp8_e4m3fn.safetensors",
      "downloadUrl": "https://huggingface.co/…", "sizeGb": 7, "optional": false }
  ]
}
```

**Generator (dev tool, `scripts/gen-bundle-requirements.ts`):** runs every workflow in a bundle
through `extractModelRefs` + `extractNodeClasses` against a *reference* ComfyUI, emits a stub
`requirements` with the auto-derivable fields filled (classType, classField, canonicalFilename, type)
and `downloadUrl`/`sizeGb`/`installVia` as `TODO` for the author to curate. This keeps the manifest
honest (refs come from the real graph) while letting us add the human-only metadata.

> The Configurator works **without** the manifest (detection still functions); the manifest just
> upgrades a bare "missing: foo.safetensors" into "missing: FLUX dev (24 GB) → Download / Remap".

### 2d. Per-endpoint/per-bundle resolution stamp — `workflowAliases.ts` neighbor (net-new)

Today verification is ephemeral and aliases are per-endpoint only. Add a per-bundle stamp so the
picker can show "✓ configured for this ComfyUI" and we skip re-scanning on every launch:

```
~/.dhee/workflow-aliases/<endpoint-slug>/bundles/<bundleId>.json
  { "resolvedAt": <ts>, "status": "ready", "unresolved": [], "engineCompat": ">=0.1.0" }
```

`readBundleResolution(endpoint, bundleId)` / `writeBundleResolution(...)` next to the existing
`readAliases`/`writeAliases`. Invalidate when the bundle `version` changes.

### 2e. Bundle install — `src/dag/installBundle.ts` (net-new) — caveat #2

```ts
export async function installBundle(src:
  | { kind: 'folder'; path: string }
  | { kind: 'zip'; path: string }
  | { kind: 'git'; url: string; ref?: string }
): Promise<{ ok: true; bundleId: string; dir: string } | { ok: false; error: string }>;
```

Validates `bundle.json` (zod), checks `engineCompat`, confirms every `workflowPath`/`manifestPath`/
prompt-template referenced actually exists, then copies/unpacks/clones into `DHEE_USER_BUNDLES_DIR`
(first-seen-wins shadowing already supported by `listBundles`). On success the caller runs the **same
`checkBundle()`** the first-run flow runs — that's the co-design: install and first-run converge here.
(`registry:` source stays reserved; install-by-URL is the practical interim.)

### 2f. BYO workflow — `src/dag/importWorkflow.ts` (net-new) — caveat #1, "their own workflow"

Two things must hold for a user-supplied ComfyUI graph to run in Dhee:
1. **It must be API-format JSON** (the `*.manifest.json` declares `"format": "api"`). ComfyUI's normal
   *Save* exports **UI format** (node positions/links) which `/prompt` rejects. → see §5 hand-holding.
2. **Its inputs must be mapped** to the parameters the runner feeds (`prompt`, `seed`, `width`,
   `height`, `filenamePrefix`, …) — exactly the `parameterMappings` an existing `*.manifest.json`
   already encodes (e.g. `zimage_tti.manifest.json`).

```ts
export function validateApiWorkflow(json: unknown):
  { ok: true } | { ok: false; reason: 'ui_format' | 'invalid' };

export function suggestParameterMappings(wf: ComfyWorkflow):
  ParameterMapping[];   // heuristics: CLIPTextEncode.text→prompt, KSampler.seed→seed,
                        //             EmptyLatentImage.width/height→width/height, SaveImage→filenamePrefix
```

The Configurator's BYO mode: detect format (reject UI-format with the fix), run the model+node check,
then show an auto-suggested input→node/field mapping for the user to confirm. Output = the user's
workflow JSON + a generated manifest written into the bundle's `workflows/` dir, with the node's
`runner.config.workflowPath/manifestPath` repointed (or stored as a project-level override).

### 2g. Exports — `src/index.ts`
Export `checkBundle`, `findMissingNodeClasses`, `installBundle`, `validateApiWorkflow`,
`suggestParameterMappings`, the resolution-stamp helpers, and their types (the desktop imports core
via the `ManagerModule` cast — see §3).

---

## 3. Desktop main-process changes (IPC + manager facade)

Pattern (confirmed): `ipcMain.handle('channel', …)` in `src/main/main.ts` → wrapper on
`dheeCoreManager` (`src/main/dheeCoreManager.ts`, added to the `ManagerModule` type + a try/catch
method) → `contextBridge` namespace in `src/main/preload.ts` → `window.electron.<ns>.<fn>()`.

### New IPC channels

| Channel | Args | Returns | Core call |
|---|---|---|---|
| `comfy:probe` | `{ url }` | `{ ok, version, gpu, vramGb, modelCount }` | `ComfyUIClient.getGpuVramTotalBytes` + `/system_stats` + `/object_info` count |
| `bundle:check` | `{ bundleId, endpoint }` | `BundleFit` | `checkBundle()` |
| `bundle:resolve` | `{ endpoint, name_aliases?, class_swaps? }` | `{ ok }` | `writeAliases()` |
| `bundle:resolution` | `{ endpoint, bundleId }` | stamp \| null | `readBundleResolution()` |
| `bundle:install` | `BundleInstallSrc` | `{ ok, bundleId } \| { ok:false, error }` | `installBundle()` |
| `workflow:validate` | `{ json }` | `{ ok } \| { reason }` | `validateApiWorkflow()` |
| `workflow:suggest-map` | `{ json }` | `ParameterMapping[]` | `suggestParameterMappings()` |
| `setup:apply-recipe` | `{ recipe, fields }` | `AppSettings` | thin wrapper over `updateSettings()` (§6) |

`comfy:probe` and `bundle:check` are read-only and must **not** restart the engine (unlike
`settings:update`). Keep them off the settings path.

### dheeCoreManager methods (each optional-chained + try/catch, like `enableCloudUsageAnalytics`)
`probeComfy(url)`, `checkBundle(bundleId, endpoint)`, `resolveBundle(...)`, `getBundleResolution(...)`,
`installBundle(src)`, `validateWorkflow(json)`, `suggestWorkflowMap(json)`. All resolve core via the
existing dynamic `import('dhee-core/dag')` shape already used for `listBundles`/`initializeProject`.

### Reuse (no new code)
`settings:update` for every config write, `provider-diagnostics:run` for the LLM/VLM lights,
`account:sign-in`/`account:get` for the cloud path, `bundle:list` + `project:initialize` for the
picker + first project.

---

## 4. Desktop renderer changes (the flows)

### 4a. `FirstRunSetupFlow` — full-screen, gated in `App.tsx`
- New `src/renderer/contexts/FirstRunSetupFlowContext.tsx`: reads `onboarding:get-state`; exposes
  `isSetupFlowActive`, `recipe`, step state, `completeSetup()` (→ `onboarding:complete`).
- `src/renderer/App.tsx` `AppContent()` switch becomes:
  `isSetupFlowActive ? <FirstRunSetupFlow/> : projectDirectory ? <WorkspaceLayout/> : <LandingScreen/>`.
  This **replaces** the passive coachmark tour for first-run config (keep the tour only as an optional
  "show me around" afterwards). Gate identical to the current auto-start: not completed + no recent
  projects + no open project.
- Steps mirror the prototype: Recipe → Brain → Renderer → **Bundle Configurator** → Pre-flight → First
  project. Cloud recipe skips Renderer + Configurator (nothing local to match).
- Components: `src/renderer/components/FirstRunSetupFlow/` (`RecipeStep`, `BrainStep`, `RendererStep`,
  `PreflightStep`, `FirstProjectStep`), styled from `styles/global.scss` tokens (already what the
  prototype uses).

### 4b. `<BundleConfigurator/>` — the shared surface (the heart of the design)
`src/renderer/components/BundleConfigurator/BundleConfigurator.tsx`. Props:
`{ bundleId, endpoint, mode: 'firstrun' | 'install' | 'byo', onResolved }`. Internally:
- calls `bundle:check` → renders per-workflow rows with **two** gap groups: **models** (Download ↗ via
  `requirements.models[].downloadUrl`, or remap via `available_by_class`) and **custom nodes** (install
  hint via `requirements.customNodes[]`, or class-swap via `available_by_class`).
- writes fixes through `bundle:resolve`; re-checks; on green calls `bundle:resolution` write + `onResolved`.
- Mounted by **all three** entry points below. This is what makes caveats #1 and #2 one feature.

### 4c. ComfyUI programmatic-access helper — inside `RendererStep` (caveat #1 hand-holding)
An expandable "ComfyUI isn't connecting?" panel driven by the `comfy:probe` result (see §5 for content).

### 4d. Community bundle install entry (caveat #2) — reuses 4b
Add an **"Install a bundle"** action to `NewProjectScreen` (next to the picker) →
`src/renderer/components/BundleInstall/BundleInstall.tsx`: pick folder / zip / paste git URL →
`bundle:install` → on success mount `<BundleConfigurator mode="install" .../>` → refresh `bundle:list`.
**Same component, same checks** as first-run. (Co-designed by construction.)

### 4e. BYO workflow entry (caveat #1) — reuses 4b + adds param-map
In the workspace (per-node "use my own workflow") or in the Configurator: drop a `.json` →
`workflow:validate` (reject UI-format with the §5 fix) → `<BundleConfigurator mode="byo">` runs the
model/node check → `workflow:suggest-map` renders an input→node/field table to confirm → write the
workflow + generated manifest into the bundle.

---

## 5. ComfyUI programmatic-access guidance (exact content for §4c)

Most users run ComfyUI as a desktop window and don't realize **the running app already exposes the
HTTP API Dhee uses** — there's no separate "server" to start. The probe (`comfy:probe`) diagnoses and
the helper shows the matching fix:

- **Connection refused** → ComfyUI isn't running, or is bound to localhost on a different machine.
  - Same machine: start ComfyUI; default URL is `http://127.0.0.1:8188`.
  - Different machine / GPU box: relaunch with `--listen 0.0.0.0` (bind beyond localhost) and use
    `http://<that-host>:8188`. Add `--enable-cors-header '*'` if the browser blocks it.
- **Reachable but `/object_info` fails** → very old ComfyUI; prompt to update.
- **Reachable, models/nodes scanned** → green; hand off to the Bundle Configurator.
- **BYO workflow rejected as UI-format** → "Your file is a *UI* workflow. In ComfyUI: Settings → enable
  **Dev mode**, then **Save (API Format)** and re-import that file." (This is the single most common
  BYO failure — the API graph is structurally different from the saved UI graph.)

Show the OS-appropriate launch snippet and a copy button. Keep it diagnostic-driven (only show the fix
that matches the probe failure) rather than a wall of docs.

---

## 6. Recipe → `AppSettings` preset mapping

A recipe is just a `Partial<AppSettings>` applied via `settings:update` (which restarts the engine and
rebroadcasts). Fields confirmed in `src/shared/settingsTypes.ts`.

| Recipe | Patch |
|---|---|
| **Dhee Cloud** | `{ llmBackend:'cloud', comfyBackend:'cloud', vlmBackend:'cloud' }` (gated on `account:sign-in`) |
| **Hybrid** | `{ llmBackend:'cloud', comfyBackend:'local', comfyuiMode:'custom', comfyuiUrl:<probed> }` |
| **Local — OpenRouter** | `{ llmBackend:'local', llmProvider:'openrouter', openRouterApiKey, openRouterModel, comfyBackend:'local', comfyuiMode:'custom', comfyuiUrl }` |
| **Local — Gemini** | `{ llmBackend:'local', llmProvider:'gemini', googleApiKey, geminiModel, comfyBackend:'local', … }` |
| **Local — OpenAI** | `{ llmBackend:'local', llmProvider:'openai', openaiApiKey, openaiBaseUrl, openaiModel, … }` |
| **Local — LM Studio** | `{ llmBackend:'local', llmProvider:'lmstudio', lmStudioUrl, lmStudioModel, … }` |

The flow writes the recipe once at the end of the relevant steps (after `provider-diagnostics:run` is
green) — not field-by-field — so the engine restarts once.

---

## 7. Phased rollout

- **M1 — Detection truth (dhee-core, no UI):** §2a `findMissingNodeClasses` + extend `CheckResult`;
  §2b `checkBundle`; unit tests against fixture `/object_info`. Ships value immediately to the agent tools.
- **M2 — Desktop surfacing:** `comfy:probe` + `bundle:check` IPC + manager methods; `<BundleConfigurator/>`
  read-only (shows model + node gaps with download/install hints). Wire into `NewProjectScreen` post-pick.
- **M3 — Resolution:** `bundle:resolve` (write aliases/class-swaps from the UI) + §2d resolution stamp;
  picker shows "✓ configured for this ComfyUI".
- **M4 — First-run flow:** `FirstRunSetupFlowContext` + full-screen flow + recipe presets (§6); replace
  the passive tour as the first-run config path.
- **M5 — Requirements manifest:** §2c schema + generator; curate the shipped bundles; upgrades gap rows
  to named/sized/linked downloads.
- **M6 — Community install + BYO:** §2e `installBundle` + §2f `importWorkflow`; both reuse `<BundleConfigurator/>`.

M1–M2 alone kill the "opaque render failure" problem (the user's #1 pain); the rest is progressive polish.

---

## 8. Open decisions (need your call before M4/M5)
1. **Model downloads:** link out to HuggingFace/source (safe, simple) vs. in-app download manager
   (great UX, but disk/bandwidth/checksum/licensing surface). Recommend link-out first, manager later.
2. **Custom-node install:** detect + hint + link only, or attempt `git clone`/Manager API install from
   inside Dhee? Auto-install is fragile (Python deps, restarts). Recommend hint+link first.
3. **Requirements manifest authority:** auto-generated-and-committed per bundle, or generated lazily at
   first check and cached? Recommend commit (reviewable, offline-capable).
4. **BYO scope for v1:** full bundle authoring vs. single-stage workflow *substitution* (swap one
   shipped workflow, keep the rest). Recommend substitution first — it reuses everything above.
