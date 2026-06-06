# Council Transcript — Skincare AI Orchestration
**Date:** 2026-05-24

---

## Original Question

Inventory view should include photos used for AI generation. Option B (AI replaces manual steps, uses inventory). Is this a sound design?

## Framed Question

A single-user personal health tracker (React + Flask + SQLite on Fly.io, Claude Sonnet 4.6) is adding an AI-driven skincare orchestration system. Two components: (1) Product Scanner — user photographs a skincare product → Claude vision identifies brand, type, active ingredients, face-safe status → stored in SQLite with the original photo blob, displayed inline in the routine. (2) Daily AI Routine — replaces the existing manual AM/PM step checklist; Claude reads today's workout log (type: cardio/lifting, timing, sweat intensity) + product inventory → generates Morning/Post-Workout/Evening routine JSON using hardcoded dermatological rules (post-cardio → BP wash first; post-lifting → BHA cleanser; max 2 medicated washes/24h; SPF mandatory daytime; heavy occlusives banned from face) → renders as interactive checklist with product photos inline. User's clinical goal: treat active breakouts + fade PIH. Is this a sound design? What risks or tweaks should be considered before building?

---

## Advisor Responses

### The Contrarian

The fatal flaw is the liability/safety gap dressed up as a feature. You're building a medical recommendation system while calling it a "routine generator." Those hardcoded dermatological rules aren't just UX decisions — they're clinical guidance. "Post-cardio BP wash first" and "max 2 medicated washes/24h" are the kind of instructions a dermatologist gives, not an app. When Claude misidentifies an active ingredient (and it will — skincare label photography is notoriously ambiguous, with overlapping terminology like "salicylic acid" vs "sodium salicylate" vs "willow bark extract"), the system confidently recommends something that could actively worsen active breakouts or cause chemical burns in combination.

Three specific failure modes that will actually occur:

**Ingredient misclassification.** Claude vision will hallucinate or misread small-print INCI lists under poor lighting. Your database gets corrupted with wrong active-ingredient flags, and the routine engine silently makes bad decisions downstream.

**Interaction blindness.** The rules handle washing sequence but completely ignore dangerous combinations — retinoids with vitamin C, benzoyl peroxide with AHAs. You have no ingredient-interaction layer. For someone treating active breakouts, this isn't theoretical risk.

**No feedback loop.** The system has zero mechanism to learn that its recommendations are making things worse. If Claude's routine is causing PIH to deepen, nothing in this architecture surfaces that. You're flying blind indefinitely.

The "clinical goal" framing is the tell. Whoever builds this should either add explicit "this is not medical advice" guardrails with forced acknowledgment, or strip the clinical language entirely.

---

### The First Principles Thinker

What problem are we actually solving?

The framing conflates two distinct problems that have different optimal solutions. Separate them:

**Problem 1: Product knowledge capture.** The user wants to know what's in their products. This is a solved problem — a lookup against an ingredient database (INCI decoder, CosDNA) is more accurate than Claude vision guessing from a photo. The photo-to-ingredient pipeline introduces hallucination risk on exactly the data that drives the "safety rules" downstream. A bad ingredient read corrupts everything after it.

**Problem 2: Routine sequencing.** The user wants to not think about order-of-operations. The "hardcoded dermatological rules" are doing real work here — but they're hardcoded in a prompt, not in code. That's the wrong layer. Rules like "max 2 medicated washes/24h" should be enforced in deterministic logic, not inferred by an LLM each time. Claude should generate the *explanation*, not be the *enforcement mechanism*.

**The deeper question nobody asked:** Is AI the right tool for routine generation at all? The routine decision tree is not complex — it's ~5 variables (time of day, workout type, sweat level, active ingredients on hand, weather/UV). This is a 50-line decision function, not an LLM problem. The LLM adds latency, cost, and non-determinism to something that should be fast and predictable.

**Rebuild the actual requirement:** Use deterministic logic for routine generation. Use Claude only for product identification (ingredient extraction) and user-facing explanation ("why this order today"). Store ingredients as structured data, not a blob. Then the clinical rules are testable, auditable, and don't drift.

---

### The Expansionist

The design is sound but this is undershooting the opportunity significantly.

You're building a context-aware dermatological AI that reads biometrics, inventory, and activity data to generate personalized protocols. That's genuinely novel. The hardcoded rules are a floor, not a ceiling — Claude should be reasoning dynamically from those principles, not just pattern-matching against a lookup table. The real upside is adaptation over time.

What's missing that would make this dramatically more powerful:

**Outcome tracking loop.** The system currently generates routines but collects zero feedback on whether they're working. Add a weekly skin check-in — even just a 1-5 breakout severity + PIH improvement rating — and now Claude can correlate routine compliance + product combos + workout patterns against skin outcomes. That's a closed-loop optimization system. The user's stated goals (breakouts + PIH) become measurable targets, not just aspirations.

**Ingredient conflict detection across the full inventory.** The hardcoded rules handle usage timing, but the bigger clinical value is: "You bought Product X — its niacinamide will interact with the BHA in Product Y if layered simultaneously." Claude vision already extracted active ingredients; use them for cross-product reasoning, not just individual classification.

**Streak/compliance analytics.** This tracker already has habit and mood modules. Skincare compliance feeds directly into those systems.

The architecture is right. Build the feedback loop from day one — retrofitting outcome tracking after months of data is painful. Capture it now even if the analysis comes later.

---

### The Outsider

The design assumes users will photograph products correctly, but people are bad at this. Blurry labels, angled shots, partial ingredient lists — Claude vision will confidently misidentify things. A "BP wash" misread as a gentle cleanser could mean someone applies benzoyl peroxide twice in quick succession. For acne + PIH treatment, that's a real skin barrier problem. There's no fallback UI shown for low-confidence scans.

The hardcoded dermatological rules are presented as if they're universal. They aren't. "Post-cardio → BP wash first" ignores that BP is an active that degrades with sweat and UV, that some users cycle BP to avoid resistance, and that people with sensitive skin can't tolerate it daily regardless of workout type. The rules will be wrong for a meaningful slice of users, and users won't know they're wrong because the AI presents them with authority.

The photo blob stored in SQLite is a red flag nobody else will say out loud: SQLite on Fly.io with binary blobs doesn't scale gracefully and adds significant DB size over time. But more importantly — those photos contain product receipts, bathroom context, sometimes faces. There's no mention of encryption or deletion policy.

The biggest outsider concern: the system conflates "routine suggestion" with "medical-adjacent advice." A user treating active breakouts who follows a bad AI-generated routine and worsens their PIH won't think "the AI guessed wrong." There needs to be a visible, persistent disclaimer that this is not dermatologist advice — not a one-time modal, something that stays present in the routine UI.

---

### The Executor

The design is buildable. Here's the execution path and where it will actually break.

**What works immediately:**
- Claude vision for product identification is solid. One endpoint: accept photo blob, return structured JSON (brand, type, actives, face-safe bool). Store the blob in SQLite as-is. Done in a day.
- The routine generation endpoint is straightforward: pull today's workout log, pull product inventory, stuff both into a Claude prompt with your hardcoded dermatological rules, return structured JSON. One Flask route.

**Where you will hit walls:**

First wall — the workout timing dependency. Your rule "post-cardio → BP wash first" requires knowing *when* the workout happened relative to now. Your workout log almost certainly stores date but maybe not time-of-day or completion timestamp. Check `backend/models.py` before writing a single line of routine logic.

Second wall — Claude vision product identification will fail on partial labels, non-English packaging, and store-brand products. You need a fallback: if confidence is low, prompt the user to manually enter actives. Without this, the product inventory becomes silently incomplete and the routine recommendations break downstream.

Third wall — "max 2 medicated washes/24h" requires knowing what was actually *checked off* on previous routine checklists, not just what was generated. If you're not persisting checklist completion state, this rule cannot be enforced.

**First Monday morning action:**
Open `backend/models.py` right now. Confirm: (1) workout log has time-of-day field, (2) there's a table or mechanism to store routine checklist completions. If either is missing, add the schema migrations first. Everything else waits on those two.

---

## Peer Reviews

### Anonymization Mapping
- Response A = First Principles Thinker
- Response B = Expansionist
- Response C = Executor
- Response D = Contrarian
- Response E = Outsider

### Reviewer 1
1. **Strongest: C (Executor)** — gives actionable, codebase-specific guidance. Identifies concrete walls the builder will hit.
2. **Biggest blind spot: B (Expansionist)** — advocates closed-loop on unreliable foundation; amplifies risk.
3. **All missed:** Fly.io SQLite volumes are ephemeral by default. Binary blobs without persistent volume mount = data loss guarantee on redeploy.

### Reviewer 2
1. **Strongest: A (First Principles)** — correctly identifies architectural mismatch; LLM as enforcement mechanism for deterministic rules is the wrong layer.
2. **Biggest blind spot: B (Expansionist)** — feedback loop on unstable foundation amplifies unreliability.
3. **All missed:** Token cost and latency scaling. Full inventory + rules on every request degrades with inventory size. Pre-filter step needed.

### Reviewer 3
1. **Strongest: C (Executor)** — most immediately actionable blockers before a line is written.
2. **Biggest blind spot: B (Expansionist)** — assumes foundation is solid, argues for more on top.
3. **All missed:** LLM-in-the-loop latency and availability. If Claude is slow or down, user gets no morning routine. Pre-generate on workout save; cache; fallback.

### Reviewer 4
1. **Strongest: C (Executor)** — only response grounded in actual codebase.
2. **Biggest blind spot: B (Expansionist)** — endorses and expands before validating foundation; garbage-in-garbage-out.
3. **All missed:** Whether Claude vision runs at display time (costs multiply on every page load) vs ingest time. Explicit architectural decision needed.

### Reviewer 5
1. **Strongest: C (Executor)** — bridges concept and execution.
2. **Biggest blind spot: A (First Principles)** — overcorrects by dismissing LLM entirely; question is how LLM output feeds deterministic rules, not whether LLM should be involved.
3. **All missed:** Routine idempotency. If user closes app and reopens, does Claude regenerate a different routine or restore saved one? Non-idempotent routine silently corrupts compliance tracking.

---

## Chairman's Verdict

### Where the Council Agrees

**The photo-to-ingredient pipeline is the load-bearing failure point.** Every advisor flagged it in some form: Claude vision will misclassify ingredients, and every downstream rule runs on that classification. A wrong read doesn't produce a suboptimal recommendation; it produces a confidently wrong one.

**Hardcoded rules should not live inside LLM prompts.** "Max 2 medicated washes/24h" and "post-cardio → BP wash first" are deterministic constraints, not reasoning tasks. These belong in Python logic that runs against structured data, with Claude handling explanation and personalization — not enforcement.

**The system has medical adjacency it isn't acknowledging.** A persistent, visible disclaimer is not optional UX polish. The routine engine is issuing guidance for active breakouts and PIH. That's clinical territory. The disclaimer must live in the routine UI itself, every time the routine is displayed.

**The feedback loop is absent and it matters.** Without tracking whether recommendations are helping or hurting, the system is an open loop. For a clinical goal (treat breakouts, fade PIH), that means the user has no signal if the app is making things worse.

### Where the Council Clashes

**LLM for routine generation: yes or no?**
The First Principles advisor says cut the LLM from routine generation entirely — it's a 50-line decision function. The Executor and Contrarian treat LLM involvement as reasonable, with guardrails. The Expansionist wants more LLM, not less.

The correct read: the decision tree (wash order, product selection, timing rules) should be deterministic Python. The LLM's role is legitimate but narrower: product identification at ingest, natural-language explanation of why the routine was generated, surfacing interaction warnings. Route the LLM around the safety-critical logic, not through it.

**Outcome tracking: build it now or later?**
The Expansionist argues for a closed-loop outcome tracking system from day one. The peer reviews push back: building a feedback loop on unreliable ingredient data and no checklist persistence means optimizing noise. Correct answer: fix the foundation first, then instrument the feedback loop.

### Blind Spots the Council Caught

- **Fly.io SQLite volumes are ephemeral by default.** Without explicit persistent volume mount, every redeployment wipes the product inventory. The routine engine breaks silently — not with an error, but by generating routines against an empty product table.
- **Routine idempotency is unresolved.** If user checks off steps, closes app, reopens — does Claude regenerate a potentially different routine or restore saved one? Non-idempotent routine silently corrupts clinical adherence tracking.
- **Claude vision must run at ingest time only, never at display time.** Re-scanning stored image blobs on every page load multiplies costs and stalls UX.
- **Workout log time-of-day field may not exist.** The rule "post-cardio → BP wash first" requires knowing when today's workout happened relative to now. May not be in the schema.
- **Token cost and latency scaling.** Full product inventory + workout log + all rules on every request degrades with inventory size. Pre-filter step is necessary.
- **LLM availability is a daily UX dependency.** Pre-generate on workout log save; cache; deterministic fallback for failure case.

### The Recommendation

Build this — the concept is sound — but restructure the architecture before writing feature code:

**Layer 1 — Ingest (LLM-assisted, runs once):** Photo → Claude vision → structured data (brand, type, actives[], face_safe). Image blob stored, never re-scanned. Low-confidence → manual fallback.

**Layer 2 — Routine generation (deterministic Python, runs once per day):** Python function reads workout log + structured product inventory → runs rule set as explicit conditional logic → persists to `daily_routines` table with date key. Claude called once after decision tree runs, to produce natural-language explanation only.

**Layer 3 — Rendering (no LLM, idempotent):** UI reads from `daily_routines` for today's date. If exists, render + restore checklist state. If not, trigger generation. No LLM at render time.

Defer the outcome-tracking feedback loop until the foundation is stable. Add persistent non-dismissible disclaimer in routine UI header.

### The One Thing to Do First

Open `fly.toml` and `backend/models.py` simultaneously and confirm: (1) persistent volume is mounted so SQLite survives redeployment, and (2) workout log table has a time-of-day field. If either is missing, fix it before writing a single line of skincare feature code.
