import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Link } from "react-router";
import { PollStatus } from "../components/PollStatus.tsx";
import { INDEXER_URL } from "../env.tsx";
import { keyToLeafHex, useKeyringCtx } from "../keyring.tsx";
import { btn } from "../btn.ts";
import { useTranslation } from "react-i18next";
import UnlockToView from "../components/UnlockToView.tsx";

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
  const { t } = useTranslation();

  useLayoutEffect(() => {
    document.title = t("nav.polls");
  });

  const KR = useKeyringCtx();
  type Role = "all roles" | "voter" | "tallier";
  const [role, setRole] = useState<Role>("all roles");
  type Status = "all statuses" | "active" | "upcoming" | "ended";
  const [status, setStatus] = useState<Status>("all statuses");
  const [page, setPage] = useState<Page | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [before, setBefore] = useState<number | null>(null);
  const [stack, setStack] = useState<number[]>([]);

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

  if (KR.locked) return <UnlockToView />;

  return (
    <div className="max-w-2xl mx-auto p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-semibold">{t("nav.polls")}</h2>
        <Link
          to="/polls/new"
          className={btn(true)}
        >
          {t("poll_list.create_new_poll")}
        </Link>
      </div>

      <PollFilters
        role={role}
        status={status}
        setRole={setRole}
        setStatus={setStatus}
        reset={reset}
        t={t}
      />

      {err && <div className="text-sm text-red-600 mb-2">{err}</div>}
      {loading && (
        <div className="text-sm opacity-70">{t("loading.loading")}</div>
      )}

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
          title={t("pagination.prev")}
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
          title={t("pagination.next")}
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

export function PollFilters(
  { role, status, setRole, setStatus, reset, t }: any,
) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  const roleMeasureRef = useRef<HTMLDivElement | null>(null);
  const statusMeasureRef = useRef<HTMLDivElement | null>(null);
  const dividerMeasureRef = useRef<HTMLSpanElement | null>(null);

  const [wrapStatus, setWrapStatus] = useState(false);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let raf = 0;

    const compute = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const cw = containerRef.current?.getBoundingClientRect().width ?? 0;
        const rw = roleMeasureRef.current?.getBoundingClientRect().width ?? 0;
        const sw = statusMeasureRef.current?.getBoundingClientRect().width ?? 0;
        const dw = dividerMeasureRef.current?.getBoundingClientRect().width ??
          0;

        // gap-2 between flex children = 8px
        const gaps = 16;

        setWrapStatus(rw + dw + sw + gaps > cw);
      });
    };

    compute();

    const ro = new ResizeObserver(compute);
    ro.observe(el);

    window.addEventListener("resize", compute);
    window.visualViewport?.addEventListener("resize", compute);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("resize", compute);
      window.visualViewport?.removeEventListener("resize", compute);
    };
  }, []);

  const pillBase = "px-3 py-1.5 rounded-full border text-sm whitespace-nowrap";
  const pillActive = "bg-black text-white dark:bg-white dark:text-black";

  const roles = ["all roles", "voter", "tallier"] as const;
  const statuses = ["all statuses", "active", "upcoming", "ended"] as const;

  return (
    <>
      <div className="absolute -left-[10000px] top-0 pointer-events-none opacity-0">
        <div ref={roleMeasureRef} className="flex flex-nowrap gap-2 w-max">
          {roles.map((r) => (
            <button key={r} className={pillBase}>
              {t("poll_list." + r)}
            </button>
          ))}
        </div>

        <span ref={dividerMeasureRef} className="inline-block w-px h-6 mx-1" />

        <div ref={statusMeasureRef} className="flex flex-nowrap gap-2 w-max">
          {statuses.map((s) => (
            <button key={s} className={pillBase}>
              {t("poll_list." + s)}
            </button>
          ))}
        </div>
      </div>

      <div
        ref={containerRef}
        className="mb-3 flex flex-wrap gap-2 items-center content-start"
      >
        <div className="flex flex-wrap gap-2 items-center content-start">
          {roles.map((r) => (
            <button
              key={r}
              onClick={() => {
                setRole(r);
                reset();
              }}
              className={`${pillBase} ${role === r ? pillActive : ""}`}
            >
              {t("poll_list." + r)}
            </button>
          ))}
        </div>

        {!wrapStatus
          ? <span className="w-px h-6 bg-zinc-200 dark:bg-zinc-700 mx-1" />
          : <span className="basis-full h-px bg-zinc-200 dark:bg-zinc-700" />}

        <div
          className={`flex flex-wrap gap-2 items-center content-start ${
            wrapStatus ? "basis-full" : ""
          }`}
        >
          {statuses.map((s) => (
            <button
              key={s}
              onClick={() => {
                setStatus(s);
                reset();
              }}
              className={`${pillBase} ${status === s ? pillActive : ""}`}
            >
              {t("poll_list." + s)}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
