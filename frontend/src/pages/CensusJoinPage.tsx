import { useEffect, useLayoutEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { makeAuthSig } from "../auth.ts";
import { CENSUS_URL } from "../env.tsx";
import { useKeyringCtx } from "../keyring.tsx";
import { btn } from "../btn.ts";

type Preflight = { member_id: number; name: string; census_title: string };

export default function CensusJoinPage() {
  const { censusId, token } = useParams();
  const cid = Number(censusId);
  const tok = token!;
  const KR = useKeyringCtx();
  const nav = useNavigate();

  useLayoutEffect(() => {
    document.title = "Join Census";
  });

  const [pf, setPf] = useState<Preflight | null>(null);
  const [stage, setStage] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    (async () => {
      try {
        setStage("Checking invite…");
        const r = await fetch(
          `${CENSUS_URL}/census/${cid}/registration/${tok}`,
        );
        if (!r.ok) throw new Error(await r.text());
        const j: Preflight = await r.json();
        setPf(j);
        setStage("");
      } catch (e: any) {
        setErr(e.message || String(e));
      }
    })();
  }, [cid, tok]);

  async function onBind() {
    try {
      setErr("");
      setStage("Signing…");
      const acct = KR.accounts[KR.active];
      const sig = await makeAuthSig(acct.prv, acct.pub);
      setStage("Submitting…");
      const r = await fetch(
        `${CENSUS_URL}/census/${cid}/members/${pf!.member_id}/claim`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", ...sig },
          body: JSON.stringify({ token: tok }),
        },
      );
      if (!r.ok) throw new Error(await r.text());
      setStage("Joined successfully");
      setTimeout(() => nav(`/census/${cid}`), 800);
    } catch (e: any) {
      setErr(e.message || String(e));
      setStage("");
    }
  }

  const disabled = KR.locked || !KR.accounts[KR.active] || !!stage;

  return (
    <div className="max-w-xl mx-auto p-4">
      {err && <div className="text-sm text-red-600 mb-2">{err}</div>}
      {!pf
        ? <div className="text-sm">{stage || "Loading…"}</div>
        : (
          <div className="space-y-3">
            <div className="text">
              You were invited to join census{" "}
              <span className="font-medium">{pf.census_title}</span> as{" "}
              <span className="font-medium">{pf.name}</span>.
            </div>
            {KR.locked && (
              <div className="text-sm text-amber-700 dark:text-amber-500">
                Unlock “ZK Accounts” and select your account to bind.
              </div>
            )}
            <button
              onClick={onBind}
              disabled={disabled}
              className={btn(!disabled)}
            >
              {stage ? stage : "Join census"}
            </button>
          </div>
        )}
    </div>
  );
}
