"use client";

import type { LogChannel } from "../../types";
import { cn } from "@/lib/utils";

type LogLevelToggleProps = {
  level: LogChannel;
  label: string;
  active: boolean;
  onToggle: () => void;
};

export function LogLevelToggle({ level, label, active, onToggle }: LogLevelToggleProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      data-channel={level}
      className={cn(
        "rounded-md border px-2 py-1 uppercase",
        active ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300 text-neutral-600",
      )}
    >
      {label}
    </button>
  );
}
