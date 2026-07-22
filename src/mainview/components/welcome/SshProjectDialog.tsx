import {
  AlertTriangle,
  Cable,
  Check,
  CheckCircle2,
  ChevronDown,
  CloudCog,
  Folder,
  FolderOpen,
  FolderPlus,
  KeyRound,
  Loader2,
  Search,
  Settings2,
  UploadCloud,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { classifySshErrorMessage } from "../../../shared/lib/ssh-error-classification";
import { apiClient } from "../../lib/api-client";
import { cx } from "../../lib/classes";
import { useAsyncGuard } from "../../hooks/use-async-guard";
import { Button, DropdownSelect, IconButton } from "../primitives";
import type {
  DetectedSshHost,
  ProjectTab,
  RemoteResourceSyncPreview,
  RemoteSyncResourceType,
  SshConnectionErrorCode,
  SshDirectoryEntry,
  SshProfile,
  SshRuntimeKind,
} from "../../types";

interface SshProjectDialogProps {
  open: boolean;
  onClose: () => void;
  onOpened: (tab: ProjectTab) => void;
}

type WizardStep = "method" | "config" | "resources" | "directory" | "opening";

const stepOrder: WizardStep[] = ["method", "config", "resources", "directory", "opening"];
const REMOTE_SYNC_RESOURCES: Array<{
  type: RemoteSyncResourceType;
  labelKey: string;
  hintKey: string;
}> = [
  {
    type: "skills",
    labelKey: "welcome.remoteSyncSkills",
    hintKey: "welcome.remoteSyncSkillsHint",
  },
  {
    type: "agents",
    labelKey: "welcome.remoteSyncAgents",
    hintKey: "welcome.remoteSyncAgentsHint",
  },
  {
    type: "rules",
    labelKey: "welcome.remoteSyncRules",
    hintKey: "welcome.remoteSyncRulesHint",
  },
];

function DetailItem({ label, value }: { label: string; value?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-medium uppercase tracking-wide text-text-tertiary">
        {label}
      </div>
      <div className="mt-1 truncate font-mono text-sm text-text-primary">{value ?? "-"}</div>
    </div>
  );
}

function RuntimeMethodIcon({
  children,
  tone,
}: {
  children: ReactNode;
  tone: "ssh" | "sandbox" | "docker" | "warning" | "muted";
}) {
  const toneClass =
    tone === "ssh"
      ? "border-runtime-ssh/45 bg-runtime-ssh/10 text-runtime-ssh"
      : tone === "sandbox"
      ? "border-runtime-sandbox/45 bg-runtime-sandbox/10 text-runtime-sandbox"
      : tone === "docker"
        ? "border-runtime-docker/30 bg-runtime-docker/8 text-runtime-docker/60"
        : tone === "warning"
          ? "border-status-warning/45 bg-status-warning/10 text-status-warning"
          : "border-border-secondary bg-surface-hover/40 text-text-tertiary";

  return (
    <span className={`flex h-10 w-10 items-center justify-center rounded-md border ${toneClass}`}>
      {children}
    </span>
  );
}

function firstNonEmpty(...values: Array<string | undefined>): string {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return "";
}

function normalizeRemotePath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) return "";
  if (trimmed === "~") return "~";
  if (trimmed.startsWith("~/")) return `~/${trimmed.slice(2).replace(/\/+$/, "")}`;
  if (trimmed === "/") return "/";
  const withoutTrailingSlash = trimmed.replace(/\/+$/, "");
  if (withoutTrailingSlash.startsWith("/")) return withoutTrailingSlash;
  return `/${withoutTrailingSlash.replace(/^\/+/, "")}`;
}

function joinRemotePath(base: string, name: string): string {
  const cleanBase = normalizeRemotePath(base);
  const cleanName = name.trim().replace(/^\/+/, "").replace(/\/+$/, "");
  if (!cleanName) return cleanBase;
  if (!cleanBase || cleanBase === ".") return cleanName;
  if (cleanBase === "/") return `/${cleanName}`;
  return `${cleanBase}/${cleanName}`;
}

function parentRemotePath(path: string): string | null {
  const normalized = normalizeRemotePath(path);
  if (!normalized || normalized === "/") return null;
  const idx = normalized.lastIndexOf("/");
  if (idx <= 0) return "/";
  return normalized.slice(0, idx);
}

function remoteProjectName(path: string): string {
  const normalized = normalizeRemotePath(path);
  if (!normalized || normalized === "/") return normalized;
  return normalized.split("/").filter(Boolean).pop() ?? normalized;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value >= 10 || unitIndex === 0 ? Math.round(value) : value.toFixed(1)} ${units[unitIndex]}`;
}

function formatSshError(
  t: (key: string) => string,
  input: { error?: string; stderr?: string; errorCode?: SshConnectionErrorCode },
): string {
  const summary = input.errorCode
    ? t(`welcome.remoteError.${input.errorCode}`)
    : t("welcome.remoteTestFailed");
  const detail = firstNonEmpty(input.error, input.stderr);
  if (!detail || detail === summary) return summary;
  return `${summary}\n${detail}`;
}

function formatThrownSshError(t: (key: string) => string, err: unknown): string {
  const candidate = err as { message?: unknown; errorCode?: unknown; stderr?: unknown };
  const message = err instanceof Error ? err.message : String(err);
  const errorCode =
    typeof candidate.errorCode === "string"
      ? (candidate.errorCode as SshConnectionErrorCode)
      : classifySshErrorMessage(message);
  return formatSshError(t, {
    error: message,
    stderr: typeof candidate.stderr === "string" ? candidate.stderr : undefined,
    errorCode,
  });
}

export function SshProjectDialog({ open, onClose, onOpened }: SshProjectDialogProps) {
  const { t } = useTranslation("common");
  const [step, setStep] = useState<WizardStep>("method");
  const [profiles, setProfiles] = useState<SshProfile[]>([]);
  const [detectedHosts, setDetectedHosts] = useState<DetectedSshHost[]>([]);
  const [profileId, setProfileId] = useState("");
  const [sshAlias, setSshAlias] = useState("");
  const [name, setName] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("");
  const [user, setUser] = useState("");
  const [identityFile, setIdentityFile] = useState("");
  const [sshRuntimeKind, setSshRuntimeKind] = useState<SshRuntimeKind>("remote-agent-child");
  const [syncResourcesEnabled, setSyncResourcesEnabled] = useState(true);
  const [selectedSyncResourceTypes, setSelectedSyncResourceTypes] = useState<
    RemoteSyncResourceType[]
  >(["skills", "agents", "rules"]);
  const [remotePath, setRemotePath] = useState("");
  const [browsePath, setBrowsePath] = useState("");
  const [entries, setEntries] = useState<SshDirectoryEntry[]>([]);
  const [newFolderName, setNewFolderName] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [busy, setBusy] = useState<"list" | "create" | "open" | null>(null);
  const [syncPreviewBusy, setSyncPreviewBusy] = useState(false);
  const [syncPreview, setSyncPreview] = useState<RemoteResourceSyncPreview | null>(null);
  const [syncPreviewError, setSyncPreviewError] = useState<string | null>(null);
  const [connectionSourcesLoading, setConnectionSourcesLoading] = useState(false);
  const [connectionSourcesError, setConnectionSourcesError] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);

  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.id === profileId) ?? null,
    [profiles, profileId],
  );

  const selectedDetected = useMemo(
    () => detectedHosts.find((item) => item.host === sshAlias) ?? null,
    [detectedHosts, sshAlias],
  );

  const connectionSelectValue = profileId
    ? `profile:${profileId}`
    : sshAlias
      ? `ssh:${sshAlias}`
      : "";
  const connectionOptions = useMemo(
    () => [
      {
        value: "",
        label: connectionSourcesLoading
          ? t("welcome.remoteProfilesLoading")
          : t("welcome.remoteManual"),
      },
      ...detectedHosts.map((item) => ({
        value: `ssh:${item.host}`,
        label: item.name,
        group: t("welcome.remoteDetectedHosts"),
      })),
      ...profiles.map((profile) => ({
        value: `profile:${profile.id}`,
        label: `${profile.name} · ${profile.host}`,
        group: t("welcome.remoteProfile"),
      })),
    ],
    [connectionSourcesLoading, detectedHosts, profiles, t],
  );
  const connectionHost = firstNonEmpty(selectedProfile?.host, sshAlias, host);
  const connectionTitle =
    firstNonEmpty(sshAlias, selectedProfile?.name, name, host) || t("welcome.remoteManual");
  const canConnect = connectionHost.length > 0 && !busy;
  const canOpen = normalizeRemotePath(remotePath).length > 0 && canConnect;
  const showResourceSync = sshRuntimeKind === "remote-agent-child";
  const syncResourceCount = selectedSyncResourceTypes.length;
  const visibleStepOrder = useMemo(
    () => (showResourceSync ? stepOrder : stepOrder.filter((item) => item !== "resources")),
    [showResourceSync],
  );

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setStep("method");
    setMessage(null);
    setSyncPreview(null);
    setSyncPreviewError(null);
    setSyncPreviewBusy(false);
    setConnectionSourcesLoading(true);
    setConnectionSourcesError(null);
    Promise.all([
      apiClient.call("project.listSshProfiles", {}),
      apiClient.call("project.listDetectedSshHosts", {}),
    ])
      .then(([profileResult, detectedResult]) => {
        if (cancelled) return;
        const nextProfiles = profileResult.profiles as SshProfile[];
        const nextDetected = detectedResult.hosts as DetectedSshHost[];
        setProfiles(nextProfiles);
        setDetectedHosts(nextDetected);

        if (nextDetected[0]) {
          applyDetectedHost(nextDetected[0]);
        } else if (nextProfiles[0]) {
          applyProfile(nextProfiles[0]);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setProfiles([]);
          setDetectedHosts([]);
          setConnectionSourcesError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelled) setConnectionSourcesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (step !== "resources" || !showResourceSync || !syncResourcesEnabled) {
      setSyncPreview(null);
      setSyncPreviewError(null);
      setSyncPreviewBusy(false);
      return;
    }
    let cancelled = false;
    setSyncPreviewBusy(true);
    setSyncPreviewError(null);
    apiClient
      .call("project.previewRemoteResourceSync", {
        profileId: selectedProfile?.id,
        host: connectionHost,
        remotePath,
        resourceTypes: selectedSyncResourceTypes,
      })
      .then((result) => {
        if (cancelled) return;
        setSyncPreview(result);
      })
      .catch((err) => {
        if (cancelled) return;
        setSyncPreview(null);
        setSyncPreviewError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setSyncPreviewBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    connectionHost,
    profileId,
    remotePath,
    selectedProfile?.id,
    selectedSyncResourceTypes,
    showResourceSync,
    step,
    syncResourcesEnabled,
  ]);

  function applyDetectedHost(detected: DetectedSshHost) {
    setProfileId("");
    setSshAlias(detected.host);
    setName(detected.name);
    setHost(detected.hostName ?? detected.host);
    setPort(detected.port ?? "");
    setUser(detected.user ?? "");
    setIdentityFile(detected.identityFile ?? "");
  }

  function applyProfile(profile: SshProfile) {
    setProfileId(profile.id);
    setSshAlias("");
    setName(profile.name);
    setHost(profile.host);
    setPort("");
    setUser("");
    setIdentityFile("");
  }

  const handleSelectConnection = (value: string) => {
    setMessage(null);
    if (!value) {
      setProfileId("");
      setSshAlias("");
      return;
    }
    const [kind, id] = value.split(":");
    if (kind === "ssh") {
      const detected = detectedHosts.find((item) => item.host === id);
      if (detected) applyDetectedHost(detected);
    }
    if (kind === "profile") {
      const profile = profiles.find((item) => item.id === id);
      if (profile) applyProfile(profile);
    }
  };

  const buildSshArgs = () => {
    if (selectedProfile?.sshArgs) return selectedProfile.sshArgs;
    if (sshAlias) return undefined;
    const args: string[] = [];
    const nextPort = port.trim();
    const nextUser = user.trim();
    const nextIdentityFile = identityFile.trim();
    if (nextPort) args.push("-p", nextPort);
    if (nextUser) args.push("-l", nextUser);
    if (nextIdentityFile) args.push("-i", nextIdentityFile);
    return args.length > 0 ? args : undefined;
  };

  const toggleSyncResourceType = (type: RemoteSyncResourceType) => {
    setSelectedSyncResourceTypes((current) =>
      current.includes(type) ? current.filter((item) => item !== type) : [...current, type],
    );
  };

  const browseRemoteDirectory = async (dirPath?: string, nextStep: WizardStep = "directory") => {
    if (!canConnect) return;
    setBusy("list");
    setMessage(null);
    try {
      const result = await apiClient.call("project.listSshDirectory", {
        profileId: selectedProfile?.id,
        host: connectionHost,
        dirPath,
        sshArgs: buildSshArgs(),
        shell: selectedProfile?.shell,
      });
      if (!result.ok) {
        setMessage({
          type: "error",
          text: formatSshError(t, result),
        });
        return;
      }
      setBrowsePath(result.path);
      setRemotePath(result.path);
      setEntries(result.entries as SshDirectoryEntry[]);
      setStep(nextStep);
      setMessage({ type: "ok", text: t("welcome.remoteTestOk") });
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(null);
    }
  };

  const [handleCreateDirectory, isCreatingDirectory] = useAsyncGuard(async () => {
    const folderName = newFolderName.trim();
    if (!folderName || !canConnect) return;
    const nextPath = joinRemotePath(firstNonEmpty(browsePath, remotePath), folderName);
    setBusy("create");
    setMessage(null);
    try {
      const result = await apiClient.call("project.createSshDirectory", {
        profileId: selectedProfile?.id,
        host: connectionHost,
        dirPath: nextPath,
        sshArgs: buildSshArgs(),
        shell: selectedProfile?.shell,
      });
      if (!result.ok) {
        setMessage({
          type: "error",
          text: formatSshError(t, result),
        });
        return;
      }
      setNewFolderName("");
      await browseRemoteDirectory(result.path);
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(null);
    }
  });

  const [handleOpen, isOpening] = useAsyncGuard(async () => {
    if (!canOpen) return;
    setStep("opening");
    setBusy("open");
    setMessage(null);
    try {
      const result = await apiClient.call("project.openSshProject", {
        profileId: selectedProfile?.id,
        projectName: firstNonEmpty(remoteProjectName(remotePath), connectionTitle),
        profileName: firstNonEmpty(name, connectionTitle),
        host: connectionHost,
        remotePath: normalizeRemotePath(remotePath),
        sshRuntimeKind,
        remoteResourceSync:
          sshRuntimeKind === "remote-agent-child"
            ? {
                enabled: syncResourcesEnabled,
                resourceTypes: selectedSyncResourceTypes,
              }
            : { enabled: false },
        sshArgs: buildSshArgs(),
        shell: selectedProfile?.shell,
      });
      onOpened(result.tab as ProjectTab);
      onClose();
    } catch (err) {
      setStep("directory");
      setMessage({
        type: "error",
        text: `${t("welcome.remoteOpenFailed")}\n${formatThrownSshError(t, err)}`,
      });
    } finally {
      setBusy(null);
    }
  });

  const renderStepBadge = (target: WizardStep, label: string, hint: string, index: number) => {
    const currentIndex = visibleStepOrder.indexOf(step);
    const targetIndex = visibleStepOrder.indexOf(target);
    const done = targetIndex < currentIndex;
    const active = target === step;
    return (
      <div
        className={`rounded-md px-4 py-3 ${
          active ? "bg-surface-hover" : done ? "bg-status-success/10" : "opacity-70"
        }`}
      >
        <div className="flex items-center gap-3">
          <span
            className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold ${
              done
                ? "bg-status-success text-white"
                : active
                  ? "bg-text-primary text-bg-primary"
                  : "bg-bg-primary text-text-secondary"
            }`}
          >
            {done ? <Check className="h-4 w-4" /> : index}
          </span>
          <div>
            <div
              className={`text-sm font-semibold ${active ? "text-text-primary" : "text-text-secondary"}`}
            >
              {label}
            </div>
            <div className="text-xs text-text-tertiary">{hint}</div>
          </div>
        </div>
      </div>
    );
  };

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-modal flex flex-col overflow-hidden bg-bg-elevated text-text-primary dark:bg-surface-code"
    >
        <header
          className="surface-header-safe-top flex shrink-0 items-center gap-3 border-b border-border-secondary bg-surface-dim px-4 py-2 dark:bg-surface-code sm:px-5"
        >
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-semibold text-text-primary">
              {t("welcome.remoteConfigTitle")}
            </h2>
            <p className="truncate text-xs text-text-tertiary">
              {t("welcome.remoteConfigSubtitle")}
            </p>
          </div>
          <IconButton label={t("close")} size="sm" onClick={onClose} className="rounded-md">
            <X className="h-4 w-4" />
          </IconButton>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[18rem_1fr]">
          <aside className="hidden border-r border-border-secondary bg-bg-elevated/80 px-6 py-6 lg:block">
            <div className="space-y-2">
              {renderStepBadge(
                "method",
                t("welcome.remoteStepMethod"),
                t("welcome.remoteStepMethodHint"),
                1,
              )}
              {renderStepBadge(
                "config",
                t("welcome.remoteStepConnection"),
                t("welcome.remoteStepConnectionHint"),
                2,
              )}
              {showResourceSync &&
                renderStepBadge(
                  "resources",
                  t("welcome.remoteStepResources"),
                  t("welcome.remoteStepResourcesHint"),
                  3,
                )}
              {renderStepBadge(
                "directory",
                t("welcome.remoteStepDirectory"),
                t("welcome.remoteStepDirectoryHint"),
                showResourceSync ? 4 : 3,
              )}
              {renderStepBadge(
                "opening",
                t("welcome.remoteStepConnect"),
                t("welcome.remoteStepConnectHint"),
                showResourceSync ? 5 : 4,
              )}
            </div>
          </aside>

          <main className="min-h-0 overflow-y-auto">
            <div className="mx-auto max-w-5xl px-6 py-7">
              <div className="space-y-5">
                {step === "method" && (
                  <section className="rounded-lg border border-border-secondary bg-bg-elevated p-5">
                    <div className="mb-5">
                      <h3 className="text-lg font-semibold text-text-primary">
                        {t("welcome.remoteStepMethod")}
                      </h3>
                      <p className="mt-1 text-sm text-text-secondary">
                        {t("welcome.remoteStepMethodHint")}
                      </p>
                    </div>
                    <div className="grid gap-4 md:grid-cols-3">
                      <button
                        type="button"
                        onClick={() => {
                          setSshRuntimeKind("remote-agent-child");
                          setStep("config");
                        }}
                        className="min-h-44 rounded-lg border border-runtime-ssh/50 bg-runtime-ssh/10 p-5 text-left transition hover:border-runtime-ssh"
                      >
                        <RuntimeMethodIcon tone="ssh">
                          <CloudCog className="h-5 w-5 stroke-[1.8]" />
                        </RuntimeMethodIcon>
                        <div className="mt-6 text-xl font-semibold text-text-primary">
                          {t("welcome.remoteStandardSshTitle")}
                        </div>
                        <div className="mt-2 text-sm leading-5 text-text-secondary">
                          {t("welcome.remoteStandardSshHint")}
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setSshRuntimeKind("ssh-command");
                          setStep("config");
                        }}
                        className="min-h-44 rounded-lg border border-border-secondary bg-bg-primary/60 p-5 text-left transition hover:border-runtime-sandbox/70 hover:bg-runtime-sandbox/5"
                      >
                        <RuntimeMethodIcon tone="sandbox">
                          <Cable className="h-5 w-5 stroke-[1.8]" />
                        </RuntimeMethodIcon>
                        <div className="mt-6 text-xl font-semibold text-text-primary">
                          {t("welcome.remoteQuickSandboxTitle")}
                        </div>
                        <div className="mt-2 text-sm leading-5 text-text-secondary">
                          {t("welcome.remoteQuickSandboxHint")}
                        </div>
                      </button>
                      <button
                        type="button"
                        disabled
                        className="min-h-44 rounded-lg border border-border-secondary bg-bg-primary/50 p-5 text-left opacity-60"
                      >
                        <RuntimeMethodIcon tone="docker">
                          <UploadCloud className="h-5 w-5 stroke-[1.8]" />
                        </RuntimeMethodIcon>
                        <div className="mt-6 text-xl font-semibold text-text-secondary">Docker</div>
                        <div className="mt-2 text-sm leading-5 text-text-tertiary">
                          {t("welcome.remoteDockerComingSoon")}
                        </div>
                      </button>
                    </div>
                  </section>
                )}

                {step === "config" && (
                  <section className="rounded-lg border border-border-secondary bg-bg-elevated p-5">
                    <div className="mb-4 flex items-center gap-3">
                      <span
                        className={`flex h-9 w-9 items-center justify-center rounded-md border ${
                          sshRuntimeKind === "ssh-command"
                            ? "border-runtime-sandbox/40 bg-runtime-sandbox/10 text-runtime-sandbox"
                            : "border-runtime-ssh/40 bg-runtime-ssh/10 text-runtime-ssh"
                        }`}
                      >
                        {sshRuntimeKind === "ssh-command" ? (
                          <Cable className="h-5 w-5" />
                        ) : (
                          <CloudCog className="h-5 w-5" />
                        )}
                      </span>
                      <div>
                        <h3 className="text-base font-semibold text-text-primary">
                          {t("welcome.remoteStepConnection")}
                        </h3>
                        <p className="text-sm text-text-secondary">
                          {t("welcome.remoteAliasHint")}
                        </p>
                      </div>
                    </div>

                    <label className="block">
                      <span className="mb-2 flex items-center gap-2 text-sm font-medium text-text-secondary">
                        <Search className="h-4 w-4 text-runtime-ssh" />
                        {t("welcome.remoteConnectionAlias")}
                      </span>
                      <DropdownSelect
                        value={connectionSelectValue}
                        onChange={handleSelectConnection}
                        disabled={connectionSourcesLoading}
                        ariaLabel={t("welcome.remoteConnectionAlias")}
                        className="h-12 w-full bg-bg-primary px-3 text-base"
                        options={connectionOptions}
                      />
                    </label>

                    {connectionSourcesError && (
                      <div className="mt-3 flex items-start gap-2 rounded-md border border-status-warning/30 bg-status-warning/10 px-3 py-2 text-xs leading-5 text-status-warning">
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span className="min-w-0 whitespace-pre-wrap break-words">
                          {t("welcome.remoteProfilesLoadFailed")}
                          {connectionSourcesError ? `\n${connectionSourcesError}` : ""}
                        </span>
                      </div>
                    )}
                    {!connectionSourcesLoading &&
                      !connectionSourcesError &&
                      detectedHosts.length === 0 &&
                      profiles.length === 0 && (
                        <div className="mt-3 rounded-md border border-border-secondary bg-bg-primary/70 px-3 py-2 text-xs leading-5 text-text-tertiary">
                          {t("welcome.remoteNoProfiles")}
                        </div>
                      )}

                    <div className="mt-4 rounded-md border border-border-secondary bg-bg-primary/70 px-4 py-3">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-text-primary">
                            {connectionTitle}
                          </div>
                          <div className="mt-0.5 truncate text-xs text-text-secondary">
                            {selectedDetected
                              ? `${selectedDetected.source} · ${selectedDetected.host}`
                              : selectedProfile
                                ? t("welcome.remoteSavedProfile")
                                : t("welcome.remoteManualDetail")}
                          </div>
                        </div>
                        <span className="rounded bg-runtime-ssh/10 px-2 py-1 text-xs font-medium text-runtime-ssh">
                          SSH
                        </span>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-4">
                        <DetailItem
                          label={t("welcome.remoteHost")}
                          value={host || connectionHost}
                        />
                        <DetailItem label={t("welcome.remotePort")} value={port || "22"} />
                        <DetailItem label={t("welcome.remoteUser")} value={user} />
                        <DetailItem label={t("welcome.remotePrivateKey")} value={identityFile} />
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => setAdvancedOpen((value) => !value)}
                      className="mt-4 inline-flex items-center gap-2 rounded-md px-1 py-1 text-sm font-medium text-runtime-ssh hover:text-runtime-ssh/80"
                    >
                      <Settings2 className="h-4 w-4" />
                      {advancedOpen
                        ? t("welcome.remoteHideAdvanced")
                        : t("welcome.remoteShowAdvanced")}
                      <ChevronDown
                        className={`h-4 w-4 transition-transform ${advancedOpen ? "rotate-180" : ""}`}
                      />
                    </button>

                    {advancedOpen && (
                      <div className="mt-3 grid gap-3 rounded-md border border-border-secondary bg-bg-primary/60 p-4 sm:grid-cols-2">
                        <label className="block">
                          <span className="mb-1 block text-xs font-medium text-text-secondary">
                            {t("welcome.remoteName")}
                          </span>
                          <input
                            value={name}
                            onChange={(event) => setName(event.target.value)}
                            placeholder="xyz-mac"
                            className="w-full rounded-md border border-border-secondary bg-bg-primary px-3 py-2 text-sm outline-none focus:border-border-focus"
                          />
                        </label>
                        <label className="block">
                          <span className="mb-1 block text-xs font-medium text-text-secondary">
                            {t("welcome.remoteHost")}
                          </span>
                          <input
                            value={host}
                            onChange={(event) => {
                              setHost(event.target.value);
                              setProfileId("");
                              setSshAlias("");
                            }}
                            placeholder="192.168.0.9"
                            className="w-full rounded-md border border-border-secondary bg-bg-primary px-3 py-2 text-sm outline-none focus:border-border-focus"
                          />
                        </label>
                        <label className="block">
                          <span className="mb-1 block text-xs font-medium text-text-secondary">
                            {t("welcome.remoteUser")}
                          </span>
                          <input
                            value={user}
                            onChange={(event) => {
                              setUser(event.target.value);
                              setProfileId("");
                            }}
                            placeholder="xyz"
                            className="w-full rounded-md border border-border-secondary bg-bg-primary px-3 py-2 text-sm outline-none focus:border-border-focus"
                          />
                        </label>
                        <label className="block">
                          <span className="mb-1 block text-xs font-medium text-text-secondary">
                            {t("welcome.remotePort")}
                          </span>
                          <input
                            value={port}
                            onChange={(event) => {
                              setPort(event.target.value);
                              setProfileId("");
                            }}
                            placeholder="22"
                            className="w-full rounded-md border border-border-secondary bg-bg-primary px-3 py-2 text-sm outline-none focus:border-border-focus"
                          />
                        </label>
                        <label className="block sm:col-span-2">
                          <span className="mb-1 flex items-center gap-1.5 text-xs font-medium text-text-secondary">
                            <KeyRound className="h-3.5 w-3.5" />
                            {t("welcome.remoteIdentityFile")}
                          </span>
                          <input
                            value={identityFile}
                            onChange={(event) => {
                              setIdentityFile(event.target.value);
                              setProfileId("");
                            }}
                            placeholder="/Users/xyz/.ssh/id_rsa"
                            className="w-full rounded-md border border-border-secondary bg-bg-primary px-3 py-2 font-mono text-sm outline-none focus:border-border-focus"
                          />
                        </label>
                      </div>
                    )}
                  </section>
                )}

                {step === "resources" && showResourceSync && (
                  <section className="rounded-lg border border-border-secondary bg-bg-elevated">
                    <div className="flex items-start gap-3 border-b border-border-secondary px-5 py-4">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-runtime-ssh/30 bg-runtime-ssh/10 text-runtime-ssh">
                        <UploadCloud className="h-4 w-4" />
                      </span>
                      <div className="min-w-0">
                        <h3 className="text-base font-semibold text-text-primary">
                          {t("welcome.remoteStepResources")}
                        </h3>
                        <p className="mt-0.5 text-sm leading-5 text-text-secondary">
                          {t("welcome.remoteStepResourcesHint")}
                        </p>
                      </div>
                    </div>

                    <div className="space-y-4 px-5 py-4">
                      <div className="rounded-md border border-border-secondary bg-bg-primary/70 p-4">
                        <label className="flex items-start gap-3">
                          <input
                            type="checkbox"
                            checked={syncResourcesEnabled}
                            onChange={(event) => setSyncResourcesEnabled(event.target.checked)}
                            className="mt-1 h-4 w-4 rounded border-border-secondary bg-bg-primary accent-accent"
                          />
                          <span className="min-w-0">
                            <span className="block text-sm font-semibold text-text-primary">
                              {t("welcome.remoteSyncTitle")}
                            </span>
                            <span className="mt-1 block text-xs leading-5 text-text-secondary">
                              {t("welcome.remoteSyncHint")}
                            </span>
                          </span>
                        </label>

                        <div
                          className={`mt-4 grid gap-2 md:grid-cols-3 ${syncResourcesEnabled ? "" : "opacity-50"}`}
                        >
                          {REMOTE_SYNC_RESOURCES.map((resource) =>
                            (() => {
                              const resourcePreview = syncPreview?.resources.find(
                                (item) => item.type === resource.type,
                              );
                              const selected = selectedSyncResourceTypes.includes(resource.type);
                              return (
                                <label
                                  key={resource.type}
                                  className={cx(
                                    "flex min-h-28 items-start gap-3 rounded-md border px-3 py-3 transition-colors",
                                    syncResourcesEnabled
                                      ? "cursor-pointer bg-bg-elevated hover:border-border-focus hover:bg-surface-hover/25"
                                      : "cursor-not-allowed bg-bg-primary/50",
                                    selected && syncResourcesEnabled
                                      ? "border-accent bg-accent/10"
                                      : "border-border-secondary",
                                  )}
                                >
                                  <input
                                    type="checkbox"
                                    checked={selected}
                                    disabled={!syncResourcesEnabled}
                                    onChange={() => toggleSyncResourceType(resource.type)}
                                    className="mt-0.5 h-4 w-4 rounded border-border-secondary bg-bg-primary accent-accent"
                                  />
                                  <span className="min-w-0 flex-1">
                                    <span className="block text-sm font-medium text-text-primary">
                                      {t(resource.labelKey)}
                                    </span>
                                    <span className="mt-1 block text-xs leading-4 text-text-tertiary">
                                      {t(resource.hintKey)}
                                    </span>
                                    {syncResourcesEnabled && selected && (
                                      <span className="mt-3 block rounded border border-border-secondary bg-bg-primary/70 px-2 py-2">
                                        <span className="flex items-center justify-between gap-2 text-xs">
                                          <span className="text-text-tertiary">
                                            {syncPreviewBusy
                                              ? t("welcome.remoteSyncPreviewLoading")
                                              : t("welcome.remoteSyncPreviewFiles")}
                                          </span>
                                          <span className="font-mono text-text-primary">
                                            {resourcePreview
                                              ? `${resourcePreview.files} / ${formatBytes(resourcePreview.bytes)}`
                                              : "-"}
                                          </span>
                                        </span>
                                        <span className="mt-2 block space-y-1">
                                          {(resourcePreview?.sources ?? []).length > 0 ? (
                                            resourcePreview?.sources.slice(0, 3).map((source) => (
                                              <span
                                                key={source}
                                                title={source}
                                                className="block truncate font-mono text-[11px] leading-4 text-text-secondary"
                                              >
                                                {source}
                                              </span>
                                            ))
                                          ) : (
                                            <span className="block text-[11px] leading-4 text-text-tertiary">
                                              {syncPreviewBusy
                                                ? t("welcome.remoteSyncPreviewLoading")
                                                : t("welcome.remoteSyncNoSources")}
                                            </span>
                                          )}
                                          {(resourcePreview?.sources.length ?? 0) > 3 && (
                                            <span className="block text-[11px] leading-4 text-text-tertiary">
                                              {t("welcome.remoteSyncMoreSources", {
                                                count: (resourcePreview?.sources.length ?? 0) - 3,
                                              })}
                                            </span>
                                          )}
                                        </span>
                                      </span>
                                    )}
                                  </span>
                                </label>
                              );
                            })(),
                          )}
                        </div>

                        {syncResourcesEnabled && syncResourceCount === 0 && (
                          <div className="mt-3 rounded-md border border-status-warning/30 bg-status-warning/10 px-3 py-2 text-xs leading-5 text-status-warning">
                            {t("welcome.remoteSyncEmptyWarning")}
                          </div>
                        )}
                        {syncResourcesEnabled && syncPreviewError && (
                          <div className="mt-3 rounded-md border border-status-error/30 bg-status-error/10 px-3 py-2 text-xs leading-5 text-status-error">
                            {syncPreviewError}
                          </div>
                        )}
                        {syncResourcesEnabled && syncPreview && syncPreview.blocked.length > 0 && (
                          <div className="mt-3 rounded-md border border-status-warning/30 bg-status-warning/10 px-3 py-2 text-xs leading-5 text-status-warning">
                            {t("welcome.remoteSyncBlockedSummary", {
                              count: syncPreview.blocked.length,
                            })}
                          </div>
                        )}
                      </div>

                      <div className="rounded-md border border-border-secondary bg-bg-primary/60 px-4 py-3 text-xs leading-5 text-text-tertiary">
                        {t("welcome.remoteSyncUnsupportedHint")}
                      </div>
                    </div>
                  </section>
                )}

                {step === "directory" && (
                  <section className="rounded-lg border border-border-secondary bg-bg-elevated">
                    <div className="flex items-start gap-3 border-b border-border-secondary px-5 py-4">
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-status-success/30 bg-status-success/10 text-status-success">
                        <FolderOpen className="h-4 w-4" />
                      </span>
                      <div className="min-w-0">
                        <h3 className="text-base font-semibold text-text-primary">
                          {t("welcome.remoteStepDirectory")}
                        </h3>
                        <p className="mt-0.5 text-sm leading-5 text-text-secondary">
                          {t("welcome.remoteDirectoryBrowserHint")}
                        </p>
                      </div>
                    </div>

                    <div className="space-y-3 px-5 py-4">
                      <div className="grid grid-cols-[1fr_auto] gap-2">
                        <input
                          value={remotePath}
                          onChange={(event) => setRemotePath(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") void browseRemoteDirectory(remotePath);
                          }}
                          placeholder="/home/user/project"
                          className="h-10 min-w-0 rounded-md border border-border-secondary bg-bg-primary px-3 font-mono text-sm outline-none focus:border-border-focus"
                        />
                        <Button
                          onClick={() => browseRemoteDirectory(remotePath)}
                          disabled={busy === "list"}
                          loading={busy === "list"}
                          size="md"
                          variant="secondary"
                          className="min-w-20"
                        >
                          {t("welcome.remoteGo")}
                        </Button>
                      </div>

                      <div className="grid grid-cols-[1fr_auto] gap-2">
                        <input
                          value={newFolderName}
                          onChange={(event) => setNewFolderName(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") void handleCreateDirectory();
                          }}
                          placeholder={t("welcome.remoteNewFolderPlaceholder")}
                          className="h-10 min-w-0 rounded-md border border-border-secondary bg-bg-primary px-3 text-sm outline-none focus:border-border-focus"
                        />
                        <Button
                          onClick={handleCreateDirectory}
                          disabled={!newFolderName.trim() || busy === "create" || isCreatingDirectory}
                          loading={busy === "create"}
                          leadingIcon={<FolderPlus className="h-4 w-4" />}
                          size="md"
                          variant="secondary"
                          className="min-w-28"
                        >
                          {t("welcome.remoteCreateFolder")}
                        </Button>
                      </div>
                    </div>

                    <div
                      className="mx-5 mb-5 max-h-[42vh] overflow-y-auto rounded-md border border-border-secondary bg-bg-primary"
                      aria-busy={busy === "list"}
                    >
                      {parentRemotePath(browsePath) && (
                        <button
                          type="button"
                          onClick={() =>
                            browseRemoteDirectory(parentRemotePath(browsePath) ?? undefined)
                          }
                          className="flex w-full items-center gap-3 border-b border-border-secondary px-4 py-2.5 text-left text-sm hover:bg-surface-hover"
                        >
                          <Folder className="h-4 w-4 text-text-tertiary" />
                          <span className="font-mono text-text-secondary">..</span>
                        </button>
                      )}
                      {busy === "list" && entries.length === 0 ? (
                        <div className="flex items-center justify-center gap-2 px-4 py-8 text-sm text-text-tertiary">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          {t("welcome.remoteDirectoryLoading")}
                        </div>
                      ) : entries.length === 0 ? (
                        <div className="px-4 py-8 text-center text-sm text-text-tertiary">
                          {t("welcome.remoteDirectoryEmpty")}
                        </div>
                      ) : (
                        entries.map((entry) => (
                          <button
                            type="button"
                            key={entry.path}
                            onClick={() => browseRemoteDirectory(entry.path)}
                            className="flex w-full items-center gap-3 border-b border-border-secondary px-4 py-2.5 text-left text-sm last:border-b-0 hover:bg-surface-hover"
                          >
                            <Folder className="h-4 w-4 text-runtime-ssh" />
                            <span className="truncate text-text-primary">{entry.name}</span>
                          </button>
                        ))
                      )}
                    </div>
                  </section>
                )}

                {step === "opening" && (
                  <section className="rounded-lg border border-border-secondary bg-bg-elevated p-6">
                    <div className="flex items-start gap-4">
                      <span className="flex h-10 w-10 items-center justify-center rounded-md bg-runtime-ssh/10 text-runtime-ssh">
                        <Loader2 className="h-5 w-5 animate-spin" />
                      </span>
                      <div>
                        <h3 className="text-base font-semibold text-text-primary">
                          {t("welcome.remoteOpeningTitle")}
                        </h3>
                        <p className="mt-1 text-sm leading-5 text-text-secondary">
                          {t("welcome.remoteOpeningHint")}
                        </p>
                        <div className="mt-4 rounded-md border border-border-secondary bg-bg-primary px-3 py-2 font-mono text-sm text-text-secondary">
                          {connectionHost}:{remotePath}
                        </div>
                      </div>
                    </div>
                  </section>
                )}
              </div>
            </div>
          </main>
        </div>

        <footer
          className="flex flex-col gap-3 border-t border-border-secondary bg-surface-dim px-4 py-3 dark:bg-surface-code sm:flex-row sm:items-center sm:justify-between"
          style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom, 0px))" }}
        >
          <div className="min-h-10 min-w-0 flex-1">
            {message && (
              <div
                className={`inline-flex max-w-full items-start gap-2 rounded-md border px-3 py-2 text-sm ${
                  message.type === "ok"
                    ? "border-status-success/40 bg-status-success/10 text-status-success"
                    : "border-status-error/40 bg-status-error/10 text-status-error"
                }`}
              >
                {message.type === "ok" ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                ) : (
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                )}
                <span className="min-w-0 whitespace-pre-wrap break-words">{message.text}</span>
              </div>
            )}
          </div>

          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            {step === "method" && (
              <>
                <Button variant="ghost" size="md" onClick={onClose}>
                  {t("cancel")}
                </Button>
                <Button variant="primary" size="md" onClick={() => setStep("config")}>
                  {t("next")}
                </Button>
              </>
            )}

            {step === "config" && (
              <>
                <Button variant="ghost" size="md" onClick={() => setStep("method")}>
                  {t("back")}
                </Button>
                <Button
                  onClick={() =>
                    browseRemoteDirectory(undefined, showResourceSync ? "resources" : "directory")
                  }
                  disabled={!canConnect || busy === "list"}
                  loading={busy === "list"}
                  variant="primary"
                  size="md"
                >
                  {showResourceSync
                    ? t("welcome.remoteConnectAndConfigure")
                    : t("welcome.remoteConnectAndBrowse")}
                </Button>
              </>
            )}

            {step === "resources" && showResourceSync && (
              <>
                <Button variant="ghost" size="md" onClick={() => setStep("config")}>
                  {t("back")}
                </Button>
                <Button variant="primary" size="md" onClick={() => setStep("directory")}>
                  {t("next")}
                </Button>
              </>
            )}

            {step === "directory" && (
              <>
                <Button
                  variant="ghost"
                  size="md"
                  onClick={() => setStep(showResourceSync ? "resources" : "config")}
                >
                  {t("back")}
                </Button>
                <Button
                  variant="primary"
                  size="md"
                  onClick={handleOpen}
                  disabled={!canOpen || busy !== null || isOpening}
                >
                  {t("welcome.remoteSelectDirectory")}
                </Button>
              </>
            )}

            {step === "opening" && (
              <Button variant="primary" size="md" loading disabled>
                {t("welcome.remoteOpening")}
              </Button>
            )}
          </div>
        </footer>
    </div>
  );
}
