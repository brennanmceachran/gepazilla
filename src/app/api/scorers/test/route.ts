import { z } from "zod";

import { scorerConfigSchema } from "@/lib/schemas";
import { evaluateScorer, type ScorerEvaluation } from "@/lib/scorers";

const datasetItemSchema = z.object({
  id: z.string().min(1),
  input: z.string().min(1, "Input is required"),
  expectedOutput: z.string().optional(),
  candidate: z.unknown().optional(),
});

const requestSchema = z.object({
  scorer: scorerConfigSchema,
  dataset: z.array(datasetItemSchema).min(1, "Provide at least one row to grade"),
});

type RequestPayload = z.infer<typeof requestSchema>;

type TestRowResult = {
  id: string;
  evaluation: ScorerEvaluation;
};

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

  const parsed = requestSchema.safeParse(json);
  if (!parsed.success) {
    return new Response(
      JSON.stringify({ error: "Invalid configuration", details: parsed.error.flatten() }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  const payload: RequestPayload = parsed.data;
  const { scorer, dataset } = payload;

  try {
    const rows: TestRowResult[] = [];

    for (const row of dataset) {
      const candidate = row.candidate ?? row.expectedOutput;
      const evaluation = await evaluateScorer(scorer, {
        input: row.input,
        expectedOutput: row.expectedOutput,
        candidate,
      });
      rows.push({ id: row.id, evaluation });
    }

    return new Response(
      JSON.stringify({ scorerId: scorer.id, rows }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: "Failed to evaluate scorer",
        details: error instanceof Error ? error.message : String(error),
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}
