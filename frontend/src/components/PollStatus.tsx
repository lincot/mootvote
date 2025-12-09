function formatDiff(ms: number): string {
  const s = Math.max(1, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function pollStatus(nowMs: number, startSec: number, endSec: number): string {
  const startMs = startSec * 1000;
  const endMs = endSec * 1000;
  if (nowMs < startMs) return `Starts in ${formatDiff(startMs - nowMs)}`;
  if (nowMs < endMs) return `Ends in ${formatDiff(endMs - nowMs)}`;
  return `Ended ${formatDiff(nowMs - endMs)} ago`;
}

function pollStatusMeta(
  nowMs: number,
  startSec: number,
  endSec: number,
): { label: string; cls: string } {
  const label = pollStatus(nowMs, startSec, endSec);
  const startMs = startSec * 1000;
  const endMs = endSec * 1000;
  if (nowMs < startMs) {
    return {
      label,
      cls: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
    };
  } else if (nowMs < endMs) {
    return {
      label,
      cls:
        "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
    };
  } else {
    return {
      label,
      cls:
        "bg-neutral-100 text-neutral-600 dark:bg-neutral-800/60 dark:text-neutral-400",
    };
  }
}

export const PollStatus: React.FC<
  { votingStartTime: number; votingEndTime: number }
> = ({ votingStartTime, votingEndTime }) => {
  const now = Date.now();
  const meta = pollStatusMeta(now, votingStartTime, votingEndTime);

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded ${meta.cls}`}
    >
      {meta.label}
    </span>
  );
};
