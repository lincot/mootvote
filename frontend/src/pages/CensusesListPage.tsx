import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { makeAuthSig } from "../auth.ts";
import { CENSUS_URL } from "../env.tsx";
import { useKeyringCtx } from "../keyring.tsx";
import { btn } from "../btn.ts";
import { useTranslation } from "react-i18next";
import UnlockToView from "../components/UnlockToView.tsx";
import ErrorBox from "../components/ErrorBox.tsx";

const CENSUS_PAGE_LIMIT = 20;

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
  const { t } = useTranslation();

  useLayoutEffect(() => {
    document.title = t("nav.censuses");
  });

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
    return <UnlockToView />;
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
    <div className="max-w-xl mx-auto p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-xl font-semibold">{t("nav.censuses")}</h2>
        <button
          type="button"
          onClick={goCreate}
          className={btn(true)}
        >
          {t("census_list.create_new_census")}
        </button>
      </div>

      {err && <ErrorBox text={err} />}
      {loading && <div className="text-sm opacity-70 mb-2">Loading…</div>}

      <div className="rounded-xl border divide-y dark:divide-neutral-800 overflow-hidden">
        {page?.items.map((it) => (
          <Link
            to={`/census/${it.id}`}
            className="block rounded-xl border p-3 border-gray-200 dark:border-neutral-800
                  hover:bg-neutral-50 dark:hover:bg-neutral-800 transition"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="font-medium">{it.title}</div>
              <div className="flex items-center gap-3">
                {it.is_creator && (
                  <span className="ml-3 text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300">
                    {t("census_list.creator")}
                  </span>
                )}
                <div className="shrink-0 text-neutral-400 group-hover:text-neutral-600 dark:group-hover:text-neutral-300 hidden sm:block">
                  →
                </div>
              </div>
            </div>
          </Link>
        ))}
        {(!page || page.items.length === 0) && !loading && (
          <div className="p-4 text-sm text-zinc-500">
            {t("census_list.no_censuses")}
          </div>
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
          title={t("pagination.prev")}
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
          title={t("pagination.next")}
        >
          ›
        </button>
      </div>
    </div>
  );
}
