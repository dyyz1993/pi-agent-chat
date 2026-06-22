import { memo, useState, useCallback, useEffect, useMemo, useRef } from "react";
import {
  CheckCircle,
  XCircle,
  CircleDot,
  CheckSquare,
  Square,
  Send,
  X,
  Loader2,
  Zap,
  Terminal,
  Eye,
  Pencil,
  Search,
  FolderOpen,
  FileText,
  Wrench,
  ShieldAlert,
  FileWarning,
  Clock,
  SkipForward,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { UIInteractionBlock } from "../../../types";
import { getUIMethodIcon } from "../tool-icon-map";
import { useUIDialogStore } from "../../../stores/use-ui-dialog-store";
import { useHooksStore } from "../../../stores/use-hooks-store";
import { useSessionStore } from "../../../stores/use-session-store";
import { useStatusStore } from "../../../stores/use-status-store";
import { PermissionActionButtons } from "../PermissionActionButtons";
import type { ToolRendererProps } from "./registry";

type UIBlock = UIInteractionBlock;
type AskDraftAnswer = { selected: string[]; text: string };

const SINGLE_SELECT_ADVANCE_DELAY_MS = 500;

const BG_MAP: Record<string, string> = {
  pending:
    "border border-status-warning/30 dark:border-status-warning/40 bg-status-warning/10 dark:bg-status-warning/25",
  responded:
    "border-l-2 border-status-success/30 dark:border-status-success/40 bg-status-success/10 dark:bg-status-success/20",
  dismissed: "border-l-2 border-border-secondary/60 bg-surface-dim",
  notified:
    "border-l-2 border-status-info/30 dark:border-status-info/40 bg-status-info/10 dark:bg-status-info/20",
};

export function CardShell({ block, children }: { block: UIBlock; children: React.ReactNode }) {
  const { t } = useTranslation("chat");
  const { icon: Icon, color } = getUIMethodIcon(block.method);
  const isPending = block.status === "pending";
  const isResponded = block.status === "responded";
  const isDismissed = block.status === "dismissed";

  return (
    <div
      className={`overflow-hidden rounded-md ${BG_MAP[block.status] ?? ""}`}
      data-ui-request-id={block.id}
    >
      <div className="flex items-center gap-2 px-3 py-2 text-xs">
        <Icon className={`w-3.5 h-3.5 shrink-0 ${color}`} />
        {block.title && <span className={`font-medium ${color}`}>{block.title}</span>}
        {isPending && (
          <span className="flex items-center gap-1 text-[11px] text-status-warning animate-pulse">
            <Loader2 className="w-2.5 h-2.5 animate-spin" />
            {t("uiCard.waitingResponse")}
          </span>
        )}
        {isResponded && <CheckCircle className="w-3 h-3 text-status-success shrink-0 ml-auto" />}
        {isDismissed && <XCircle className="w-3 h-3 text-text-tertiary" />}
      </div>
      {block.message && (
        <div className="max-h-32 overflow-y-auto px-3 pb-2 text-xs leading-relaxed text-text-secondary">
          {block.message}
        </div>
      )}
      {children}
    </div>
  );
}

export const UIInteractionAnchor = memo(function UIInteractionAnchor({
  block,
}: {
  block: UIBlock;
}) {
  const { t } = useTranslation("chat");
  const setPanelOpen = useUIDialogStore((s) => s.setPanelOpen);
  const { icon: Icon, color } = getUIMethodIcon(block.method);
  const isPending = block.status === "pending";

  const focusPrimarySurface = useCallback(() => {
    const dock = Array.from(document.querySelectorAll("[data-ui-dock-request-id]")).find(
      (el) => el.getAttribute("data-ui-dock-request-id") === block.id,
    );
    if (dock) {
      dock.scrollIntoView({ behavior: "smooth", block: "nearest" });
      return;
    }
    setPanelOpen(true);
  }, [block.id, setPanelOpen]);

  const statusLabel = isPending
    ? t("uiCard.waitingResponse")
    : block.status === "responded"
      ? t("uiCard.confirmed")
      : t("uiCard.rejected");

  return (
    <div
      className={`flex items-center gap-2 rounded-lg border px-2.5 py-2 text-xs ${
        isPending
          ? "border-status-warning/25 bg-status-warning/10 text-status-warning"
          : "border-border-secondary/40 bg-surface-dim text-text-secondary"
      }`}
      data-ui-request-id={block.id}
    >
      <Icon className={`h-3.5 w-3.5 shrink-0 ${color}`} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate font-medium text-text-primary">
            {block.title ?? t("uiPending.pendingRequestsTitle")}
          </span>
          <span className="shrink-0 text-[10px] text-text-tertiary">{statusLabel}</span>
        </div>
        {block.message && (
          <div className="mt-0.5 truncate text-[10px] text-text-tertiary">{block.message}</div>
        )}
      </div>
      {isPending ? (
        <button
          type="button"
          onClick={focusPrimarySurface}
          className="shrink-0 rounded-md border border-status-warning/30 bg-status-warning/10 px-2 py-1 text-[11px] font-medium text-status-warning transition-colors hover:bg-status-warning/20"
        >
          {t("uiPending.handleRequest", "处理")}
        </button>
      ) : (
        <CheckCircle className="h-3.5 w-3.5 shrink-0 text-status-success" />
      )}
    </div>
  );
});

const HOOK_TOOL_ICONS: Record<string, { icon: typeof Terminal; color: string }> = {
  bash: { icon: Terminal, color: "text-orange-400" },
  read: { icon: Eye, color: "text-blue-400" },
  write: { icon: FileText, color: "text-green-400" },
  edit: { icon: Pencil, color: "text-amber-400" },
  grep: { icon: Search, color: "text-purple-400" },
  find: { icon: FolderOpen, color: "text-cyan-400" },
  ls: { icon: FolderOpen, color: "text-cyan-400" },
};

export const ConfirmCard = memo(function ConfirmCard({ block }: { block: UIBlock }) {
  const { t } = useTranslation("chat");
  const respondById = useUIDialogStore((s) => s.respondById);
  const dismissById = useUIDialogStore((s) => s.dismissById);
  const skipRule = useHooksStore((s) => s.skipRule);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const isPending = block.status === "pending";

  const hookMeta = block.hookMeta;
  const isHookConfirm = !!hookMeta;
  const confirmText = block.confirmText ?? hookMeta?.confirmText;
  const cancelText = block.cancelText ?? hookMeta?.cancelText;

  const responseText =
    block.status === "responded" && block.response
      ? block.response.confirmed
        ? t("uiCard.confirmed")
        : t("uiCard.rejected")
      : null;

  if (isHookConfirm) {
    const hookIcon = HOOK_TOOL_ICONS[hookMeta.toolName?.toLowerCase()] ?? {
      icon: Wrench,
      color: "text-gray-400",
    };
    const HookIcon = hookIcon.icon;

    return (
      <CardShell block={block}>
        {isPending ? (
          <div className="px-3 pb-2 space-y-2">
            {hookMeta.command && (
              <div className="space-y-1.5 rounded-md border border-status-warning/25 bg-bg-primary/70 px-2.5 py-2 dark:bg-black/35">
                <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-status-warning">
                  <HookIcon className={`h-3 w-3 shrink-0 ${hookIcon.color}`} />
                  Command
                </div>
                <code className="block break-all font-mono text-[11px] leading-relaxed text-text-primary">
                  <span className="text-text-tertiary">$ </span>
                  {hookMeta.command}
                </code>
                {[hookMeta.description, hookMeta.matcher].some(Boolean) && (
                  <div className="grid grid-cols-[3.5rem_minmax(0,1fr)] gap-2 border-t border-border-secondary/35 pt-1.5">
                    {hookMeta.description && (
                      <>
                        <span className="text-[10px] text-text-tertiary">说明</span>
                        <span className="text-[11px] leading-relaxed text-text-secondary">
                          {hookMeta.description}
                        </span>
                      </>
                    )}
                    {hookMeta.matcher && (
                      <>
                        <span className="text-[10px] text-text-tertiary">Matcher</span>
                        <code className="break-all font-mono text-[10px] text-text-secondary">
                          {hookMeta.matcher}
                        </code>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
            {hookMeta.hookCommand && (
              <div className="rounded px-2 py-1 bg-surface-dim/60 dark:bg-surface-code/50 border border-border-secondary/30">
                <div className="text-[10px] text-text-tertiary mb-0.5">
                  Hook 规则
                  {hookMeta.eventName ? ` · ${hookMeta.eventName}` : ""}
                  {hookMeta.source ? ` · ${hookMeta.source}` : ""}
                </div>
                <code className="text-[10px] text-text-secondary font-mono break-all leading-relaxed">
                  {hookMeta.hookCommand}
                </code>
              </div>
            )}
            <div className="flex gap-1.5">
              <button
                onClick={() => respondById(block.id, { confirmed: true })}
                className="flex-1 flex items-center justify-center gap-1 py-1 text-[11px] rounded bg-status-success text-white dark:bg-status-success/20 dark:text-status-success hover:bg-status-success/90 dark:hover:bg-status-success/30 transition-colors"
              >
                <CheckCircle className="w-3 h-3" />
                {confirmText ?? t("uiCard.allowOnce")}
              </button>
              <button
                onClick={() => dismissById(block.id)}
                className="flex items-center justify-center gap-1 px-3 py-1 text-[11px] rounded bg-status-error text-white dark:bg-status-error/15 dark:text-status-error hover:bg-status-error/90 dark:hover:bg-status-error/25 transition-colors"
              >
                <XCircle className="w-3 h-3" />
                {cancelText ?? t("common:cancel")}
              </button>
            </div>
            <button
              onClick={() => {
                if (activeSessionId && hookMeta) {
                  skipRule(activeSessionId, hookMeta.eventName ?? "PreToolUse", hookMeta.matcher);
                  dismissById(block.id);
                }
              }}
              disabled={!activeSessionId || !hookMeta}
              className="w-full flex items-center justify-center gap-1 py-1 text-[11px] rounded border border-border-secondary/50 text-text-secondary hover:bg-surface-hover/40 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <SkipForward className="w-3 h-3" />
              {t("uiCard.skipThisHook")}
            </button>
          </div>
        ) : responseText ? (
          <div className="px-3 pb-1.5">
            <span
              className={`text-[11px] ${block.response?.confirmed ? "text-status-success" : "text-status-error"}`}
            >
              {responseText}
            </span>
          </div>
        ) : null}
      </CardShell>
    );
  }

  return (
    <CardShell block={block}>
      {isPending ? (
        <div className="px-3 py-1.5 flex gap-2">
          <button
            onClick={() => respondById(block.id, { confirmed: true })}
            className="flex-1 flex items-center justify-center gap-1 py-1 text-[11px] rounded bg-status-success text-white dark:bg-status-success/20 dark:text-status-success hover:bg-status-success/90 dark:hover:bg-status-success/30 transition-colors"
          >
            <CheckCircle className="w-3 h-3" />
            {t("common:confirm")}
          </button>
          <button
            onClick={() => dismissById(block.id)}
            className="flex-1 flex items-center justify-center gap-1 py-1 text-[11px] rounded bg-status-error text-white dark:bg-status-error/15 dark:text-status-error hover:bg-status-error/90 dark:hover:bg-status-error/25 transition-colors"
          >
            <XCircle className="w-3 h-3" />
            {t("common:cancel")}
          </button>
        </div>
      ) : responseText ? (
        <div className="px-3 pb-1.5">
          <span
            className={`text-[11px] ${block.response?.confirmed ? "text-status-success" : "text-status-error"}`}
          >
            {responseText}
          </span>
        </div>
      ) : null}
    </CardShell>
  );
});

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function normalizeAskAnswer(value: unknown): AskDraftAnswer {
  if (!value || typeof value !== "object") {
    return { selected: [], text: "" };
  }
  const record = value as Record<string, unknown>;
  return {
    selected: normalizeStringArray(record.selected),
    text: typeof record.text === "string" ? record.text : "",
  };
}

function normalizeAskAnswers(value: unknown): Record<string, AskDraftAnswer> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result: Record<string, AskDraftAnswer> = {};
  for (const [questionId, answer] of Object.entries(value as Record<string, unknown>)) {
    result[questionId] = normalizeAskAnswer(answer);
  }
  return Object.keys(result).length > 0 ? result : null;
}

function getAskResponseAnswers(block: UIBlock): Record<string, AskDraftAnswer> | null {
  if (block.status !== "responded" || !block.response) return null;
  const rawAnswers =
    "answers" in block.response
      ? (block.response as Record<string, unknown>).answers
      : block.response;
  return normalizeAskAnswers(rawAnswers);
}

function parseAskToolOutput(output?: string): Record<string, AskDraftAnswer> | null {
  const raw = output?.trim();
  if (!raw) return null;
  const prefix = "User answered:";
  const jsonText = raw.startsWith(prefix) ? raw.slice(prefix.length).trim() : raw;
  try {
    const parsed = JSON.parse(jsonText) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && "answers" in parsed) {
      return normalizeAskAnswers((parsed as Record<string, unknown>).answers);
    }
    return normalizeAskAnswers(parsed);
  } catch {
    return null;
  }
}

function parseJsonObject(value?: string): Record<string, unknown> | null {
  const raw = value?.trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function isAskQuestion(value: unknown): value is NonNullable<UIBlock["questions"]>[number] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.question === "string" &&
    Array.isArray(record.options)
  );
}

function parseAskToolArgs(args?: string): {
  title?: string;
  message?: string;
  questions?: NonNullable<UIBlock["questions"]>;
} {
  const parsed = parseJsonObject(args);
  if (!parsed) return {};
  const questions = Array.isArray(parsed.questions)
    ? parsed.questions.filter(isAskQuestion)
    : undefined;
  return {
    title: typeof parsed.title === "string" ? parsed.title : undefined,
    message: typeof parsed.message === "string" ? parsed.message : undefined,
    questions: questions && questions.length > 0 ? questions : undefined,
  };
}

export function shouldRenderAskUserQuestionToolCard({
  block,
  uiBlock,
}: ToolRendererProps): boolean {
  if (block.status === "error") return false;
  return block.status === "running" || !!uiBlock || parseAskToolOutput(block.output) !== null;
}

export const AskUserQuestionCard = memo(function AskUserQuestionCard({
  block,
}: {
  block: UIBlock;
}) {
  const { t } = useTranslation("chat");
  const respondById = useUIDialogStore((s) => s.respondById);
  const dismissById = useUIDialogStore((s) => s.dismissById);
  const questions = block.questions ?? [];
  const isPending = block.status === "pending";
  const [draft, setDraft] = useState<Record<string, AskDraftAnswer>>({});
  const [currentStep, setCurrentStep] = useState(0);
  const [autoAdvance, setAutoAdvance] = useState<{ questionId: string; label: string } | null>(
    null,
  );
  const autoAdvanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentQuestionIndex = Math.min(currentStep, Math.max(questions.length - 1, 0));
  const currentQuestion = questions[currentQuestionIndex];

  const clearAutoAdvance = useCallback(() => {
    if (autoAdvanceTimerRef.current) {
      clearTimeout(autoAdvanceTimerRef.current);
      autoAdvanceTimerRef.current = null;
    }
  }, []);

  const resetAutoAdvance = useCallback(() => {
    clearAutoAdvance();
    setAutoAdvance(null);
  }, [clearAutoAdvance]);

  useEffect(() => () => clearAutoAdvance(), [clearAutoAdvance]);

  const answerEntries = questions.map((question) => [
    question.id,
    draft[question.id] ?? { selected: [], text: "" },
  ]);
  const canSubmit = answerEntries.some(([, answer]) => {
    const typedAnswer = answer as AskDraftAnswer;
    return typedAnswer.selected.length > 0 || typedAnswer.text.trim().length > 0;
  });
  const hasAnswer = (questionId: string) => {
    const answer = draft[questionId] ?? { selected: [], text: "" };
    return answer.selected.length > 0 || answer.text.trim().length > 0;
  };
  const canAdvance = currentQuestion ? hasAnswer(currentQuestion.id) : false;
  const allAnswered = questions.length > 0 && questions.every((question) => hasAnswer(question.id));
  const isLastStep = currentQuestionIndex >= questions.length - 1;
  const autoAdvanceActive = !!autoAdvance;
  const goBack = useCallback(() => {
    resetAutoAdvance();
    setCurrentStep((step) => Math.max(0, step - 1));
  }, [resetAutoAdvance]);
  const goNext = useCallback(() => {
    resetAutoAdvance();
    setCurrentStep((step) => Math.min(questions.length - 1, step + 1));
  }, [questions.length, resetAutoAdvance]);

  const buildAnswers = useCallback(
    (answersDraft: Record<string, AskDraftAnswer>) =>
      Object.fromEntries(
        questions.map((question) => {
          const typedAnswer = answersDraft[question.id] ?? { selected: [], text: "" };
          return [
            question.id,
            {
              selected: typedAnswer.selected,
              ...(typedAnswer.text.trim() ? { text: typedAnswer.text.trim() } : {}),
            },
          ];
        }),
      ),
    [questions],
  );

  const submit = useCallback(
    (answersDraft = draft) => {
      resetAutoAdvance();
      respondById(block.id, { action: "responded", answers: buildAnswers(answersDraft) });
    },
    [block.id, buildAnswers, draft, resetAutoAdvance, respondById],
  );

  const chooseOption = useCallback(
    (questionId: string, label: string, multiSelect: boolean) => {
      const current = draft[questionId] ?? { selected: [], text: "" };
      const selected = multiSelect
        ? current.selected.includes(label)
          ? current.selected.filter((item) => item !== label)
          : [...current.selected, label]
        : [label];
      const nextDraft = {
        ...draft,
        [questionId]: { selected, text: multiSelect ? current.text : "" },
      };
      setDraft(nextDraft);
      if (!multiSelect) {
        clearAutoAdvance();
        setAutoAdvance({ questionId, label });
        autoAdvanceTimerRef.current = setTimeout(() => {
          autoAdvanceTimerRef.current = null;
          setAutoAdvance(null);
          if (isLastStep) {
            submit(nextDraft);
          } else {
            setCurrentStep((step) => Math.min(questions.length - 1, step + 1));
          }
        }, SINGLE_SELECT_ADVANCE_DELAY_MS);
      }
    },
    [clearAutoAdvance, draft, isLastStep, questions.length, submit],
  );

  const updateCustomAnswer = useCallback(
    (questionId: string, text: string, multiSelect: boolean) => {
      resetAutoAdvance();
      setDraft((prev) => {
        const current = prev[questionId] ?? { selected: [], text: "" };
        return {
          ...prev,
          [questionId]: {
            selected: multiSelect ? current.selected : [],
            text,
          },
        };
      });
    },
    [resetAutoAdvance],
  );

  const responseAnswers = useMemo(() => getAskResponseAnswers(block), [block]);
  const responseRows = useMemo(() => {
    if (!responseAnswers) return [];
    return Object.entries(responseAnswers).map(([questionId, answer]) => {
      const question = questions.find((item) => item.id === questionId);
      const label = question?.header ?? question?.question ?? questionId;
      const detail =
        question?.header && question.question && question.question !== question.header
          ? question.question
          : undefined;
      return {
        questionId,
        label,
        detail,
        values: [...answer.selected, answer.text].filter((item) => item.trim().length > 0),
      };
    });
  }, [questions, responseAnswers]);
  const { icon: MethodIcon, color } = getUIMethodIcon(block.method);
  const mainTitle = block.title ?? t("uiPending.askUserQuestion");

  if (isPending) {
    return (
      <div
        className="flex max-h-[min(540px,62vh)] flex-col overflow-hidden rounded-lg border border-border-secondary/60 bg-bg-elevated/95 shadow-sm dark:bg-surface-dim/95"
        data-ui-request-id={block.id}
      >
        {currentQuestion ? (
          <>
            <div className="shrink-0 px-3.5 pb-3 pt-3.5 sm:px-4 sm:pt-4">
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1 text-sm font-semibold leading-5 text-text-primary">
                  {mainTitle}
                </div>
                <div className="flex shrink-0 items-center gap-1 text-xs text-text-tertiary">
                  <button
                    type="button"
                    disabled={currentQuestionIndex === 0}
                    onClick={goBack}
                    className="rounded-md p-1 transition-colors hover:bg-surface-hover disabled:cursor-default disabled:opacity-30"
                    aria-label={t("common:back")}
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </button>
                  <span className="min-w-8 text-center tabular-nums">
                    {currentQuestionIndex + 1}/{questions.length}
                  </span>
                  <button
                    type="button"
                    disabled={isLastStep || !canAdvance || autoAdvanceActive}
                    onClick={goNext}
                    className="rounded-md p-1 transition-colors hover:bg-surface-hover disabled:cursor-default disabled:opacity-30"
                    aria-label={t("common:next")}
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              <div className="mt-2.5 flex items-start gap-2.5">
                <span className="mt-0.5 max-w-[40%] shrink-0 truncate rounded-md border border-border-secondary/60 bg-surface-hover/45 px-2 py-0.5 text-[11px] font-medium text-text-secondary">
                  {currentQuestion.header}
                </span>
                <div className="min-w-0 flex-1 text-sm font-medium leading-5 text-text-primary/95">
                  {currentQuestion.question}
                </div>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-3.5 py-2 sm:px-4">
              <div className="space-y-2">
                {currentQuestion.options.map((option) => {
                  const current = draft[currentQuestion.id] ?? { selected: [], text: "" };
                  const checked = current.selected.includes(option.label);
                  const isAutoSelecting =
                    autoAdvance?.questionId === currentQuestion.id &&
                    autoAdvance.label === option.label;
                  const isActive = checked || isAutoSelecting;
                  const Icon = currentQuestion.multiSelect
                    ? checked
                      ? CheckSquare
                      : Square
                    : CircleDot;
                  return (
                    <button
                      key={option.label}
                      type="button"
                      onClick={() =>
                        chooseOption(
                          currentQuestion.id,
                          option.label,
                          !!currentQuestion.multiSelect,
                        )
                      }
                      className={`w-full rounded-md px-3 py-2.5 text-left text-xs leading-5 transition-colors ${
                        isActive
                          ? "bg-surface-hover text-text-primary ring-1 ring-semantic-accent/35"
                          : "text-text-secondary hover:bg-surface-hover/55"
                      }`}
                    >
                      <span className="flex items-start gap-2.5">
                        <Icon
                          className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${
                            isActive ? "text-semantic-accent" : "text-text-tertiary"
                          }`}
                        />
                        <span className="min-w-0">
                          <span className="block font-semibold text-text-primary">
                            {option.label}
                          </span>
                          {option.description && (
                            <span className="mt-0.5 block text-xs leading-5 text-text-tertiary">
                              {option.description}
                            </span>
                          )}
                          {option.preview && (
                            <span className="mt-1 block rounded bg-surface-code px-2 py-1 font-mono text-xs leading-5 text-text-secondary">
                              {option.preview}
                            </span>
                          )}
                        </span>
                      </span>
                    </button>
                  );
                })}
                {(() => {
                  const customText = (draft[currentQuestion.id]?.text ?? "").trim();
                  const CustomIcon = currentQuestion.multiSelect
                    ? customText
                      ? CheckSquare
                      : Square
                    : CircleDot;
                  return (
                    <label
                      className={`flex items-center gap-2.5 rounded-md px-3 py-2.5 text-xs transition-colors ${
                        customText
                          ? "bg-surface-hover text-text-primary ring-1 ring-semantic-accent/35"
                          : "text-text-secondary hover:bg-surface-hover/55"
                      }`}
                    >
                      <CustomIcon
                        className={`h-3.5 w-3.5 shrink-0 ${
                          customText ? "text-semantic-accent" : "text-text-tertiary"
                        }`}
                      />
                      <input
                        type="text"
                        value={(draft[currentQuestion.id] ?? { selected: [], text: "" }).text}
                        onChange={(event) =>
                          updateCustomAnswer(
                            currentQuestion.id,
                            event.target.value,
                            !!currentQuestion.multiSelect,
                          )
                        }
                        onFocus={() =>
                          updateCustomAnswer(
                            currentQuestion.id,
                            draft[currentQuestion.id]?.text ?? "",
                            !!currentQuestion.multiSelect,
                          )
                        }
                        placeholder={t("uiCard.customAnswer")}
                        className="min-w-0 flex-1 bg-transparent text-xs font-medium text-text-primary placeholder:text-text-tertiary focus:outline-none"
                      />
                    </label>
                  );
                })()}
              </div>
            </div>

            <div className="shrink-0 border-t border-border-secondary/50 px-3.5 py-3 sm:px-4">
              <div className="flex flex-wrap items-center gap-2">
                {autoAdvance ? (
                  <span className="min-w-0 flex-1 truncate text-xs font-medium text-semantic-accent">
                    {t("uiCard.selectionSaved", { value: autoAdvance.label })}
                  </span>
                ) : block.message ? (
                  <span className="min-w-0 flex-1 truncate text-xs text-text-tertiary">
                    {block.message}
                  </span>
                ) : (
                  <span className="min-w-0 flex-1" />
                )}
                <div className="ml-auto flex items-center gap-2">
                  <button
                    onClick={() => {
                      resetAutoAdvance();
                      dismissById(block.id);
                    }}
                    className="rounded-md border border-border-secondary/70 bg-surface-hover/35 px-3 py-2 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-hover"
                  >
                    {t("common:dismiss")}
                  </button>
                  {questions.length > 0 && !isLastStep ? (
                    <button
                      onClick={goNext}
                      disabled={!canAdvance || autoAdvanceActive}
                      className="rounded-md bg-semantic-accent px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-semantic-accent/90 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <span className="inline-flex items-center justify-center gap-1">
                        {t("common:next")}
                        <ChevronRight className="h-3.5 w-3.5" />
                      </span>
                    </button>
                  ) : (
                    <button
                      onClick={() => submit()}
                      disabled={
                        questions.length > 0 ? !allAnswered || autoAdvanceActive : !canSubmit
                      }
                      className="rounded-md bg-semantic-accent px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-semantic-accent/90 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {t("common:submit")}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="px-3.5 py-3 text-xs text-text-secondary">{block.message}</div>
        )}
      </div>
    );
  }

  return (
    <div
      className="overflow-hidden rounded-lg border border-status-success/25 bg-status-success/10 dark:bg-status-success/15"
      data-ui-request-id={block.id}
    >
      <div className="flex items-center gap-2 px-3 py-2 text-xs">
        <MethodIcon className={`w-3.5 h-3.5 shrink-0 ${color}`} />
        <span className={`min-w-0 flex-1 truncate font-medium ${color}`}>
          {block.title ?? t("uiCard.askAnswered")}
        </span>
        <CheckCircle className="w-3 h-3 text-status-success shrink-0 ml-auto" />
      </div>
      {responseRows.length > 0 ? (
        <div className="space-y-1.5 px-3 pb-2.5 text-xs text-text-secondary">
          {responseRows.map((row) => (
            <div key={row.questionId} className="rounded-md bg-surface-hover/35 px-2 py-1.5">
              <div className="mb-1 truncate text-[11px] font-medium text-text-tertiary">
                <span>{row.label}</span>
                {row.detail && <span className="text-text-tertiary/80">（{row.detail}）</span>}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {row.values.length > 0 ? (
                  row.values.map((value) => (
                    <span
                      key={value}
                      className="rounded-md bg-status-success/15 px-1.5 py-0.5 text-xs font-medium text-status-success"
                    >
                      {value}
                    </span>
                  ))
                ) : (
                  <span className="text-text-tertiary">{t("uiCard.empty")}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : block.message ? (
        <div className="px-3 pb-2 text-xs text-text-secondary">{block.message}</div>
      ) : null}
    </div>
  );
});

export const AskUserQuestionToolCard = memo(function AskUserQuestionToolCard({
  block,
  uiBlock,
}: ToolRendererProps) {
  const parsedAnswers = parseAskToolOutput(block.output);
  const parsedArgs = parseAskToolArgs(block.args);

  if (uiBlock) {
    if (!parsedAnswers && uiBlock.status === "pending") {
      return <UIInteractionAnchor block={uiBlock} />;
    }
    const normalizedBlock: UIBlock =
      parsedAnswers && block.status !== "running"
        ? {
            ...uiBlock,
            status: "responded",
            title: uiBlock.title ?? parsedArgs.title,
            message: uiBlock.message ?? parsedArgs.message,
            questions: uiBlock.questions ?? parsedArgs.questions,
            response: { action: "responded", answers: parsedAnswers },
          }
        : uiBlock;
    return <AskUserQuestionCard block={normalizedBlock} />;
  }

  const fallbackBlock: UIBlock = {
    type: "uiInteraction",
    id: block.toolCallId,
    method: "askUserQuestion",
    status: parsedAnswers ? "responded" : block.status === "error" ? "dismissed" : "pending",
    title: parsedArgs.title ?? block.toolName,
    message: parsedAnswers ? parsedArgs.message : block.output,
    questions: parsedArgs.questions,
    response: parsedAnswers ? { action: "responded", answers: parsedAnswers } : undefined,
  };

  return <AskUserQuestionCard block={fallbackBlock} />;
});

export const PathPermissionCard = memo(function PathPermissionCard({ block }: { block: UIBlock }) {
  const { t } = useTranslation("chat");
  const respondById = useUIDialogStore((s) => s.respondById);
  const isPending = block.status === "pending";
  const meta = block.permissionMeta?.type === "path_boundary" ? block.permissionMeta : undefined;
  const options = block.options ?? [];
  const scopePattern = meta
    ? `${meta.path.split("/").slice(0, -1).join("/") || "/"}/\u2217\u2217`
    : null;
  const rememberScope = useStatusStore((s) => (s.projectTrust?.trusted ? "project" : "session"));
  const rememberOptions =
    meta && scopePattern
      ? [
          {
            id: "path-boundary-scope",
            label: "Path scope",
            subject: "file.write",
            pattern: scopePattern,
            scope: rememberScope,
            action: "allow" as const,
          },
        ]
      : undefined;

  const scopeIcon = meta?.scope === "write" ? Pencil : Eye;
  const ScopeIcon = scopeIcon;

  const responseValue =
    block.status === "responded" && block.response ? (block.response.value as string) : null;

  if (responseValue) {
    return (
      <CardShell block={block}>
        <div className="px-3 pb-1.5">
          <span className="text-xs text-status-info">{responseValue}</span>
        </div>
      </CardShell>
    );
  }

  if (!isPending) {
    return <CardShell block={block}>{null}</CardShell>;
  }

  return (
    <CardShell block={block}>
      <div className="px-3 py-2">
        {meta && (
          <div className="mb-2.5 space-y-1.5 rounded-md border border-border-secondary/40 bg-surface-dim/60 px-2.5 py-2">
            <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-2">
              <span className="flex items-center gap-1.5 text-[10px] text-text-tertiary">
                <ScopeIcon className="h-3.5 w-3.5 shrink-0" />
                Tool
              </span>
              <span className="min-w-0 truncate text-xs font-medium capitalize text-text-primary">
                {meta.toolName}
              </span>
            </div>
            <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-2">
              <span className="flex items-center gap-1.5 text-[10px] text-text-tertiary">
                <FileWarning className="h-3.5 w-3.5 shrink-0" />
                Path
              </span>
              <span
                className="min-w-0 truncate font-mono text-xs text-text-primary"
                title={meta.path}
              >
                {meta.path}
              </span>
            </div>
            <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-2">
              <span className="flex items-center gap-1.5 text-[10px] text-text-tertiary">
                <FolderOpen className="h-3.5 w-3.5 shrink-0" />
                Project
              </span>
              <span
                className="min-w-0 truncate font-mono text-xs text-text-secondary"
                title={meta.cwd}
              >
                {meta.cwd}
              </span>
            </div>
            <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-2">
              <span className="flex items-center gap-1.5 text-[10px] text-text-tertiary">
                <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-status-warning" />
                Status
              </span>
              <span className="min-w-0 truncate text-xs text-status-warning">
                {meta.relativeTo}
              </span>
            </div>
          </div>
        )}
        <PermissionActionButtons
          options={options}
          rememberOptions={rememberOptions}
          onSelect={(value) => respondById(block.id, { value })}
        />
        {block.timeout != null && block.timeout > 0 && (
          <div className="flex items-center gap-1 mt-1.5 px-0.5">
            <Clock className="w-3 h-3 text-text-tertiary" />
            <span className="text-[10px] text-text-tertiary">
              {t("uiCard.autoDeny", { seconds: Math.ceil(block.timeout / 1000) })}
            </span>
          </div>
        )}
      </div>
    </CardShell>
  );
});

export const RuntimePermissionCard = memo(function RuntimePermissionCard({
  block,
}: {
  block: UIBlock;
}) {
  const { t } = useTranslation("chat");
  const respondById = useUIDialogStore((s) => s.respondById);
  const isPending = block.status === "pending";
  const meta =
    block.permissionMeta?.type === "permission_runtime" ? block.permissionMeta : undefined;
  const options = block.options ?? [];
  const command =
    typeof meta?.metadata?.command === "string"
      ? meta.metadata.command
      : typeof meta?.metadata?.path === "string"
        ? meta.metadata.path
        : undefined;

  const responseValue =
    block.status === "responded" && block.response ? (block.response.value as string) : null;

  if (responseValue) {
    return (
      <CardShell block={block}>
        <div className="px-3 pb-1.5">
          <span className="text-xs text-status-info">{responseValue}</span>
        </div>
      </CardShell>
    );
  }

  if (!isPending) {
    return <CardShell block={block}>{null}</CardShell>;
  }

  return (
    <CardShell block={block}>
      <div className="px-3 py-2">
        {block.message && (
          <p className="mb-2 text-[11px] leading-relaxed text-text-secondary">{block.message}</p>
        )}
        {meta && (
          <div className="mb-2 space-y-1 rounded-md border border-border-secondary/40 bg-surface-dim/35 px-2 py-1.5">
            <div className="grid grid-cols-[4rem_minmax(0,1fr)] items-center gap-2">
              <span className="text-[10px] text-text-tertiary">Provider</span>
              <span className="min-w-0 truncate text-[11px] font-medium text-text-primary">
                {meta.provider}
              </span>
            </div>
            <div className="grid grid-cols-[4rem_minmax(0,1fr)] items-center gap-2">
              <span className="text-[10px] text-text-tertiary">Subject</span>
              <span className="min-w-0 truncate font-mono text-[11px] text-text-secondary">
                {meta.subject}
              </span>
            </div>
            {command && (
              <div className="grid grid-cols-[4rem_minmax(0,1fr)] items-center gap-2">
                <span className="text-[10px] text-text-tertiary">Command</span>
                <span
                  className="min-w-0 truncate font-mono text-[11px] text-text-primary"
                  title={command}
                >
                  {command}
                </span>
              </div>
            )}
          </div>
        )}
        <PermissionActionButtons
          options={options}
          rememberOptions={meta?.rememberOptions}
          onSelect={(value) => respondById(block.id, { value })}
        />
        {block.timeout != null && block.timeout > 0 && (
          <div className="flex items-center gap-1 mt-1.5 px-0.5">
            <Clock className="w-3 h-3 text-text-tertiary" />
            <span className="text-[10px] text-text-tertiary">
              {t("uiCard.autoDeny", { seconds: Math.ceil(block.timeout / 1000) })}
            </span>
          </div>
        )}
      </div>
    </CardShell>
  );
});

export const SelectCard = memo(function SelectCard({ block }: { block: UIBlock }) {
  const { t } = useTranslation("chat");
  const respondById = useUIDialogStore((s) => s.respondById);
  const dismissById = useUIDialogStore((s) => s.dismissById);
  const isPending = block.status === "pending";
  const options = block.options ?? [];
  const isMulti = !!block.multiple || (block.toolName?.toLowerCase().includes("multi") ?? false);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [checkedSet, setCheckedSet] = useState<Set<number>>(new Set());
  const [customValue, setCustomValue] = useState("");
  const [customSelected, setCustomSelected] = useState(false);

  const toggleCheck = useCallback((i: number) => {
    setCheckedSet((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }, []);

  function parseOption(opt: string) {
    const idx = opt.indexOf(" ");
    if (idx <= 0) return { label: opt, desc: "" };
    return { label: opt.slice(0, idx), desc: opt.slice(idx + 1) };
  }

  const responseValue =
    block.status === "responded" && block.response
      ? (block.response.value as string | string[])
      : null;

  if (isPending) {
    if (isMulti) {
      return (
        <CardShell block={block}>
          <div className="px-3 py-2 space-y-0.5">
            {options.map((opt, i) => {
              const { label, desc } = parseOption(opt);
              const checked = checkedSet.has(i);
              return (
                <button
                  key={i}
                  onClick={() => toggleCheck(i)}
                  className={`w-full text-left flex items-center gap-2 px-2 py-1.5 rounded-md text-[11px] transition-colors ${
                    checked
                      ? "bg-status-info text-white dark:bg-status-info/15 dark:text-status-info"
                      : "text-text-secondary hover:bg-surface-dim hover:text-text-primary"
                  }`}
                >
                  {checked ? (
                    <CheckSquare className="w-3.5 h-3.5 shrink-0 text-white dark:text-status-info" />
                  ) : (
                    <Square className="w-3.5 h-3.5 shrink-0 text-text-tertiary" />
                  )}
                  <div className="min-w-0">
                    <div>{label}</div>
                    {desc && (
                      <div
                        className={`text-[10px] ${checked ? "text-white/70 dark:text-text-tertiary" : "text-text-tertiary"}`}
                      >
                        {desc}
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
            <div className="flex items-center gap-2 px-2 py-1.5">
              <button
                onClick={() => {
                  setCustomSelected(true);
                  setCheckedSet(new Set());
                }}
                className={`shrink-0 ${customSelected ? "text-status-info" : "text-text-tertiary"}`}
              >
                {customSelected ? (
                  <CheckSquare className="w-3.5 h-3.5" />
                ) : (
                  <Square className="w-3.5 h-3.5" />
                )}
              </button>
              <span
                className={`text-[11px] ${customSelected ? "text-status-info" : "text-text-secondary"}`}
              >
                {t("uiCard.customAnswer")}
              </span>
            </div>
            {customSelected && (
              <input
                type="text"
                value={customValue}
                onChange={(e) => setCustomValue(e.target.value)}
                placeholder={block.placeholder ?? t("uiCard.inputYourAnswer")}
                className="w-full ml-6 bg-surface-dim border border-border-secondary rounded px-2 py-1 text-[11px] text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-status-warning/50"
                onKeyDown={(e) =>
                  e.key === "Enter" &&
                  customValue.trim() &&
                  respondById(block.id, { value: customValue.trim() })
                }
              />
            )}
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => {
                  if (checkedSet.size > 0)
                    respondById(block.id, { value: Array.from(checkedSet).map((i) => options[i]) });
                  else if (customValue.trim()) respondById(block.id, { value: customValue.trim() });
                }}
                disabled={checkedSet.size === 0 && !customValue.trim()}
                className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-md bg-status-warning text-white dark:bg-status-warning/20 dark:text-status-warning hover:bg-status-warning/90 dark:hover:bg-status-warning/30 disabled:opacity-40 disabled:cursor-not-allowed text-[11px] transition-colors"
              >
                {t("common:submit")}
              </button>
              <button
                onClick={() => dismissById(block.id)}
                className="flex items-center justify-center px-3 py-1.5 rounded-md bg-surface-hover/60 text-text-secondary hover:bg-surface-hover text-[11px] transition-colors"
              >
                {t("common:dismiss")}
              </button>
            </div>
          </div>
        </CardShell>
      );
    }

    return (
      <CardShell block={block}>
        <div className="px-3 py-2 space-y-0.5">
          {options.map((opt, i) => {
            const { label, desc } = parseOption(opt);
            return (
              <button
                key={i}
                onClick={() => {
                  setSelectedIdx(i);
                  setCustomSelected(false);
                }}
                className={`w-full text-left flex items-center gap-2 px-2 py-1.5 rounded-md text-[11px] transition-colors ${
                  selectedIdx === i
                    ? "bg-status-info text-white dark:bg-status-info/15 dark:text-status-info"
                    : "text-text-secondary hover:bg-surface-hover dark:hover:bg-surface-hover/50 hover:text-text-primary dark:hover:text-text-secondary"
                }`}
              >
                <CircleDot
                  className={`w-3.5 h-3.5 shrink-0 ${selectedIdx === i ? "text-white dark:text-status-info" : "text-text-tertiary"}`}
                />
                <div className="min-w-0">
                  <div>{label}</div>
                  {desc && (
                    <div
                      className={`text-[10px] ${selectedIdx === i ? "text-white/70 dark:text-text-tertiary" : "text-text-tertiary"}`}
                    >
                      {desc}
                    </div>
                  )}
                </div>
              </button>
            );
          })}
          <div className="flex items-center gap-2 px-2 py-1.5">
            <button
              onClick={() => {
                setCustomSelected(true);
                setSelectedIdx(null);
              }}
              className={`shrink-0 ${customSelected || selectedIdx === -1 ? "text-status-info" : "text-text-tertiary"}`}
            >
              {customSelected || selectedIdx === -1 ? (
                <CircleDot className="w-3.5 h-3.5 text-status-info" />
              ) : (
                <CircleDot className="w-3.5 h-3.5 text-text-tertiary" />
              )}
            </button>
            <span
              className={`text-[11px] ${customSelected || selectedIdx === -1 ? "text-status-info" : "text-text-secondary"}`}
            >
              {t("uiCard.customAnswer")}
            </span>
          </div>
          {customSelected && (
            <input
              type="text"
              value={customValue}
              onChange={(e) => setCustomValue(e.target.value)}
              placeholder={block.placeholder ?? t("uiCard.inputYourAnswer")}
              className="w-full ml-7 bg-surface-dim border border-border-secondary rounded px-2 py-1 text-[11px] text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-status-warning/50"
              onKeyDown={(e) =>
                e.key === "Enter" &&
                customValue.trim() &&
                respondById(block.id, { value: customValue.trim() })
              }
            />
          )}
          <div className="flex gap-2 pt-1">
            <button
              onClick={() => {
                if (selectedIdx != null && selectedIdx >= 0)
                  respondById(block.id, { value: options[selectedIdx] });
                else if (customValue.trim()) respondById(block.id, { value: customValue.trim() });
              }}
              disabled={selectedIdx == null && !customValue.trim()}
              className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-md bg-status-warning text-white dark:bg-status-warning/20 dark:text-status-warning hover:bg-status-warning/90 dark:hover:bg-status-warning/30 disabled:opacity-40 disabled:cursor-not-allowed text-[11px] transition-colors"
            >
              {t("common:submit")}
            </button>
            <button
              onClick={() => dismissById(block.id)}
              className="flex items-center justify-center px-3 py-1.5 rounded-md bg-surface-hover/60 dark:bg-surface-hover/30 text-text-secondary dark:text-text-tertiary hover:bg-surface-hover/80 dark:hover:bg-surface-hover/50 text-[11px] transition-colors"
            >
              {t("common:dismiss")}
            </button>
          </div>
        </div>
      </CardShell>
    );
  }

  if (responseValue) {
    const display = Array.isArray(responseValue) ? responseValue.join(", ") : responseValue;
    return (
      <CardShell block={block}>
        <div className="px-3 pb-1.5">
          <span className="text-[11px] text-status-info">
            {isMulti
              ? t("uiCard.selected", { count: (responseValue as string[]).length })
              : t("uiCard.selectedSingle")}
            {display}
          </span>
        </div>
      </CardShell>
    );
  }

  return <CardShell block={block}>{null}</CardShell>;
});

export const InputCard = memo(function InputCard({ block }: { block: UIBlock }) {
  const { t } = useTranslation("chat");
  const respondById = useUIDialogStore((s) => s.respondById);
  const isPending = block.status === "pending";
  const [value, setValue] = useState("");

  const responseValue =
    block.status === "responded" && block.response ? (block.response.value as string) : null;

  return (
    <CardShell block={block}>
      {isPending ? (
        <div className="px-3 py-1.5 flex gap-1.5">
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={block.placeholder ?? t("uiCard.pleaseInput")}
            className="flex-1 bg-surface-dim/60 border border-border-secondary/50 rounded px-2 py-1 text-[11px] text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-status-warning/50"
            onKeyDown={(e) => {
              if (e.key === "Enter") respondById(block.id, { value });
            }}
          />
          <button
            onClick={() => respondById(block.id, { value })}
            className="flex items-center justify-center px-2 py-1 rounded bg-status-warning text-white dark:bg-status-warning/20 dark:text-status-warning hover:bg-status-warning/90 dark:hover:bg-status-warning/30 transition-colors"
          >
            <Send className="w-3 h-3" />
          </button>
        </div>
      ) : responseValue != null ? (
        <div className="px-3 pb-1.5">
          <span className="text-[11px] text-status-warning">
            {t("uiCard.inputColon")}
            {responseValue || t("uiCard.empty")}
          </span>
        </div>
      ) : null}
    </CardShell>
  );
});

export const EditorCard = memo(function EditorCard({ block }: { block: UIBlock }) {
  const { t } = useTranslation("chat");
  const respondById = useUIDialogStore((s) => s.respondById);
  const dismissById = useUIDialogStore((s) => s.dismissById);
  const isPending = block.status === "pending";
  const [value, setValue] = useState(block.prefill ?? "");

  const responseValue =
    block.status === "responded" && block.response ? (block.response.value as string) : null;
  const wasDismissed =
    block.status === "dismissed" ||
    (block.response && "cancelled" in block.response && block.response.cancelled === true);

  return (
    <CardShell block={block}>
      {isPending ? (
        <div className="px-3 py-1.5 space-y-1.5">
          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={block.placeholder ?? t("uiCard.pleaseEdit")}
            rows={4}
            className="w-full bg-surface-dim border border-border-secondary/30 rounded px-2 py-1 text-[11px] text-text-primary font-mono placeholder:text-text-tertiary focus:outline-none focus:border-status-info/50 resize-y"
          />
          <div className="flex gap-1.5">
            <button
              onClick={() => respondById(block.id, { value })}
              className="flex-1 flex items-center justify-center gap-1 py-1 text-[11px] rounded bg-semantic-agent text-white dark:bg-semantic-agent/20 dark:text-semantic-agent hover:bg-semantic-agent/90 dark:hover:bg-semantic-agent/30 transition-colors"
            >
              <Send className="w-3 h-3" />
              {t("common:submit")}
            </button>
            <button
              onClick={() => dismissById(block.id)}
              className="flex items-center justify-center gap-1 px-2 py-1 text-[11px] rounded bg-surface-hover/60 text-text-secondary hover:bg-surface-hover dark:hover:bg-surface-hover transition-colors"
            >
              <X className="w-3 h-3" />
              {t("common:cancel")}
            </button>
          </div>
        </div>
      ) : responseValue != null ? (
        <div className="px-3 pb-1.5">
          <details>
            <summary className="text-[11px] text-semantic-agent cursor-pointer hover:text-semantic-agent dark:hover:text-semantic-agent">
              {t("uiCard.editContent", { count: responseValue.length })}
            </summary>
            <pre className="mt-1 text-[11px] text-text-primary bg-surface-code rounded p-2 max-h-40 overflow-auto whitespace-pre-wrap font-mono">
              {responseValue}
            </pre>
          </details>
        </div>
      ) : wasDismissed ? (
        <div className="px-3 pb-1.5">
          <span className="text-[11px] text-text-tertiary">{t("uiCard.editCancelled")}</span>
        </div>
      ) : null}
    </CardShell>
  );
});

export const NotifyCard = memo(function NotifyCard({ block }: { block: UIBlock }) {
  const { t } = useTranslation("chat");
  const notifyColors: Record<string, string> = {
    info: "text-semantic-tool",
    warning: "text-status-warning",
    error: "text-status-error",
  };
  const colorClass = notifyColors[block.notifyType ?? "info"] ?? "text-semantic-tool";

  return (
    <CardShell block={block}>
      <div className="px-3 pb-1.5">
        <span className={`text-[11px] ${colorClass}`}>
          {block.notifyType === "warning" ? "⚠️ " : block.notifyType === "error" ? "❌ " : "ℹ️ "}
          {block.message ?? t("uiCard.notificationSent")}
        </span>
      </div>
    </CardShell>
  );
});

export const RespondUICard = memo(function RespondUICard({ block }: { block: UIBlock }) {
  const { icon: Icon, color } = getUIMethodIcon("respondUI");

  return (
    <div
      className="overflow-hidden rounded bg-semantic-notify/50 dark:bg-semantic-notify/20 border-l-2 border-semantic-notify/30 dark:border-semantic-notify/40"
      data-ui-request-id={block.id}
    >
      <div className="px-3 py-1.5 flex items-center gap-2 text-xs">
        <Icon className={`w-3.5 h-3.5 shrink-0 ${color}`} />
        {block.title && <span className={`font-medium ${color}`}>{block.title}</span>}
        <Zap className="w-3 h-3 text-semantic-notify shrink-0 ml-auto" />
      </div>
      {block.message && (
        <div className="px-3 pb-1.5 text-[11px] text-semantic-notify/70">{block.message}</div>
      )}
    </div>
  );
});

export const UIInteractionCard = memo(function UIInteractionCard({ block }: { block: UIBlock }) {
  switch (block.method) {
    case "askUserQuestion":
      return <AskUserQuestionCard block={block} />;
    case "confirm":
      return <ConfirmCard block={block} />;
    case "select":
      if (block.permissionMeta?.type === "path_boundary") {
        return <PathPermissionCard block={block} />;
      }
      if (block.permissionMeta?.type === "permission_runtime") {
        return <RuntimePermissionCard block={block} />;
      }
      return <SelectCard block={block} />;
    case "input":
      return <InputCard block={block} />;
    case "editor":
      return <EditorCard block={block} />;
    case "notify":
      return <NotifyCard block={block} />;
    default:
      return <CardShell block={block}>{null}</CardShell>;
  }
});
