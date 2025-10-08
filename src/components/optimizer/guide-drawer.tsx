"use client";

import type { ReactNode } from "react";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";
import {
  GaugeCircle,
  ListChecks,
  PencilLine,
  RefreshCw,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

type FlowStage = {
  title: string;
  llm: string;
  icon: LucideIcon;
  description: string;
  bullets: string[];
  note?: string;
};

const flowStages: FlowStage[] = [
  {
    title: "1 · Generate",
    llm: "Task model",
    icon: Sparkles,
    description:
      "Call your configured task model with each train row using the current system prompt. This is where latency and cost originate.",
    bullets: [
      "System prompt + row input → model output",
      "Runs on train rows and validation rows",
    ],
    note: "Latency recorded here.",
  },
  {
    title: "2 · Score",
    llm: "Scorers (optional LLM judges)",
    icon: ListChecks,
    description:
      "Deterministic checks and optional LLM judges turn the output into numeric scores and written diagnostics.",
    bullets: [
      "Weights from the Scoring Criteria panel blend into correctness",
      "Diagnostics capture why a row succeeded or failed",
    ],
    note: "Cost recorded here when using LLM judges.",
  },
  {
    title: "3 · Optimize",
    llm: "No LLM call",
    icon: GaugeCircle,
    description:
      "GEPA updates the Pareto frontier, balancing correctness against latency using the active scorers.",
    bullets: [
      "Dominated candidates are discarded",
      "Both train and validation scores influence the best prompt",
    ],
    note: "Pareto frontier update—no additional LLM spend.",
  },
  {
    title: "4 · Reflect",
    llm: "Reflection model",
    icon: RefreshCw,
    description:
      "The reflection model reads diagnostics, plus your optional hint, and proposes a new system prompt to try next.",
    bullets: [
      "Only low-scoring train rows feed reflection",
      "Reflection hint in Config steers tone and priorities",
    ],
    note: "Latency & cost captured when the reflection model runs.",
  },
];

type DatasetCardConfig = {
  title: string;
  icon: LucideIcon;
  bullets: string[];
};

const datasetCards: DatasetCardConfig[] = [
  {
    title: "Train rows",
    icon: PencilLine,
    bullets: [
      "Editable, drive exploration",
      "Trigger every LLM call (task model, scorers, reflection)",
      "Diagnostics from scorers feed reflection",
    ],
  },
  {
    title: "Validation rows",
    icon: ShieldCheck,
    bullets: [
      "Read-only holdout",
      "Scored by task model + scorers only",
      "Never reflected—keeps Pareto winners honest",
    ],
  },
];

const guideAnchors = [
  { id: "guide-quick-start", label: "Quick start" },
  { id: "guide-dataset", label: "Dataset" },
  { id: "guide-gepa", label: "GEPA cycle" },
  { id: "guide-controls", label: "Controls" },
  { id: "guide-best-practices", label: "Best practices" },
  { id: "guide-reading", label: "Further reading" },
] as const;

type GuideDrawerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function GuideDrawer({ open, onOpenChange }: GuideDrawerProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        className="w-[90vw] max-w-[90vw] overflow-hidden p-0 sm:w-[90vw] sm:max-w-[90vw] md:w-[900px] md:max-w-[900px]"
        side="right"
      >
        <SheetHeader className="border-b border-neutral-200 bg-neutral-50 px-6 py-4">
          <SheetTitle className="text-left text-lg font-semibold text-neutral-900">How it works</SheetTitle>
          <SheetDescription className="text-left text-sm text-neutral-600">
            Three ingredients: a small dataset, configurable scorers, and GEPA’s reflective search. Here’s how they
            collaborate.
          </SheetDescription>
        </SheetHeader>
        <ScrollArea
          className="h-full min-h-0"
          viewportClassName="px-6 pb-8 pt-6"
        >
          <nav className="mb-6 flex flex-wrap gap-2 text-xs" aria-label="Guide sections">
            {guideAnchors.map((anchor) => (
              <a
                key={anchor.id}
                href={`#${anchor.id}`}
                className="rounded-full border border-neutral-200 bg-white px-3 py-1 font-medium text-neutral-600 transition hover:border-neutral-300 hover:text-neutral-900"
              >
                {anchor.label}
              </a>
            ))}
          </nav>

          <div className="space-y-8 text-sm leading-relaxed text-neutral-700">
            <GuideSection id="guide-quick-start" title="1 · Quick start" subtitle="From empty dataset to first run">
              <ol className="list-decimal space-y-2 pl-5">
                <li>
                  <strong>Sketch the task.</strong> Add 5–10 train rows covering common wins and tricky cases. Keep a few in
                  validation so winners must generalize.
                </li>
                <li>
                  <strong>Wire in scorers.</strong> Begin with deterministic checks (exact match, regex structure, length
                  ratio). Layer LLM judges later if you need richer signals.
                </li>
                <li>
                  <strong>Run the optimizer.</strong> GEPA cycles through generation, scoring, Pareto selection, and
                  reflection until the prompt converges.
                </li>
              </ol>
              <Alert className="text-xs">
                <AlertTitle>Tip</AlertTitle>
                <AlertDescription>
                  The Run dock records every iteration. Open it to inspect scorer diagnostics, telemetry, and the reflection
                  dataset as GEPA works.
                </AlertDescription>
              </Alert>
            </GuideSection>

            <GuideSection id="guide-dataset" title="2 · Dataset lanes" subtitle="How train and validation rows behave">
              <div className="grid gap-4 sm:grid-cols-1 md:grid-cols-2">
                {datasetCards.map((card) => (
                  <DatasetCard key={card.title} {...card} />
                ))}
              </div>
              <Alert variant="info" className="text-xs">
                <AlertTitle>Telemetry note</AlertTitle>
                <AlertDescription>
                  Latency and cost are captured for both splits, so you can compare trade-offs without touching the
                  training dataset.
                </AlertDescription>
              </Alert>
            </GuideSection>

            <GuideSection id="guide-gepa" title="3 · GEPA cycle" subtitle="Where each LLM is used">
              <div className="grid gap-4 sm:grid-cols-1 md:grid-cols-2">
                {flowStages.map((stage) => (
                  <FlowCard key={stage.title} {...stage} />
                ))}
              </div>
              <Alert variant="warning" className="text-xs">
                <AlertTitle>Heads-up</AlertTitle>
                <AlertDescription>
                  Reflection only looks at underperforming <strong>training</strong> rows. Validation rows stay untouched so
                  improvements have to generalize.
                </AlertDescription>
              </Alert>
            </GuideSection>

            <GuideSection id="guide-controls" title="4 · Key controls" subtitle="Where to steer the optimizer">
              <div className="grid gap-3 sm:grid-cols-1 md:grid-cols-2">
                <GuideCard title="Scorer weights">
                  Set how much each metric influences correctness. Any scorer with weight &gt; 0 participates in preview and
                  full runs.
                </GuideCard>
                <GuideCard title="Reflection hint">
                  Short business guidance prepended to every reflection prompt. Examples: “Redaction accuracy outweighs
                  brevity” or “Avoid bullet lists unless the dataset requests them.”
                </GuideCard>
                <GuideCard title="Train / validation split">
                  Training drives reflection; validation stays untouched so Pareto winners must generalize.
                </GuideCard>
                <GuideCard title="Run dock & logs">
                  The dock shows live scores, telemetry, and reflection datasets. Logs include the exact diagnostics we feed
                  back into reflection.
                </GuideCard>
              </div>
            </GuideSection>

            <GuideSection id="guide-best-practices" title="5 · Best practices">
              <ul className="list-disc space-y-1 pl-5">
                <li>Start with deterministic scorers (exact match, regex, length) before adding LLM judges.</li>
                <li>Keep datasets small but representative—5–10 rows per split is usually enough to explore.</li>
                <li>Disable pricey scorers while prototyping; re-enable them once the prompt stabilizes.</li>
                <li>Add at least one validation row to avoid overfitting to the training set.</li>
                <li>Monitor latency/cost tiles in Results to understand the trade-offs GEPA is making.</li>
              </ul>
            </GuideSection>

            <GuideSection id="guide-reading" title="6 · Further reading">
              <ul className="list-disc space-y-1 pl-5">
                <li>
                  <a
                    href="https://arxiv.org/abs/2507.19457"
                    target="_blank"
                    rel="noreferrer"
                    className="text-neutral-900 underline decoration-neutral-400 underline-offset-2 hover:text-neutral-700"
                  >
                    GEPA research preprint
                  </a>
                </li>
                <li>
                  <a
                    href="https://github.com/current-ai-llc/dsts"
                    target="_blank"
                    rel="noreferrer"
                    className="text-neutral-900 underline decoration-neutral-400 underline-offset-2 hover:text-neutral-700"
                  >
                    @currentai/dsts TypeScript optimizer
                  </a>
                </li>
              </ul>
            </GuideSection>
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

type GuideSectionProps = {
  title: string;
  subtitle?: string;
  children: ReactNode;
  id?: string;
};

function GuideSection({ title, subtitle, id, children }: GuideSectionProps) {
  return (
    <section id={id} className="space-y-3 scroll-mt-16">
      <div>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">{title}</h3>
        {subtitle ? <p className="text-xs text-neutral-500">{subtitle}</p> : null}
      </div>
      <div className="space-y-2 text-neutral-700">{children}</div>
      <div className="pt-3">
        <div className="h-px w-full bg-neutral-200" />
      </div>
    </section>
  );
}

type GuideCardProps = {
  title: string;
  children: ReactNode;
};

function GuideCard({ title, children }: GuideCardProps) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-700">
      <div className="text-sm font-semibold text-neutral-800">{title}</div>
      <div className="mt-1 text-sm text-neutral-600">{children}</div>
    </div>
  );
}

type DatasetCardProps = DatasetCardConfig;

function DatasetCard({ title, icon: Icon, bullets }: DatasetCardProps) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3 text-sm text-neutral-700">
      <div className="mt-1 rounded-md bg-white p-2 text-neutral-500 shadow-sm" aria-hidden>
        <Icon className="h-5 w-5" />
      </div>
      <div className="space-y-2">
        <div className="text-sm font-semibold text-neutral-800">{title}</div>
        <ul className="list-disc space-y-1 pl-4 text-neutral-600">
          {bullets.map((bullet) => (
            <li key={bullet}>{bullet}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

type FlowCardProps = FlowStage;

function FlowCard({ title, llm, icon: Icon, description, bullets, note }: FlowCardProps) {
  const isLLM = llm !== "No LLM call";
  return (
    <div className="flex gap-3 rounded-lg border border-neutral-200 bg-white px-4 py-4 shadow-sm">
      <div
        className="mt-1 flex h-10 w-10 items-center justify-center rounded-md bg-neutral-50 text-neutral-500 shadow-inner"
        aria-hidden
      >
        <Icon className="h-5 w-5" />
      </div>
      <div className="flex-1 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-sm font-semibold text-neutral-800">{title}</h4>
          <Badge
            variant="outline"
            className={cn(
              "border px-2 py-0.5 text-[11px] uppercase",
              isLLM ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-neutral-200 bg-neutral-50 text-neutral-600",
            )}
          >
            {llm}
          </Badge>
        </div>
        <p className="text-sm text-neutral-600">{description}</p>
        <ul className="list-disc space-y-1 pl-4 text-sm text-neutral-600">
          {bullets.map((bullet) => (
            <li key={bullet}>{bullet}</li>
          ))}
        </ul>
        {note ? <p className="text-xs text-neutral-500">{note}</p> : null}
      </div>
    </div>
  );
}
