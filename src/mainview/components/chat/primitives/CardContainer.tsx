import { type ReactNode, type Ref } from "react";
import { CARD_CONTAINER_BASE } from "../chat-layout-classes";

interface CardContainerProps {
  children: ReactNode;
  isRunning: boolean;
  isError: boolean;
  /** 运行态边框色，默认 border-status-info/25 */
  runningBorder?: string;
  /** 运行态背景色，默认 bg-status-info/5 */
  runningBg?: string;
  className?: string;
  blockId?: string;
  containerRef?: Ref<HTMLDivElement>;
}

/**
 * 工具卡片外层容器。
 * ReadFileCard 为标准模板，80% 的卡片直接用默认参数就可以。
 * 特殊卡片可通过 runningBorder/runningBg 自定义运行态颜色。
 */
export function CardContainer({
  children,
  isRunning,
  isError,
  runningBorder = "border-status-info/25",
  runningBg = "bg-status-info/5",
  className = "",
  blockId,
  containerRef,
}: CardContainerProps) {
  let stateColors: string;
  if (isRunning) {
    stateColors = `${runningBorder} ${runningBg}`;
  } else if (isError) {
    stateColors = "border-status-error/15 bg-status-error/5";
  } else {
    stateColors = "border-border-secondary/30 bg-surface-dim";
  }

  return (
    <div
      ref={containerRef}
      data-block-id={blockId}
      className={`${CARD_CONTAINER_BASE} ${stateColors} ${className}`}
    >
      {children}
    </div>
  );
}
