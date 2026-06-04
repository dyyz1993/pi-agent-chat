export function formatTokenCount(n: number): string {
  if (n >= 1_000_000) {
    const str = (n / 1_000_000).toFixed(1);
    return `${str}M`;
  }
  if (n >= 1_000) {
    const str = (n / 1_000).toFixed(n % 1000 === 0 ? 0 : 1);
    if (parseFloat(str) >= 1000) {
      return `${(parseFloat(str) / 1000).toFixed(1)}M`;
    }
    return `${str}K`;
  }
  return `${n}`;
}
