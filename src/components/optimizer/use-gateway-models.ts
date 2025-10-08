"use client";

import { useEffect, useState } from "react";

export type ModelOption = {
  id: string;
  label: string;
  description?: string;
};

export const FALLBACK_MODELS: ModelOption[] = [
  { id: "openai/gpt-5-nano", label: "OpenAI GPT-5 nano" },
  { id: "openai/gpt-5-mini", label: "OpenAI GPT-5 mini" },
  { id: "openai/gpt-4o-mini", label: "OpenAI GPT-4o mini" },
  { id: "openai/gpt-4.1-mini", label: "OpenAI GPT-4.1 mini" },
  { id: "openai/o3-mini", label: "OpenAI o3 mini" },
  { id: "anthropic/claude-3.5-haiku", label: "Anthropic Claude 3.5 Haiku" },
  { id: "anthropic/claude-3.5-sonnet", label: "Anthropic Claude 3.5 Sonnet" },
];

type UseGatewayModelsOptions = {
  apiKey?: string | null;
  enabled: boolean;
};

export function useGatewayModels(options: UseGatewayModelsOptions) {
  const { apiKey, enabled } = options;
  const [models, setModels] = useState<ModelOption[]>(FALLBACK_MODELS);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const trimmedKey = apiKey?.trim();

    if (!enabled && !trimmedKey) {
      setModels(FALLBACK_MODELS);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();

    (async () => {
      try {
        setLoading(true);
        setError(null);
        const init: RequestInit = { signal: controller.signal };
        if (trimmedKey) {
          init.headers = { "X-GEPA-Gateway-Key": trimmedKey };
        }

        const response = await fetch("/api/models", init);
        if (cancelled) return;

        if (response.status === 401) {
          setModels(FALLBACK_MODELS);
          return;
        }

        if (!response.ok) {
          setError(`Failed to load models (status ${response.status})`);
          return;
        }

        const data = (await response.json()) as {
          models?: Array<{ id: string; name: string; description?: string }>;
        };

        if (!data.models || data.models.length === 0) {
          return;
        }

        setModels(
          data.models.map((model) => ({
            id: model.id,
            label: model.name,
            description: model.description,
          })),
        );
      } catch (error) {
        if (controller.signal.aborted || cancelled) return;
        setError(error instanceof Error ? error.message : String(error));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [apiKey, enabled]);

  return {
    models,
    loading,
    error,
  };
}
