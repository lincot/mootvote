import { useWallet } from "@solana/wallet-adapter-react";
import { groth16 } from "snarkjs";
import { poseidonEncrypt } from "@zk-kit/poseidon-cipher";
import {
  cuLimitInstruction,
  fetchPlatformConfig,
  findPoll,
  type InstructionWithCu,
  PLATFORM_CONFIG,
  PLATFORM_NAME,
  PROGRAM_ID,
  serializeVoteData,
  vote,
} from "@lincot/anon-vote-sdk";
import { fetchRelayerConfig } from "@lincot/zk-relayer-sdk";
import { getMerkleProof } from "../../../helpers/merkletree.ts";
import { compressProof } from "../../../helpers/compressSolana.ts";
import { getBabyjub, getEddsa, getPoseidon } from "../circomMemo.ts";
import { CLUSTER, RELAYER_URL, RPC_URL } from "../env.tsx";
import type { PollDetail } from "../poll.ts";
import { idForAccount, useKeyringCtx, useRevoKeysCtx } from "../keyring.tsx";
import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import { useState } from "react";
import { toBytesBE32, toHex32 } from "../../../helpers/utils.ts";
import { CENSUS_DEPTH } from "../consts.ts";
import { randomScalar } from "../../../helpers/key.ts";
import { bytesToHex } from "@noble/hashes/utils";
import { btn } from "../btn.ts";
import { Help } from "./Help.tsx";

const VOTE_WASM_URL = "/zk/Vote/Vote.wasm";
const VOTE_ZKEY_URL = "/zk/Vote/groth16_pkey.zkey";

type RelayAccountMeta = {
  is_signer: boolean;
  is_writable: boolean;
  pubkey: string;
};

type RelayRequestBody = {
  msg_hash: string;
  nu: string;
  discriminator: number;
  data: string;
  target_program: string;
  state_id: string;
  cu_limit?: number;
  accounts: RelayAccountMeta[];
};

export const Vote: React.FC<{ poll: PollDetail }> = ({ poll }) => {
  const wallet = useWallet();
  const KR = useKeyringCtx();
  const RK = useRevoKeysCtx();
  const connection = new Connection(RPC_URL, { commitment: "confirmed" });
  const [selected, setSelected] = useState<number | null>(null);
  const [stage, setStage] = useState<string | React.ReactNode>("");
  const [useRelayer, setUseRelayer] = useState<boolean>(true);
  const [err, setErr] = useState<string>("");
  const [busy, setBusy] = useState(false);

  const title = poll.title;
  const choices = poll.choices;

  const disabled = busy || (!useRelayer && !wallet.publicKey) || KR.locked ||
    !poll ||
    selected == null || Date.now() / 1000 < poll.voting_start_time ||
    Date.now() / 1000 > poll.voting_end_time;

  const onVoteClick = async () => {
    try {
      if (busy) return;
      setBusy(true);
      setErr("");
      if (!wallet.publicKey || KR.locked || !poll) {
        throw new Error("Unlock keyring and connect wallet");
      }
      if (selected == null) throw new Error("Select a choice");

      setStage("Preparing keys & proof…");
      const eddsa = await getEddsa();
      const babyjub = await getBabyjub();
      const poseidon = await getPoseidon();
      const F = poseidon.F;

      const a = KR.accounts[KR.active] ?? KR.accounts[0];
      if (!a) throw new Error("No active ZK account");
      const accountId = idForAccount(a);
      const prv = a.prv;
      const pub: [bigint, bigint] = a.pub;

      const pollIdBig = BigInt(poll.poll_id);
      const existing = RK.getForPoll(accountId, pollIdBig);
      const oldSec: bigint = existing ? existing.sk : 0n;
      const newRec = await RK.generateForPoll();
      const newSec: bigint = newRec.sk;

      const PK: [bigint, bigint] = [
        BigInt("0x" + poll.coordinator_key[0]),
        BigInt("0x" + poll.coordinator_key[1]),
      ];

      const nChoices = BigInt(choices.length);
      const pollId = BigInt(poll.poll_id);
      const choice = BigInt(selected + 1);

      setStage("Downloading census & building Merkle proof…");
      const ab: ArrayBuffer = await fetch(poll.census_url).then((r) =>
        r.arrayBuffer()
      );
      const censusBuf = new Uint8Array(ab);
      if (censusBuf.length % 32 !== 0) throw new Error("Bad census file");
      const myLeaf = poseidon.F.toObject(
        poseidon([pub[0], pub[1]]),
      ) as bigint;
      let found = -1;
      for (let off = 0, i = 0; off < censusBuf.length; off += 32, i++) {
        let x = 0n;
        for (let b = 0; b < 32; b++) x = (x << 8n) | BigInt(censusBuf[off + b]);
        if (x === myLeaf) {
          found = i;
          break;
        }
      }
      if (found < 0) throw new Error("Your key is not in the census");
      const leaves: bigint[] = [];
      for (let off = 0; off < censusBuf.length; off += 32) {
        let x = 0n;
        for (let b = 0; b < 32; b++) x = (x << 8n) | BigInt(censusBuf[off + b]);
        leaves.push(x);
      }
      const { path, pathPos } = await getMerkleProof(
        CENSUS_DEPTH,
        leaves,
        found,
      );

      const M_N = poseidon([PLATFORM_NAME, pollId]);
      const sigN = eddsa.signPoseidon(prv, M_N);
      const sigR: [bigint, bigint] = [
        F.toObject(sigN.R8[0]),
        F.toObject(sigN.R8[1]),
      ];
      const sigS = sigN.S;
      const sigHash = F.toObject(
        poseidon([
          sigS,
          sigR[0],
          sigR[1],
        ]),
      );

      let ephSk = randomScalar(babyjub.subOrder);
      const ephPkRaw = babyjub.mulPointEscalar(babyjub.Base8, ephSk);
      const sharedKeyRaw = babyjub.mulPointEscalar(
        [F.e(PK[0]), F.e(PK[1])],
        ephSk,
      );
      const sharedKey: [bigint, bigint] = [
        F.toObject(sharedKeyRaw[0]),
        F.toObject(sharedKeyRaw[1]),
      ];

      const ephPk: [bigint, bigint] = [
        F.toObject(ephPkRaw[0]),
        F.toObject(ephPkRaw[1]),
      ];

      const revotingKeyOld = oldSec;
      const revotingKeyNew = newSec;

      const nuCoordinator = F.toObject(poseidon([sigHash]));
      const P = [
        nuCoordinator,
        choice,
        F.toObject(poseidon([revotingKeyOld])),
        F.toObject(poseidon([revotingKeyNew])),
      ];
      const nonce = (() => {
        const u = new Uint32Array(2);
        crypto.getRandomValues(u);
        return (BigInt(u[0]) << 32n) | BigInt(u[1]);
      })();
      const ciphertext = poseidonEncrypt(P, sharedKey, nonce);

      const coordinatorPk = PK;

      let relayerId = 0n;
      let relayerNu;
      if (useRelayer) {
        setStage("Fetching relayer information…");
        const relayerConfig = await fetchRelayerConfig(connection);
        if (!relayerConfig) {
          throw new Error("Relayer not initialized");
        }
        const relayerIdBuf = relayerConfig.relayer.feeKey.toBuffer();
        relayerIdBuf[0] &= (1 << 5) - 1;
        relayerId = BigInt("0x" + relayerIdBuf.toString("hex"));
        relayerNu = F.toObject(poseidon([sigHash, relayerId]));
      }

      setStage("Generating proof… (this may take a bit)");
      const inputs = {
        censusRoot: BigInt("0x" + poll.census_root),
        pollId,
        nChoices,
        revotingKeyNew,
        revotingKeyOld,
        voterPk: pub,
        sigR,
        sigS,
        path,
        pathPos,
        choice,
        ephSk,
        coordinatorPk,
        relayerId,
        nonce,
        ciphertext,
      };
      const { proof } = await groth16.fullProve(
        inputs,
        VOTE_WASM_URL,
        VOTE_ZKEY_URL,
      );
      const serializedProof = compressProof(proof);

      if (useRelayer) {
        setStage("Preparing relayer request…");

        const msgHashBig = F.toObject(
          poseidon([ephPk[0], ephPk[1], nonce, ...ciphertext]),
        ) as bigint;
        const msgHashHex = toHex32(msgHashBig);
        const nuHex = toHex32(relayerNu);

        const ciphertextBytes: number[][] = ciphertext.map((c) =>
          toBytesBE32(c)
        );
        const proofCompressed = {
          a: Array.from(serializedProof.a),
          b: Array.from(serializedProof.b),
          c: Array.from(serializedProof.c),
        };
        const ephPkBytes = {
          x: toBytesBE32(ephPk[0]),
          y: toBytesBE32(ephPk[1]),
        };

        if (!RELAYER_URL) {
          throw new Error("Relayer URL is not configured.");
        }

        const dataU8 = serializeVoteData({
          ciphertext: ciphertextBytes,
          proof: proofCompressed,
          ephPk: ephPkBytes,
          nonce: nonce,
        });
        const dataHex = bytesToHex(dataU8);

        const platform = await fetchPlatformConfig(connection);

        const accounts: RelayAccountMeta[] = [
          {
            is_signer: false,
            is_writable: false,
            pubkey: PLATFORM_CONFIG.toBase58(),
          },
          {
            is_signer: false,
            is_writable: true,
            pubkey: findPoll(pollId).toBase58(),
          },
          {
            is_signer: false,
            is_writable: true,
            pubkey: platform!.feeDestination.toBase58(),
          },
        ];

        const body: RelayRequestBody = {
          msg_hash: msgHashHex,
          nu: nuHex,
          discriminator: 4,
          data: dataHex,
          target_program: PROGRAM_ID.toBase58(),
          state_id: String(pollId),
          cu_limit: 200_000,
          accounts,
        };

        setStage("Submitting to relayer…");
        const resp = await fetch(new URL("/relay", RELAYER_URL).toString(), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!resp.ok) {
          const txt = await resp.text().catch(() => "");
          throw new Error(txt || `Relayer error (${resp.status})`);
        }
        const { signature } = (await resp.json()) as { signature: string };
        // TODO verify transaction content here

        const q = CLUSTER === "devnet" ? "?cluster=devnet" : "";
        const url = `https://explorer.solana.com/tx/${signature}${q}`;
        setStage(
          <>
            Vote sent via relayer.&nbsp;
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2"
            >
              View on Explorer
            </a>
          </>,
        );
      } else {
        setStage("Sending transaction…");
        const platform = await fetchPlatformConfig(connection);
        const ix: InstructionWithCu = await vote({
          payer: wallet.publicKey,
          pollId: pollId,
          ciphertext: ciphertext.map((c) => toBytesBE32(c)),
          ephPk: {
            x: toBytesBE32(ephPk[0]),
            y: toBytesBE32(ephPk[1]),
          },
          nonce: nonce,
          proof: {
            a: Array.from(serializedProof.a),
            b: Array.from(serializedProof.b),
            c: Array.from(serializedProof.c),
          },
          platformFeeDestination: platform!.feeDestination,
          pollFeeDestination: new PublicKey(poll.fee_destination),
        });

        const tx = new Transaction().add(
          cuLimitInstruction([ix]),
          ...[ix].map((x) => x.instruction),
        );
        tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
        tx.feePayer = wallet.publicKey;
        await wallet.sendTransaction(tx, connection, { maxRetries: 3 });
        setStage("Vote sent!");
      }

      await RK.setForPoll(accountId, pollIdBig, { ...newRec, title });
    } catch (e: any) {
      console.error(e);
      setErr("Error: " + String(e?.message || e));
      setStage("");
    } finally {
      setBusy(false);
    }
  };

  if (!poll) {
    return <></>;
  }

  const now = Math.floor(Date.now() / 1000);
  const active = now >= poll.voting_start_time && now <= poll.voting_end_time;

  return (
    <>
      {choices.length === 0
        ? (
          <div className="text-sm opacity-70">
            No choices found in description.
          </div>
        )
        : (
          <div className="space-y-2">
            {choices.map((c, i) => (
              <label
                key={i}
                className="flex items-center gap-2 cursor-pointer"
              >
                <input
                  type="radio"
                  name="choice"
                  checked={selected === i}
                  onChange={() => setSelected(i)}
                />
                <span>{c}</span>
              </label>
            ))}
          </div>
        )}

      <div className="mt-4 flex items-center gap-3">
        <button
          className={btn(!disabled)}
          disabled={disabled}
          onClick={onVoteClick}
        >
          {active ? "Cast vote" : "Voting closed"}
        </button>
        {stage && <span className="text-sm text-purple-600">{stage}</span>}
      </div>
      {err && <div className="mt-2 text-sm text-red-600">{err}</div>}
      {!useRelayer && !wallet.publicKey && (
        <div className="mt-2 text-xs text-amber-700 dark:text-amber-500">
          Connect your Solana wallet.
        </div>
      )}

      <div className="mt-3 flex items-center">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={useRelayer}
            onChange={(e) => setUseRelayer(e.target.checked)}
          />
          Use relayer (recommended)
          <Help
            title={"When to use relayer?"}
            below={true}
            content={
              <div>
                <p>
                  Relayer submits your vote on-chain and covers all fees.<br />
                  <br />
                  Note that relayer can only send a maximum of 3 of your votes
                  per poll.<br />
                  <br />
                  If you prefer, uncheck to submit the transaction directly from
                  your wallet. However, in this case, tallier will be able to
                  link your vote to your wallet.
                </p>
              </div>
            }
          />
        </label>
      </div>
    </>
  );
};
