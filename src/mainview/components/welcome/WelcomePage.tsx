import { ArrowRight, Clock, FolderOpen, Server, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiClient } from "../../lib/api-client";
import type { RecentProject } from "../../types";

interface WelcomePageProps {
  onOpenLocalProject: () => void;
  onOpenRemoteProject: () => void;
  onSelectRecentProject: (project: RecentProject) => void;
}

export function WelcomePage({
  onOpenLocalProject,
  onOpenRemoteProject,
  onSelectRecentProject,
}: WelcomePageProps) {
  const { t } = useTranslation("common");
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([]);

  useEffect(() => {
    let cancelled = false;
    apiClient
      .call("project.listRecent", {})
      .then((result) => {
        if (cancelled) return;
        setRecentProjects((result.projects as RecentProject[]).slice(0, 4));
      })
      .catch(() => {
        if (!cancelled) setRecentProjects([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="min-h-screen bg-bg-primary text-text-primary">
      <div className="mx-auto flex min-h-screen w-full max-w-5xl flex-col justify-center px-6 py-10">
        <div className="mb-8 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-border-secondary bg-bg-elevated text-semantic-accent">
            <Sparkles className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-normal text-text-primary">
              {t("welcome.title")}
            </h1>
            <p className="mt-1 text-sm text-text-secondary">{t("welcome.subtitle")}</p>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <button
            type="button"
            onClick={onOpenLocalProject}
            className="group flex min-h-36 flex-col items-start rounded-lg border border-border-secondary bg-bg-elevated p-5 text-left transition-colors hover:border-border-focus hover:bg-surface-hover/40"
          >
            <span className="mb-4 flex h-10 w-10 items-center justify-center rounded-md bg-semantic-accent/12 text-semantic-accent">
              <FolderOpen className="h-5 w-5" />
            </span>
            <span className="text-base font-medium text-text-primary">{t("welcome.localTitle")}</span>
            <span className="mt-1 text-sm leading-5 text-text-secondary">
              {t("welcome.localDescription")}
            </span>
            <span className="mt-auto flex items-center gap-1 pt-4 text-sm font-medium text-semantic-accent">
              {t("welcome.openLocal")}
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </span>
          </button>

          <button
            type="button"
            onClick={onOpenRemoteProject}
            className="group flex min-h-36 flex-col items-start rounded-lg border border-border-secondary bg-bg-elevated p-5 text-left transition-colors hover:border-border-focus hover:bg-surface-hover/40"
          >
            <span className="mb-4 flex h-10 w-10 items-center justify-center rounded-md bg-status-info/12 text-status-info">
              <Server className="h-5 w-5" />
            </span>
            <span className="text-base font-medium text-text-primary">
              {t("welcome.remoteTitle")}
            </span>
            <span className="mt-1 text-sm leading-5 text-text-secondary">
              {t("welcome.remoteDescription")}
            </span>
            <span className="mt-auto flex items-center gap-1 pt-4 text-sm font-medium text-status-info">
              {t("welcome.connectRemote")}
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </span>
          </button>
        </div>

        {recentProjects.length > 0 && (
          <div className="mt-8">
            <div className="mb-3 flex items-center gap-2 text-sm font-medium text-text-secondary">
              <Clock className="h-4 w-4" />
              {t("welcome.recentProjects")}
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              {recentProjects.map((project) => (
                <button
                  key={project.path}
                  type="button"
                  onClick={() => onSelectRecentProject(project)}
                  className="flex items-center gap-3 rounded-lg border border-border-secondary bg-bg-elevated/60 px-3 py-2.5 text-left transition-colors hover:border-border-focus hover:bg-surface-hover/40"
                >
                  {project.runtime === "ssh" ? (
                    <Server className="h-4 w-4 shrink-0 text-status-info/80" />
                  ) : (
                    <FolderOpen className="h-4 w-4 shrink-0 text-semantic-accent/80" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-text-primary">
                      {project.name}
                    </span>
                    <span className="block truncate text-xs text-text-tertiary">
                      {project.remote
                        ? `${project.remote.host}:${project.remote.remotePath}`
                        : project.path}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
