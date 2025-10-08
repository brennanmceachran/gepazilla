import { z } from "zod";
import type { GatewayProvider } from "@ai-sdk/gateway";
import type { GatewayProviderOptions } from "@/lib/provider-options";
import type { OptimizeScorerConfig } from "@/lib/schemas";

export type ScoreCellStatus = "idle" | "pending" | "ready" | "error";

export type ScorerMode = "sync" | "async";

export type ScorerContext = {
  input: unknown;
  expectedOutput?: unknown;
  candidate: unknown;
};

export type ScorerEvaluation = {
  value: number | null;
  status: ScoreCellStatus;
  notes?: string;
};

export type ScorerEvaluationOptions = {
  providerOptions?: GatewayProviderOptions;
  gatewayProvider?: GatewayProvider;
};

export type NormalizedScorerContext = {
  input: string;
  expectedOutput?: string;
  candidate: string;
};

export type SyncEvaluator<Schema extends z.ZodTypeAny> = (
  ctx: NormalizedScorerContext & { params: z.infer<Schema>; options?: ScorerEvaluationOptions },
) => ScorerEvaluation;

export type AsyncEvaluator<Schema extends z.ZodTypeAny> = (
  ctx: NormalizedScorerContext & { params: z.infer<Schema>; options?: ScorerEvaluationOptions },
) => Promise<ScorerEvaluation>;

export interface ScorerPlugin<Schema extends z.ZodTypeAny> {
  type: OptimizeScorerConfig["type"];
  mode: ScorerMode;
  paramsSchema: Schema;
  defaultParams: z.infer<Schema>;
  defaultLabel: string;
  evaluateSync?: SyncEvaluator<Schema>;
  evaluateAsync?: AsyncEvaluator<Schema>;
  previewNotes?: string;
}

type Registry = Record<OptimizeScorerConfig["type"], ScorerPlugin<z.ZodTypeAny>>;

export const normalizeToString = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch (error) {
      return String(error);
    }
  }
  return String(value);
};

const exactMatchPlugin: ScorerPlugin<z.ZodTypeAny> = {
  type: "exact_match",
  mode: "sync",
  paramsSchema: z.object({}).default({}),
  defaultParams: {},
  defaultLabel: "Exact match",
  evaluateSync: ({ candidate, expectedOutput }) => {
    if (!expectedOutput) {
      return {
        status: "idle",
        value: null,
        notes: "Add an expected output to use exact match scoring.",
      };
    }
    const normalizedExpected = expectedOutput.trim().toLowerCase();
    const normalizedCandidate = candidate.trim().toLowerCase();
    const value = normalizedExpected === normalizedCandidate ? 1 : 0;
    return {
      status: "ready",
      value,
      notes: value === 1 ? undefined : "Mismatch with gold output.",
    };
  },
  previewNotes: "Checks equality against the gold output.",
};

export const regexPresenceSchema = z.object({
  pattern: z.string().default(""),
  mode: z.enum(["any", "at_least", "at_most", "between", "scaled"]).default("any"),
  minCount: z.number().int().min(0).nullish(),
  maxCount: z.number().int().min(0).nullish(),
  targetCount: z.number().int().min(1).nullish(),
  invert: z.boolean().default(false),
});

export type RegexPresenceParams = z.infer<typeof regexPresenceSchema>;

type RegexScoreComputation = {
  value: number;
  summary: string;
  error?: string;
};

const computeRegexScore = (count: number, params: RegexPresenceParams): RegexScoreComputation => {
  const mode = params.mode ?? "any";
  switch (mode) {
    case "any": {
      const value = count > 0 ? 1 : 0;
      return { value, summary: count > 0 ? "Match found" : "No matches" };
    }
    case "at_least": {
      const threshold = typeof params.minCount === "number" && params.minCount > 0 ? params.minCount : 1;
      const value = count >= threshold ? 1 : 0;
      return { value, summary: `count=${count} target≥${threshold}` };
    }
    case "at_most": {
      const ceiling = typeof params.maxCount === "number" ? params.maxCount : 0;
      const value = count <= ceiling ? 1 : 0;
      return { value, summary: `count=${count} target≤${ceiling}` };
    }
    case "between": {
      const floor = typeof params.minCount === "number" ? params.minCount : 1;
      const ceiling = typeof params.maxCount === "number" ? params.maxCount : floor;
      if (ceiling < floor) {
        return { value: 0, summary: "", error: "Max count must be greater than or equal to min count." };
      }
      const value = count >= floor && count <= ceiling ? 1 : 0;
      return { value, summary: `count=${count} target ${floor}-${ceiling}` };
    }
    case "scaled": {
      const cap = typeof params.targetCount === "number" && params.targetCount > 0
        ? params.targetCount
        : typeof params.maxCount === "number" && params.maxCount > 0
          ? params.maxCount
          : undefined;
      if (!cap) {
        return { value: 0, summary: "", error: "Provide a target count greater than zero." };
      }
      const value = Math.min(count / cap, 1);
      return { value, summary: `count=${count} target=${cap}` };
    }
    default:
      return { value: 0, summary: "", error: "Unsupported regex mode." };
  }
};

const formatRegexNotes = (
  count: number,
  summary: string,
  inverted: boolean,
  mode: RegexPresenceParams["mode"],
) => {
  const base = summary ? summary : `matches=${count}`;
  const invertTag = inverted ? " • inverted" : "";
  if (mode === "any") {
    return `${count === 1 ? "1 match" : `${count} matches`} • ${base}${invertTag}`;
  }
  return `${base}${invertTag}`;
};

export const evaluateRegexPresence = (
  candidate: string,
  params: RegexPresenceParams,
): ScorerEvaluation => {
  const pattern = params.pattern?.trim();
  if (!pattern) {
    return {
      status: "error",
      value: null,
      notes: "Provide a regex pattern.",
    };
  }

  let regex: RegExp;
  try {
    regex = new RegExp(pattern, "gi");
  } catch (error) {
    return {
      status: "error",
      value: null,
      notes: `Invalid regex: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const matches = normalizeToString(candidate).match(regex) ?? [];
  const count = matches.length;
  const { value, summary, error } = computeRegexScore(count, params);
  if (error) {
    return {
      status: "error",
      value: null,
      notes: error,
    };
  }

  const inverted = Boolean(params.invert);
  const adjustedValue = inverted
    ? params.mode === "scaled"
      ? Number.parseFloat((1 - value).toFixed(4))
      : value === 1
        ? 0
        : 1
    : value;

  return {
    status: "ready",
    value: Number.isFinite(adjustedValue) ? adjustedValue : 0,
    notes: formatRegexNotes(count, summary, inverted, params.mode ?? "any"),
  };
};

const regexPresencePlugin: ScorerPlugin<typeof regexPresenceSchema> = {
  type: "regex_presence",
  mode: "sync",
  paramsSchema: regexPresenceSchema,
  defaultParams: regexPresenceSchema.parse({}),
  defaultLabel: "Regex rule",
  evaluateSync: ({ candidate, params }) => evaluateRegexPresence(candidate, params as RegexPresenceParams),
  previewNotes: "Runs regex against the candidate output with optional match-count targets.",
};

const lengthRatioSchema = z.object({
  minRatio: z.number().optional(),
  maxRatio: z.number().optional(),
});

const lengthRatioPlugin: ScorerPlugin<typeof lengthRatioSchema> = {
  type: "length_ratio",
  mode: "sync",
  paramsSchema: lengthRatioSchema,
  defaultParams: lengthRatioSchema.parse({ minRatio: 0.15, maxRatio: 0.25 }),
  defaultLabel: "Length ratio",
  evaluateSync: ({ input, candidate, params }) => {
    const minRaw = params.minRatio;
    const maxRaw = params.maxRatio;
    const min = typeof minRaw === "number" && Number.isFinite(minRaw) ? minRaw : 0;
    const max = typeof maxRaw === "number" && Number.isFinite(maxRaw) ? maxRaw : 1;
    const base = Math.min(min, max);
    const limit = Math.max(min, max);
    const inputLength = normalizeToString(input).length;
    if (inputLength === 0) {
      return {
        status: "error",
        value: null,
        notes: "Input is empty; cannot compute ratio.",
      };
    }
    const ratio = normalizeToString(candidate).length / inputLength;
    if (!Number.isFinite(ratio)) {
      return {
        status: "error",
        value: null,
        notes: "Ratio is not finite.",
      };
    }
    const within = ratio >= base && ratio <= limit;
    return {
      status: "ready",
      value: within ? 1 : 0,
      notes: `ratio=${ratio.toFixed(2)} target=${base.toFixed(2)}-${limit.toFixed(2)}`,
    };
  },
  previewNotes: "Checks output length relative to input length.",
};

const llmRubricSchema = z.object({
  rubric: z.string().default(""),
  model: z.string().default("openai/gpt-4o-mini"),
});

const llmRubricPlugin: ScorerPlugin<typeof llmRubricSchema> = {
  type: "llm_rubric",
  mode: "async",
  paramsSchema: llmRubricSchema,
  defaultParams: llmRubricSchema.parse({}),
  defaultLabel: "LLM rubric",
  evaluateSync: () => ({
    status: "pending",
    value: null,
    notes: "Run this scorer to grade with the configured LLM judge.",
  }),
  evaluateAsync: async ({ input, expectedOutput, candidate, params, options }) => {
    const rubric = params.rubric?.trim();
    if (!rubric) {
      return {
        status: "error",
        value: null,
        notes: "Provide a grading rubric before running this scorer.",
      };
    }

    const model = params.model?.trim() || "openai/gpt-4o-mini";

    try {
      const { generateObject } = await import("ai");
      const gradeSchema = z.object({
        score: z.preprocess((value) => {
          if (typeof value === "string") {
            const parsed = Number.parseFloat(value);
            return Number.isNaN(parsed) ? value : parsed;
          }
          return value;
        }, z.number()),
        explanation: z.string().optional(),
      });

      const inputText = normalizeToString(input);
      const candidateText = normalizeToString(candidate);
      const expectedText =
        expectedOutput !== undefined ? normalizeToString(expectedOutput) : null;

      const userSegments = [
        "You are the evaluation judge. Score the candidate between 0 and 1 inclusive.",
        `Rubric:\n${rubric}`,
        `Task input:\n${inputText}`,
      ];
      if (expectedText && expectedText.length > 0) {
        userSegments.push(`Reference output (optional):\n${expectedText}`);
      }
      userSegments.push(`Candidate output to grade:\n${candidateText}`);
      userSegments.push("Respond with JSON only. Match this schema exactly: {\"score\": number, \"explanation\"?: string}.");

      const resolvedModel = options?.gatewayProvider
        ? options.gatewayProvider.languageModel(model)
        : model;

      const result = await generateObject({
        model: resolvedModel,
        messages: [
          {
            role: "system",
            content:
              "You are a strict rubric grader. Follow the rubric instructions precisely. Always return a score between 0 and 1.",
          },
          {
            role: "user",
            content: userSegments.join("\n\n"),
          },
        ],
        schema: gradeSchema,
        providerOptions: options?.providerOptions,
      });

      const grade = result.object;
      const rawScore = grade.score;
      if (typeof rawScore !== "number" || Number.isNaN(rawScore)) {
        return {
          status: "error",
          value: null,
          notes: "LLM grader returned an invalid score.",
        };
      }

      const normalized = Math.min(1, Math.max(0, rawScore));
      const explanation = grade.explanation?.trim();

      return {
        status: "ready",
        value: normalized,
        notes: explanation && explanation.length > 0 ? explanation : "LLM rubric score",
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        status: "error",
        value: null,
        notes: message,
      };
    }
  },
  previewNotes: "Requires server-side LLM call; use the Test button to grade.",
};

const latencyBuiltinSchema = z.object({}).default({});

const latencyBuiltinPlugin: ScorerPlugin<typeof latencyBuiltinSchema> = {
  type: "latency_builtin",
  mode: "sync",
  paramsSchema: latencyBuiltinSchema,
  defaultParams: latencyBuiltinSchema.parse({}),
  defaultLabel: "Latency (GEPA built-in)",
  evaluateSync: () => ({
    status: "idle",
    value: null,
    notes: "GEPA already optimizes latency internally; this scorer is informational.",
  }),
  previewNotes: "Latency is tracked by DSTS automatically; enabling this scorer has no effect.",
};

const registry: Registry = {
  exact_match: exactMatchPlugin,
  regex_presence: regexPresencePlugin,
  length_ratio: lengthRatioPlugin,
  llm_rubric: llmRubricPlugin,
  latency_builtin: latencyBuiltinPlugin,
};

const generateId = (type: OptimizeScorerConfig["type"]): string =>
  `${type}-${Math.random().toString(36).slice(2, 8)}`;

const mergeParams = <Schema extends z.ZodTypeAny>(
  plugin: ScorerPlugin<Schema>,
  rawParams: unknown,
) => {
  const base = plugin.defaultParams;
  const mergedParams = Object.assign(
    {},
    base,
    rawParams && typeof rawParams === "object" ? (rawParams as Record<string, unknown>) : {},
  );
  const result = plugin.paramsSchema.safeParse(mergedParams);
  if (!result.success) {
    throw result.error;
  }
  return result.data;
};

export const resolvePlugin = (
  type: OptimizeScorerConfig["type"],
): ScorerPlugin<z.ZodTypeAny> | undefined => registry[type];

type ScorerOverrides = Partial<Omit<OptimizeScorerConfig, "type" | "id" | "params" | "label">> &
  Partial<Pick<OptimizeScorerConfig, "params" | "label" | "id" | "enabled" | "weight">>;

export const createScorerConfig = (
  type: OptimizeScorerConfig["type"],
  overrides?: ScorerOverrides,
): OptimizeScorerConfig => {
  const plugin = resolvePlugin(type);
  if (!plugin) {
    throw new Error(`Unknown scorer type: ${type}`);
  }

  const baseId = overrides?.id && overrides.id.length > 0 ? overrides.id : generateId(type);
  const baseLabel = overrides?.label && overrides.label.length > 0
    ? overrides.label
    : plugin.defaultLabel;
  const baseWeight =
    typeof overrides?.weight === "number" && Number.isFinite(overrides.weight)
      ? overrides.weight
      : 1;
  const baseEnabled = overrides?.enabled ?? true;

  let params: OptimizeScorerConfig["params"] = undefined;
  if (overrides?.params !== undefined) {
    const result = plugin.paramsSchema.safeParse(overrides.params);
    if (result.success) {
      params = result.data as Record<string, unknown>;
    } else {
      throw result.error;
    }
  } else if (plugin.defaultParams && typeof plugin.defaultParams === "object") {
    const result = plugin.paramsSchema.safeParse(plugin.defaultParams);
    if (result.success && Object.keys(result.data as Record<string, unknown>).length > 0) {
      params = { ...(result.data as Record<string, unknown>) };
    }
  }

  return {
    id: baseId,
    label: baseLabel,
    type,
    enabled: baseEnabled,
    weight: baseWeight,
    params,
  } satisfies OptimizeScorerConfig;
};

export const evaluateScorerSync = (
  config: OptimizeScorerConfig,
  ctx: ScorerContext,
  options?: ScorerEvaluationOptions,
): ScorerEvaluation => {
  const plugin = resolvePlugin(config.type);
  if (!plugin) {
    return { status: "error", value: null, notes: `Unsupported scorer type: ${config.type}` };
  }

  let params;
  try {
    params = mergeParams(plugin, config.params);
  } catch (error) {
    return {
      status: "error",
      value: null,
      notes: error instanceof Error ? error.message : String(error),
    };
  }

  const candidate = normalizeToString(ctx.candidate);
  const input = normalizeToString(ctx.input);
  const expectedOutput =
    ctx.expectedOutput !== undefined ? normalizeToString(ctx.expectedOutput) : undefined;

  if (plugin.mode === "async" && !plugin.evaluateSync) {
    return {
      status: "pending",
      value: null,
      notes: plugin.previewNotes ?? "Async scorer requires a server-side run.",
    };
  }

  const evaluator = plugin.evaluateSync;
  if (!evaluator) {
    return {
      status: "error",
      value: null,
      notes: "Scorer does not implement a synchronous evaluation path.",
    };
  }

  return evaluator({ input, expectedOutput, candidate, params, options });
};

export const evaluateScorer = async (
  config: OptimizeScorerConfig,
  ctx: ScorerContext,
  options?: ScorerEvaluationOptions,
): Promise<ScorerEvaluation> => {
  const plugin = resolvePlugin(config.type);
  if (!plugin) {
    return { status: "error", value: null, notes: `Unsupported scorer type: ${config.type}` };
  }

  let params;
  try {
    params = mergeParams(plugin, config.params);
  } catch (error) {
    return {
      status: "error",
      value: null,
      notes: error instanceof Error ? error.message : String(error),
    };
  }

  const candidate = normalizeToString(ctx.candidate);
  const input = normalizeToString(ctx.input);
  const expectedOutput =
    ctx.expectedOutput !== undefined ? normalizeToString(ctx.expectedOutput) : undefined;

  if (plugin.mode === "async") {
    if (plugin.evaluateAsync) {
      return plugin.evaluateAsync({ input, expectedOutput, candidate, params, options });
    }
    if (plugin.evaluateSync) {
      return plugin.evaluateSync({ input, expectedOutput, candidate, params, options });
    }
    return {
      status: "pending",
      value: null,
      notes: plugin.previewNotes ?? "Async scorer requires a server-side run.",
    };
  }

  if (!plugin.evaluateSync) {
    return {
      status: "error",
      value: null,
      notes: "Scorer does not implement a synchronous evaluation path.",
    };
  }

  return plugin.evaluateSync({ input, expectedOutput, candidate, params, options });
};

export const listPlugins = (): ScorerPlugin<z.ZodTypeAny>[] => Object.values(registry);
