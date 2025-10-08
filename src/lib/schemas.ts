import { z } from "zod";

const datasetItemSchema = z.object({
  id: z.string().min(1).optional(),
  input: z.string().min(1, "Input is required"),
  expectedOutput: z.string().optional(),
});

export const scorerConfigSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(["exact_match", "regex_presence", "length_ratio", "llm_rubric", "latency_builtin"]),
  enabled: z.boolean().default(true),
  weight: z.number().min(0).max(100).default(1),
  params: z.record(z.string(), z.unknown()).optional(),
});

export const optimizeRequestSchema = z.object({
  taskModel: z.string().min(1),
  reflectionModel: z.string().min(1),
  reflectionHint: z.string().max(2000).optional(),
  maxIterations: z.number().int().min(1).max(100).default(5),
  maxMetricCalls: z.number().int().min(1).max(10000).optional(),
  maxBudgetUSD: z.number().min(0).optional(),
  reflectionMinibatchSize: z.number().int().min(1).max(20).default(3),
  candidateSelectionStrategy: z.enum(["current_best", "pareto"]).default("current_best"),
  skipPerfectScore: z.boolean().default(true),
  seedSystemPrompt: z.string().min(1, "System prompt cannot be empty"),
  trainset: z.array(datasetItemSchema).min(1, "Provide at least one training example"),
  valset: z.array(datasetItemSchema).optional(),
  scorers: z.array(scorerConfigSchema).default([]),
  resumeCheckpoint: z.string().max(1_000_000).optional(),
  resumeMetadata: z
    .object({
      previousIterations: z.number().int().min(0).default(0),
    })
    .optional(),
});

export type OptimizeRequestInput = z.infer<typeof optimizeRequestSchema>;
export type OptimizeScorerConfig = z.infer<typeof scorerConfigSchema>;
