import { afterEach, describe, expect, it } from "vitest";
import "fake-indexeddb/auto";

import { ProjectsDatabase } from "@/lib/persistence/projects-db";
import { RunEngine } from "@/lib/run-engine";
import { createProject, listProjects } from "@/lib/projects/store";

const activeDatabases = new Set<ProjectsDatabase>();

const createDatabase = () => {
  const db = new ProjectsDatabase(`projects-store-${crypto.randomUUID()}`);
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

describe("projects store", () => {
  it("creates projects with sensible defaults", async () => {
    const db = createDatabase();
    const project = await createProject(
      { name: "", description: null },
      { database: db },
    );
    expect(project.name).toBe("Untitled project");
    const stored = await db.projects.get(project.id);
    expect(stored?.id).toBe(project.id);
  });

  it("lists projects with engine-derived status", async () => {
    const db = createDatabase();
    const engine = new RunEngine();
    const project = await createProject({ name: "Alpha" }, { database: db });
    const started = engine.start(project.id, { payload: {} });
    expect(started.runId).toBeDefined();
    const projects = await listProjects({ database: db, engine });
    expect(projects).toHaveLength(1);
    expect(projects[0]?.status).toBe("starting");
  });
});
