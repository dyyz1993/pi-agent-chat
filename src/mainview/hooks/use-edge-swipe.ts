/**
 * 边缘滑动手势
 * 
 * 从屏幕左边缘右滑 → 打开左侧面板（会话列表）
 * 从屏幕右边缘左滑 → 打开右侧面板（状态面板）
 * 
 * 仅在移动端生效。
 */
import { useCallback, useRef, useEffect } from 'react';
import { useLayoutStore } from '../layouts/use-layout-store';

interface SwipeConfig {
  /** 边缘触发区域宽度（px），默认 20 */
  edgeWidth?: number;
  /** 最小滑动距离（px），默认 60 */
  minDistance?: number;
  /** 最大滑动时间（ms），默认 500 */
  maxDuration?: number;
}

export function useEdgeSwipe(config?: SwipeConfig) {
  const edgeWidth = config?.edgeWidth ?? 20;
  const minDistance = config?.minDistance ?? 60;
  const maxDuration = config?.maxDuration ?? 500;

  const startX = useRef(0);
  const startY = useRef(0);
  const startTime = useRef(0);

  const handleTouchStart = useCallback((e: TouchEvent) => {
    const touch = e.touches[0];
    startX.current = touch.clientX;
    startY.current = touch.clientY;
    startTime.current = Date.now();
  }, []);

  const handleTouchEnd = useCallback((e: TouchEvent) => {
    const touch = e.changedTouches[0];
    const deltaX = touch.clientX - startX.current;
    const deltaY = Math.abs(touch.clientY - startY.current);
    const duration = Date.now() - startTime.current;

    // 必须是水平滑动（Y 偏移小于 X 偏移的 50%）
    if (deltaY > Math.abs(deltaX) * 0.5) return;
    // 滑动距离和时长限制
    if (Math.abs(deltaX) < minDistance || duration > maxDuration) return;

    const store = useLayoutStore.getState();
    const width = window.innerWidth;

    // 从左边缘右滑 → 打开左侧面板（会话列表）
    if (startX.current < edgeWidth && deltaX > 0) {
      store.showSession();
      return;
    }

    // 从右边缘左滑 → 打开右侧面板（状态面板）
    if (startX.current > width - edgeWidth && deltaX < 0) {
      store.showStatus();
      return;
    }
  }, [edgeWidth, minDistance, maxDuration]);

  useEffect(() => {
    // 只在移动端启用
    if (window.innerWidth >= 640) return;

    document.addEventListener('touchstart', handleTouchStart, { passive: true });
    document.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      document.removeEventListener('touchstart', handleTouchStart);
      document.removeEventListener('touchend', handleTouchEnd);
    };
  }, [handleTouchStart, handleTouchEnd]);
}
