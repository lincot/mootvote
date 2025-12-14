import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { PollStatus } from "../components/PollStatus.tsx";
import { INDEXER_URL } from "../env.tsx";
import { keyToLeafHex, useKeyringCtx } from "../keyring.tsx";
import { btn } from "../btn.ts";
import { unlockToView } from "../unlockToView.tsx";

export type PollItem = {
  poll_id: string;
  voting_start_time: number;
  voting_end_time: number;
  title: string;
  choices: string[];
};

type Page = { items: PollItem[]; next_before: number | null };

const POLLS_PAGE_LIMIT = 20;

export default function PollListPage() {
  const KR = useKeyringCtx();
  const [sp, setSp] = useSearchParams();
  const role = (sp.get("role") ?? "all roles") as
    | "all roles"
    | "voter"
    | "tallier";
  const status = (sp.get("status") ?? "all statuses") as
    | "all statuses"
    | "Active"
    | "Upcoming"
    | "Ended";
  const [page, setPage] = useState<Page | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [before, setBefore] = useState<number | null>(null);
  const [stack, setStack] = useState<number[]>([]);

  const setQP = (k: string, v: string | null) => {
    const next = new URLSearchParams(sp);
    if (v === null) next.delete(k);
    else next.set(k, v);
    setSp(next, { replace: true });
  };

  const load = useCallback(async () => {
    try {
      setErr("");
      setLoading(true);
      const acc = KR.accounts[KR.active];
      if (!acc) {
        setPage(null);
        return;
      }
      const q = new URLSearchParams();
      q.set("limit", String(POLLS_PAGE_LIMIT));
      if (role !== "all roles") q.set("role", role);
      if (role === "tallier" || role === "all roles") {
        q.set(
          "coordinator",
          (acc.pub[0].toString(16).padStart(64, "0") +
            acc.pub[1].toString(16).padStart(64, "0")).toLowerCase(),
        );
      }
      if (role === "voter" || role == "all roles") {
        q.set("voter_leaf", await keyToLeafHex(acc.pub));
      }
      if (status !== "all statuses") q.set("status", status);
      if (before) q.set("before", String(before));
      const r = await fetch(`${INDEXER_URL}/polls?${q.toString()}`);
      if (!r.ok) throw new Error(await r.text());
      const p: Page = await r.json();
      setPage(p);
    } catch (e: any) {
      setErr(e.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, [KR.active, KR.accounts, role, status, before]);

  useEffect(() => {
    if (!KR.locked) load();
  }, [load, KR.locked]);

  const next = () => {
    setStack((s) => [...s, before!]);
    setBefore(page!.next_before!);
  };
  const prev = () => {
    const s = stack.slice();
    const a = s.pop()!;
    setStack(s);
    setBefore(a);
  };
  const reset = () => {
    setStack([]);
    setBefore(null);
  };

  const canPrev = stack.length !== 0;
  const canNext = !!page?.next_before;

  if (KR.locked) return unlockToView;

  return (
    <div className="max-w-2xl mx-auto p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">My Polls</h2>
        <a
          href="/polls/new"
          className={btn(true)}
        >
          Create new poll
        </a>
      </div>

      <div className="flex flex-wrap gap-2 mb-3">
        {(["all roles", "voter", "tallier"] as const).map((r) => (
          <button
            key={r}
            onClick={() => {
              setQP("role", r === "all roles" ? null : r);
              reset();
            }}
            className={`px-3 py-1.5 rounded-full border text-sm ${
              role === r
                ? "bg-black text-white dark:bg-white dark:text-black"
                : ""
            }`}
          >
            {r[0].toUpperCase() + r.slice(1)}
          </button>
        ))}
        <span className="w-px h-6 bg-zinc-200 dark:bg-zinc-700 mx-1" />
        {(["all statuses", "Active", "Upcoming", "Ended"] as const).map((s) => (
          <button
            key={s}
            onClick={() => {
              setQP("status", s === "all statuses" ? null : s);
              reset();
            }}
            className={`px-3 py-1.5 rounded-full border text-sm ${
              status === s
                ? "bg-black text-white dark:bg-white dark:text-black"
                : ""
            }`}
          >
            {s[0].toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {err && <div className="text-sm text-red-600 mb-2">{err}</div>}
      {loading && <div className="text-sm opacity-70">Loading…</div>}

      {!loading && page && (
        <div className="rounded-xl border divide-y dark:divide-neutral-800 overflow-hidden">
          {page.items.map((it) => {
            return (
              <PollRow key={it.poll_id} p={it} to={`/polls/${it.poll_id}`} />
            );
          })}
          {page.items.length === 0 && (
            <div className="p-4 text-sm text-zinc-500">No polls yet.</div>
          )}
        </div>
      )}

      <div className="mt-3 flex gap-2 justify-end">
        <button
          onClick={prev}
          disabled={loading || !canPrev}
          className={`rounded-lg px-3 py-2 border dark:border-neutral-700 ${
            !canPrev
              ? "opacity-50 cursor-not-allowed"
              : "hover:bg-neutral-100 dark:hover:bg-neutral-800"
          }`}
          aria-label="Previous page"
        >
          ‹
        </button>
        <button
          onClick={next}
          disabled={loading || !canNext}
          className={`rounded-lg px-3 py-2 border dark:border-neutral-700 ${
            !canNext
              ? "opacity-50 cursor-not-allowed"
              : "hover:bg-neutral-100 dark:hover:bg-neutral-800"
          }`}
          aria-label="Next page"
        >
          ›
        </button>
      </div>
    </div>
  );
}

const PollRow: React.FC<{ p: PollItem; to?: string }> = ({ p, to }) => {
  return (
    <Link
      to={to ?? `/poll/${p.poll_id}`}
      className="block rounded-xl border p-3 border-gray-200 dark:border-neutral-800
                  hover:bg-neutral-50 dark:hover:bg-neutral-800 transition"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium truncate">
            {p.title || "Untitled poll"}
          </div>
          <div className="mt-1 flex items-center gap-2 text-xs">
            <span className="opacity-70">#{p.poll_id}</span>
            <PollStatus
              votingStartTime={p.voting_start_time}
              votingEndTime={p.voting_end_time}
            />
          </div>
        </div>
        <div className="shrink-0 text-neutral-400 group-hover:text-neutral-600 dark:group-hover:text-neutral-300 hidden sm:block">
          →
        </div>
      </div>
    </Link>
  );
};
