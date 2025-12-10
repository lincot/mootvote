import { useWallet } from "@solana/wallet-adapter-react";
import { groth16 } from "snarkjs";
import { del as idbDel, get as idbGet, set as idbSet } from "idb-keyval";
import { poseidonDecrypt } from "@zk-kit/poseidon-cipher";
import {
  createTally,
  cuLimitInstruction,
  finishTally,
  tallyBatch,
} from "@lincot/mootvote-sdk";
import { HASH0, toBytesBE32, toHex32 } from "../../../helpers/utils.ts";
import { mulPointEscalar } from "@zk-kit/baby-jubjub";
import {
  ErrEntryIndexAlreadyExists,
  InMemoryDB,
  Merkletree,
  ZERO_HASH,
} from "@iden3/js-merkletree";
import type { PollDetail } from "../poll.ts";
import { useKeyringCtx } from "../keyring.tsx";
import { useCallback, useEffect, useState } from "react";
import { INDEXER_URL, RPC_URL } from "../env.tsx";
import { Connection, Transaction } from "@solana/web3.js";
import { getPoseidon } from "../circomMemo.ts";
import { MAX_CHOICES } from "../consts.ts";
import { compressProof } from "../../../helpers/compressSolana.ts";
import { btn } from "../btn.ts";

const STATE_DEPTH = 64;
const MAX_BATCH = 6;

const TALLY_WASM_URL = "/zk/Tally/Tally.wasm";
const TALLY_ZKEY_URL = "/zk/Tally/groth16_pkey.zkey";

type LeafData = {
  choice: bigint;
  revotingKey: bigint;
  hash: bigint;
};

const TALLY_DB_KEY = (pollId: bigint, accountId: string) =>
  `mootvote:tally:v1:${pollId}:${accountId}`;

type TallyStore = {
  pollId: bigint;
  accountId: string;
  processedAfterId: bigint;
  processedCount: number;
  rootHex: string;
  runningMsgHashHex: string;
  tallySaltHex: string;
  tallyCounts: string[]; // decimal strings
  leaves: Record<string, LeafData>;
};

async function loadTallyStore(
  pollId: bigint,
  accountId: string,
): Promise<TallyStore | null> {
  const x = await idbGet(TALLY_DB_KEY(pollId, accountId));
  return (x as TallyStore) ?? null;
}

async function saveTallyStore(s: TallyStore): Promise<void> {
  await idbSet(TALLY_DB_KEY(s.pollId, s.accountId), s);
}

async function resetTallyStore(
  pollId: bigint,
  accountId: string,
): Promise<void> {
  await idbDel(TALLY_DB_KEY(pollId, accountId));
}

type VoteRow = {
  id: string;
  eph_x: string;
  eph_y: string;
  nonce: string;
  ciphertext: string;
};

type VotesPage = {
  items: VoteRow[];
  total: number;
};

export const Tally: React.FC<{ poll: PollDetail }> = ({ poll }) => {
  const wallet = useWallet();
  const KR = useKeyringCtx();
  const connection = new Connection(RPC_URL, { commitment: "confirmed" });
  const [store, setStore] = useState<TallyStore | null>(null);
  const [err, setErr] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<string>("");
  const [remaining, setRemaining] = useState<number | null>(null);

  const pollId = BigInt(poll.poll_id);

  const keypair = KR.accounts[KR.active];
  const accountId = keypair
    ? `${keypair.pub[0].toString(16)}:${keypair.pub[1].toString(16)}`
    : "";

  useEffect(() => {
    if (!keypair) return;
    loadTallyStore(pollId, accountId).then(setStore);
  }, [pollId, accountId]);

  const refreshRemaining = useCallback(async () => {
    try {
      if (!store) {
        setRemaining(null);
        return;
      }
      const after = store.processedAfterId;
      const r = await fetch(
        `${INDEXER_URL}/polls/${pollId}/votes?limit=100&after=${after}`,
      );
      if (!r.ok) throw new Error("votes fetch");
      const j: VotesPage = await r.json();
      setRemaining(j.total - store.processedCount);
    } catch (e: any) {
      console.error(e);
      setRemaining(null);
    }
  }, [store, pollId]);

  useEffect(() => {
    refreshRemaining();
  }, [refreshRemaining]);

  const onCreateTally = useCallback(async () => {
    try {
      if (busy) return;
      setBusy(true);
      setStage("Creating tally account…");
      if (!wallet.publicKey) throw new Error("Connect Solana wallet");
      if (!keypair) throw new Error("No active ZK tallier key");
      if (!poll) throw new Error("Poll not loaded");

      const tallyOld = Array(poll.choices.length).fill(0n);
      const saltU8 = new Uint8Array(8);
      crypto.getRandomValues(saltU8);
      let salt = 0n;
      for (const b of saltU8) salt = (salt << 8n) | BigInt(b);

      const poseidon = await getPoseidon();
      const F = poseidon.F;
      const tallyOldHash = F.toObject(
        poseidon([
          salt,
          ...tallyOld,
          ...Array(MAX_CHOICES - tallyOld.length).fill(0n),
        ]),
      );
      const initialTallyHashBytes = toBytesBE32(tallyOldHash);

      const ix = await createTally({
        initialTallyHash: initialTallyHashBytes,
        payer: wallet.publicKey,
        pollId: BigInt(pollId),
      });
      const tx = new Transaction().add(
        cuLimitInstruction([ix]),
        ...[ix].map((x) => x.instruction),
      );
      tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      tx.feePayer = wallet.publicKey;
      await wallet.sendTransaction(tx, connection, { maxRetries: 3 });

      const s: TallyStore = {
        pollId,
        accountId,
        processedAfterId: 0n,
        processedCount: 0,
        rootHex: "0x" + "00".repeat(32),
        runningMsgHashHex: "0x" + "00".repeat(32),
        tallySaltHex: toHex32(salt),
        tallyCounts: tallyOld.map((x) => x.toString(10)),
        leaves: {},
      };
      await saveTallyStore(s);
      setStore(s);
      setStage("");
    } catch (e: any) {
      console.error(e);
      setErr("Error: " + String(e?.message || e));
      setStage("");
    } finally {
      setBusy(false);
    }
  }, [
    wallet.publicKey,
    poll,
    pollId,
    accountId,
    keypair,
    refreshRemaining,
    busy,
  ]);

  const onTallyNext = useCallback(async () => {
    try {
      if (busy) return;
      setBusy(true);
      setStage("Fetching votes to tally…");
      if (!wallet.publicKey) throw new Error("Connect Solana wallet");
      if (!keypair) throw new Error("No active ZK tallier key");
      if (!poll || !store) throw new Error("Poll/store not ready");
      const poseidon = await getPoseidon();
      const F = poseidon.F;

      const r = await fetch(
        `${INDEXER_URL}/polls/${pollId}/votes?limit=${MAX_BATCH}&after=${store.processedAfterId}`,
      );
      if (!r.ok) throw new Error("votes fetch failed");
      const page: VotesPage = await r.json();
      const batch = page.items;
      if (batch.length === 0) throw new Error("No new votes to tally");

      setStage("Generating proof… (this may take a bit)");
      const db = new InMemoryDB(new Uint8Array());
      const mt = new Merkletree(db, true, STATE_DEPTH);
      for (const [idxStr, { hash: leafHash }] of Object.entries(store.leaves)) {
        const idx = BigInt(idxStr);
        try {
          await mt.add(idx, leafHash);
        } catch (e) {
          if (e !== ErrEntryIndexAlreadyExists) throw e;
          await mt.update(idx, leafHash);
        }
      }
      const rootOld = (await mt.root()).bigInt();

      const coordinatorSk = keypair.sk;
      let H = BigInt(store.runningMsgHashHex);
      const tallyCounts = store.tallyCounts.map((x) => BigInt(x));
      const leavesMap = { ...store.leaves };

      const ephPk: bigint[][] = [];
      const nonces: bigint[] = [];
      const ciphertext: bigint[][] = [];
      const siblings: bigint[][] = [];
      const choicesOld: bigint[] = [];
      const revotingKeyOld: bigint[] = [];
      const noAux: bigint[] = [];
      const auxKey: bigint[] = [];
      const auxValue: bigint[] = [];
      const wasLeafEmpty: bigint[] = [];

      const LIMBS = 4;

      for (const v of batch) {
        const R: [bigint, bigint] = [
          BigInt("0x" + v.eph_x),
          BigInt("0x" + v.eph_y),
        ];
        const nonce = BigInt(v.nonce);
        const ctWords: bigint[] = [];
        const buf = Uint8Array.from(
          (v.ciphertext.match(/.{1,2}/g) ?? []).map((h) => parseInt(h, 16)),
        );
        if (buf.length % 32 !== 0) throw new Error("bad ciphertext len");
        for (let i = 0; i < buf.length; i += 32) {
          let x = 0n;
          for (let j = 0; j < 32; j++) x = (x << 8n) | BigInt(buf[i + j]);
          ctWords.push(x);
        }
        const shared = mulPointEscalar(R, coordinatorSk);
        const plain = poseidonDecrypt(ctWords, shared, nonce, LIMBS);
        const [
          nu,
          choice,
          revotingKeyOldFromMsg,
          revotingKeyNew,
        ] = plain;

        const idx = nu & ((1n << BigInt(STATE_DEPTH)) - 1n);
        const leafOld = leavesMap[idx.toString()];
        let choiceOld = 0n;
        let revotingOld = HASH0;
        if (leafOld) {
          choiceOld = leafOld.choice;
          revotingOld = leafOld.revotingKey;
        }

        const voteIsValid = revotingOld == revotingKeyOldFromMsg;

        let proof: any;
        if (voteIsValid) {
          const leaf = F.toObject(poseidon([choice, revotingKeyNew]));
          try {
            proof = await mt.addAndGetCircomProof(idx, leaf);
            wasLeafEmpty.push(1n);
          } catch (e) {
            if (e !== ErrEntryIndexAlreadyExists) throw e;
            proof = await mt.update(idx, leaf);
            wasLeafEmpty.push(0n);
          }
          leavesMap[idx.toString()] = {
            choice,
            revotingKey: revotingKeyNew,
            hash: leaf,
          };
          if (choiceOld !== 0n) tallyCounts[Number(choiceOld) - 1] -= 1n;
          if (choice !== 0n) tallyCounts[Number(choice) - 1] += 1n;
        } else {
          proof = await mt.generateCircomVerifierProof(idx, ZERO_HASH);
          wasLeafEmpty.push(0n);
        }

        noAux.push(BigInt(proof.isOld0));
        auxKey.push(proof.oldKey.bigInt());
        auxValue.push(proof.oldValue.bigInt());
        siblings.push(proof.siblings.map((h: any) => h.bigInt()));
        choicesOld.push(choiceOld);
        revotingKeyOld.push(revotingOld);
        ephPk.push(R);
        nonces.push(nonce);
        ciphertext.push(ctWords);

        const msgHash = F.toObject(poseidon([R[0], R[1], nonce, ...ctWords]));
        H = F.toObject(poseidon([H, msgHash]));
      }

      while (ephPk.length < MAX_BATCH) {
        ephPk.push(ephPk[ephPk.length - 1]);
        nonces.push(nonces[nonces.length - 1]);
        ciphertext.push(ciphertext[ciphertext.length - 1]);
        siblings.push(siblings[siblings.length - 1]);
        choicesOld.push(choicesOld[choicesOld.length - 1]);
        wasLeafEmpty.push(wasLeafEmpty[wasLeafEmpty.length - 1]);
        noAux.push(noAux[noAux.length - 1]);
        auxKey.push(auxKey[auxKey.length - 1]);
        auxValue.push(auxValue[auxValue.length - 1]);
        revotingKeyOld.push(
          revotingKeyOld[revotingKeyOld.length - 1],
        );
      }

      const rootNew = (await mt.root()).bigInt();
      let tallySaltOld = BigInt("0x" + store.tallySaltHex);
      const saltU8b = new Uint8Array(8);
      crypto.getRandomValues(saltU8b);
      let tallySaltNew = 0n;
      for (const b of saltU8b) tallySaltNew = (tallySaltNew << 8n) | BigInt(b);

      const tallyOld = Array(MAX_CHOICES).fill(0n);
      for (let i = 0; i < MAX_CHOICES; i++) {
        tallyOld[i] = BigInt(store.tallyCounts[i] ?? "0");
      }
      const tallyNew = tallyOld.slice();
      for (let i = 0; i < MAX_CHOICES; i++) {
        tallyNew[i] = tallyCounts[i] ?? 0n;
      }

      const cumulativeMsgHashOld = BigInt(store.runningMsgHashHex);

      const tallyHashNew = F.toObject(poseidon([tallySaltNew, ...tallyNew]));

      const inputs = {
        rootOld,
        cumulativeMsgHashOld,
        tallySaltOld,
        tallySaltNew,
        tallyOld,
        batchLen: BigInt(batch.length),
        coordinatorSk,
        ephPk,
        nonce: nonces,
        ciphertext,
        siblings,
        choiceOld: choicesOld,
        revotingKeyOld,
        noAux,
        auxKey,
        auxValue,
        wasLeafEmpty,
      };

      const { proof, publicSignals } = await groth16.fullProve(
        inputs,
        TALLY_WASM_URL,
        TALLY_ZKEY_URL,
      );
      const rootNewPub = BigInt(publicSignals[1]);
      const cumulativeMsgHashNewPub = BigInt(publicSignals[2]);
      const tallyHashNewPub = BigInt(publicSignals[3]);
      if (rootNewPub !== rootNew) throw new Error("rootNew mismatch");
      if (tallyHashNewPub !== tallyHashNew) {
        throw new Error("tallyHashNew mismatch");
      }

      setStage("Sending transaction…");
      const serialized = compressProof(proof);
      const ix = await tallyBatch({
        pollId: BigInt(pollId),
        proof: {
          a: Array.from(serialized.a),
          b: Array.from(serialized.b),
          c: Array.from(serialized.c),
        },
        owner: wallet.publicKey,
        rootNew: toBytesBE32(rootNew),
        cumulativeMsgHashNew: toBytesBE32(cumulativeMsgHashNewPub),
        tallyHashNew: toBytesBE32(tallyHashNewPub),
      });
      const tx = new Transaction().add(
        cuLimitInstruction([ix]),
        ...[ix].map((x) => x.instruction),
      );
      tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      tx.feePayer = wallet.publicKey;
      await wallet.sendTransaction(tx, connection, { maxRetries: 3 });

      const lastId = BigInt(batch[batch.length - 1].id);
      const newStore: TallyStore = {
        ...store,
        processedAfterId: lastId,
        processedCount: store.processedCount + batch.length,
        rootHex: toHex32(rootNew),
        runningMsgHashHex: toHex32(cumulativeMsgHashNewPub),
        tallySaltHex: toHex32(tallySaltNew),
        tallyCounts: tallyCounts.map((x) => x.toString(10)),
        leaves: leavesMap,
      };
      await saveTallyStore(newStore);
      setStore(newStore);
      await refreshRemaining();
      setStage("Tally batch submitted");
    } catch (e: any) {
      console.error(e);
      setErr("Error: " + String(e?.message || e));
      setStage("");
    } finally {
      setBusy(false);
    }
  }, [wallet.publicKey, poll, store, keypair, pollId, refreshRemaining, busy]);

  const onFinishTally = useCallback(async () => {
    try {
      if (busy) return;
      setBusy(true);
      setStage("Sending transaction…");
      if (!wallet.publicKey) throw new Error("Connect Solana wallet");
      if (!poll || !store) throw new Error("Poll/store not ready");
      const finalCounts = store.tallyCounts.map((x) => BigInt(x));
      const finalSalt = BigInt("0x" + store.tallySaltHex);
      const ix = await finishTally({
        pollId: BigInt(pollId),
        payer: wallet.publicKey,
        tally: finalCounts,
        tallySalt: finalSalt,
      });
      const tx = new Transaction().add(ix.instruction);
      tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
      tx.feePayer = wallet.publicKey;
      await wallet.sendTransaction(tx, connection, { maxRetries: 3 });
      setStage("Tally finished");
    } catch (e: any) {
      console.error(e);
      setErr("Error: " + String(e?.message || e));
      setStage("");
    } finally {
      setBusy(false);
    }
  }, [wallet.publicKey, poll, store, pollId, busy]);

  const onResetTally = useCallback(async () => {
    if (!store) return;
    const ok = confirm(
      "Reset tally progress? This will clear your local state.",
    );
    if (!ok) return;
    resetTallyStore(pollId, accountId);
    setStore(null);
    await refreshRemaining();
  }, [store, refreshRemaining]);

  return (
    <>
      {store && (
        <div className="mt-4">
          {(() => {
            const processed = store.processedCount;
            const rem = remaining ?? 0;
            const total = processed + rem;
            const pct = total === 0 ? 100 : Math.max(
              0,
              Math.min(100, Math.round((processed / total) * 100)),
            );
            return (
              <div className="flex items-center gap-2">
                <div className="relative h-2 w-full rounded bg-gray-200 dark:bg-zinc-800 overflow-hidden">
                  <div
                    className="h-full bg-emerald-600 dark:bg-emerald-500 transition-[width] duration-300"
                    style={{ width: `${pct}%` }}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={pct}
                    role="progressbar"
                  />
                </div>
                <button
                  onClick={refreshRemaining}
                  disabled={busy}
                  title="Refresh remaining"
                  className="p-1 rounded hover:bg-gray-100 dark:hover:bg-zinc-800 disabled:opacity-60"
                  aria-label="Refresh remaining"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 32 32"
                    width="32px"
                    height="32px"
                  >
                    <path
                      fill="#AB7C94"
                      d="M 16 4 C 10.886719 4 6.617188 7.160156 4.875 11.625 L 6.71875 12.375 C 8.175781 8.640625 11.710938 6 16 6 C 19.242188 6 22.132813 7.589844 23.9375 10 L 20 10 L 20 12 L 27 12 L 27 5 L 25 5 L 25 8.09375 C 22.808594 5.582031 19.570313 4 16 4 Z M 25.28125 19.625 C 23.824219 23.359375 20.289063 26 16 26 C 12.722656 26 9.84375 24.386719 8.03125 22 L 12 22 L 12 20 L 5 20 L 5 27 L 7 27 L 7 23.90625 C 9.1875 26.386719 12.394531 28 16 28 C 21.113281 28 25.382813 24.839844 27.125 20.375 Z"
                    />
                  </svg>
                </button>
                <div className="text-xs tabular-nums w-20 text-right">
                  {processed}/{total}
                </div>
              </div>
            );
          })()}
        </div>
      )}
      {!store && (
        <p className="text-sm">
          To count votes, first initialize the tally.
        </p>
      )}
      <div className="mt-3 flex items-center gap-2">
        {!store && (
          <button
            className={btn(!busy && !!wallet.publicKey)}
            disabled={busy || !wallet.publicKey}
            onClick={onCreateTally}
          >
            Start tally
          </button>
        )}
        {store && (
          <>
            {remaining !== 0 && remaining !== null && (
              <button
                className={btn(!busy && !!wallet.publicKey)}
                disabled={busy || !wallet.publicKey}
                onClick={onTallyNext}
              >
                Tally next batch
              </button>
            )}
            {Date.now() / 1000 >= poll.voting_end_time && remaining === 0 &&
              (
                <button
                  className={btn(!busy && !!wallet.publicKey)}
                  disabled={busy || !wallet.publicKey}
                  onClick={onFinishTally}
                >
                  Finish Tally
                </button>
              )}
          </>
        )}
        <span className="text-sm text-purple-600">{stage}</span>
        {err && (
          <span className="text-sm text-red-500 whitespace-pre-wrap">
            {err}
          </span>
        )}
        {/* We don't want to hide it when poll is over, server may lag... */}
        {store && (
          <>
            <button
              className="ml-auto px-3 py-2 text-xs underline opacity-70"
              disabled={busy}
              onClick={onResetTally}
            >
              Reset tally
            </button>
          </>
        )}
      </div>
    </>
  );
};
