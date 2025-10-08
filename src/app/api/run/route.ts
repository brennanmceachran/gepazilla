import { GEPA } from "@currentai/dsts";
import type { CheckpointState } from "@currentai/dsts/dist/persistence";
import { createGateway } from "@ai-sdk/gateway";
import { generateText } from "ai";
import { optimizeRequestSchema } from "@/lib/schemas";
import { ScorerAdapter, telemetryRowStorage } from "@/lib/scorer-adapter";
import type { GatewayProviderOptions } from "@/lib/provider-options";
import { createTelemetrySettings, type TelemetryEvent } from "@/lib/telemetry";
import { StreamingPersistence } from "@/lib/streaming-persistence";
import {
  computeScoreboard,
  parseIterationValue,
  prepareDataset,
  updateEvaluationRole,
} from "./helpers";
import type {
  DatasetRowMeta,
  ScoreboardRowPayload,
  ScoreCellPayload,
} from "./helpers";

const GATEWAY_HEADER = "x-gepa-gateway-key";
export const maxDuration = 800;

const encoder = new TextEncoder();

const MAX_CHECKPOINT_BYTES = 1_000_000;

const decodeCheckpoint = (raw: string): CheckpointState => {
  const trimmed = raw.trim();
  const bytes = Buffer.byteLength(trimmed, "utf8");
  if (bytes > MAX_CHECKPOINT_BYTES) {
    throw Object.assign(new Error("Checkpoint payload too large"), { status: 413 as const });
  }

  const asJson = trimmed.startsWith("{") ? trimmed : Buffer.from(trimmed, "base64").toString("utf8");
  const parsed = JSON.parse(asJson) as CheckpointState;
  if (typeof parsed?.iteration !== "number" || parsed.iteration < 0) {
    throw Object.assign(new Error("Invalid checkpoint"), { status: 400 as const });
  }
  return parsed;
};

const classifyLogChannel = (level: string, message: string): string => {
  const normalized = message.toLowerCase();
  if (level === "warn" || level === "error" || normalized.includes("error") || normalized.includes("failed")) {
    return "alerts";
  }
  if (
    normalized.includes("reflect")
    || normalized.includes("component text updated")
    || normalized.includes("system prompt")
  ) {
    return "prompt";
  }
  if (
    normalized.includes("scor")
    || normalized.includes("dataset")
    || normalized.includes("scoreboard")
  ) {
    return "scoring";
  }
  if (
    normalized.includes("starting")
    || normalized.includes("optimizer")
    || normalized.includes("checkpoint")
    || normalized.includes("candidate evaluation complete")
  ) {
    return "lifecycle";
  }
  return "misc";
};

async function sendJson(
  writer: WritableStreamDefaultWriter<Uint8Array>,
  payload: Record<string, unknown>,
) {
  const eventType = typeof payload.type === "string" && payload.type.length > 0 ? payload.type : "message";
  const json = JSON.stringify(payload);
  await writer.write(encoder.encode(`event: ${eventType}\ndata: ${json}\n\n`));
}


export async function POST(req: Request) {
  let json: unknown;

  try {
    json = await req.json();
  } catch (error) {
    return new Response(
      JSON.stringify({ error: "Invalid JSON payload", details: String(error) }),
      { status: 400 },
    );
  }

  const parsed = optimizeRequestSchema.safeParse(json);

  if (!parsed.success) {
    return new Response(
      JSON.stringify({ error: "Invalid configuration", details: parsed.error.flatten() }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  const data = parsed.data;
  let initialCheckpoint: CheckpointState | undefined;
  try {
    if (data.resumeCheckpoint) {
      initialCheckpoint = decodeCheckpoint(data.resumeCheckpoint);
    }
  } catch (error) {
    const status = typeof (error as { status?: number }).status === "number"
      ? (error as { status?: number }).status
      : 400;
    return new Response(
      JSON.stringify({ error: (error as Error).message ?? "Invalid checkpoint" }),
      {
        status,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
  const resumeMetadata = data.resumeMetadata ?? (initialCheckpoint
    ? { previousIterations: initialCheckpoint.iteration }
    : undefined);
  const headerGatewayKey = req.headers.get(GATEWAY_HEADER)?.trim() ?? "";
  const envGatewayKey = process.env.AI_GATEWAY_API_KEY?.trim() ?? "";
  const gatewayKey = headerGatewayKey || envGatewayKey;
  if (!gatewayKey) {
    return new Response(
      JSON.stringify({
        error:
          "AI Gateway API key missing. Add it in the Run dock or configure the AI_GATEWAY_API_KEY environment variable.",
      }),
      {
        status: 401,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
  const gatewayProvider = createGateway({ apiKey: gatewayKey });
  const reflectionLanguageModel = gatewayProvider.languageModel(data.reflectionModel);
  const providerOptions: GatewayProviderOptions = { gateway: { apiKey: gatewayKey } };
  const reflectionOutputs = new Map<string, { oldText: string; newText: string }>();
  const reflectionGenerator = async (prompt: string): Promise<string> => {
    const componentNameMatch = prompt.match(/Component Name:\s*(.+)/);
    const componentName = componentNameMatch ? componentNameMatch[1]?.trim() ?? "" : "";
    const currentTextLabel = "Current Text:";
    const examplesLabel = "Execution Examples";
    let oldText = "";
    const currentTextIndex = prompt.indexOf(currentTextLabel);
    if (currentTextIndex !== -1) {
      const start = currentTextIndex + currentTextLabel.length;
      const end = prompt.indexOf(examplesLabel, start);
      const slice = end !== -1 ? prompt.substring(start, end) : prompt.substring(start);
      oldText = slice.trim();
    }

    const result = await generateText({
      model: reflectionLanguageModel,
      messages: [{ role: "user", content: prompt }],
      providerOptions,
    });
    const newText = (result.text ?? "").trim();
    if (componentName) {
      reflectionOutputs.set(componentName, { oldText, newText });
    }
    return newText;
  };
  const enrichComponentMeta = (message: unknown, meta: unknown): unknown => {
    if (message !== "Component text updated") return meta;
    if (!meta || typeof meta !== "object") return meta;
    const component = (meta as Record<string, unknown>).component;
    if (typeof component !== "string") return meta;
    const stored = reflectionOutputs.get(component);
    if (!stored) return meta;
    reflectionOutputs.delete(component);
    return {
      ...meta,
      oldTextFull: stored.oldText,
      newTextFull: stored.newText,
    };
  };
  const { readable, writable } = new TransformStream<Uint8Array>();
  const writer = writable.getWriter();
  let currentIteration: number | null = null;
  let currentEvaluationRole: string | null = null;

  const emitTelemetry = (event: TelemetryEvent) => {
    const baseAttributes = (event.attributes && typeof event.attributes === "object"
      ? { ...(event.attributes as Record<string, unknown>) }
      : {}) as Record<string, unknown>;

    const rowMeta = telemetryRowStorage.getStore();

    const attributes = {
      ...baseAttributes,
      ...(currentIteration !== null ? { "gepa.iteration": currentIteration } : {}),
      ...(currentEvaluationRole ? { "gepa.role": currentEvaluationRole } : {}),
      ...(rowMeta
        ? {
            "gepa.rowId": rowMeta.id,
            "gepa.rowInput": rowMeta.input,
            ...(rowMeta.expectedOutput ? { "gepa.rowExpected": rowMeta.expectedOutput } : {}),
          }
        : {}),
    } satisfies Record<string, unknown>;
    const enriched: TelemetryEvent = {
      ...event,
      attributes,
    };
    void sendJson(writer, {
      type: "data",
      data: {
        kind: "telemetry",
        event: enriched,
      },
    }).catch(() => {});
  };

  (async () => {
    try {
      await sendJson(writer, { type: "status", status: "started", ts: Date.now() });

      const trainDataset = prepareDataset(data.trainset);
      const validationDataset = Array.isArray(data.valset)
        ? prepareDataset(data.valset)
        : null;

      const adapter = new ScorerAdapter({
        model: gatewayProvider.languageModel(data.taskModel),
        modelId: data.taskModel,
        maxConcurrency: 3,
        scorers: data.scorers,
        reflectionSampleSize: data.reflectionMinibatchSize,
        providerOptions,
        gatewayProvider,
        experimentalTelemetry: createTelemetrySettings(emitTelemetry, {
          attributeSupplier: () => {
            const rowMeta = telemetryRowStorage.getStore();
            if (!rowMeta) return null;
            return {
              "gepa.rowId": rowMeta.id,
              "gepa.rowInput": rowMeta.input,
              ...(rowMeta.expectedOutput ? { "gepa.rowExpected": rowMeta.expectedOutput } : {}),
            } as Record<string, unknown>;
          },
        }),
        logger: async (level, message, meta) => {
          const augmentedMeta = enrichComponentMeta(message, meta);
          const iteration = parseIterationValue(meta);
          if (iteration !== null) currentIteration = iteration;
          currentEvaluationRole = updateEvaluationRole(currentEvaluationRole, String(message ?? ""));
          const rowMeta = telemetryRowStorage.getStore();
          const metaWithRow = rowMeta
            ? {
                ...(augmentedMeta && typeof augmentedMeta === "object"
                  ? (augmentedMeta as Record<string, unknown>)
                  : {}),
                rowId: rowMeta.id,
                rowInput: rowMeta.input,
                rowExpected: rowMeta.expectedOutput,
              }
            : augmentedMeta;
          await sendJson(writer, {
            type: "log",
            level,
            channel: classifyLogChannel(level, String(message ?? "")),
            message,
            meta: metaWithRow,
            ts: Date.now(),
          });
        },
      });

      const persistence = new StreamingPersistence(
        (checkpoint) => {
          void sendJson(writer, {
            type: "checkpoint",
            checkpoint,
            ...(resumeMetadata ? { resumeMetadata } : {}),
            ts: Date.now(),
          }).catch(() => {});
        },
        initialCheckpoint,
        (record) => {
          void sendJson(writer, {
            type: "archive",
            record,
            ts: Date.now(),
          }).catch(() => {});
        },
      );

      const gepa = new GEPA({
        seedCandidate: { system: data.seedSystemPrompt },
        trainset: trainDataset.tasks,
        valset: validationDataset ? validationDataset.tasks : undefined,
        adapter,
        reflectionLM: reflectionGenerator,
        reflectionLMProviderOptions: providerOptions,
        maxIterations: data.maxIterations,
        maxMetricCalls: data.maxMetricCalls,
        maxBudgetUSD: data.maxBudgetUSD,
        reflectionMinibatchSize: data.reflectionMinibatchSize,
        reflectionHint: data.reflectionHint,
        candidateSelectionStrategy: data.candidateSelectionStrategy,
        skipPerfectScore: data.skipPerfectScore,
        componentSelector: "all",
        persistence: {
          dir: "",
          resume: Boolean(initialCheckpoint),
          checkpointEveryIterations: 1,
        },
        logger: {
          log: async (level: string, message: string, meta?: unknown) => {
            const augmentedMeta = enrichComponentMeta(message, meta);
            const iteration = parseIterationValue(meta);
            if (iteration !== null) currentIteration = iteration;
            currentEvaluationRole = updateEvaluationRole(currentEvaluationRole, message);
            const rowMeta = telemetryRowStorage.getStore();
            const metaWithRow = rowMeta
              ? {
                  ...(augmentedMeta && typeof augmentedMeta === "object"
                    ? (augmentedMeta as Record<string, unknown>)
                    : {}),
                  rowId: rowMeta.id,
                  rowInput: rowMeta.input,
                  rowExpected: rowMeta.expectedOutput,
                }
              : augmentedMeta;
            await sendJson(writer, {
              type: "log",
              level,
              message,
              meta: metaWithRow,
              ts: Date.now(),
            });
          },
        },
      });

      (gepa as unknown as { persistence?: StreamingPersistence }).persistence = persistence;
      (gepa as unknown as { checkpointEveryIterations: number }).checkpointEveryIterations = 1;

      const result = await gepa.optimize();

      let trainScoreboardRows: ScoreboardRowPayload[] = [];
      let validationScoreboardRows: ScoreboardRowPayload[] = [];
      if (data.scorers.length > 0) {
        try {
          adapter.setScorers(data.scorers);
          const evaluation = await adapter.evaluate(
            trainDataset.tasks,
            result.bestCandidate,
            true,
          );
          trainScoreboardRows = await computeScoreboard(
            trainDataset.rows,
            evaluation.outputs,
            data.scorers,
            providerOptions,
            gatewayProvider,
          );
          if (validationDataset) {
            const valEvaluation = await adapter.evaluate(
              validationDataset.tasks,
              result.bestCandidate,
              true,
            );
            validationScoreboardRows = await computeScoreboard(
              validationDataset.rows,
              valEvaluation.outputs,
              data.scorers,
              providerOptions,
              gatewayProvider,
            );
          }
        } catch (scoreError) {
          const message = scoreError instanceof Error ? scoreError.message : String(scoreError);
          const errorRow = (row: DatasetRowMeta): ScoreboardRowPayload => ({
            id: row.id,
            total: null,
            scorers: Object.fromEntries(
              data.scorers.map((scorer) => [
                scorer.id,
                {
                  value: null,
                  status: "error",
                  notes: `Failed to compute scorer: ${message}`,
                } satisfies ScoreCellPayload,
              ]),
            ),
          });

          trainScoreboardRows = trainDataset.rows.map(errorRow);
          if (validationDataset) {
            validationScoreboardRows = validationDataset.rows.map(errorRow);
          }
        }
      }

      await sendJson(writer, {
        type: "result",
        result,
        ts: Date.now(),
      });

      if (trainScoreboardRows.length > 0 || validationScoreboardRows.length > 0) {
        await sendJson(writer, {
          type: "scoreboard",
          datasets: {
            training: trainScoreboardRows,
            validation: validationScoreboardRows,
          },
          ts: Date.now(),
        });
      }

      await sendJson(writer, { type: "status", status: "completed", ts: Date.now() });
    } catch (error) {
      await sendJson(writer, {
        type: "error",
        message: error instanceof Error ? error.message : String(error),
        ts: Date.now(),
      });
    } finally {
      await writer.close();
    }
  })();

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Transfer-Encoding": "chunked",
    },
  });
}
