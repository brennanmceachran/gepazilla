export type OptimizerPhase =
  | "parent_minibatch"
  | "candidate_minibatch"
  | "candidate_full"
  | "reflection";

export const CORE_PHASES: OptimizerPhase[] = [
  "parent_minibatch",
  "candidate_minibatch",
  "candidate_full",
];

export const OPTIONAL_PHASES: OptimizerPhase[] = ["reflection"];

export const DEFAULT_PHASE_DURATION_MS: Record<OptimizerPhase, number> = {
  reflection: 12000,
  parent_minibatch: 16000,
  candidate_minibatch: 20000,
  candidate_full: 24000,
};

export const DEFAULT_FINALIZING_DURATION_MS = 60000;

const ROLE_ALIAS_ENTRIES: Array<[string, OptimizerPhase]> = [
  ["parent_minibatch", "parent_minibatch"],
  ["candidate_minibatch", "candidate_minibatch"],
  ["candidate_full", "candidate_full"],
  ["candidate_full_dataset", "candidate_full"],
  ["candidate_full_pass", "candidate_full"],
  ["reflection", "reflection"],
  ["reflection_dataset", "reflection"],
  ["reflection_hint", "reflection"],
  ["reflection_generate", "reflection"],
  ["reflection_update", "reflection"],
  ["reflection_apply", "reflection"],
];

export const ROLE_ALIAS_MAP: Record<string, OptimizerPhase> = Object.fromEntries(
  ROLE_ALIAS_ENTRIES,
);

export function normalizePhaseRole(role: string | null | undefined): OptimizerPhase | null {
  if (!role) return null;
  const normalized = ROLE_ALIAS_MAP[role];
  return normalized ?? null;
}
