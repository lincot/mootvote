import {
  closeTally,
  createPoll,
  createTally,
  fetchPlatformConfig,
  fetchPoll,
  fetchTally,
  findPoll,
  findTally,
  finishTally,
  initialize,
  type InstructionWithCu,
  onVote,
  PLATFORM_NAME,
  PROGRAM_ID,
  setProvider,
  tallyBatch,
  toTransaction,
  updateConfig,
  vote,
  voteWithRelayer,
  withdrawPoll,
} from "@lincot/mootvote-sdk";
import {
  fetchRelayerConfig,
  fetchRelayerState,
  findRelayerState,
  initialize as initializeRelayer,
  updateConfig as updateRelayerConfig,
} from "@lincot/zk-relayer-sdk";
import {
  Keypair,
  type Signer,
  type TransactionSignature,
} from "@solana/web3.js";
import { before, describe, test } from "mocha";
import * as chai from "chai";
import chaiAsPromised from "chai-as-promised";
import { expect } from "chai";
import {
  disperse,
  HASH0,
  sendAndConfirmVersionedTx,
  setupTests,
  toBigint,
  toBytesBE32,
} from "../helpers/utils.ts";
import {
  type BabyJub,
  buildBabyjub,
  buildEddsa,
  buildPoseidon,
  type Eddsa,
  type Poseidon,
} from "circomlibjs";
import { poseidonDecrypt, poseidonEncrypt } from "@zk-kit/poseidon-cipher";
import { groth16 } from "snarkjs";
import { readFileSync } from "fs";
import { genBabyJubKeypair, randomScalar } from "../helpers/key.ts";
import { compressProof } from "../helpers/compressSolana.ts";
import { getMerkleProof, getMerkleRoot } from "../helpers/merkletree.ts";
import {
  CircomProcessorProof,
  CircomVerifierProof,
  ErrEntryIndexAlreadyExists,
  InMemoryDB,
  Merkletree,
  ZERO_HASH,
} from "@iden3/js-merkletree";
import { mulPointEscalar } from "@zk-kit/baby-jubjub";
import anchor from "@coral-xyz/anchor";

const { BN } = anchor;

chai.use(chaiAsPromised);

const { provider, payer } = setupTests();
const connection = provider.connection;

setProvider(provider);

const sendTx = async (
  ixs: InstructionWithCu[],
  signers: Signer[] = [payer],
): Promise<TransactionSignature> => {
  const tx = toTransaction(
    ixs,
    await connection.getLatestBlockhash().then((x) => x.blockhash),
    payer,
  );
  return await sendAndConfirmVersionedTx(
    connection,
    tx,
    signers,
    signers[0].publicKey,
  );
};

const sendIx = async (
  ix: InstructionWithCu,
  signers: Signer[] = [payer],
): Promise<TransactionSignature> => sendTx([ix], signers);

let poseidon: Poseidon;
let eddsa: Eddsa;
let babyjub: BabyJub;
let F: any;

type Voter = {
  prv: Uint8Array;
  pub: [Uint8Array, Uint8Array];
};

const voters: Voter[] = [];
const census: bigint[] = [];
let censusRoot: bigint;

type Message = {
  ephPk: [bigint, bigint];
  nonce: bigint;
  ciphertext: bigint[];
};

const messages: Message[] = [];

const CENSUS_DEPTH = 40;
const STATE_DEPTH = 64;
const N_VOTERS = 3;

const MSG_LIMIT = 3n;

const pollFeeDestination = new Keypair();
const platformFeeDestination = new Keypair();

const admin = new Keypair();

const platformFee = 100_000n;
const pollFee = 200_000n;

before(async () => {
  await disperse(
    connection,
    [
      platformFeeDestination.publicKey,
      pollFeeDestination.publicKey,
      relayer.publicKey,
    ],
    payer,
    200_000_000,
  );

  poseidon = await buildPoseidon();
  eddsa = await buildEddsa();
  babyjub = await buildBabyjub();
  F = poseidon.F;

  for (let i = 0; i < N_VOTERS; i++) {
    const { prv, pub } = genBabyJubKeypair(
      babyjub,
      eddsa,
    );
    voters.push({ prv, pub });
    census.push(
      F.toObject(
        poseidon([F.toObject(pub[0]), F.toObject(pub[1])]),
      ),
    );
  }

  censusRoot = await getMerkleRoot(CENSUS_DEPTH, census);
});

const relayer = new Keypair();
const relayerFee = 100_000n;

describe("ZK Relayer", () => {
  const tempAdmin = new Keypair();

  test("initialize", async () => {
    const relayerEndpoint = "https://test.test";
    const fee = 123123n;
    await sendIx(
      await initializeRelayer({
        admin: tempAdmin.publicKey,
        fee,
        payer: payer.publicKey,
        relayerEndpoint,
        relayerFeeKey: relayer.publicKey,
      }),
    );

    const relayerConfig = await fetchRelayerConfig(connection);
    if (!relayerConfig) throw new Error("Relayer config not initialized");
    expect(relayerConfig.admin.equals(tempAdmin.publicKey)).to.be.true;
    expect(toBigint(relayerConfig.fee)).to.equal(fee);
    expect(relayerConfig.relayer).to.deep.equal({
      feeKey: relayer.publicKey,
      endpoint: relayerEndpoint,
    });
  });

  test("updateRelayerConfig", async () => {
    const relayerEndpoint = "https://test2.test";
    await sendIx(
      await updateRelayerConfig({
        oldAdmin: tempAdmin.publicKey,
        newAdmin: admin.publicKey,
        fee: relayerFee,
        payer: payer.publicKey,
        relayerEndpoint,
        relayerFeeKey: relayer.publicKey,
      }),
      [payer, tempAdmin],
    );

    const relayerConfig = await fetchRelayerConfig(connection);
    if (!relayerConfig) throw new Error("Relayer config not initialized");
    expect(relayerConfig.admin.equals(admin.publicKey)).to.be.true;
    expect(toBigint(relayerConfig.fee)).to.equal(relayerFee);
    expect(relayerConfig.relayer).to.deep.equal({
      feeKey: relayer.publicKey,
      endpoint: relayerEndpoint,
    });
  });
});

describe("MootVote", () => {
  const tempAdmin = new Keypair();

  const pollId = 5n;
  let tallierSk: bigint;
  let PKx: Uint8Array;
  let PKy: Uint8Array;
  const nChoices = 6;

  test("initialize", async () => {
    const fee = 789789n;
    const feeDestination = new Keypair().publicKey;

    await sendIx(
      await initialize({
        admin: tempAdmin.publicKey,
        fee,
        feeDestination,
        payer: payer.publicKey,
      }),
    );

    const platformConfig = await fetchPlatformConfig(connection);
    if (!platformConfig) throw new Error("Platform config not initialized");
    expect(platformConfig).to.not.be.null;
    expect(platformConfig.admin.equals(tempAdmin.publicKey)).to.be.true;
    expect(toBigint(platformConfig.fee)).to.equal(fee);
    expect(platformConfig.feeDestination.equals(feeDestination)).to.be.true;
  });

  test("updateConfig", async () => {
    await sendIx(
      await updateConfig({
        oldAdmin: tempAdmin.publicKey,
        newAdmin: admin.publicKey,
        fee: platformFee,
        feeDestination: platformFeeDestination.publicKey,
      }),
      [payer, tempAdmin],
    );

    const platformConfig = await fetchPlatformConfig(connection);
    if (!platformConfig) throw new Error("Platform config not initialized");
    expect(platformConfig.admin.equals(admin.publicKey)).to.be.true;
    expect(toBigint(platformConfig.fee)).to.equal(platformFee);
    expect(
      platformConfig.feeDestination.equals(platformFeeDestination.publicKey),
    ).to.be.true;
  });

  test("createPoll", async () => {
    const { sk: sk_, pub } = genBabyJubKeypair(babyjub, eddsa);
    tallierSk = sk_;
    PKx = pub[0];
    PKy = pub[1];
    const tallierKey = {
      x: toBytesBE32(F.toObject(PKx)),
      y: toBytesBE32(F.toObject(PKy)),
    };

    const descriptionUrl =
      "https://ipfs.io/ipfs/bafkreicvkyr25sgsl2suwl4euwlexamplevyk7vxnai6tti2qexaexaexa";
    const censusUrl =
      "https://ipfs.io/ipfs/bafkreicvkyr25sgsl2suwl4euwlexamplevyk7vxnai6tti2qexaexaexa";
    const votingStartTime = new BN(Math.floor(Date.now() / 1000) + 1);
    const votingEndTime = new BN(Math.floor(Date.now() / 1000) + 15);
    await sendIx(
      await createPoll({
        payer: payer.publicKey,
        id: pollId,
        censusRoot: toBytesBE32(censusRoot),
        tallierKey,
        nChoices,
        votingStartTime,
        votingEndTime,
        fee: pollFee,
        feeDestination: pollFeeDestination.publicKey,
        nVoters: BigInt(N_VOTERS),
        descriptionUrl,
        censusUrl,
      }),
    );

    const poll = await fetchPoll(connection, findPoll(pollId));
    if (!poll) throw new Error("Poll not initialized");
    expect(toBigint(poll.id)).to.equal(pollId);
    expect(poll.nChoices).to.equal(nChoices);
    expect(poll.tallierKey).to.deep.equal(tallierKey);
    expect(poll.censusRoot).to.deep.equal(toBytesBE32(censusRoot));
    expect(poll.cumulativeMsgHash).to.deep.equal(
      Array.from({ length: 32 }, () => 0),
    );
    expect(poll.votingStartTime.eq(votingStartTime)).to.be.true;
    expect(poll.votingEndTime.eq(votingEndTime)).to.be.true;
    expect(toBigint(poll.platformFee)).to.deep.equal(platformFee);
    expect(toBigint(poll.fee)).to.equal(pollFee);
    expect(poll.feeDestination.equals(pollFeeDestination.publicKey)).to.be
      .true;
    expect(poll.descriptionUrl).to.equal(descriptionUrl);
    expect(poll.censusUrl).to.equal(censusUrl);
    expect(poll.tally).to.be.empty;

    const relayerState = await fetchRelayerState(
      connection,
      findRelayerState(PROGRAM_ID, pollId),
    );
    if (!relayerState) throw new Error("Relayer state not initialized");
    expect(relayerState.endTime.eq(votingEndTime)).to.be.true;
    expect(toBigint(relayerState.msgLimit)).to.equal(MSG_LIMIT);
    expect(relayerState.rootState).to.not.deep.equal(
      Array.from({ length: 32 }, () => 0),
    );
  });

  test("vote", async () => {
    const batchLen = voters.length + 2;
    expect(batchLen).to.be.lessThan(MAX_BATCH);

    const quotaDb = new InMemoryDB(new Uint8Array(1));
    const quotaMt = new Merkletree(quotaDb, true, STATE_DEPTH);
    const quotaMtMap = new Map();
    const uniqDb = new InMemoryDB(new Uint8Array(2));
    const uniqMt = new Merkletree(uniqDb, true, STATE_DEPTH);

    const prvRevoting = randomScalar(babyjub.subOrder);

    for (let i = 0; i < batchLen; i++) {
      const voterIndex = batchLen > 2 && i >= batchLen - 2
        ? voters.length - 1
        : i;
      const { prv, pub } = voters[voterIndex];
      const nonce = 5n + BigInt(i);
      const M_N = poseidon([PLATFORM_NAME, pollId]);
      const sigN = eddsa.signPoseidon(prv, M_N);
      expect(eddsa.verifyPoseidon(M_N, sigN, pub)).to.be.true;

      const sigR = [
        F.toObject(sigN.R8[0]),
        F.toObject(sigN.R8[1]),
      ];
      const sigS = sigN.S;

      const sigHash = F.toObject(poseidon([sigS, sigR[0], sigR[1]]));
      const choice = BigInt((i % nChoices) + 1); // 1..nChoices

      const ephSk = randomScalar(babyjub.subOrder);
      const ephPkRaw = babyjub.mulPointEscalar(babyjub.Base8, ephSk);
      const sharedKeyRaw = babyjub.mulPointEscalar([PKx, PKy], ephSk);
      const ephPk: [bigint, bigint] = [
        F.toObject(ephPkRaw[0]),
        F.toObject(ephPkRaw[1]),
      ];
      const sharedKey: [bigint, bigint] = [
        F.toObject(sharedKeyRaw[0]),
        F.toObject(sharedKeyRaw[1]),
      ];

      // normal votes, then key change, then a valid vote with new key, then an invalid vote
      const revotingKeyOld = i == batchLen - 2 && batchLen > 2
        ? prvRevoting
        : 0n;
      const revotingKeyNew = i == batchLen - 3 && batchLen > 2
        ? prvRevoting
        : 42n;

      const nuTallier = F.toObject(poseidon([sigHash]));
      const plaintext = [
        nuTallier,
        choice,
        F.toObject(poseidon([revotingKeyOld])),
        F.toObject(poseidon([revotingKeyNew])),
      ];
      const ciphertext = poseidonEncrypt(plaintext, sharedKey, nonce);

      const LIMBS = plaintext.length;
      const PAD = (LIMBS % 3 === 0) ? LIMBS : LIMBS + (3 - (LIMBS % 3));
      if (ciphertext.length !== PAD + 1) {
        throw new Error(
          `CT length mismatch: got ${ciphertext.length}, expected ${PAD + 1}`,
        );
      }

      let relayerId = 0n;
      let relayerNu = 0n;

      if (i == 1) {
        const relayerIdBuf = relayer.publicKey.toBuffer();
        relayerIdBuf[0] &= (1 << 5) - 1;
        relayerId = BigInt("0x" + relayerIdBuf.toString("hex"));
        relayerNu = F.toObject(poseidon([sigHash, relayerId]));
      }

      const tallierPk = [F.toObject(PKx), F.toObject(PKy)];
      const { path, pathPos } = await getMerkleProof(
        CENSUS_DEPTH,
        census,
        voterIndex,
      );
      const inputs = {
        censusRoot,
        pollId,
        nChoices: BigInt(nChoices),
        revotingKeyNew,
        revotingKeyOld,

        voterPk: [F.toObject(pub[0]), F.toObject(pub[1])],
        sigR,
        sigS,

        path,
        pathPos,
        choice,
        ephSk,
        tallierPk,
        relayerId,
        nonce,
        ciphertext,
      };

      const startTime = performance.now();
      let { proof, publicSignals } = await groth16.fullProve(
        inputs,
        "build/Vote/Vote_js/Vote.wasm",
        "build/Vote/groth16_pkey.zkey",
      );
      const endTime = performance.now();
      console.log(`Vote proving took ${endTime - startTime}ms`);

      const msgHashJs = F.toObject(
        poseidon([ephPk[0], ephPk[1], nonce, ...ciphertext]),
      );
      const relayerNuHashJs = i == 1
        ? F.toObject(poseidon([relayerNu, msgHashJs]))
        : 0n;

      const MsgHash_pub = BigInt(publicSignals[0]);
      const RelayerNuHash_pub = BigInt(publicSignals[1]);
      const CensusRoot_pub = BigInt(publicSignals[2]);
      const PollId_pub = BigInt(publicSignals[3]);
      const N_choices_pub = BigInt(publicSignals[4]);
      const PK_pub = [BigInt(publicSignals[5]), BigInt(publicSignals[6])];

      if (CensusRoot_pub !== censusRoot) throw new Error("CensusRoot mismatch");
      if (PollId_pub !== pollId) throw new Error("PollId mismatch");
      if (MsgHash_pub !== msgHashJs) throw new Error("MsgHash mismatch");
      if (RelayerNuHash_pub !== relayerNuHashJs) {
        throw new Error("RelayerNuHash mismatch");
      }
      if (N_choices_pub !== BigInt(nChoices)) {
        throw new Error("N_choices mismatch");
      }
      if (PK_pub[0] != tallierPk[0] || PK_pub[1] != tallierPk[1]) {
        throw new Error("PK mismatch");
      }

      const vkey = JSON.parse(
        readFileSync("./build/Vote/groth16_vkey.json", "utf8"),
      );
      expect(await groth16.verify(vkey, publicSignals, proof)).to.be.true;

      const serializedProof = compressProof(proof);

      const eventPromise: Promise<void> = new Promise((resolve, reject) => {
        onVote((event) => {
          try {
            expect(event.ciphertext).to.deep.equal(
              ciphertext.map((x) => toBytesBE32(x)),
            );
            expect(event.ephPk.x).to.deep.equal(toBytesBE32(ephPk[0]));
            expect(event.ephPk.y).to.deep.equal(toBytesBE32(ephPk[1]));
            expect(toBigint(event.nonce)).to.equal(nonce);
            resolve();
          } catch (error) {
            reject(error);
          }
        });
        setTimeout(() => {
          reject(new Error("Event did not fire within timeout"));
        }, 12000);
      });

      if (i == 1) {
        const rootQuotaOld = (await quotaMt.root()).bigInt();
        const rootUniqOld = (await uniqMt.root()).bigInt();

        const idx = relayerNu & ((1n << BigInt(STATE_DEPTH)) - 1n);

        const coundOld = quotaMtMap.get(idx) ?? 0;
        quotaMtMap.set(idx, coundOld + 1);

        let proofQuota: CircomProcessorProof | CircomVerifierProof;
        try {
          proofQuota = await quotaMt.addAndGetCircomProof(
            idx,
            BigInt(coundOld + 1),
          );
        } catch (e) {
          if (e != ErrEntryIndexAlreadyExists) {
            throw e;
          }

          proofQuota = await quotaMt.update(idx, BigInt(coundOld + 1));
        }

        const proofUniq = await uniqMt.addAndGetCircomProof(MsgHash_pub, 1n);

        const siblingsQuota = proofQuota.siblings.map((h) => h.bigInt());
        expect(siblingsQuota.length).to.equal(STATE_DEPTH);
        const siblingsUniq = proofUniq.siblings.map((h) => h.bigInt());
        expect(siblingsUniq.length).to.equal(STATE_DEPTH);

        const msgLimit = 3n;

        const inputs = {
          rootQuotaOld,
          rootUniqOld,
          msgHash: msgHashJs,
          msgLimit,
          nu: relayerNu,
          countOld: BigInt(coundOld),
          siblingsQuota,
          noAuxQuota: BigInt(proofQuota.isOld0),
          auxKeyQuota: proofQuota.oldKey.bigInt(),
          auxValueQuota: proofQuota.oldValue.bigInt(),
          siblingsUniq,
          noAuxUniq: BigInt(proofUniq.isOld0),
          auxKeyUniq: proofUniq.oldKey.bigInt(),
          auxValueUniq: proofUniq.oldValue.bigInt(),
        };

        const startTime = performance.now();
        const { proof: relayerProof, publicSignals } = await groth16.fullProve(
          inputs,
          "build/Relay/Relay_js/Relay.wasm",
          "build/Relay/groth16_pkey.zkey",
        );
        const endTime = performance.now();
        console.log(`Relay proving took ${endTime - startTime}ms`);

        const rootStateOldPub = BigInt(publicSignals[0]);
        const rootStateNew = BigInt(publicSignals[1]);
        const relayerNuHashPub = BigInt(publicSignals[2]);
        const msgHashPubRelayer = BigInt(publicSignals[3]);
        const msgLimitPub = BigInt(publicSignals[4]);

        expect(rootStateOldPub).to.equal(
          F.toObject(poseidon([rootQuotaOld, rootUniqOld])),
        );
        expect(rootStateNew).to.equal(
          F.toObject(
            poseidon([
              (await quotaMt.root()).bigInt(),
              (await uniqMt.root()).bigInt(),
            ]),
          ),
        );
        expect(relayerNuHashPub).to.equal(relayerNuHashJs);
        expect(msgHashPubRelayer).to.equal(msgHashJs);
        expect(msgLimitPub).to.equal(msgLimit);

        const vkey = JSON.parse(
          readFileSync("build/Relay/groth16_vkey.json", "utf8"),
        );
        const ok = await groth16.verify(vkey, publicSignals, relayerProof);
        expect(ok).to.equal(true);

        const serializedRelayerProof = compressProof(relayerProof);

        await sendIx(
          await voteWithRelayer({
            relayer: relayer.publicKey,
            pollId,
            msgHash: toBytesBE32(msgHashJs),
            ciphertext: ciphertext.map((x) => toBytesBE32(x)),
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
            platformFeeDestination: platformFeeDestination.publicKey,
            relayerNuHash: toBytesBE32(relayerNuHashJs),
            relayerProof: {
              a: Array.from(serializedRelayerProof.a),
              b: Array.from(serializedRelayerProof.b),
              c: Array.from(serializedRelayerProof.c),
            },
            rootStateNew: toBytesBE32(rootStateNew),
          }),
          [relayer],
        );
      } else {
        await sendIx(
          await vote({
            payer: payer.publicKey,
            pollId,
            ciphertext: ciphertext.map((x) => toBytesBE32(x)),
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
            platformFeeDestination: platformFeeDestination.publicKey,
            pollFeeDestination: pollFeeDestination.publicKey,
          }),
        );
      }
      await eventPromise;
      messages.push({
        ephPk,
        nonce,
        ciphertext,
      });
    }

    // writeProofBin(proof, "proof.bin");
    // writePublicInputsBin(publicSignals, "public_inputs.bin");
    // writeVkBin("./build/Vote/groth16_vkey.json", "vk.bin");
  });

  const MAX_BATCH = 6;
  const LIMBS = 4;
  const MAX_CHOICES = 8;

  it("tally", async () => {
    const db = new InMemoryDB(new Uint8Array());
    const mt = new Merkletree(db, true, STATE_DEPTH);
    const mtMap = new Map();
    const rootOld = (await mt.root()).bigInt();
    expect(rootOld).to.equal(0n);

    const cumulativeMsgHashOld = 0n;
    let cumulativeMsgHash = cumulativeMsgHashOld;
    const tallyOld = Array<bigint>(MAX_CHOICES).fill(0n);
    const tally = tallyOld.slice();

    const tallySaltOld = 42n;
    const tallySaltNew = 43n;

    const ephPk: bigint[][] = [];
    const nonce: bigint[] = [];
    const ciphertext: bigint[][] = [];
    const siblings: bigint[][] = [];
    const choiceOld: bigint[] = [];
    const wasLeafEmpty: bigint[] = [];
    const noAux: bigint[] = [];
    const auxKey: bigint[] = [];
    const auxValue: bigint[] = [];
    const revotingKeyOld: bigint[] = [];

    for (const message of messages) {
      const [
        nu,
        choice,
        revotingKeyOldFromMsg,
        revotingKeyNew,
      ] = poseidonDecrypt(
        message.ciphertext,
        mulPointEscalar(message.ephPk, tallierSk),
        message.nonce,
        LIMBS,
      );

      const idx = nu & ((1n << BigInt(STATE_DEPTH)) - 1n);

      const prevLeaf = mtMap.get(idx) ?? { choice: 0n, revotingKey: HASH0 };
      const voteIsValid = prevLeaf.revotingKey == revotingKeyOldFromMsg;
      if (voteIsValid) {
        mtMap.set(idx, { choice, revotingKey: revotingKeyNew });
      }
      const leaf = F.toObject(poseidon([choice, revotingKeyNew]));
      let proof: CircomProcessorProof | CircomVerifierProof;
      if (voteIsValid) {
        try {
          proof = await mt.addAndGetCircomProof(idx, leaf);
          wasLeafEmpty.push(1n);
        } catch (e) {
          if (e != ErrEntryIndexAlreadyExists) {
            throw e;
          }

          proof = await mt.update(idx, leaf);
          wasLeafEmpty.push(0n);
        }
      } else {
        proof = await mt.generateCircomVerifierProof(idx, ZERO_HASH);
        wasLeafEmpty.push(0n);
      }

      noAux.push(BigInt(proof.isOld0));
      auxKey.push(proof.oldKey.bigInt());
      auxValue.push(proof.oldValue.bigInt());

      const proofSiblings = proof.siblings.map((h) => h.bigInt());
      expect(proofSiblings.length).to.equal(STATE_DEPTH);

      ephPk.push(message.ephPk);
      nonce.push(message.nonce);
      ciphertext.push(message.ciphertext);
      siblings.push(proofSiblings);
      choiceOld.push(prevLeaf.choice);
      revotingKeyOld.push(prevLeaf.revotingKey);

      const msgHash = F.toObject(
        poseidon([
          message.ephPk[0],
          message.ephPk[1],
          message.nonce,
          ...message.ciphertext,
        ]),
      );
      cumulativeMsgHash = F.toObject(poseidon([cumulativeMsgHash, msgHash]));

      if (voteIsValid) {
        if (prevLeaf.choice !== 0n) tally[Number(prevLeaf.choice) - 1] -= 1n;
        tally[Number(choice) - 1] += 1n;
      }
    }

    while (ephPk.length < MAX_BATCH) {
      ephPk.push(ephPk[ephPk.length - 1]);
      nonce.push(nonce[nonce.length - 1]);
      ciphertext.push(ciphertext[ciphertext.length - 1]);
      siblings.push(siblings[siblings.length - 1]);
      choiceOld.push(choiceOld[choiceOld.length - 1]);
      wasLeafEmpty.push(wasLeafEmpty[wasLeafEmpty.length - 1]);
      noAux.push(noAux[noAux.length - 1]);
      auxKey.push(auxKey[auxKey.length - 1]);
      auxValue.push(auxValue[auxValue.length - 1]);
      revotingKeyOld.push(
        revotingKeyOld[revotingKeyOld.length - 1],
      );
    }

    const inputs = {
      rootOld,
      cumulativeMsgHashOld,
      tallySaltOld,
      tallySaltNew,
      tallyOld,
      batchLen: BigInt(messages.length),
      tallierSk,
      ephPk,
      nonce,
      ciphertext,
      siblings,
      choiceOld,
      revotingKeyOld,
      noAux,
      auxKey,
      auxValue,
      wasLeafEmpty,
    };

    const startTime = performance.now();
    const { proof, publicSignals } = await groth16.fullProve(
      inputs,
      "build/Tally/Tally_js/Tally.wasm",
      "build/Tally/groth16_pkey.zkey",
    );
    const endTime = performance.now();
    console.log(`Tally proving took ${endTime - startTime}ms`);

    const tallyHashOld = F.toObject(
      poseidon([tallySaltOld, ...tallyOld]),
    );
    expect(BigInt(publicSignals[0])).to.equal(tallyHashOld);
    const rootNew = BigInt(publicSignals[1]);
    const cumulativeMsgHashNew = BigInt(publicSignals[2]);
    const tallyHashNew = BigInt(publicSignals[3]);
    expect(BigInt(publicSignals[4])).to.equal(rootOld);
    expect(BigInt(publicSignals[5])).to.equal(cumulativeMsgHashOld);

    expect(rootNew).to.equal((await mt.root()).bigInt());
    expect(cumulativeMsgHashNew).to.equal(cumulativeMsgHash);
    expect(tallyHashNew).to.equal(
      F.toObject(poseidon([tallySaltNew, ...tally])),
    );

    const vkey = JSON.parse(
      readFileSync("build/Tally/groth16_vkey.json", "utf8"),
    );
    const ok = await groth16.verify(vkey, publicSignals, proof);
    expect(ok).to.equal(true);

    await sendIx(
      await createTally({
        initialTallyHash: toBytesBE32(tallyHashOld),
        payer: payer.publicKey,
        pollId,
      }),
    );

    const tallyAcc = await fetchTally(
      connection,
      findTally(pollId, payer.publicKey),
    );
    if (!tallyAcc) throw new Error("Tally not initialized");
    expect(tallyAcc.tallyHash).to.deep.equal(toBytesBE32(tallyHashOld));
    expect(tallyAcc.cumulativeMsgHash).to.deep.equal(
      Array.from({ length: 32 }, () => 0),
    );
    expect(tallyAcc.root).to.deep.equal(Array.from({ length: 32 }, () => 0));

    await sendIx(
      await closeTally({
        owner: payer.publicKey,
        pollId,
      }),
    );

    expect(await fetchTally(connection, findTally(pollId, payer.publicKey))).to
      .be.null;

    await sendIx(
      await createTally({
        initialTallyHash: toBytesBE32(tallyHashOld),
        payer: payer.publicKey,
        pollId,
      }),
    );

    await expect(sendIx(
      await finishTally({
        pollId,
        payer: payer.publicKey,
        tally: tally.slice(0, nChoices),
        tallySalt: tallySaltNew,
      }),
    )).to.rejectedWith("IncorrectTally");

    const serializedProof = compressProof(proof);
    await sendIx(
      await tallyBatch({
        pollId,
        proof: {
          a: Array.from(serializedProof.a),
          b: Array.from(serializedProof.b),
          c: Array.from(serializedProof.c),
        },
        owner: payer.publicKey,
        rootNew: toBytesBE32(rootNew),
        cumulativeMsgHashNew: toBytesBE32(cumulativeMsgHashNew),
        tallyHashNew: toBytesBE32(tallyHashNew),
      }),
    );

    const fakeTally = tally.slice(0, nChoices);
    fakeTally[0] += 1n;
    await expect(sendIx(
      await finishTally({
        pollId,
        payer: payer.publicKey,
        tally: fakeTally,
        tallySalt: tallySaltNew,
      }),
    )).to.rejectedWith("IncorrectTally");

    await sendIx(
      await finishTally({
        pollId,
        payer: payer.publicKey,
        tally: tally.slice(0, nChoices),
        tallySalt: tallySaltNew,
      }),
    );

    expect(await fetchTally(connection, findTally(pollId, payer.publicKey))).to
      .be.null;

    const poll = await fetchPoll(connection, findPoll(pollId));
    if (!poll) throw new Error("Poll not initialized");
    expect(poll.tally.map(toBigint)).to.deep.equal(tally.slice(0, nChoices));
  });

  test("withdrawPoll", async () => {
    await sendIx(
      await withdrawPoll({
        id: pollId,
        feeDestination: pollFeeDestination.publicKey,
      }),
    );
  });
});
