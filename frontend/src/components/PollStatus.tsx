import { useTranslation } from "react-i18next";

export function formatTimeDiff(sec: number): string {
  const { t } = useTranslation();
  const s = Math.max(1, Math.floor(sec));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return t("time.d", { days: d, hours: h });
  if (h > 0) return t("time.h", { hours: h, mins: m });
  if (m > 0) return t("time.m", { mins: m });
  return t("time.s", { secs: s });
}

function pollStatus(nowMs: number, startSec: number, endSec: number): string {
  const { t } = useTranslation();

  if (nowMs < 1000 * startSec) {
    return t("status.starts_in", {
      time: formatTimeDiff(startSec - nowMs / 1000),
    });
  }
  if (nowMs < 1000 * endSec) {
    return t("status.ends_in", { time: formatTimeDiff(endSec - nowMs / 1000) });
  }
  return t("status.ended_ago", { time: formatTimeDiff(nowMs / 1000 - endSec) });
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
