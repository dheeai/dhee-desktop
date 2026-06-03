# kshana strategy notes — 2026-05-14

Working notes from a strategy session covering: dropping ComfyUI, target audience, business model, moat, and the lock-as-signal data flywheel. These are decision-support notes, not commitments.

---

## 1. Dropping ComfyUI for 3 models (Flux Klein, Z-Image Turbo, LTX)

### Underlying motivation
Broaden access. ComfyUI in the install path is the single biggest adoption blocker. Most prospective users won't install Python + ComfyUI + model weights + custom nodes + troubleshoot CUDA.

### What "drop ComfyUI" actually means
ComfyUI does two distinct jobs in this codebase:
- **Graph execution** — running the node graph (samplers, VAE decode, LoRA stacking, multi-pass video). Replacing means re-implementing the actual model pipelines.
- **Plumbing** — queue/websocket/polling/upload/download. ~5k LOC of pure mechanism. Any replacement makes this go away — pure win.

The graph execution layer is the real question.

### Three realistic paths

| Path | Description | Effort | Tradeoff |
|---|---|---|---|
| **A. Cloud-only** | Replace ComfyUI with direct fal.ai / Replicate / BFL API calls for Klein/ZIT/LTX | ~1–2 weeks | Loses local rendering entirely; ongoing per-render cost; simplest code |
| **B. Native bundled inference** | Ship PyTorch/ComfyUI-equivalent runtime inside Electron, drive models directly | ~2–3 months | Massive install (10–30GB), GPU detection hell, but true local |
| **C. Headless ComfyUI bundled** | Keep ComfyUI but auto-spawn as child process from Electron, hide it from the user | ~1 week | "Drops ComfyUI" only in UX, not in code — fastest, most pragmatic |

### Per-model difficulty (not equal)
- **Z-Image Turbo** — simplest. ~140-line workflow, no reference images, no LoRA stacking. Easy to replace with direct API or minimal local pipeline.
- **Flux Klein** — moderate. 486-line workflow, up to 4 reference image slots. Multi-image conditioning is non-trivial to re-implement; cloud APIs (BFL, fal) handle it.
- **LTX 2.3 fml2v** — hardest. 834 lines, first/mid/last frame conditioning, LoRA strength tuning, multi-pass. Local re-implementation is real work; cloud APIs exist but 3-frame conditioning isn't always exposed.

### Hard truth about the constraint
Removing ComfyUI doesn't fully open the door if local rendering is kept. The real constraint is:
- Flux Klein wants ~24GB VRAM
- LTX 2.3 wants 16GB+ VRAM
- Z-Image Turbo is forgiving (8–12GB)

This rules out every Mac, every laptop without a beefy NVIDIA GPU, every integrated-graphics machine. **Local rendering only works for the same enthusiast crowd, ComfyUI or not.**

### The real question is local vs cloud, not ComfyUI vs not-ComfyUI

If TAM goal is "anyone with a laptop," the move is cloud-first:
- User installs dhee-desktop (~200MB Electron app, no GPU needed)
- App calls fal.ai / Replicate / BFL / direct LTX provider APIs
- User either uses our API key (we bill them) or brings their own
- Renders happen in seconds-to-minutes on cloud GPUs

Note: the codebase already has `_cloud.json` workflow variants for all 3 models — already straddling local/cloud. Cloud workflows today still go through a hosted ComfyUI runner; can swap that out for direct vendor APIs without changing the desktop UX at all.

### Suggested staging
1. **Now (~1 week):** Make cloud mode the default in the desktop app. Hide local/ComfyUI behind an "advanced" toggle. Most new users never see ComfyUI.
2. **Next (~2 weeks):** Replace cloud-ComfyUI runner with direct vendor API calls (fal for Flux/LTX, whoever hosts Z-Image). Cleaner, cheaper, fewer moving parts.
3. **Later (optional):** Decide whether local mode is worth keeping at all. If <5% of users use it, kill it.

---

## 2. Audience & business model

### Who actually uses LTX (vs Seedance/Veo/Kling)?
Not absolute-quality seekers. Real LTX audience:
- High-iteration users (animatic, storyboard, draft-then-refine)
- Volume-content creators where $0.05/clip × 1000 clips matters
- Users who need **control** — LTX exposes first/mid/last frame conditioning natively, which closed models hide or charge premium for
- Local-first users (devs, hobbyists, privacy-conscious)

**Structural advantage for kshana:** LTX's 3-frame conditioning is exactly what the shot-continuity pipeline needs. The deterministic-first-frame work in recent commits is essentially impossible to replicate well on Seedance because you can't pin its frames. **LTX isn't competing with Seedance — it's the only model that does what the pipeline needs.**

### Who pays Seedance prices?
~$0.50–$1/5s = $6–$12 per 60s video. Real but narrow segment:
- Agencies billing clients (markup hides cost)
- Monetized creators (YouTube/TikTok with revenue offset)
- Marketers doing ad creative (CAC math works at $50/ad)
- Studios doing previz

Not hobbyists. Not indie filmmakers without revenue.

### Why would a user buy credits from us vs going direct to fal?

**The existential question.** If kshana = "fal with a 20% markup and a nicer UI," there is no business. Fal/Replicate/vendors will undercut. Markups on commodity inference race to zero.

The advantage must be **the pipeline, not the inference**:

1. **Story → movie, not prompt → clip.** Going direct to fal gets a clip generator. The user has to be their own director, prompt engineer, continuity supervisor, editor. kshana does that *for* the user.
2. **Right iteration granularity.** Regenerate one shot without re-running the pipeline. Override one prompt. Swap one frame. Lock continuity across a sequence. This is the actual hard problem and the focus of recent commits.
3. **Multi-model orchestration.** Klein for first frame (reference-image control). Z-Image for atmospheric cutaways (fast/cheap). LTX where frame conditioning is needed. Seedance for hero shots. A direct-fal user can't do this without becoming a part-time AI engineer.

### Business model (read)
- **Free tier:** Local-only via ComfyUI. Costs ~nothing, builds community, keeps enthusiasts as evangelists.
- **Pro subscription ($20–40/mo):** Desktop app + cloud credit allotment. Captures hobbyists who want to skip ComfyUI install but aren't volume users.
- **Credit packs / metered:** Volume users. Markup on cloud inference bundled with orchestration value.
- **Studio/agency tier (later):** Multi-seat, shared projects, brand kits, higher SLAs.

**The trap:** pricing as if we're selling inference. We're not. We're selling **time saved orchestrating inference**. A 60s video might use $8 of cloud credit but save 4 hours. The kshana value is the 4 hours, not the $8.

---

## 3. Moat

### What is NOT a moat
- Model access (universal)
- The UI (replicable in 3 months)
- Cloud markup (commodity)
- ComfyUI workflow library (forkable)

### What COULD be a moat
- **The director layer** — LLM agent's ability to break a story into a *shot list that actually works as a video* (continuity, pacing, framing). Real technical bar. Most "AI video" startups have a prompt box; kshana has a planner.
- **Continuity primitives** — visual anchors, deterministic frame chains, character consistency across shots. Real machinery exists. Almost nobody else has this.
- **Workflow / template library** — if users contribute "anime music video" / "real estate walkthrough" / "product launch" templates and we curate, it becomes a content ecosystem competitors can't easily clone.
- **Open + cloud hybrid** — power users run local, casual users run cloud, same project format. Almost nobody offers both well.

### Not yet a moat, but could become one
- Custom-trained orchestration model on pipeline data (story → shot list → prompts). 12–18 months out. Where real defensible advantage lives.

### Honest threat
Runway, Pika, Sora, LumaLabs are all racing toward "story → movie." Window is the next 12–18 months. The bet: *vertical pipeline + open architecture + power-user UX* beats *closed monolith with a chat box*. Winnable, but only by staying focused on the director layer and not competing on raw model quality.

**If we compete on inference, we lose. If we compete on direction, we can win.**

---

## 4. Lock-as-signal data flywheel

### The proposal
User can lock a prompt / image / video. Lock = human signal that the generation was good. Track it, store it. Over time, accumulate training data. Use it to improve generation.

### Why the naive version isn't a moat
1. **Can't retrain Flux/LTX/Seedance.** Those weights belong to BFL/Lightricks/ByteDance. At best a LoRA on top, and frontier base models outpace LoRA gains.
2. **Lock is noisier than it looks.** Conflates "this is great" with "I ran out of patience/credits/ideas." Without separating tiers, B-tier work gets labeled A-tier.
3. **Mechanic is copyable.** Runway can ship a heart button tomorrow. Only accumulated contextual data is defensible, not the mechanic.
4. **Scale problem.** RLHF/fine-tune datasets typically need 10k–100k preference pairs to move a needle. 100 users × 10 locks = 1k data points. Need real volume before training is even possible.
5. **Frontier risk.** If Veo 4 or Sora 3 ships with native story understanding, data advantage in generation quality evaporates from above.

### Where the moat actually lives
We're not collecting generation data. We're collecting **orchestration data**. That's the unlock.

What's actually in a lock signal if instrumented right:
- "Given story X and scene Y with constraints Z → this prompt worked"
- "Given character A → these references kept her consistent across 8 shots"
- "Given mood M and pacing P → this shot sequence felt right"
- "Given a locked first-frame → this LTX seed/conditioning produced a coherent clip"

Nobody else has this data. Runway has clip-level likes. Pika has thumbs-up. **We have shot-list-in-story-context with continuity chains.** Different dataset entirely, and exactly what an orchestration model needs.

**Don't train Flux. Train the director** — the LLM that's planning shots, writing prompts, choosing models, and managing continuity. That LLM can be ours, and it gets meaningfully better with every locked sequence.

### Naive version vs real-moat version

| Naive | Real-moat |
|---|---|
| Store image + "locked: true" | Store entire context graph: story → scene → shot → prompt → references → prior regens → final lock |
| Train a generation LoRA | Train an orchestration model + a reranker |
| One global model | Personal taste profiles per user |
| "Lock" = good | "Locked after N regens" = strong; "Locked first try" = stronger; "Locked + reused across projects" = strongest |

**Personal taste profile angle is underrated.** If kshana learns *this user* likes slow cuts, warm grading, low-angle hero shots — that data can't be exported to a competitor. Switching cost grows monotonically with usage. Stickiness independent of model quality.

### Cheap early version to ship first
Before any training, do **retrieval-augmented planning**. At 100 users with ~10k locked shots with context: when a new user describes a scene, retrieve the 5 most similar locked shots from the corpus and feed them as exemplars to the planner LLM.
- Works with no training
- Gets better with every lock
- Invisible to competitors
- Validates the strategy — if exemplar-conditioned generation isn't measurably better than zero-shot, no amount of fine-tuning will save it

Only after that demonstrably works, graduate to fine-tuning.

### Risks to be honest about
1. **Cold start.** Early users get a worse product than late users. Pipeline + UX has to stand on its own *before* the flywheel spins.
2. **Consent.** Many users won't want creative work in a training corpus. Need clean opt-in UX. Will reduce data by some fraction — plan for it.
3. **Schema is everything.** "image_id → locked: true" collects almost nothing useful. Full context graph (including what was regenerated and why) is the asset. **Instrumentation work matters more than the lock feature itself.**
4. **Frontier compression.** A capable enough foundation model might learn orchestration directly from base training and obviate the director layer. Probably 3+ years out, but hedge by making pipeline value-add visible in iteration UX, not just behind-the-scenes intelligence.

### Net
Lock-as-signal is a **necessary input** to a moat, not the moat itself. The moat is:

> Orchestration data (contextual, not just preference) → director model + personal taste profiles → sticky, compounding advantage that the frontier labs aren't building because they're focused on bigger base models

Framing matters:
- Bad pitch: "we have a like button and we'll train someday"
- Good pitch: "every lock teaches kshana how *you specifically* direct films, and the planner gets sharper every time"

---

## 5. P2P distributed GPU marketplace

### The proposal
Operate kshana as a P2P compute service. Users submit image/video generation requests not only to their own GPU but also to other users' GPUs, distributing workload across a network. Network effects = moat: more GPU providers → cheaper/faster renders → more creators → more providers.

### Why kshana is structurally well-suited (more than competitors)
Most diffusion inference is single-job-latency-bound (one prompt → one image, fast as possible). That's a hostile workload for P2P — network RTT + cold start kills the UX.

**Kshana's pipeline produces a DAG of independent shot-level jobs.** That's throughput-bound and latency-tolerant — exactly the workload P2P serves well. 12 shots × 6 GPUs = 2 batches. Overnight rendering of a 5-minute film is a credible product story P2P can actually deliver. Render Network won 3D rendering for the same structural reason — render farms are inherently parallel.

### Why the user base is unusually well-suited for seeding
- Technical (already comfortable with AI gen)
- Already own GPUs (high overlap with kshana early adopters)
- Creatively cooperative (indie filmmaker + AI culture has a real "build together" ethos)
- Worst-case marketplace seed is "random consumers, no trust." Kshana seeds with "GPU-owning enthusiasts who share Discord servers." ~10× better starting condition.

### Why this could be a real moat
Network effects in compute marketplaces are durable when achieved:
- More providers → shorter render queue → more creators → more providers
- Two-sided marketplace network effects are among the most durable moats that exist (when they take)

### Failure modes / risks

1. **Cold start is the entire game.** Marketplaces don't die from competition; they die from never reaching liquidity. Need credible plan for first ~50 providers + ~50 active renderers. Options:
   - **Seed yourself:** buy/rent 10 GPUs, list as "kshana network," sell renders cheap. Real providers join once demand is visible.
   - **Convert existing local users:** anyone running dhee-desktop with a GPU becomes a potential provider with one toggle. "Lend idle GPU, earn credits toward cloud renders." Cleverest path — supply piggybacks on existing app installs.
   - **Anchor partner:** one small studio or Discord (50+ enthusiasts) commits to using kshana network exclusively for 3 months in exchange for free credits.

2. **Multi-homing is the durability risk.** Providers can list on kshana + Salad + io.net simultaneously (zero switching cost). Users can submit to kshana + fal (zero switching cost). What stops migration? Real lock-in candidates:
   - Reputation/trust scores accumulated over time
   - Project state/history living in kshana
   - **The orchestration layer being kshana-specific** (providers can't use their network on Render Network's workloads). This is the edge — make the network *only* useful for kshana-style decomposed workloads, providers can't easily multi-home.

3. **Render Network is the cautionary tale.** ~5+ years at this, never broke into diffusion despite real network effects in 3D. Specific reason: 3D render farms are studio-owned (concentrated supply, easy to onboard); diffusion supply is fragmented consumer GPUs (hard to onboard, unreliable). Kshana's specific theory for cracking this: not a general compute network — a *kshana-pipeline* compute network where the workload is uniquely shaped to fit P2P.

4. **Generic P2P problems still apply:**
   - **Verification/trust:** how to know the host honestly ran the job? Re-running for verification doubles cost.
   - **Quality variance:** consumer FP8 vs cloud FP16 produces different output. Reproducibility breaks.
   - **Reliability:** consumer GPUs are unreliable (laptop closed mid-job, driver crash, power blip).
   - **Model distribution:** Flux ~20GB, LTX ~30GB. Pre-download (huge install) or on-demand (huge per-job latency)?
   - **Payments:** money between strangers = you're a payments company (KYC, fraud, multi-jurisdictional tax). Or crypto (regulatory risk, UX friction).
   - **Adversarial use:** someone generates CSAM on the network. Host GPU owner has legal exposure. So do we. **Existential, not just operational.**

### Staged approach (the version worth building)

1. **Phase 1 — Local multi-GPU.** User with 2 GPUs in workstation. Kshana farms shots across them in parallel. Pure throughput win. Zero trust/payment problems. Useful day one.
2. **Phase 2 — Friends-and-teams pool.** Collaborator has a 4090, I have a 4080. Shared project, shots distribute across both. Trust solved by social relationship. No payments — pooled goodwill. Latency tolerable on home network. **This is the wedge.**
3. **Phase 3 — Studio/community pools.** Small animation studio with 4 boxes. Discord community of 30 enthusiasts. Same model, slightly wider trust circle. Optional credit accounting.
4. **Phase 4 (maybe) — Open marketplace.** Only after Phases 1–3 work. By then you have real trust/verification/payment infrastructure to harden.

### The killer feature framing
Not "use anyone's GPU." Instead: **"submit your project, kshana farms it across your friends' idle GPUs overnight, wake up to a finished movie."** Nobody else can tell this story because nobody else has the shot-decomposition pipeline to make it parallel.

### Pairs with cloud-first strategy
**Hybrid render queue.** Submit a project, kshana intelligently distributes shots:
- Cheap/fast Z-Image shots → user's local GPU
- Expensive LTX shots → cloud
- Hero Seedance shots → cloud premium
- Or: any shot → friend's idle GPU

Same orchestration logic, multiple compute targets. This is a real product nobody else has.

### Decisions to make eventually (not now)
- **Settlement model:** credits (closed-loop, simpler legally) or cash/crypto (open-loop, more powerful but legally fraught)?
- **Trust model:** kshana-curated providers only (gated, slower growth, higher quality) or open to anyone (fast growth, quality variance)?

These shape architecture choices, so keep in mind even if not deciding today.

### Net position
P2P GPU marketplace is a **good adjacent feature, dangerous primary strategy.** The director-layer moat is more tractable and shouldn't be traded for a moonshot in a category that's defeated better-funded teams.

**But:** the multi-GPU / pooled-render feature is genuinely differentiating and worth building. Frame it as "kshana renders in parallel across whatever GPUs you have access to" — local, team, cloud — not as "the BitTorrent of AI."

Build the multi-GPU / collaborator-pool infrastructure now as a real feature (Phases 1–2). That gives the technical foundation, lets you learn workload patterns, and quietly accumulates the architecture. Don't *launch* the marketplace until you have:
- 500+ active kshana users (potential demand)
- 100+ GPU-owning power users in the app (potential supply)
- A demonstrated workload that genuinely benefits from parallelism (overnight-render UX)

At that point, opening the network is a switch flip on infrastructure you already have. Before that point, it's a moonshot that distracts from the director-layer work.

---

## Summary — strategic posture

1. **Get off ComfyUI as a user-facing requirement.** Cloud-default desktop app. ~1–3 weeks of work, opens the addressable market by ~10–100×.
2. **Don't sell inference. Sell direction.** Pricing should reflect time saved orchestrating, not markup on cloud credits.
3. **Bet on the director layer as the moat.** Continuity primitives, multi-model orchestration, story-to-shot-list planning.
4. **Ship lock-as-signal — but as orchestration data, not generation data.** Schema matters more than the feature. Start with retrieval-augmented planning before any model training.
5. **Build distributed-render infrastructure as a feature, not a marketplace — yet.** Phases 1–2 (local multi-GPU + collaborator pool) give real user value and lay groundwork. Defer open marketplace until critical mass exists (~500 users, ~100 GPU providers).
6. **Watch the frontier.** 12–18 month window before story-native foundation models could compress the orchestration advantage. Use that window to build user lock-in via personal taste profiles.
