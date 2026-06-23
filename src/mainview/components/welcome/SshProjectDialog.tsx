import {
  Check,
  CheckCircle2,
  ChevronDown,
  Folder,
  FolderOpen,
  FolderPlus,
  KeyRound,
  Loader2,
  Search,
  Server,
  Settings2,
  UploadCloud,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiClient } from "../../lib/api-client";
import type { DetectedSshHost, ProjectTab, SshDirectoryEntry, SshProfile } from "../../types";

interface SshProjectDialogProps {
  open: boolean;
  onClose: () => void;
  onOpened: (tab: ProjectTab) => void;
}

type WizardStep = "method" | "config" | "directory" | "opening";

const stepOrder: WizardStep[] = ["method", "config", "directory", "opening"];

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
  if (trimmed === "/") return "/";
  return trimmed.replace(/\/+$/, "");
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
  const [remotePath, setRemotePath] = useState("");
  const [browsePath, setBrowsePath] = useState("");
  const [entries, setEntries] = useState<SshDirectoryEntry[]>([]);
  const [newFolderName, setNewFolderName] = useState("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [busy, setBusy] = useState<"list" | "create" | "open" | null>(null);
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setStep("method");
    setMessage(null);
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
      .catch(() => {
        if (!cancelled) {
          setProfiles([]);
          setDetectedHosts([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

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
  const connectionHost = firstNonEmpty(selectedProfile?.host, sshAlias, host);
  const connectionTitle =
    firstNonEmpty(sshAlias, selectedProfile?.name, name, host) || t("welcome.remoteManual");
  const canConnect = connectionHost.length > 0 && !busy;
  const canOpen = normalizeRemotePath(remotePath).length > 0 && canConnect;

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

  const browseRemoteDirectory = async (dirPath?: string) => {
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
          text: firstNonEmpty(result.error, result.stderr) || t("welcome.remoteTestFailed"),
        });
        return;
      }
      setBrowsePath(result.path);
      setRemotePath(result.path);
      setEntries(result.entries as SshDirectoryEntry[]);
      setStep("directory");
      setMessage({ type: "ok", text: t("welcome.remoteTestOk") });
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(null);
    }
  };

  const handleCreateDirectory = async () => {
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
          text: firstNonEmpty(result.error, result.stderr) || t("welcome.remoteCreateFailed"),
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
  };

  const handleOpen = async () => {
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
        sshArgs: buildSshArgs(),
        shell: selectedProfile?.shell,
      });
      onOpened(result.tab as ProjectTab);
      onClose();
    } catch (err) {
      setStep("directory");
      setMessage({ type: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(null);
    }
  };

  const renderStepBadge = (target: WizardStep, label: string, hint: string, index: number) => {
    const currentIndex = stepOrder.indexOf(step);
    const targetIndex = stepOrder.indexOf(target);
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
    <div className="fixed inset-0 z-modal bg-bg-primary text-text-primary">
      <div className="flex h-full flex-col">
        <header
          className="flex items-start justify-between border-b border-border-secondary bg-bg-elevated px-6 py-5"
          style={{ paddingTop: "calc(1.25rem + env(safe-area-inset-top, 0px))" }}
        >
          <div>
            <h2 className="text-xl font-semibold leading-7">{t("welcome.remoteConfigTitle")}</h2>
            <p className="mt-1 text-sm leading-5 text-text-secondary">
              {t("welcome.remoteConfigSubtitle")}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-11 w-11 items-center justify-center rounded-md text-text-secondary hover:bg-surface-hover hover:text-text-primary"
            aria-label={t("close")}
          >
            <X className="h-5 w-5" />
          </button>
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
              {renderStepBadge(
                "directory",
                t("welcome.remoteStepDirectory"),
                t("welcome.remoteStepDirectoryHint"),
                3,
              )}
              {renderStepBadge(
                "opening",
                t("welcome.remoteStepConnect"),
                t("welcome.remoteStepConnectHint"),
                4,
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
                    <div className="grid gap-4 md:grid-cols-2">
                      <button
                        type="button"
                        onClick={() => setStep("config")}
                        className="min-h-44 rounded-lg border border-status-info/50 bg-status-info/10 p-5 text-left transition hover:border-status-info"
                      >
                        <span className="flex h-11 w-11 items-center justify-center rounded-md bg-status-info text-white">
                          <Server className="h-6 w-6" />
                        </span>
                        <div className="mt-6 text-xl font-semibold text-text-primary">SSH</div>
                        <div className="mt-2 text-sm leading-5 text-text-secondary">
                          {t("welcome.remoteSshMethodHint")}
                        </div>
                      </button>
                      <button
                        type="button"
                        disabled
                        className="min-h-44 rounded-lg border border-border-secondary bg-bg-primary/50 p-5 text-left opacity-60"
                      >
                        <span className="flex h-11 w-11 items-center justify-center rounded-md border border-border-secondary text-text-tertiary">
                          <UploadCloud className="h-6 w-6" />
                        </span>
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
                      <span className="flex h-9 w-9 items-center justify-center rounded-md border border-status-info/30 bg-status-info/10 text-status-info">
                        <Server className="h-5 w-5" />
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
                        <Search className="h-4 w-4 text-status-info" />
                        {t("welcome.remoteConnectionAlias")}
                      </span>
                      <select
                        value={connectionSelectValue}
                        onChange={(event) => handleSelectConnection(event.target.value)}
                        className="h-12 w-full rounded-md border border-border-secondary bg-bg-primary px-3 text-base outline-none focus:border-border-focus"
                      >
                        <option value="">{t("welcome.remoteManual")}</option>
                        {detectedHosts.length > 0 && (
                          <optgroup label={t("welcome.remoteDetectedHosts")}>
                            {detectedHosts.map((item) => (
                              <option key={`ssh:${item.host}`} value={`ssh:${item.host}`}>
                                {item.name}
                              </option>
                            ))}
                          </optgroup>
                        )}
                        {profiles.length > 0 && (
                          <optgroup label={t("welcome.remoteProfile")}>
                            {profiles.map((profile) => (
                              <option key={`profile:${profile.id}`} value={`profile:${profile.id}`}>
                                {profile.name} · {profile.host}
                              </option>
                            ))}
                          </optgroup>
                        )}
                      </select>
                    </label>

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
                        <span className="rounded bg-status-info/10 px-2 py-1 text-xs font-medium text-status-info">
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
                      className="mt-4 inline-flex items-center gap-2 rounded-md px-1 py-1 text-sm font-medium text-status-info hover:text-status-info/80"
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
                          className="h-10 min-w-0 rounded-md border border-border-secondary bg-bg-primary px-3 font-mono text-sm outline-none focus:border-border-focus"
                        />
                        <button
                          type="button"
                          onClick={() => browseRemoteDirectory(remotePath)}
                          disabled={busy === "list"}
                          className="inline-flex h-10 min-w-20 items-center justify-center gap-2 rounded-md border border-border-secondary px-3 text-sm font-medium text-text-primary hover:bg-surface-hover disabled:opacity-50"
                        >
                          {busy === "list" && <Loader2 className="h-4 w-4 animate-spin" />}
                          {t("welcome.remoteGo")}
                        </button>
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
                        <button
                          type="button"
                          onClick={handleCreateDirectory}
                          disabled={!newFolderName.trim() || busy === "create"}
                          className="inline-flex h-10 min-w-28 items-center justify-center gap-2 rounded-md border border-border-secondary px-3 text-sm font-medium text-text-primary hover:bg-surface-hover disabled:opacity-50"
                        >
                          {busy === "create" ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <FolderPlus className="h-4 w-4" />
                          )}
                          {t("welcome.remoteCreateFolder")}
                        </button>
                      </div>
                    </div>

                    <div className="mx-5 mb-5 max-h-[42vh] overflow-y-auto rounded-md border border-border-secondary bg-bg-primary">
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
                      {entries.length === 0 ? (
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
                            <Folder className="h-4 w-4 text-status-info" />
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
                      <span className="flex h-10 w-10 items-center justify-center rounded-md bg-status-info/10 text-status-info">
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

                {message && (
                  <div
                    className={`flex items-start gap-2 rounded-md border px-3 py-2 text-sm ${
                      message.type === "ok"
                        ? "border-status-success/40 bg-status-success/10 text-status-success"
                        : "border-status-error/40 bg-status-error/10 text-status-error"
                    }`}
                  >
                    {message.type === "ok" && <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />}
                    <span className="min-w-0 break-words">{message.text}</span>
                  </div>
                )}
              </div>
            </div>
          </main>
        </div>

        <footer
          className="flex items-center justify-end gap-2 border-t border-border-secondary bg-bg-elevated px-6 py-4"
          style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom, 0px))" }}
        >
          {step === "method" && (
            <>
              <button
                type="button"
                onClick={onClose}
                className="rounded-md px-4 py-2 text-sm text-text-secondary hover:bg-surface-hover hover:text-text-primary"
              >
                {t("cancel")}
              </button>
              <button
                type="button"
                onClick={() => setStep("config")}
                className="rounded-md bg-semantic-accent px-4 py-2 text-sm font-medium text-white hover:bg-semantic-accent/90"
              >
                {t("next")}
              </button>
            </>
          )}

          {step === "config" && (
            <>
              <button
                type="button"
                onClick={() => setStep("method")}
                className="rounded-md px-4 py-2 text-sm text-text-secondary hover:bg-surface-hover hover:text-text-primary"
              >
                {t("back")}
              </button>
              <button
                type="button"
                onClick={() => browseRemoteDirectory()}
                disabled={!canConnect || busy === "list"}
                className="inline-flex items-center gap-2 rounded-md bg-semantic-accent px-4 py-2 text-sm font-medium text-white hover:bg-semantic-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy === "list" && <Loader2 className="h-4 w-4 animate-spin" />}
                {t("welcome.remoteConnectAndBrowse")}
              </button>
            </>
          )}

          {step === "directory" && (
            <>
              <button
                type="button"
                onClick={() => setStep("config")}
                className="rounded-md px-4 py-2 text-sm text-text-secondary hover:bg-surface-hover hover:text-text-primary"
              >
                {t("back")}
              </button>
              <button
                type="button"
                onClick={handleOpen}
                disabled={!canOpen || busy !== null}
                className="inline-flex items-center gap-2 rounded-md bg-semantic-accent px-4 py-2 text-sm font-medium text-white hover:bg-semantic-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t("welcome.remoteSelectDirectory")}
              </button>
            </>
          )}

          {step === "opening" && (
            <button
              type="button"
              disabled
              className="inline-flex items-center gap-2 rounded-md bg-semantic-accent px-4 py-2 text-sm font-medium text-white opacity-70"
            >
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("welcome.remoteOpening")}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
