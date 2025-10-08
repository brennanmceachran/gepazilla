import { afterEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import type { GatewayLanguageModelEntry } from "@ai-sdk/gateway";

import { GET as modelsGet } from "@/app/api/models/route";

type GatewayModelStub = {
  id: string;
  modelType: "language" | "embedding" | "image" | null;
  name?: string;
  description?: string;
};

const sharedModels: GatewayModelStub[] = [];

vi.mock("@ai-sdk/gateway", () => {
  const getAvailableModels = vi.fn(async () => ({
    models: sharedModels as unknown as GatewayLanguageModelEntry[],
  }));
  return {
    gateway: { getAvailableModels },
    createGateway: vi.fn(() => ({ getAvailableModels })),
  };
});

const toJson = async (response: Response) => ({
  status: response.status,
  body: await response.json(),
});

const buildRequest = (init?: RequestInit) =>
  new Request("http://localhost/api/models", {
    headers: {
      "x-gepa-gateway-key": "test-key",
      ...(init?.headers ?? {}),
    },
    ...init,
  });

afterEach(() => {
  sharedModels.length = 0;
  vi.clearAllMocks();
});

describe("/api/models GET", () => {
  it("filters for language models and defaults fields", async () => {
    sharedModels.push(
      { id: "lang-1", modelType: "language", name: "Alpha", description: "" },
      { id: "vision-1", modelType: "image", name: "Vision", description: "" },
      { id: "legacy", modelType: null, name: "legacy", description: "" },
    );

    const response = await modelsGet(buildRequest());
    const { status, body } = await toJson(response);

    expect(status).toBe(200);
    expect(body.models).toEqual([
      { id: "lang-1", name: "Alpha", description: "" },
      { id: "legacy", name: "legacy", description: "" },
    ]);
  });

  it("returns 500 when gateway fails", async () => {
    const mockGateway = await import("@ai-sdk/gateway");
    const getAvailableModels = mockGateway.gateway.getAvailableModels as Mock;
    getAvailableModels.mockRejectedValueOnce(new Error("offline"));

    const response = await modelsGet(buildRequest());
    const { status, body } = await toJson(response);

    expect(status).toBe(500);
    expect(body.error).toBe("offline");
  });

  it("returns 401 when no API key is provided", async () => {
    const response = await modelsGet(new Request("http://localhost/api/models"));
    expect(response.status).toBe(401);
  });
});
