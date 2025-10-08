<p align="center">
  <img src="./public/gepazilla-logo.png" alt="GEPAzilla logo" width="280" />
</p>

# GEPAzilla

GEPAzilla is the open-source GEPA prompt optimizer named after the friendly GEPAzilla dinosaur who smashes weak prompts and keeps the strongest contenders. The project includes a marketing splash page plus a BYO API-key console so curious builders can jump in quickly. Curate datasets, configure deterministic and LLM-powered scorers, and watch GEPA iterate on your system prompt while tracking latency, cost, and diagnostics—all on your machine. Visit [gepazilla.com](https://gepazilla.com) to meet the mascot and launch the console.

## Quick start

```bash
cp .env.example .env.local  # fill in required keys
pnpm install
pnpm dev
```

The marketing page lives at http://localhost:3000. Launch the console at http://localhost:3000/optimizer to work with datasets and scorers. The **Open console (BYO API key)** button on the homepage routes to the same place.

### Required environment variables

| Variable              | Description                                                                 |
| --------------------- | --------------------------------------------------------------------------- |
| `AI_GATEWAY_API_KEY`  | Required for GEPA runs, scorer previews, and `/api/models` discovery. Supply your own AI Gateway credential. |

> **How to obtain a key:** GEPAzilla expects a [Vercel AI Gateway](https://vercel.com/ai-gateway/models) token. Create or select a Vercel project, enable AI Gateway, and generate a gateway API key. Copy that value into `.env.local` before running `pnpm dev`.

Copy `.env.example` to `.env.local` and provide values before running the dev server. You can export the keys before running `pnpm dev`, or place them in `.env.local`.

GEPAzilla ships with a starter dataset so you can experiment instantly. If you’d like a larger fixture, import [`data/sample-dataset.json`](./data/sample-dataset.json) through the dataset menu.

## Working with datasets

- **Training rows** drive candidate exploration and feed reflection. Edit them inline, duplicate tricky cases, and move hold-outs to validation from each row’s overflow menu.
- **Validation rows** stay read-only during reflection and act as the generalisation check. They appear in the same table with a muted flag at the bottom.
- Dataset tools currently support copying or pasting JSON payloads from the clipboard; use the “Use” pill on each row to toggle Training/Validation.

## Scorers and diagnostics

- Add scorers from the Scoring Criteria panel. Deterministic plugins (exact match, regex, length) run instantly in the browser, while async plugins (LLM judges) execute during optimizer runs.
- Multiple instances of each scorer type are supported. Set weights to control how they contribute to the aggregate correctness objective.
- The Results tab now surfaces a **Scorer diagnostics** card summarising failure rates, averages, and the most common notes per scorer so you can tune signal quality quickly.

## GEPA workflow

The optimizer UI mirrors the GEPA paper’s reflection loop while keeping the UX approachable. Here’s how we expect contributors to exercise it:

1. **Prime GEPAzilla** – Set the task and reflection models (BYO API key) in the Run dock, choose your reflection batch, and confirm the skip-perfect toggle matches your dataset. The header pill (“Meet GEPAzilla”) links to an in-app guide if you forget what each field does.
2. **Shape the dataset** – Use the Training/Validation toggles to curate high-signal examples. GEPAzilla’s reflective dataset generator samples underperforming rows; keeping validation rows pristine makes the Pareto gate meaningful.
3. **Tune the scoring stack** – Combine deterministic plugins (latency, regex, exact match) with LLM judges. Weighting and optional duplication lets you emphasize metrics that matter. The `/api/scorers/test` endpoint powers the “Preview scorer” button so you can sanity-check configuration before a run.
4. **Run and iterate** – Start the run (`⌘/Ctrl + Enter` works). Watch the Logs tab for scorer notes and telemetry, then pivot to Results to inspect candidate prompts, iteration trends, and scorer diagnostics. Apply the preferred prompt directly from Results without leaving the page.
5. **Reflect and repeat** – If a scorer misbehaves or the dataset falls short, adjust and run again. All telemetry remains local; GEPAzilla never exfiltrates run data.

The “How it works” drawer (top-right) walks through the same flow with annotated screenshots for new contributors.

## Telemetry and opt-out

The optimizer records span-level diagnostics to power the run dock, but everything stays in your browser. Telemetry events are never sent to a remote service. Advanced debugging flags such as `DEBUG_TELEMETRY` and `NEXT_PUBLIC_DEBUG_TELEMETRY` are documented in [CONTRIBUTING.md](./CONTRIBUTING.md).

## Maintenance scripts

| Command                     | Purpose                              |
| --------------------------- | ------------------------------------ |
| `pnpm dev`                  | Start the Turbopack dev server       |
| `pnpm lint`                 | Run ESLint across the project        |
| `pnpm exec tsc --noEmit`    | Type-check the codebase without emit |
| `pnpm test`                 | Run the Vitest suite once            |
| `pnpm test -- --run --coverage` | Run Vitest with v8 coverage      |

## Development & Contributing

- Start with [CONTRIBUTING.md](./CONTRIBUTING.md) for environment setup, commit checks, and PR etiquette.
- The [Scorer Authoring Guide](./docs/SCORER_GUIDE.md) explains how to create new scorer plugins and hook them into the registry and UI.
- CI executes `pnpm lint`, `pnpm exec tsc --noEmit`, and `pnpm test -- --run` on every push and pull request (see [`.github/workflows/ci.yml`](./.github/workflows/ci.yml)).

## Deployment

The application ships as a standard Next.js project. To produce a production build:

```bash
pnpm install
pnpm build
pnpm start
```

Set `AI_GATEWAY_API_KEY` in the runtime environment before launching either `pnpm build` or `pnpm start`. Optional debug flags should remain unset (or `false`) in production unless you are actively debugging locally.

## Licensing & Attribution

- Dependency licenses are tracked in [`docs/THIRD_PARTY_LICENSES.json`](./docs/THIRD_PARTY_LICENSES.json).
- Static asset sources are listed in [`docs/ASSET_ATTRIBUTIONS.md`](./docs/ASSET_ATTRIBUTIONS.md).

## Further reading

- [GEPA Preprint](https://arxiv.org/abs/2507.19457)
- [`@currentai/dsts` TypeScript library](https://github.com/current-ai-llc/dsts)

## License

GEPAzilla is released under the [MIT License](./LICENSE).

All community activity is governed by our [Code of Conduct](./CODE_OF_CONDUCT.md).
