import type { SessionMeta } from "../types";

export type SessionIdentityKind = "delegate" | "subagent" | "fork";

export interface SessionIdentity {
  kind: SessionIdentityKind;
  label: string;
  shortLabel: string;
  title: string;
}

type IdentitySession = Pick<SessionMeta, "sessionId" | "delegateParentSessionId" | "delegateType">;

export function getSessionIdentity(
  session: IdentitySession | null | undefined,
): SessionIdentity | null {
  if (!session) return null;
  const delegateType = session.delegateType ?? "";
  const sessionId = session.sessionId ?? "";

  if (delegateType === "subagent" || sessionId.startsWith("sess_sub_")) {
    return {
      kind: "subagent",
      label: "子任务",
      shortLabel: "子任务",
      title: "子任务会话",
    };
  }

  if (delegateType === "fork") {
    return {
      kind: "fork",
      label: "Fork",
      shortLabel: "Fork",
      title: "Fork 会话",
    };
  }

  if (
    delegateType === "coordinator" ||
    session.delegateParentSessionId ||
    sessionId.startsWith("sess_coord_")
  ) {
    return {
      kind: "delegate",
      label: "委派",
      shortLabel: "委派",
      title: "委派子任务会话",
    };
  }

  return null;
}

export function getProjectDisplayName(projectPath: string | null | undefined): string {
  const value = (projectPath ?? "").trim();
  if (!value) return "";
  const trimmed = value.replace(/\/+$/, "");
  if (!trimmed) return "/";
  return trimmed.split("/").filter(Boolean).pop() ?? trimmed;
}
