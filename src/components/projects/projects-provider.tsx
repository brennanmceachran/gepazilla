"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";

import {
  createProject as createProjectRecord,
  listProjects,
  type CreateProjectInput,
  type ProjectListItem,
} from "@/lib/projects/store";

type ProjectsContextValue = {
  projects: ProjectListItem[];
  activeProjectId: string | null;
  loading: boolean;
  setActiveProjectId: (projectId: string | null) => void;
  refresh: () => Promise<void>;
  createProject: (input?: CreateProjectInput) => Promise<string>;
};

const ProjectsContext = createContext<ProjectsContextValue | undefined>(undefined);

export const ProjectsStoreProvider = ({ children }: PropsWithChildren) => {
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await listProjects();
      setProjects(list);
      if (list.length > 0 && !activeProjectId) {
        setActiveProjectId(list[0].id);
      }
    } finally {
      setLoading(false);
    }
  }, [activeProjectId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const createProject = useCallback(async (input?: CreateProjectInput) => {
    const record = await createProjectRecord(input);
    setProjects((prev) => [
      {
        ...record,
        status: "idle",
      },
      ...prev,
    ]);
    setActiveProjectId((prev) => prev ?? record.id);
    return record.id;
  }, []);

  const value = useMemo<ProjectsContextValue>(
    () => ({
      projects,
      activeProjectId,
      loading,
      setActiveProjectId,
      refresh,
      createProject,
    }),
    [projects, activeProjectId, loading, refresh, createProject],
  );

  return <ProjectsContext.Provider value={value}>{children}</ProjectsContext.Provider>;
};

export const useProjectsStore = (): ProjectsContextValue => {
  const context = useContext(ProjectsContext);
  if (!context) {
    throw new Error("useProjectsStore must be used within ProjectsStoreProvider");
  }
  return context;
};
