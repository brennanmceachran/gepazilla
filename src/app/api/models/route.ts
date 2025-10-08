import { NextResponse } from "next/server";
import { createGateway } from "@ai-sdk/gateway";

export async function GET(request: Request) {
  const headerGatewayKey = request.headers.get("x-gepa-gateway-key")?.trim() ?? "";
  const envGatewayKey = process.env.AI_GATEWAY_API_KEY?.trim() ?? "";
  const gatewayKey = headerGatewayKey || envGatewayKey;
  if (!gatewayKey) {
    return NextResponse.json(
      {
        error:
          "AI Gateway API key missing. Supply one via the Run dock or set AI_GATEWAY_API_KEY on the server.",
      },
      { status: 401 },
    );
  }
  const provider = createGateway({ apiKey: gatewayKey });

  try {
    const { models } = await provider.getAvailableModels();
    const languageModels = models
      .filter((model) => model.modelType === "language" || model.modelType == null)
      .map((model) => ({
        id: model.id,
        name: model.name ?? model.id,
        description: model.description ?? "",
      }));

    return NextResponse.json({ models: languageModels });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to fetch models";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
