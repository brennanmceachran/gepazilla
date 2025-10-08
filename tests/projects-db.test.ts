import { describe, expect, it, afterEach } from "vitest";
import "fake-indexeddb/auto";

import {
  ProjectsDatabase,
  type ProjectRecord,
  type ProjectConfigRecord,
} from "@/lib/persistence/projects-db";

const activeDatabases = new Set<ProjectsDatabase>();

const createDatabase = () => {
  const db = new ProjectsDatabase(`test-${crypto.randomUUID()}`);
  activeDatabases.add(db);
  return db;
};

afterEach(async () => {
  for (const db of activeDatabases) {
    try {
      await db.delete();
    } catch {
      db.close();
    }
  }
  activeDatabases.clear();
});

describe("ProjectsDatabase", () => {
  it("initializes all expected tables", async () => {
    const db = createDatabase();
    await db.open();
    const tableNames = db.tables.map((table) => table.name).sort();
    expect(tableNames).toEqual([
      "datasetRows",
      "projectConfigs",
      "projects",
      "runRequests",
      "runStates",
      "runSummaries",
      "scorerConfigs",
      "settings",
      "telemetryChunks",
    ]);
  });

  it("persists project metadata and configuration", async () => {
    const db = createDatabase();
    const now = Date.now();
    const project: ProjectRecord = {
      id: "proj-1",
      name: "Test Project",
      createdAt: now,
      updatedAt: now,
      archived: false,
      activeRunId: null,
      description: "snapshot",
    };
    const config: ProjectConfigRecord = {
      projectId: "proj-1",
      seedSystemPrompt: "prompt",
      taskModel: "openai/gpt-5-nano",
      reflectionModel: "openai/gpt-5-mini",
      reflectionHint: "",
      maxIterations: 5,
      reflectionMinibatchSize: 3,
      candidateSelectionStrategy: "pareto",
      skipPerfectScore: true,
      maxMetricCalls: 10,
      maxBudgetUSD: 1,
      hasGatewayKey: false,
      updatedAt: now,
    };

    await db.transaction("rw", db.projects, db.projectConfigs, async () => {
      await db.projects.put(project);
      await db.projectConfigs.put(config);
    });

    const storedProject = await db.projects.get(project.id);
    expect(storedProject?.name).toBe("Test Project");

    const storedConfig = await db.projectConfigs.get(project.id);
    expect(storedConfig?.seedSystemPrompt).toBe("prompt");
    expect(storedConfig?.candidateSelectionStrategy).toBe("pareto");
  });
});
