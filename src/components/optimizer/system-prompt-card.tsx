"use client";

import { useId } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";

import type { RunStatus } from "./types";

type SystemPromptCardProps = {
  value: string;
  onChange: (next: string) => void;
  status: RunStatus;
};

export function SystemPromptCard({ value, onChange, status }: SystemPromptCardProps) {
  const textareaId = useId();
  return (
    <Card className="border-neutral-200 shadow-sm">
      <CardHeader className="gap-1 pb-1">
        <CardTitle className="text-base">System Prompt</CardTitle>
        <CardDescription className="text-xs text-neutral-500">
          Add your system prompt below. This will be used as the starting point for GEPA to improve.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-1 pt-1">
        <label htmlFor={textareaId} className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
          Prompt
        </label>
        <Textarea
          id={textareaId}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="min-h-[120px] resize-vertical text-[13px]"
          placeholder="Provide the baseline assistant behavior..."
          disabled={status === "running" || status === "starting"}
        />
      </CardContent>
    </Card>
  );
}
