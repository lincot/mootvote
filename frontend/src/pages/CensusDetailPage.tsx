import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import { useParams } from "react-router";
import { makeAuthSig } from "../auth.ts";
import { CENSUS_URL } from "../env.tsx";
import { useKeyringCtx } from "../keyring.tsx";
import { useTranslation } from "react-i18next";
import UnlockToView from "../components/UnlockToView.tsx";

type MemberRow = {
  id: number;
  name: string;
  pub_x: string | null;
  pub_y: string | null;
  joined: boolean;
  invite: string | null;
};

type Page = {
  title: string;
  description?: string;
  is_creator: boolean;
  items: MemberRow[];
  any_left: boolean;
};

type Invite = { member_id: number; name: string; token: string };

const MEMBER_PAGE_LIMIT = 20;

export default function CensusDetailPage() {
  const { t } = useTranslation();
  const { censusId } = useParams();
  const cid = Number(censusId);
  const KR = useKeyringCtx();

  const [page, setPage] = useState<Page | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [stack, setStack] = useState<number[]>([]);

  const [addName, setAddName] = useState("");
  const [addBusy, setAddBusy] = useState(false);
  const [addErr, setAddErr] = useState("");
  const [addInvite, setAddInvite] = useState<Invite | null>(null);
  const [removingId, setRemovingId] = useState<number | null>(null);

  useLayoutEffect(() => {
    if (page) document.title = page.title;
  }, [page]);

  async function load(after: number | null) {
    try {
      setLoading(true);
      setErr("");
      const acct = KR.accounts[KR.active];
      const sig = acct ? await makeAuthSig(acct.prv, acct.pub) : null;
      const r = await fetch(
        `${CENSUS_URL}/census/${cid}/members?limit=${MEMBER_PAGE_LIMIT}${
          after === null ? "" : (after ? `&after=${after}` : "")
        }`,
        {
          method: "GET",
          headers: { "Content-Type": "application/json", ...sig },
        },
      );
      if (!r.ok) throw new Error(await r.text());
      const page: Page = await r.json();
      setPage(page);
    } catch (e: any) {
      console.error(e);
      setErr(e.message || String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setPage(null);
    load(null);
  }, [KR]);

  if (KR.locked) return <UnlockToView />;

  const next = () => {
    const after = page!.items[page!.items.length - 1].id;
    setStack((s) => [...s, after]);
    load(after);
  };

  const prev = () => {
    const s = stack.slice();
    s.pop();
    setStack(s);
    load(s[s.length - 1] ?? null);
  };

  async function onAddMember() {
    try {
      setAddErr("");
      setAddInvite(null);
      setAddBusy(true);
      const acct = KR.accounts[KR.active];
      if (!acct) throw new Error("Unlock ZK Accounts and select an account");
      const sig = await makeAuthSig(acct.prv, acct.pub);
      const name = addName.trim();
      if (!name) throw new Error("Enter a name");
      const r = await fetch(`${CENSUS_URL}/census/${cid}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...sig },
        body: JSON.stringify({ member: name }),
      });
      if (!r.ok) throw new Error(await r.text());
      const j = await r.json();
      const invite: Invite = j.invite;
      setAddInvite(invite);
      setAddName("");

      if (page!.items.length < MEMBER_PAGE_LIMIT) {
        page!.items.push({
          id: invite.member_id,
          invite: invite.token,
          joined: false,
          name: invite.name,
          pub_x: null,
          pub_y: null,
        });
        setPage(page);
      } else if (page?.any_left === false) {
        page!.any_left = true;
        setPage(page);
      }
    } catch (e: any) {
      setAddErr(e.message || String(e));
    } finally {
      setAddBusy(false);
    }
  }

  async function onRemoveMember(memberId: number, memberName: string) {
    try {
      if (!window.confirm(`Remove “${memberName}” from this census?`)) return;
      setRemovingId(memberId);
      const acct = KR.accounts[KR.active];
      if (!acct) throw new Error("Unlock ZK Accounts and select an account");
      const sig = await makeAuthSig(acct.prv, acct.pub);
      const r = await fetch(`${CENSUS_URL}/census/${cid}/members/${memberId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json", ...sig },
      });
      if (!r.ok) throw new Error(await r.text());
      if (page?.items.length === 1 && page.items[0].id == memberId) {
        prev();
      } else {
        load(stack[stack.length - 1] ?? null);
      }
    } catch (e: any) {
      setErr(e.message || String(e));
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <div className="max-w-xl mx-auto p-4">
      {loading && <div className="text-sm opacity-70 mt-2">Loading…</div>}
      {err && <div className="text-sm text-red-600 mb-2">{err}</div>}
      {!loading && page && (
        <>
          <h2 className="text-xl font-semibold mb-3">{page.title}</h2>
          {page.description && <p className="mb-3">{page.description}</p>}

          {page.is_creator && (
            <div className="mb-4 rounded-xl border p-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium">
                  {t("census.add_member")}
                </div>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <input
                  className="w-full rounded border px-3 py-2"
                  placeholder={t("census.member_name")}
                  value={addName}
                  onChange={(e) => setAddName(e.target.value)}
                />
                <button
                  type="button"
                  onClick={onAddMember}
                  disabled={addBusy || addName.trim().length === 0}
                  className={`px-3 py-2 rounded-lg text-white ${
                    addBusy ? "bg-gray-400" : "bg-black hover:bg-gray-800"
                  }`}
                >
                  {addBusy ? t("loading.adding") : t("actions.add")}
                </button>
              </div>
              <div className="mt-2 flex items-center gap-3">
                {addErr && (
                  <span className="text-sm text-red-600">{addErr}</span>
                )}
              </div>
              {addInvite && (
                <div className="mt-3">
                  <div className="text-sm font-medium mb-2">
                    {t("census.added_member")}
                  </div>
                  <div className="rounded-lg border p-2 flex items-center justify-between gap-3 text-sm">
                    <div className="truncate font-medium">
                      {addInvite.name}
                    </div>
                    <InviteCopy cid={cid} token={addInvite.token} />
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="rounded-xl border divide-y">
            {page.items.map((m) => (
              <div key={m.id} className="p-3 flex items-center justify-between">
                <div>
                  <div className="font-medium">{m.name}</div>
                  <div
                    className={`text-xs ${
                      m.joined ? "text-emerald-700" : "text-zinc-500"
                    }`}
                  >
                    {!m.joined && t("census.has_not_joined")}
                    {m.pub_x && <>pkX: {m.pub_x.replace(/^0+/, "")}</>}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {m.invite && <InviteCopy cid={cid} token={m.invite} />}
                  {page.is_creator && (
                    <button
                      type="button"
                      className="px-2 py-1 rounded border text-xs hover:bg-red-50 text-red-700 border-red-200"
                      onClick={() => onRemoveMember(m.id, m.name)}
                      disabled={removingId === m.id}
                    >
                      {removingId === m.id
                        ? t("loading.removing")
                        : t("actions.remove")}
                    </button>
                  )}
                </div>
              </div>
            ))}
            {page.items.length === 0 && (
              <div className="p-4 text-sm text-zinc-500">
                {t("census.no_members_yet")}
              </div>
            )}
          </div>
        </>
      )}

      <div className="mt-3 flex gap-2 justify-end">
        <button
          className={`rounded-lg px-3 py-2 border dark:border-neutral-700 ${
            loading || stack.length === 0
              ? "opacity-50 cursor-not-allowed"
              : "hover:bg-neutral-100 dark:hover:bg-neutral-800"
          }`}
          onClick={prev}
          disabled={loading || stack.length === 0}
          title={t("pagination.prev")}
        >
          ‹
        </button>
        <button
          className={`rounded-lg px-3 py-2 border dark:border-neutral-700 ${
            (loading || !page || !page.any_left)
              ? "opacity-50 cursor-not-allowed"
              : "hover:bg-neutral-100 dark:hover:bg-neutral-800"
          }`}
          onClick={next}
          disabled={loading || !page || !page.any_left}
          title={t("pagination.next")}
        >
          ›
        </button>
      </div>
    </div>
  );
}

type CopyStatus = "idle" | "copied" | "error";

function InviteCopy({ cid, token }: { cid: number; token: string }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<CopyStatus>("idle");

  const url = useMemo(
    () => `${window.location.origin}/census/${cid}/join/${token}`,
    [cid, token],
  );

  useEffect(() => {
    if (status !== "copied") return;
    const id = window.setTimeout(() => setStatus("idle"), 2000);
    return () => window.clearTimeout(id);
  }, [status]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setStatus("copied");
    } catch (e) {
      console.error("Failed to copy invite link", e);
      setStatus("error");
    }
  };

  const label = status === "copied"
    ? t("census.invite_copied")
    : status === "error"
    ? t("census.copy_failed")
    : t("census.copy_invite");

  return (
    <div className="inline-flex items-center gap-2 max-w-full">
      <button
        type="button"
        onClick={handleCopy}
        aria-live="polite"
        className={[
          "inline-flex items-center px-3 py-1.5 rounded border text-sm transition",
          "border-zinc-300",
          status === "copied" && "border-emerald-300 text-emerald-700",
          status === "error" && "border-red-300 text-red-700 bg-red-50",
          status === "idle" && "hover:bg-neutral-200 dark:hover:bg-neutral-800",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {status === "copied" && "✓ "}
        {label}
      </button>
    </div>
  );
}
