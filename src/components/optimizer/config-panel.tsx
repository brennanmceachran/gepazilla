"use client";

import { useMemo, type ChangeEvent } from "react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { OptimizerConfig } from "./types";
import { useGatewayModels } from "./use-gateway-models";

type RunConfigFormProps = {
  config: OptimizerConfig;
  onConfigField: (
    field: keyof OptimizerConfig,
  ) => (event: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => void;
  onConfigNumberField: (field: keyof OptimizerConfig) => (event: ChangeEvent<HTMLInputElement>) => void;
  onConfigOptionalNumberField: (field: keyof OptimizerConfig) => (event: ChangeEvent<HTMLInputElement>) => void;
};

export function RunConfigForm(props: RunConfigFormProps & { hasGatewayKey: boolean }) {
  const {
    config,
    onConfigField,
    onConfigNumberField,
    onConfigOptionalNumberField,
    hasGatewayKey,
  } = props;

  const { models } = useGatewayModels({
    apiKey: config.gatewayApiKey,
    enabled: hasGatewayKey || Boolean(config.gatewayApiKey?.trim()),
  });
  const needsGatewayKey = !hasGatewayKey && !config.gatewayApiKey.trim();

  const taskModelSelectValue = useMemo(() => {
    return config.taskModel && models.some((option) => option.id === config.taskModel)
      ? config.taskModel
      : "custom";
  }, [config.taskModel, models]);

  const reflectionModelSelectValue = useMemo(() => {
    return config.reflectionModel && models.some((option) => option.id === config.reflectionModel)
      ? config.reflectionModel
      : "custom";
  }, [config.reflectionModel, models]);

  return (
    <div className="space-y-4 text-[13px]">
      {needsGatewayKey ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-700">
          Provide an AI Gateway API key so GEPA can run. Add your key below or configure{" "}
          <code>AI_GATEWAY_API_KEY</code> in the environment. Need a key?{" "}
          <a
            href="https://vercel.com/ai-gateway/models"
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold underline"
          >
            Follow the Vercel AI Gateway guide
          </a>
          .
        </div>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        {!hasGatewayKey ? (
          <div className="sm:col-span-2">
            <Field
              label="AI Gateway API key"
              tooltip="We never store this server-side. It is attached to your requests only when you run the optimizer."
            >
              <Input
                type="password"
                value={config.gatewayApiKey}
                onChange={onConfigField("gatewayApiKey")}
                placeholder="sk-gateway-..."
                autoComplete="off"
                className="h-8 text-[13px]"
              />
              <p className="mt-1 text-[11px] text-neutral-500">
                Provide your own gateway key to fetch models and run GEPA.
              </p>
            </Field>
          </div>
        ) : null}
        <Field
          label="Task model"
          tooltip="Model GEPA queries for candidate scoring. Choose the same runtime model you plan to ship to align latency and behavior."
        >
          <div className="flex min-w-0 flex-col gap-2">
            <Select
              value={taskModelSelectValue}
              onValueChange={(value) => {
                if (value === "custom") return;
                const handler = onConfigField("taskModel");
                handler({
                  target: { value, type: "select-one" } as HTMLSelectElement,
                } as ChangeEvent<HTMLInputElement | HTMLSelectElement>);
              }}
            >
              <SelectTrigger className="h-8 min-w-0 max-w-full text-[13px]">
                <SelectValue placeholder="Select a model" />
              </SelectTrigger>
              <SelectContent className="max-h-72 w-[280px]">
                {models.map((model) => (
                  <SelectItem key={model.id} value={model.id} textValue={model.label}>
                    <div className="flex min-w-0 flex-col text-left">
                      <span className="font-medium">{model.label}</span>
                      <span className="text-[11px] text-neutral-500">{model.id}</span>
                    </div>
                  </SelectItem>
                ))}
                <SelectItem value="custom" textValue="Custom value">
                  Custom value…
                </SelectItem>
              </SelectContent>
            </Select>
            {taskModelSelectValue === "custom" ? (
              <Input
                value={config.taskModel}
                onChange={onConfigField("taskModel")}
                placeholder="openai/gpt-5-nano"
                className="h-8 text-[13px]"
              />
            ) : null}
          </div>
        </Field>
        <Field
          label="Reflection model"
          tooltip="Model used for natural-language reflection between iterations. It can be cheaper than the task model so long as feedback stays strong."
        >
          <div className="flex min-w-0 flex-col gap-2">
            <Select
              value={reflectionModelSelectValue}
              onValueChange={(value) => {
                if (value === "custom") return;
                const handler = onConfigField("reflectionModel");
                handler({
                  target: { value, type: "select-one" } as HTMLSelectElement,
                } as ChangeEvent<HTMLInputElement | HTMLSelectElement>);
              }}
            >
              <SelectTrigger className="h-8 min-w-0 max-w-full text-[13px]">
                <SelectValue placeholder="Select a model" />
              </SelectTrigger>
              <SelectContent className="max-h-72 w-[280px]">
                {models.map((model) => (
                  <SelectItem key={model.id} value={model.id} textValue={model.label}>
                    <div className="flex min-w-0 flex-col text-left">
                      <span className="font-medium">{model.label}</span>
                      <span className="text-[11px] text-neutral-500">{model.id}</span>
                    </div>
                  </SelectItem>
                ))}
                <SelectItem value="custom" textValue="Custom value">
                  Custom value…
                </SelectItem>
              </SelectContent>
            </Select>
            {reflectionModelSelectValue === "custom" ? (
              <Input
                value={config.reflectionModel}
                onChange={onConfigField("reflectionModel")}
                placeholder="openai/gpt-5-mini"
                className="h-8 text-[13px]"
              />
            ) : null}
          </div>
        </Field>
        <Field
          label="Max iterations"
          tooltip="Total number of GEPA evolution steps before stopping. Lower values = faster experiments; higher values = deeper search."
        >
          <Input
            type="number"
            min={1}
            max={100}
            value={config.maxIterations}
            onChange={onConfigNumberField("maxIterations")}
            className="h-8 text-[13px]"
          />
        </Field>
        <Field
          label="Reflection batch"
          tooltip="How many training rows are inspected per reflective update. The GEPA paper defaults to 3."
        >
          <Input
            type="number"
            min={1}
            max={20}
            value={config.reflectionMinibatchSize}
            onChange={onConfigNumberField("reflectionMinibatchSize")}
            className="h-8 text-[13px]"
          />
        </Field>
        <Field
          label="Max metric calls"
          tooltip="Optional guardrail on total scorer evaluations (including async judges). Leave blank unless you need to cap spend."
        >
          <Input
            type="number"
            min={1}
            value={config.maxMetricCalls ?? ""}
            onChange={onConfigOptionalNumberField("maxMetricCalls")}
            className="h-8 text-[13px]"
          />
        </Field>
        <Field
          label="Budget (USD)"
          tooltip="Stop once the adapter reports this much combined evaluator + reflection spend. Default $10 is a safe sandbox limit."
        >
          <Input
            type="number"
            min={0}
            step={0.01}
            value={config.maxBudgetUSD ?? ""}
            onChange={onConfigOptionalNumberField("maxBudgetUSD")}
            className="h-8 text-[13px]"
          />
        </Field>
        <Field
          label="Selection strategy"
          tooltip="Pareto sampling keeps diverse winners per dataset row and avoids local optima. Use Current best only for debugging."
        >
          <Select
            value={config.candidateSelectionStrategy}
            onValueChange={(value) => {
              const handler = onConfigField("candidateSelectionStrategy");
              handler({
                target: { value, type: "select-one" } as HTMLSelectElement,
              } as ChangeEvent<HTMLInputElement | HTMLSelectElement>);
            }}
          >
            <SelectTrigger className="h-8 text-[13px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="pareto">Pareto frontier (recommended)</SelectItem>
              <SelectItem value="current_best">Current best (debug)</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field
          label="Skip perfect"
          tooltip="When enabled, GEPA skips iterations where the minibatch already scores 1.0, saving metric calls."
        >
          <label className="flex items-center gap-2 text-neutral-600">
            <input
              type="checkbox"
              checked={config.skipPerfectScore}
              onChange={onConfigField("skipPerfectScore")}
              className="h-4 w-4 rounded border-neutral-300"
            />
            <span>Stop once a scorer hits 1.0</span>
          </label>
        </Field>
      </div>
      <Field
        label="Reflection hint"
        tooltip="Optional message prepended to every reflection prompt. Keep it short—use it to remind the model about business priorities (e.g., 'Redaction accuracy outranks brevity.')."
      >
        <textarea
          value={config.reflectionHint ?? ""}
          onChange={onConfigField("reflectionHint")}
          placeholder="e.g., Focus on removing confidential identifiers before rewriting."
          className="min-h-[72px] w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-800 shadow-sm focus:border-neutral-400 focus:outline-none"
        />
        <p className="mt-1 text-[11px] text-neutral-500">Leave blank to rely on automatic feedback only.</p>
      </Field>
    </div>
  );
}

type FieldProps = {
  label: string;
  children: React.ReactNode;
  tooltip?: string;
};

function Field({ label, children, tooltip }: FieldProps) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
        <span>{label}</span>
        {tooltip ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="cursor-help text-neutral-400 transition hover:text-neutral-600 focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-neutral-400"
              >
                ⓘ
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-xs text-left">{tooltip}</TooltipContent>
          </Tooltip>
        ) : null}
      </div>
      {children}
    </div>
  );
}
