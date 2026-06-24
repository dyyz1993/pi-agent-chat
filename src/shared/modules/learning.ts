export type LearningMode = "off" | "pending" | "auto";
export type LearningCuratorMode = "dry-run" | "pending" | "auto";
export type LearningDomain = "memory" | "skill" | "curator";
export type LearningCandidateStatus = "pending" | "approved" | "rejected";
export type LearningCandidateAction =
  | "create-memory"
  | "update-memory"
  | "create-skill"
  | "merge-skill"
  | "archive-skill"
  | "restore-skill"
  | "disable-skill"
  | "promote-skill"
  | "curator-report";
export type LearningFileKind =
  | "memory"
  | "memory-index"
  | "skill"
  | "skill-entrypoint"
  | "skill-reference"
  | "skill-script"
  | "skill-template"
  | "skill-asset"
  | "run"
  | "candidate";

export interface LearningFileRef {
  path: string;
  label: string;
  kind: LearningFileKind;
  exists: boolean;
  size?: number;
  mtimeMs?: number;
}

export interface LearningCuratorSchedule {
  enabled: boolean;
  intervalMinutes: number;
}

export interface LearningConfig {
  version: 1;
  enabled: boolean;
  memory: {
    recallEnabled: boolean;
    extractMode: LearningMode;
    curatorMode: LearningCuratorMode;
    curatorSchedule: LearningCuratorSchedule;
  };
  skills: {
    distillMode: LearningMode;
    curatorMode: LearningCuratorMode;
    curatorSchedule: LearningCuratorSchedule;
  };
}

export interface LearningMemoryCandidatePayload {
  type: "memory";
  filename: string;
  description: string;
  memoryType: "user" | "feedback" | "project" | "reference" | "bookmark";
  content: string;
}

export interface LearningSkillCandidatePayload {
  type: "skill";
  name: string;
  description: string;
  body: string;
  targetSkillName?: string;
  files?: Array<{ relativePath: string; content: string }>;
  pinned?: boolean;
}

export interface LearningCuratorCandidatePayload {
  type: "curator";
  domain: "memory" | "skill";
  report: string;
  actions: Array<{
    action: LearningCandidateAction;
    targetId?: string;
    targetPath?: string;
    summary: string;
    fileRefs?: LearningFileRef[];
  }>;
}

export type LearningCandidatePayload =
  | LearningMemoryCandidatePayload
  | LearningSkillCandidatePayload
  | LearningCuratorCandidatePayload;

export interface LearningCandidate {
  version: 1;
  id: string;
  domain: LearningDomain;
  action: LearningCandidateAction;
  status: LearningCandidateStatus;
  title: string;
  summary: string;
  confidence: "low" | "medium" | "high";
  sourceSessionId?: string;
  sourceMessageIds?: string[];
  createdAt: number;
  decidedAt?: number;
  decision?: "approved" | "rejected";
  targetId?: string;
  targetPath?: string;
  payload: LearningCandidatePayload;
  fileRefs: LearningFileRef[];
}

export interface LearningMemorySummary {
  filename: string;
  filePath: string;
  description: string | null;
  type: string | null;
  mtimeMs: number;
  size: number;
  state: "active" | "archived";
}

export interface LearningSkillSummary {
  name: string;
  description: string;
  scope: "project-private" | "project-shared" | "global";
  source: "generated" | "user" | "project" | "package";
  state: "active" | "disabled" | "archived";
  usageCount: number;
  lastUsedAt: number | null;
  patchCount: number;
  filePath: string;
  baseDir: string;
  pinned: boolean;
  files: LearningFileRef[];
}

export interface LearningRun {
  version: 1;
  id: string;
  domain: LearningDomain;
  type: "memory-extract" | "skill-distill" | "memory-curator" | "skill-curator" | "candidate-decision";
  mode: LearningMode | LearningCuratorMode | "manual";
  status: "started" | "completed" | "failed";
  startedAt: number;
  completedAt?: number;
  summary: string;
  actions: Array<{
    action: LearningCandidateAction | "none";
    targetId?: string;
    targetPath?: string;
    summary: string;
    fileRefs?: LearningFileRef[];
  }>;
  error?: string;
}

export interface LearningOverview {
  memoryFiles: number;
  activeSkills: number;
  disabledSkills: number;
  archivedSkills: number;
  pendingCandidates: number;
  warnings: number;
  lastRunAt: number | null;
}

export interface LearningSnapshot {
  version: 1;
  projectRoot: string;
  dirs: {
    learningDir: string;
    memoryDir: string;
    skillsDir: string;
  };
  config: LearningConfig;
  overview: LearningOverview;
  memory: {
    files: LearningMemorySummary[];
    entrypoint: LearningFileRef | null;
    diagnostics: string[];
  };
  skills: {
    items: LearningSkillSummary[];
    diagnostics: string[];
  };
  candidates: LearningCandidate[];
  runs: LearningRun[];
}

export interface LearningMethods {
  "learning.getSnapshot": {
    params: { projectPath: string; sessionId?: string };
    result: LearningSnapshot;
  };
  "learning.setConfig": {
    params: { projectPath: string; sessionId?: string; config: Partial<LearningConfig> };
    result: LearningSnapshot;
  };
  "learning.approveCandidate": {
    params: { projectPath: string; sessionId?: string; candidateId: string; mergeTargetSkillName?: string };
    result: LearningSnapshot;
  };
  "learning.rejectCandidate": {
    params: { projectPath: string; sessionId?: string; candidateId: string };
    result: LearningSnapshot;
  };
  "learning.runCurator": {
    params: { projectPath: string; sessionId?: string; domain: "memory" | "skill"; mode?: LearningCuratorMode };
    result: LearningRun;
  };
}

export interface LearningEvents {
  "learning.snapshot": { sessionId: string; snapshot: LearningSnapshot; timestamp: number };
  "learning.run": { sessionId: string; run: LearningRun; timestamp: number };
  "learning.candidate": { sessionId: string; candidate: LearningCandidate; timestamp: number };
}
