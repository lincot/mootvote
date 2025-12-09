import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router";
import {
  INDEXER_URL,
  keyToLeafHex,
  TallyPage,
  useKeyringCtx,
  VotePage,
} from "../App.tsx";

type PollDetail = {
  poll_id: string;
  census_root: string;
  coordinator_key: [string, string];
  voting_start_time: number;
  voting_end_time: number;
  fee: string;
  platform_fee: string;
  fee_destination: string;
  description_url: string;
  census_url: string;
  tally: number[] | null;
  title: string;
  choices: string[];
};

export type PollClock = { label: string; isOver: boolean; isActive: boolean };

function usePollClock(startSec: number, endSec: number): PollClock {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);
  const isBefore = now < startSec;
  const isOver = now >= endSec;
  const secs = isBefore ? (startSec - now) : (isOver ? 0 : endSec - now);
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  const fmt = (n: number) => String(n).padStart(2, "0");
  const label = isBefore
    ? `Starts in ${fmt(h)}:${fmt(m)}:${fmt(s)}`
    : isOver
    ? `Ended`
    : `Ends in ${fmt(h)}:${fmt(m)}:${fmt(s)}`;
  return { label, isOver, isActive: !isBefore && !isOver };
}

export default function PollDetailPage() {
  const { pollId } = useParams();
  const [sp, setSp] = useSearchParams();
  const KR = useKeyringCtx();
  const [poll, setPoll] = useState<PollDetail | null>(null);
  const [isVoter, setIsVoter] = useState(false);
  const [err, setErr] = useState("");

  const clock = usePollClock(
    poll?.voting_start_time ?? 0,
    poll?.voting_end_time ?? 0,
  );

  const tab = (sp.get("tab") ?? "").toLowerCase();
  const setTab = (t: string) => {
    const next = new URLSearchParams(sp);
    if (t) next.set("tab", t);
    else next.delete("tab");
    setSp(next, { replace: true });
  };

  useEffect(() => {
    (async () => {
      try {
        setErr("");
        const r = await fetch(`${INDEXER_URL}/polls/${pollId}`);
        if (!r.ok) throw new Error(await r.text());
        const p: PollDetail = await r.json();
        setPoll(p);
      } catch (e: any) {
        console.error(e);
        setErr(e.message ?? String(e));
      }
    })();
  }, [pollId]);

  const isCoordinator = useMemo(() => {
    if (!poll || KR.locked) return false;
    const acc = KR.accounts[KR.active];
    if (!acc) return false;
    const x = acc.pub[0].toString(16).padStart(64, "0");
    const y = acc.pub[1].toString(16).padStart(64, "0");
    const isCoordinator = x.toLowerCase() ===
        poll.coordinator_key[0].replace(/^0x/, "").toLowerCase() &&
      y.toLowerCase() ===
        poll.coordinator_key[1].replace(/^0x/, "").toLowerCase();
    return isCoordinator;
  }, [poll, KR.locked, KR.active, KR.accounts]);

  useEffect(() => {
    (async () => {
      try {
        setErr("");
        if (KR.locked) return false;
        const acc = KR.accounts[KR.active];
        const r = await fetch(
          `${INDEXER_URL}/polls/${pollId}/is_voter?leaf=${await keyToLeafHex(
            acc.pub,
          )}`,
        );
        if (!r.ok) throw new Error(await r.text());
        const text = await r.text();
        const isVoter = text === "true";
        setIsVoter(isVoter);
      } catch (e: any) {
        console.error(e);
        setErr(e.message ?? String(e));
      }
    })();
  }, [pollId, KR.locked, KR.active, KR.accounts]);

  // default tab
  useEffect(() => {
    if (!poll) return;
    if (poll.tally || (isVoter && clock.isOver)) setTab("results");
    else if (isCoordinator) setTab("tally");
    else if (isVoter) setTab("vote");
    else setTab("overview");
  }, [poll, isVoter, isCoordinator, clock.isOver]);

  const Tabs = () => {
    const TabBtn = (t: string, label: string, disabled = false) => (
      <button
        onClick={() => !disabled && setTab(t)}
        className={`px-3 py-2 text-sm rounded-lg border
           ${
          tab === t
            ? "bg-black text-white dark:bg-white dark:text-black"
            : "hover:bg-neutral-100 dark:hover:bg-neutral-800"
        }
           ${disabled ? "opacity-50 cursor-not-allowed" : ""}
         `}
        disabled={disabled}
      >
        {label}
      </button>
    );
    const locked = KR.locked;
    const hasTally = !!poll?.tally;
    return (
      <div className="flex gap-2 mb-3">
        {TabBtn("overview", "Overview")}
        {TabBtn(
          "vote",
          "Vote",
          locked || hasTally || !isVoter || !clock.isActive,
        )}
        {TabBtn("tally", "Tally", locked || hasTally || !isCoordinator)}
        {TabBtn("results", "Results", !clock.isOver)}
      </div>
    );
  };

  return (
    <div className="max-w-4xl mx-auto p-4">
      {err && <div className="text-sm text-red-600 mb-2">{err}</div>}
      {!poll && !err && <div className="text-sm opacity-70">Loading…</div>}
      {poll && (
        <>
          <div className="flex items-start justify-between mb-2">
            <div>
              <h2 className="text-xl font-semibold">{poll.title}</h2>
              <div className="text-xs text-zinc-500">Poll #{poll.poll_id}</div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm opacity-70">{clock.label}</span>
            </div>
          </div>

          {KR.locked && (
            <div className="mb-3 text-sm text-amber-700 dark:text-amber-400">
              Unlock “ZK Accounts” to vote or tally.
            </div>
          )}

          <Tabs />

          {/* Overview */}
          {tab === "overview" && (
            <div className="max-w-xl mx-auto p-4 rounded-xl border">
              <div className="mb-2">
                <div className="text-sm text-zinc-600 dark:text-zinc-300">
                  Choices:
                </div>
                <ul className="list-disc ml-6 text-sm">
                  {poll.choices.map((c, i) => <li key={i}>{c}</li>)}
                </ul>
              </div>
              <div className="text-xs text-zinc-500">
                Fee: {poll.fee} · Platform fee: {poll.platform_fee}
              </div>
            </div>
          )}

          {/* Vote (embedded) */}
          {tab === "vote" && (
            <div className="max-w-xl mx-auto p-4 rounded-xl border">
              <VotePage pollId={BigInt(pollId!)} />
            </div>
          )}

          {/* Tally (embedded) */}
          {tab === "tally" && (
            <div className="max-w-xl mx-auto p-4 rounded-xl border">
              <TallyPage pollId={BigInt(pollId!)} />
            </div>
          )}

          {/* Results */}
          {tab === "results" &&
            (
              <>
                {!poll.tally && <p>Waiting for tallier to count the votes…</p>}
                {poll.tally && (
                  <div className="max-w-xl mx-auto p-4 rounded-xl border">
                    {/* <ResultsBars tally={poll.tally} labels={poll.choices} />*/}
                    <ResultsBars
                      tally={poll.tally}
                      choices={poll.choices}
                      title="Results"
                    />
                  </div>
                )}
              </>
            )}
        </>
      )}
    </div>
  );
}

const ResultsBars: React.FC<{
  title: string;
  choices: string[];
  tally: number[];
}> = ({ title, choices, tally }) => {
  const data = useMemo(() => {
    const pairs = choices.map((label, i) => ({
      label,
      count: tally[i] ?? 0,
      idx: i,
    }));
    pairs.sort((a, b) => (b.count - a.count) || (a.idx - b.idx));
    const total = Math.max(0, pairs.reduce((s, x) => s + x.count, 0));
    const max = Math.max(1, ...pairs.map((p) => p.count));
    return { pairs, total, max };
  }, [choices, tally]);

  return (
    <div className="mt-3">
      <h2 className="text-lg font-semibold mb-3">{title}</h2>
      <div className="space-y-3">
        {data.pairs.map((p) => {
          const pct = data.total === 0
            ? 0
            : Math.round((p.count / data.total) * 100);
          const rel = Math.round((p.count / data.max) * 100);
          return (
            <div key={p.idx}>
              <div className="flex items-baseline justify-between gap-3">
                <div className="font-medium truncate">{p.label}</div>
                <div className="text-xs tabular-nums text-gray-600 dark:text-zinc-300">
                  {p.count} ({pct}%)
                </div>
              </div>
              <div className="h-2 w-full bg-gray-200 dark:bg-zinc-800 rounded overflow-hidden">
                <div
                  className="h-full bg-emerald-600 dark:bg-emerald-500 transition-[width] duration-300"
                  style={{ width: `${rel}%` }}
                />
              </div>
            </div>
          );
        })}
        <div className="text-xs text-gray-500 dark:text-zinc-400">
          Total votes: <span className="tabular-nums">{data.total}</span>
        </div>
      </div>
    </div>
  );
};
