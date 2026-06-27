import { useEffect, useMemo, useState } from "react";
import type { LucideIcon } from "lucide-react";
import type { AgentAvatar as AgentAvatarValue } from "../../stores/use-agent-store";
import { apiClient } from "../../lib/api-client";
import { cx } from "../../lib/classes";
import { toLocalFileUrl } from "../../lib/file-url";
import { agentColorStyle } from "../../utils/agent-color";

const URL_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const ABSOLUTE_PATH = /^(\/|[A-Za-z]:[\\/])/;

function dirname(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  return index > 0 ? normalized.slice(0, index) : "";
}

function normalizePath(path: string): string {
  const isAbsolute = path.startsWith("/");
  const parts: string[] = [];
  for (const part of path.replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return `${isAbsolute ? "/" : ""}${parts.join("/")}`;
}

function toFilePath(src: string, agentFilePath?: string): string {
  if (src.startsWith("file:")) {
    try {
      return decodeURIComponent(new URL(src).pathname);
    } catch {
      return src.replace(/^file:\/\//i, "");
    }
  }
  if (ABSOLUTE_PATH.test(src)) return src;
  if (!agentFilePath) return src;
  return normalizePath(`${dirname(agentFilePath)}/${src}`);
}

function resolveImageSrc(src: string, agentFilePath?: string): string {
  if (/^(https?:|data:)/i.test(src)) return src;

  const filePath = toFilePath(src, agentFilePath);
  if (!ABSOLUTE_PATH.test(filePath) && !URL_SCHEME.test(filePath)) return src;
  if (apiClient.getTransport() === "websocket") {
    const token = apiClient.getAuthToken();
    const baseUrl = apiClient.getBaseUrl();
    return baseUrl ? `${baseUrl}/fs${filePath}?token=${token}` : `/fs${filePath}?token=${token}`;
  }
  if (URL_SCHEME.test(filePath)) return filePath;
  return toLocalFileUrl(filePath);
}

export function AgentAvatar({
  avatar,
  agentFilePath,
  color,
  fallbackIcon: FallbackIcon,
  className,
  fallbackClassName,
  title,
}: {
  avatar?: AgentAvatarValue;
  agentFilePath?: string;
  color?: string;
  fallbackIcon: LucideIcon;
  className?: string;
  fallbackClassName?: string;
  title?: string;
}) {
  const imageSrc = useMemo(
    () => (avatar?.type === "image" ? resolveImageSrc(avatar.src, agentFilePath) : null),
    [agentFilePath, avatar],
  );
  const fallbackStyle = useMemo(() => agentColorStyle(color), [color]);
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    setImageFailed(false);
  }, [imageSrc]);

  if (avatar?.type === "emoji") {
    return (
      <span
        className={cx(
          "inline-flex items-center justify-center overflow-hidden text-center leading-none",
          className,
        )}
        title={title}
        aria-hidden="true"
      >
        {avatar.value}
      </span>
    );
  }

  if (imageSrc && !imageFailed) {
    return (
      <span
        className={cx("inline-flex items-center justify-center overflow-hidden", className)}
        title={title}
        aria-hidden="true"
      >
        <img
          src={imageSrc}
          alt=""
          className="h-full w-full rounded-[inherit] object-cover"
          draggable={false}
          onError={() => setImageFailed(true)}
        />
      </span>
    );
  }

  if (fallbackStyle) {
    return (
      <span
        className={cx("inline-flex items-center justify-center overflow-hidden", className)}
        style={{ backgroundColor: fallbackStyle.bg, color: fallbackStyle.color }}
        title={title}
        aria-hidden="true"
      >
        <FallbackIcon className={cx("h-[70%] w-[70%]", fallbackClassName)} />
      </span>
    );
  }

  return <FallbackIcon className={cx(className, fallbackClassName)} aria-hidden="true" />;
}
