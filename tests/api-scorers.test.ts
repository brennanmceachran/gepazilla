import { describe, expect, it, vi, afterEach } from "vitest";

import { POST as scorersPost } from "@/app/api/scorers/test/route";
import type { ScorerEvaluation } from "@/lib/scorers";

const toJson = async (response: Response) => ({
  status: response.status,
  body: await response.json(),
  headers: Object.fromEntries(response.headers.entries()),
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("/api/scorers/test POST", () => {
  it("returns row evaluations on success", async () => {
    const evaluation: ScorerEvaluation = { status: "ready", value: 0.7, notes: "fine" };
    const spy = vi
      .spyOn(await import("@/lib/scorers"), "evaluateScorer")
      .mockResolvedValue(evaluation);

    const payload = {
      scorer: {
        id: "regex-1",
        label: "Regex",
        type: "regex_presence",
        enabled: true,
        weight: 1,
        params: { pattern: "foo" },
      },
      dataset: [
        { id: "row-1", input: "foo", expectedOutput: "bar", candidate: "foo" },
      ],
    };

    const response = await scorersPost(
      new Request("http://localhost/api/scorers/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
    );

    const { status, body } = await toJson(response);
    const contentType = response.headers.get("content-type");

    expect(status).toBe(200);
    expect(contentType).toMatch(/application\/json/);
    expect(body).toEqual({
      scorerId: "regex-1",
      rows: [{ id: "row-1", evaluation }],
    });

    expect(spy).toHaveBeenCalledOnce();
  });

  it("returns 400 for invalid JSON", async () => {
    const response = await scorersPost(
      new Request("http://localhost/api/scorers/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{",
      }),
    );

    const { status, body } = await toJson(response);
    expect(status).toBe(400);
    expect(body.error).toBe("Invalid JSON payload");
  });

  it("returns 400 for schema violations", async () => {
    const invalidPayload = { scorer: { id: "a" }, dataset: [] };
    const response = await scorersPost(
      new Request("http://localhost/api/scorers/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(invalidPayload),
      }),
    );

    const { status, body } = await toJson(response);
    expect(status).toBe(400);
    expect(body.error).toBe("Invalid configuration");
  });

  it("returns 500 when evaluation fails", async () => {
    const scorers = await import("@/lib/scorers");
    vi.spyOn(scorers, "evaluateScorer").mockRejectedValueOnce(new Error("kaboom"));

    const payload = {
      scorer: {
        id: "regex-1",
        label: "Regex",
        type: "regex_presence",
        enabled: true,
        weight: 1,
        params: { pattern: "foo" },
      },
      dataset: [{ id: "row", input: "foo" }],
    };

    const response = await scorersPost(
      new Request("http://localhost/api/scorers/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
    );

    const { status, body } = await toJson(response);
    expect(status).toBe(500);
    expect(body.error).toBe("Failed to evaluate scorer");
    expect(body.details).toBe("kaboom");
  });
});
