import { useCallback, useEffect, useMemo, useState } from "react";
import { makeAuthSig } from "../auth.ts";
import { createPortal } from "react-dom";
import { CENSUS_URL } from "../env.tsx";
import { useKeyringCtx } from "../keyring.tsx";
import { useTranslation } from "react-i18next";
import ErrorBox from "./ErrorBox.tsx";

type CensusListItem = {
  id: number;
  title: string;
  description?: string | null;
};
type CensusListOut = { items: CensusListItem[]; next_before: number | null };

export const ChooseCensusModal: React.FC<{
  open: boolean;
  onClose: () => void;
  onPick: (it: { id: number; title: string }) => Promise<void>;
}> = ({
  open,
  onClose,
  onPick,
}) => {
  const { t } = useTranslation();
  const KR = useKeyringCtx();
  const [list, setList] = useState<CensusListOut | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [before, setBefore] = useState<number | null>(null);
  const [stack, setStack] = useState<number[]>([]);
  const [pickingId, setPickingId] = useState<number | null>(null);

  const canPrev = stack.length > 0;
  const canNext = !!list?.next_before;

  const load = useCallback(async (cursor: number | null) => {
    try {
      setLoading(true);
      setErr("");
      const acct = KR.accounts[KR.active];
      if (!acct) return;
      const sig = await makeAuthSig(acct.prv, acct.pub);
      const r = await fetch(
        `${CENSUS_URL}/censuses?creator_only=true${
          cursor ? `&before=${cursor}` : ""
        }`,
        {
          method: "GET",
          headers: { "Content-Type": "application/json", ...sig },
        },
      );
      if (!r.ok) throw new Error(await r.text());
      const out: CensusListOut = await r.json();
      setList(out);
    } catch (e: any) {
      console.error(e);
      setErr(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [KR.accounts, KR.active]);

  useEffect(() => {
    load(before);
  }, [before, load]);

  const shown = useMemo(() => {
    if (!q.trim()) return list?.items ?? [];
    const s = q.trim().toLowerCase();
    return (list?.items ?? []).filter((i) => i.title.toLowerCase().includes(s));
  }, [list, q]);

  const onNext = () => {
    if (!canNext) return;
    setStack((s) => [...s, list!.next_before!]);
    setBefore(list!.next_before!);
  };
  const onPrev = () => {
    if (!canPrev) return;
    const s = stack.slice();
    s.pop();
    setStack(s);
    setBefore(s.length ? s[s.length - 1] : null);
  };

  const [root, setRoot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setRoot(document.getElementById("content-overlay-root"));
  }, []);

  useEffect(() => {
    const content = document.documentElement;
    if (!content) return;
    content.classList.toggle("overflow-hidden", open);
    return () => {
      content.classList.remove("overflow-hidden");
    };
  }, [open]);

  // close on Esc
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !root) return null;

  return createPortal(
    <div
      className="fixed inset-0 flex items-center justify-center pointer-events-auto"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/40 dark:bg-black/60" />

      <div
        className="relative w-full max-w-xl max-h-[60vh] flex flex-col rounded-xl bg-white dark:bg-neutral-900 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b dark:border-neutral-800 shrink-0">
          <div className="font-semibold">{t("census_modal.choose_census")}</div>
          <button
            onClick={onClose}
            className="px-2 py-1 rounded hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
          {err && <ErrorBox text={err} />}
          {KR.locked && (
            <div className="text-sm text-amber-700 dark:text-amber-500">
              {t("census_modal.unlock_zk")}
            </div>
          )}
          {!KR.locked && (
            <>
              <input
                placeholder="Search by title…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="w-full rounded border px-3 py-2 dark:border-neutral-700"
              />

              <div className="rounded-xl border divide-y dark:border-neutral-700">
                {loading && (
                  <div className="p-3 text-sm opacity-70">
                    {t("loading.loading")}
                  </div>
                )}
                {!loading &&
                  shown.map((it) => (
                    <button
                      key={it.id}
                      disabled={pickingId !== null}
                      onClick={async () => {
                        try {
                          setErr("");
                          setPickingId(it.id);
                          await onPick({ id: it.id, title: it.title });
                        } catch (e: any) {
                          console.error(e);
                          setErr(e?.message || String(e));
                        }
                      }}
                      className="w-full text-left p-3 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition"
                    >
                      <div className="font-medium">{it.title}</div>
                      {it.description && (
                        <div className="text-xs text-zinc-600 dark:text-zinc-400 mt-0.5 line-clamp-2">
                          {it.description}
                        </div>
                      )}
                    </button>
                  ))}
                {!loading && shown.length === 0 && (
                  <div className="p-3 text-sm text-zinc-500">
                    {t("census_modal.no_matches")}
                  </div>
                )}
              </div>
            </>
          )}

          <div className="flex gap-2 justify-end">
            <button
              className={`rounded-lg px-3 py-2 border dark:border-neutral-700 ${
                canPrev
                  ? "hover:bg-neutral-100 dark:hover:bg-neutral-800"
                  : "opacity-50 cursor-not-allowed"
              }`}
              onClick={onPrev}
              disabled={!canPrev}
              title={t("pagination.prev")}
            >
              ‹
            </button>
            <button
              className={`rounded-lg px-3 py-2 border dark:border-neutral-700 ${
                canNext
                  ? "hover:bg-neutral-100 dark:hover:bg-neutral-800"
                  : "opacity-50 cursor-not-allowed"
              }`}
              onClick={onNext}
              disabled={!canNext}
              title={t("pagination.next")}
            >
              ›
            </button>
          </div>
        </div>
      </div>
    </div>,
    root,
  );
};
