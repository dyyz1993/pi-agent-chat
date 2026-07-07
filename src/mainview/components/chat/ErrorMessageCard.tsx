import { memo, useCallback, useState } from "react";
import { AlertTriangle, Archive, Check, ChevronDown, Copy } from "lucide-react";
import { useClipboard } from "./preview/use-clipboard";
import type { ChatMessage } from "../../types";
import { CHAT_CARD_SHELL_CLASS } from "./chat-layout-classes";
import {
  formatCompactNumber,
  getProviderRequestSection,
  isSuspectedContextProviderError,
  summarizeProviderRequest,
} from "../../lib/provider-error-diagnostics";

export const ErrorMessageCard = memo(function ErrorMessageCard({
  message,
  title,
  detail,
  stopReason,
}: {
  message: ChatMessage;
  title: string;
  detail: string;
  stopReason?: string | null;
}) {
  const { copied, copy } = useClipboard(2000);
  const normalizedDetail = detail.trim();
  const hasDetail = normalizedDetail.length > 0;
  const [expanded, setExpanded] = useState(false);
  const providerRequest = message.providerRequest;
  const suspectedContextError = isSuspectedContextProviderError(normalizedDetail, providerRequest);
  const messageCount = getProviderRequestSection(providerRequest, "messages")?.count;
  const toolCount = getProviderRequestSection(providerRequest, "tools")?.count;
  const providerRequestSummary = providerRequest ? summarizeProviderRequest(providerRequest) : "";
  const detailPreview = hasDetail
    ? normalizedDetail.replace(/\s+/gu, " ").slice(0, 180)
    : "未收到 provider 原始错误详情，可能是上游只返回了错误分类或响应体为空。";

  const handleCopy = useCallback(() => {
    const copyText = [
      title,
      normalizedDetail,
      stopReason ? `stopReason: ${stopReason}` : "",
      providerRequestSummary ? `providerRequest: ${providerRequestSummary}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    copy(copyText);
  }, [title, normalizedDetail, stopReason, providerRequestSummary, copy]);

  return (
    <div data-msg-card-id={message.id} className={CHAT_CARD_SHELL_CLASS}>
      <div className="mx-3 rounded-lg bg-status-error/10 border border-status-error/20">
        <div className="flex items-start gap-2 px-3 py-2">
          <button
            type="button"
            onClick={() => hasDetail && setExpanded(!expanded)}
            aria-expanded={expanded}
            className="flex min-w-0 flex-1 items-start gap-2 text-left"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-status-error" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium text-status-error">{title}</span>
                {stopReason && (
                  <span className="rounded bg-status-error/10 px-1.5 py-0.5 text-[10px] text-status-error/60">
                    {stopReason}
                  </span>
                )}
              </div>
              <div className="mt-0.5 truncate text-xs text-status-error/70">
                {detailPreview}
                {hasDetail && normalizedDetail.length > 180 ? "..." : ""}
              </div>
            </div>
            {hasDetail && (
              <ChevronDown
                className={`mt-0.5 h-3.5 w-3.5 shrink-0 text-status-error/60 transition-transform ${
                  expanded ? "rotate-180" : ""
                }`}
              />
            )}
          </button>
          <button
            onClick={handleCopy}
            className="shrink-0 p-1 hover:bg-status-error/20 rounded transition-colors"
            title="复制错误信息"
          >
            {copied ? (
              <Check className="w-3.5 h-3.5 text-status-success" />
            ) : (
              <Copy className="w-3.5 h-3.5 text-status-error/60" />
            )}
          </button>
        </div>
        {hasDetail && expanded && (
          <div className="px-3 pb-2">
            {suspectedContextError && providerRequest && (
              <div className="mb-2 flex items-start gap-1.5 text-xs leading-relaxed text-status-warning/85">
                <Archive className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <div className="min-w-0">
                  <span className="font-medium">疑似上下文过大：</span>
                  最近一次请求约 {formatCompactNumber(providerRequest.payloadTokens)} tokens
                  {messageCount !== undefined ? `，${messageCount} 条消息` : ""}
                  {toolCount !== undefined ? `，${toolCount} 个工具` : ""}
                  。建议发送 <code className="font-mono">/compact-force</code> 后重试，或切换到实际可用窗口更大的模型。
                  <span className="ml-1 text-[10px] text-status-warning/60">
                    {providerRequest.provider}/{providerRequest.modelId}
                    {providerRequest.api ? ` · ${providerRequest.api}` : ""}
                  </span>
                </div>
              </div>
            )}
            <pre
              data-testid="llm-error-detail"
              className="max-h-40 overflow-y-auto rounded bg-status-error/5 px-2 py-1.5 text-xs text-status-error/80 whitespace-pre-wrap break-all"
            >
              {normalizedDetail}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
});
