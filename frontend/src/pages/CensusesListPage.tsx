import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { CENSUS_URL, useKeyringCtx } from "../App.tsx";
import { makeAuthSig } from "../auth.ts";

const CENSUS_PAGE_LIMIT = 2;

type CensusListItem = {
  id: number;
  title: string;
  description?: string | null;
  is_creator: boolean;
};

type ListOut = {
  items: CensusListItem[];
  next_before: number | null;
};

export default function CensusesListPage() {
  const KR = useKeyringCtx();
  const navigate = useNavigate();

  const [page, setPage] = useState<ListOut | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [cursorStack, setCursorStack] = useState<number[]>([]);
  const [currentBefore, setCurrentBefore] = useState<number | null>(null);

  const canPrev = cursorStack.length > 0;
  const canNext = !!page?.next_before;

  const load = useCallback(async (before: number | null) => {
    try {
      setLoading(true);
      setErr("");

      const acct = KR.accounts[KR.active];
      if (!acct) {
        setPage(null);
        return;
      }

      const sig = await makeAuthSig(acct.prv, acct.pub);
      const qs = before ? `&before=${before}` : "";
      const r = await fetch(
        `${CENSUS_URL}/censuses?limit=${CENSUS_PAGE_LIMIT}${qs}`,
        {
          method: "GET",
          headers: { "Content-Type": "application/json", ...sig },
        },
      );
      if (!r.ok) throw new Error(await r.text());
      const out: ListOut = await r.json();
      setPage(out);
      setCurrentBefore(out.next_before ?? null);
    } catch (e: any) {
      console.error(e);
      setErr(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [KR.accounts, KR.active]);

  useEffect(() => {
    setCursorStack([]);
    setCurrentBefore(null);
    setPage(null);
    if (!KR.locked) load(null);
  }, [KR.locked, KR.active, load]);

  if (KR.locked) {
    return (
      <div className="p-4 text-sm text-amber-700 dark:text-amber-400">
        Unlock “ZK Accounts” to view your censuses.
      </div>
    );
  }

  const onNext = () => {
    setCursorStack((s) => [...s, currentBefore!]);
    load(currentBefore);
  };

  const onPrev = () => {
    const s = cursorStack.slice();
    s.pop();
    setCursorStack(s);
    const before = s.length ? s[s.length - 1] : null;
    load(before);
  };

  const goCreate = () => navigate("/census/new");

  return (
    <div className="max-w-4xl mx-auto p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-xl font-semibold">Censuses</h2>
        <button
          type="button"
          onClick={goCreate}
          className="rounded-lg px-3 py-2 text-white bg-black hover:bg-gray-800"
        >
          Create new census
        </button>
      </div>

      {err && <div className="text-sm text-red-600 mb-2">{err}</div>}
      {loading && <div className="text-sm opacity-70 mb-2">Loading…</div>}

      <div className="space-y-2 divide-y">
        {page?.items.map((it) => (
          <Link
            to={`/census/${it.id}`}
            className="block rounded-xl border p-3 border-gray-200 dark:border-neutral-800
                  hover:bg-neutral-50 dark:hover:bg-neutral-800 transition"
          >
            <div className="flex items-center justify-between">
              <div className="font-medium">{it.title}</div>
              {it.is_creator && (
                <span className="ml-3 text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300">
                  Creator
                </span>
              )}
            </div>
          </Link>
        ))}
        {(!page || page.items.length === 0) && !loading && (
          <div className="p-4 text-sm text-zinc-500">No censuses yet.</div>
        )}
      </div>

      <div className="mt-3 flex gap-2 justify-end">
        <button
          className={[
            "rounded-lg px-3 py-2 border dark:border-neutral-700",
            (!canPrev || loading)
              ? "opacity-50 cursor-not-allowed"
              : "hover:bg-neutral-100 dark:hover:bg-neutral-800",
          ].join(" ")}
          onClick={onPrev}
          disabled={!canPrev || loading}
          aria-label="Previous page"
          title="Previous"
        >
          ‹
        </button>
        <button
          className={[
            "rounded-lg px-3 py-2 border dark:border-neutral-700",
            (!canNext || loading)
              ? "opacity-50 cursor-not-allowed"
              : "hover:bg-neutral-100 dark:hover:bg-neutral-800",
          ].join(" ")}
          onClick={onNext}
          disabled={!canNext || loading}
          aria-label="Next page"
          title="Next"
        >
          ›
        </button>
      </div>
    </div>
  );
}
