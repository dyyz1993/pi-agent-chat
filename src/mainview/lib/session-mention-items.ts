import type { ProjectTab, SessionMeta } from "../types";

export type SessionMentionScope = "recent" | "current" | "global";
export type SessionMentionAction = "reference" | "jump";

export interface SessionMentionItem {
  id: string;
  sessionId: string;
  label: string;
  description: string;
  projectPath: string;
  insertText: string;
  updatedAt: number;
  interactionRank: number;
  action: SessionMentionAction;
}

interface BuildSessionMentionItemsInput {
  sessionsByProject: Record<string, SessionMeta[]>;
  projectTabs: ProjectTab[];
  activeProjectId: string | null;
  scope: SessionMentionScope;
  action: SessionMentionAction;
}

function compact(value: string | null | undefined, fallback: string): string {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, 80) : fallback;
}

function projectLabel(projectTabs: ProjectTab[], projectPath: string): string {
  const tab = projectTabs.find((item) => item.path === projectPath);
  const parts = projectPath.split("/").filter(Boolean);
  return tab?.name || parts[parts.length - 1] || projectPath;
}

function interactionRank(session: SessionMeta): number {
  if (session.delegateParentSessionId || session.delegateType || session.parentSessionPath) return 0;
  if (session.messageCount > 0 || session.firstMessage) return 1;
  return 2;
}

export function buildSessionMentionItems({
  sessionsByProject,
  projectTabs,
  activeProjectId,
  scope,
  action,
}: BuildSessionMentionItemsInput): SessionMentionItem[] {
  const activeTab = projectTabs.find((item) => item.id === activeProjectId) ?? null;
  const activeProjectPath = activeTab?.path ?? null;
  const entries = Object.entries(sessionsByProject).flatMap(([projectPath, sessions]) =>
    sessions.map((session) => ({ projectPath, session })),
  );

  const scoped = entries.filter(({ projectPath, session }) => {
    if (scope === "current") return activeProjectPath ? projectPath === activeProjectPath : false;
    if (scope === "recent") {
      return Boolean(
        session.delegateParentSessionId ||
          session.delegateType ||
          session.parentSessionPath ||
          session.messageCount > 0 ||
          session.firstMessage,
      );
    }
    return true;
  });

  const source = scoped.length > 0 || scope !== "recent" ? scoped : entries;

  return source
    .map(({ projectPath, session }) => {
      const label = compact(session.name, compact(session.firstMessage, session.sessionId));
      const project = projectLabel(projectTabs, projectPath);
      const shortId = session.sessionId.slice(0, 8);
      const kind =
        session.delegateType === "subagent"
          ? "Sub-agent"
          : session.delegateType
            ? "Delegated"
            : "Session";
      return {
        id: `${action}-session-${session.sessionId}`,
        sessionId: session.sessionId,
        label,
        description: `${project} · ${kind} · ${shortId}`,
        projectPath,
        insertText: `@session:${session.sessionId}`,
        updatedAt: session.updatedAt || session.createdAt || 0,
        interactionRank: interactionRank(session),
        action,
      };
    })
    .sort((a, b) => {
      if (a.interactionRank !== b.interactionRank) return a.interactionRank - b.interactionRank;
      return b.updatedAt - a.updatedAt;
    })
    .slice(0, 50);
}
