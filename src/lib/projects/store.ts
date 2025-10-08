import { getProjectsDatabase, type ProjectRecord, type ProjectsDatabase } from "@/lib/persistence/projects-db";
import { runEngine, type RunEngine, type RunEngineStatus } from "@/lib/run-engine";

export type ProjectListItem = ProjectRecord & {
  status: RunEngineStatus | "idle";
};

export type CreateProjectInput = {
  name?: string;
  description?: string | null;
};

export type ProjectsStoreDependencies = {
  database?: ProjectsDatabase | null;
  engine?: RunEngine;
};

const DEFAULT_NAME = "Untitled project";

const resolveDatabase = (deps?: ProjectsStoreDependencies): ProjectsDatabase | null => {
  if (deps?.database !== undefined) return deps.database;
  return getProjectsDatabase();
};

const resolveEngine = (deps?: ProjectsStoreDependencies): RunEngine => {
  if (deps?.engine) return deps.engine;
  return runEngine;
};

const deriveStatus = (projectId: string, engine: RunEngine): RunEngineStatus | "idle" => {
  const handles = engine.listByProject(projectId);
  if (handles.length === 0) return "idle";
  const priority: RunEngineStatus[] = ["running", "starting", "paused", "completed", "errored", "aborted"];
  const ordered = [...handles].sort(
    (a, b) => priority.indexOf(a.status) - priority.indexOf(b.status),
  );
  return ordered[0]?.status ?? "idle";
};

export const listProjects = async (deps?: ProjectsStoreDependencies): Promise<ProjectListItem[]> => {
  const db = resolveDatabase(deps);
  if (!db) return [];
  const engine = resolveEngine(deps);
  const records = await db.projects.orderBy("updatedAt").reverse().toArray();
  return records.map((record) => ({
    ...record,
    status: deriveStatus(record.id, engine),
  }));
};

export const createProject = async (
  input: CreateProjectInput = {},
  deps?: ProjectsStoreDependencies,
): Promise<ProjectRecord> => {
  const db = resolveDatabase(deps);
  if (!db) {
    throw new Error("Projects database is not available in this environment.");
  }
  const now = Date.now();
  const record: ProjectRecord = {
    id: crypto.randomUUID(),
    name: input.name?.trim().length ? input.name.trim() : DEFAULT_NAME,
    description: input.description ?? null,
    createdAt: now,
    updatedAt: now,
    archived: false,
    activeRunId: null,
  };
  await db.transaction("rw", db.projects, async () => {
    await db.projects.put(record);
  });
  return record;
};

export const markProjectUpdated = async (
  projectId: string,
  deps?: ProjectsStoreDependencies,
): Promise<void> => {
  const db = resolveDatabase(deps);
  if (!db) return;
  await db.projects.update(projectId, { updatedAt: Date.now() });
};
