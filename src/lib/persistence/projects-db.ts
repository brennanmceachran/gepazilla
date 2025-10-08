import Dexie, { type Table } from "dexie";

const DB_NAME = "gepazilla-projects";
const DB_VERSION = 1;

export type ProjectRecord = {
  id: string;
  name: string;
  description?: string | null;
  createdAt: number;
  updatedAt: number;
  archived: boolean;
  activeRunId?: string | null;
};

export type ProjectConfigRecord = {
  projectId: string;
  seedSystemPrompt: string;
  taskModel: string;
  reflectionModel: string;
  reflectionHint?: string;
  maxIterations: number;
  reflectionMinibatchSize: number;
  candidateSelectionStrategy: "pareto" | "current_best";
  skipPerfectScore: boolean;
  maxMetricCalls?: number | null;
  maxBudgetUSD?: number | null;
  hasGatewayKey: boolean;
  updatedAt: number;
};

export type DatasetRowRecord = {
  rowId: string;
  projectId: string;
  datasetKey: "training" | "validation";
  index: number;
  input: string;
  expectedOutput?: string;
  checksum: string;
  updatedAt: number;
};

export type ScorerConfigRecord = {
  scorerId: string;
  projectId: string;
  type: string;
  label: string;
  weight: number;
  enabled: boolean;
  params?: Record<string, unknown>;
  updatedAt: number;
};

export type PersistedRunStatus = "starting" | "running" | "completed" | "errored" | "paused" | "aborted";

export type RunSummaryRecord = {
  id: string;
  projectId: string;
  label: string;
  status: PersistedRunStatus;
  startedAt: number;
  finishedAt?: number;
  datasetSize: number;
  bestScore?: number | null;
  hypervolume2D?: number | null;
  iterations?: number | null;
  totalMetricCalls?: number | null;
  totalCostUSD?: number | null;
  error?: string | null;
};

export type RunStateRecord = {
  runId: string;
  projectId: string;
  status: PersistedRunStatus;
  snapshot: unknown;
  iterationOffset: number;
  lastEventTs: number;
};

export type RunRequestRecord = {
  runId: string;
  projectId: string;
  payload: unknown;
  createdAt: number;
};

export type TelemetryChunkRecord = {
  chunkId: string;
  runId: string;
  projectId: string;
  sequence: number;
  spans: unknown[];
};

export type SettingsRecord = {
  key: string;
  value: unknown;
  updatedAt: number;
};

export class ProjectsDatabase extends Dexie {
  projects!: Table<ProjectRecord, string>;
  projectConfigs!: Table<ProjectConfigRecord, string>;
  datasetRows!: Table<DatasetRowRecord, string>;
  scorerConfigs!: Table<ScorerConfigRecord, string>;
  runSummaries!: Table<RunSummaryRecord, string>;
  runStates!: Table<RunStateRecord, string>;
  runRequests!: Table<RunRequestRecord, string>;
  telemetryChunks!: Table<TelemetryChunkRecord, string>;
  settings!: Table<SettingsRecord, string>;

  constructor(name = DB_NAME) {
    super(name);
    this.version(DB_VERSION).stores({
      projects: "&id, updatedAt, archived, activeRunId",
      projectConfigs: "&projectId, updatedAt",
      datasetRows: "&rowId, projectId, datasetKey, index",
      scorerConfigs: "&scorerId, projectId, type, enabled",
      runSummaries: "&id, projectId, status, startedAt, finishedAt",
      runStates: "&runId, projectId, status, lastEventTs",
      runRequests: "&runId, projectId, createdAt",
      telemetryChunks: "&chunkId, runId, projectId, sequence",
      settings: "&key, updatedAt",
    });
  }
}

let browserDb: ProjectsDatabase | null = null;

const isBrowser = typeof window !== "undefined";

export const getProjectsDatabase = (): ProjectsDatabase | null => {
  if (!isBrowser) return null;
  if (!browserDb) {
    browserDb = new ProjectsDatabase();
  }
  return browserDb;
};

export const closeProjectsDatabase = async () => {
  if (!browserDb) return;
  browserDb.close();
  browserDb = null;
};
