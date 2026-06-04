export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) {
    const s = ms / 1000;
    return s < 10 ? `${s.toFixed(1)}s` : `${Math.round(s)}s`;
  }
  const m = Math.floor(ms / 60000);
  const sec = Math.round((ms % 60000) / 1000);
  return sec > 0 ? `${m}m${sec}s` : `${m}m`;
}
