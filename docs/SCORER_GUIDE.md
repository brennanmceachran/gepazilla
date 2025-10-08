# Scorer Authoring Guide

GEPAzilla evaluates candidate prompts through pluggable "scorers" defined in `src/lib/scorers`. Each scorer implements a simple interface that maps a dataset row (`input`, `expectedOutput`) and the candidate output to a numeric score plus diagnostic text. This guide explains how the pieces fit together and how to add a new scorer safely.

## Architecture Overview

- **Registry** – `src/lib/scorers/index.ts` exposes `createScorerConfig`, `resolvePlugin`, and evaluation helpers. Each plugin declares its default label, parameter schema (via Zod), synchrony (`sync` vs `async`), and evaluation functions.
- **Scorer Adapter** – `src/lib/scorer-adapter.ts` wraps GEPA's default adapter to run enabled scorers after each evaluation, aggregate the weighted score, and record diagnostics for the reflective dataset.
- **API Surface** – `/api/run` and `/api/scorers/test` accept an array of `OptimizeScorerConfig` objects; the new scorer will appear anywhere the registry is used (UI scorer picker, tests, reflective dataset).

## Adding a New Scorer

1. **Define the plugin** inside `src/lib/scorers/index.ts`:
   ```ts
   const customParamsSchema = z.object({ threshold: z.number().min(0).max(1) });

   const customPlugin: ScorerPlugin<typeof customParamsSchema> = {
     type: "custom_threshold",
     mode: "sync",
     paramsSchema: customParamsSchema,
     defaultParams: { threshold: 0.5 },
     defaultLabel: "Custom threshold",
     evaluateSync: ({ candidate, params }) => {
       const score = candidate.length >= params.threshold ? 1 : 0;
       return {
         status: "ready",
         value: score,
         notes: `len=${candidate.length} threshold=${params.threshold}`,
       } satisfies ScorerEvaluation;
     },
     previewNotes: "Scores 1 when candidate length exceeds the configured threshold.",
   };
   ```

2. **Register the plugin** by adding it to the `registry` object and extending any relevant type unions (`OptimizeScorerConfig["type"]`).

3. **Expose defaults** (optional) in `src/lib/default-config.ts` if you want the scorer to appear in the initial configuration.

4. **Add tests** in `tests/scorers.test.ts` covering:
   - Parameter validation (invalid params should throw).
   - Evaluation behaviour on representative inputs.

5. **Update the UI** (`src/components/optimizer/scorer-panel.tsx`) to add metadata (label, tooltip, parameter form). The panel consumes `listPlugins()` so any registry additions are automatically surfaced—only the editor UI for parameters may require tweaks.

6. **Document the scorer**: mention the new type and its parameters in this guide or the README so users understand when to enable it.

## Evaluation Guidelines

- Return `status: "ready"` only when the scorer produced a meaningful numeric `value`. Use `"pending"` for async scorers with server components (e.g., LLM rubric) and `"error"` for configuration/user issues.
- Keep scores normalized to `[0, 1]`. The optimizer expects higher values to be better.
- Add actionable `notes` so the reflective dataset can summarize misses (see the diagnostics appended in `ScorerAdapter`).

## Testing Checklist

- Unit tests live in `tests/scorers.test.ts` for pure evaluation logic.
- Integration coverage flows through:
  - `tests/api-scorsers.test.ts` (preview endpoint).
  - `tests/scorer-adapter.test.ts` (post-run aggregation and reflective dataset generation).

Following the steps above keeps new scorers consistent with existing plugins and ensures every layer—from API to UI—understands how to handle them.
