import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import type { GEPAResult } from "@currentai/dsts"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function extractLatencyMs(result?: GEPAResult | null): number | undefined {
  if (!result) return undefined

  const values: number[] = []

  if (Array.isArray(result.paretoFront)) {
    for (const entry of result.paretoFront) {
      const raw = entry?.scores?.latency
      if (typeof raw === "number" && Number.isFinite(raw)) {
        values.push(raw)
      }
    }
  }

  if (Array.isArray(result.history)) {
    for (const event of result.history) {
      const raw = event?.scores?.latency
      if (typeof raw === "number" && Number.isFinite(raw)) {
        values.push(raw)
      }
    }
  }

  if (values.length === 0) return undefined

  let best = Number.POSITIVE_INFINITY
  for (const raw of values) {
    const ms = raw < 0 ? -raw : raw
    if (ms < best) {
      best = ms
    }
  }

  return Number.isFinite(best) ? best : undefined
}
