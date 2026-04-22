export function formatDistanceToNowStrict(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const absSec = Math.abs(diffMs) / 1000;
  if (absSec < 60) return `${Math.round(absSec)}s ago`;
  if (absSec < 3600) return `${Math.round(absSec / 60)}m ago`;
  if (absSec < 86400) return `${Math.round(absSec / 3600)}h ago`;
  return `${Math.round(absSec / 86400)}d ago`;
}
