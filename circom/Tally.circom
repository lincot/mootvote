pragma circom 2.2.2;

include "./PoseidonHasher.circom";
include "smt/smtverifier.circom";
include "smt/smtprocessor.circom";
include "babyjub.circom";
include "escalarmulany.circom";
include "bitify.circom";
include "poseidon-cipher.circom";
include "ecdh.circom";

template Tally(DEPTH, MAX_CHOICES, MAX_BATCH) {
    var LIMBS = 4; // nullifier, choice, revotingKeyOld, revotingKeyNew
    var PAD = (LIMBS % 3 == 0) ? LIMBS : LIMBS + (3 - (LIMBS % 3));
    var CT_LEN = PAD + 1;

    // ---- Public ----
    signal input rootOld;
    signal input cumulativeMsgHashOld;
    signal output tallyHashOld;
    signal output rootNew;
    signal output cumulativeMsgHashNew;
    signal output tallyHashNew;

    // ---- Private ----
    signal input batchLen;
    signal input tallyOld[MAX_CHOICES];
    signal input tallySaltOld;
    signal input tallySaltNew; // should be different for the last batch
    signal input tallierSk; // Tallier secret scalar

    signal input ephPk[MAX_BATCH][2];
    signal input nonce[MAX_BATCH];
    signal input ciphertext[MAX_BATCH][CT_LEN];

    signal input siblings[MAX_BATCH][DEPTH];
    signal input choiceOld[MAX_BATCH];
    signal input revotingKeyOld[MAX_BATCH];

    signal input noAux[MAX_BATCH];
    signal input auxKey[MAX_BATCH];
    signal input auxValue[MAX_BATCH];
    signal input wasLeafEmpty[MAX_BATCH];

    signal leafOld[MAX_BATCH];
    signal leafNew[MAX_BATCH];
    signal revotingKeysEqual[MAX_BATCH];

    signal {binary} isSlotEnabled[MAX_BATCH];

    component dec[MAX_BATCH];

    signal nu[MAX_BATCH];
    signal choice[MAX_BATCH];
    signal revotingKeyOldFromMsg[MAX_BATCH];
    signal revotingKeyNew[MAX_BATCH];

    signal idxBits[MAX_BATCH][DEPTH];
    signal nuLo[MAX_BATCH];
    signal nuHi[MAX_BATCH];

    signal cumulativeMsgHashAcc[MAX_BATCH + 1];
    signal cumulativeMsgHashNext[MAX_BATCH];
    signal tallyAcc[MAX_BATCH + 1][MAX_CHOICES];
    signal rootAcc[MAX_BATCH + 1];

    component msgHasher[MAX_BATCH];

    component isNewChoice[MAX_BATCH][MAX_CHOICES];
    component isOldChoice[MAX_BATCH][MAX_CHOICES];

    signal indexLessThan[MAX_BATCH];

    component tallyHashOldHasher = PoseidonHasher(1 + MAX_CHOICES);
    tallyHashOldHasher.inputs[0] <== tallySaltOld;
    for (var i = 0; i < MAX_CHOICES; i++) {
        tallyHashOldHasher.inputs[1 + i] <== tallyOld[i];
    }
    tallyHashOld <== tallyHashOldHasher.out;

    cumulativeMsgHashAcc[0] <== cumulativeMsgHashOld;
    tallyAcc[0] <== tallyOld;
    rootAcc[0] <== rootOld;

    signal isFirstBatch <== IsZero()(cumulativeMsgHashOld);
    for (var i = 0; i < MAX_CHOICES; i++) {
        isFirstBatch * tallyOld[i] === 0;
    }

    for (var i = 0; i < MAX_BATCH; i++) {
        msgHasher[i] = PoseidonHasher(3 + CT_LEN);
        msgHasher[i].inputs[0] <== ephPk[i][0];
        msgHasher[i].inputs[1] <== ephPk[i][1];
        msgHasher[i].inputs[2] <== nonce[i];
        for (var k = 0; k < CT_LEN; k++) {
            msgHasher[i].inputs[3 + k] <== ciphertext[i][k];
        }

        cumulativeMsgHashNext[i] <== PoseidonHasher(2)([cumulativeMsgHashAcc[i], msgHasher[i].out]);

        dec[i] = PoseidonDecrypt(LIMBS);
        dec[i].key <== Ecdh()(tallierSk, ephPk[i]);
        dec[i].nonce <== nonce[i];
        dec[i].ciphertext <== ciphertext[i];
        nu[i] <== dec[i].decrypted[0];
        choice[i] <== dec[i].decrypted[1];
        revotingKeyOldFromMsg[i] <== dec[i].decrypted[2];
        revotingKeyNew[i] <== dec[i].decrypted[3];

        leafOld[i] <== PoseidonHasher(2)([choiceOld[i], revotingKeyOld[i]]);
        leafNew[i] <== PoseidonHasher(2)([choice[i], revotingKeyNew[i]]);

        indexLessThan[i] <== LessThan(16)([i, batchLen]);
        revotingKeysEqual[i] <== IsEqual()([revotingKeyOldFromMsg[i], revotingKeyOld[i]]);
        isSlotEnabled[i] <== indexLessThan[i] * revotingKeysEqual[i];

        nuLo[i] <-- nu[i] & ((1 << DEPTH) - 1);
        nuHi[i] <-- nu[i] >> DEPTH;
        idxBits[i] <== Num2Bits(DEPTH)(nuLo[i]); // Num2Bits asserts that lo is DEPTH bits
        nu[i] === nuLo[i] + nuHi[i] * (1 << DEPTH);

        // if leaf was empty, old choice should be 0
        wasLeafEmpty[i] * choiceOld[i] === 0;

        SMTVerifier(DEPTH)(
            enabled <== indexLessThan[i],
            root <== rootAcc[i],
            siblings <== siblings[i],
            oldKey <== auxKey[i], // not required for inclusion
            oldValue <== auxValue[i], // not required for inclusion
            isOld0 <== noAux[i], // not required for inclusion
            key <== nuLo[i],
            value <== leafOld[i], // not required for non-inclusion
            fnc <== wasLeafEmpty[i]
        );

        rootAcc[i + 1] <== SMTProcessor(DEPTH)(
            oldRoot <== rootAcc[i],
            siblings <== siblings[i],
            oldKey <== auxKey[i],
            oldValue <== auxValue[i],
            isOld0 <== noAux[i],
            newKey <== nuLo[i],
            newValue <== leafNew[i],
            // (1, 0) -> insert, (0, 1) -> update, (0, 0) -> no-op
            fnc <== [
                isSlotEnabled[i] * wasLeafEmpty[i],
                isSlotEnabled[i] * (1 - wasLeafEmpty[i])
            ]
        );

        for (var t = 0; t < MAX_CHOICES; t++) {
          isNewChoice[i][t] = IsEqual();
          isNewChoice[i][t].in[0] <== choice[i];
          isNewChoice[i][t].in[1] <== t + 1;

          isOldChoice[i][t] = IsEqual();
          isOldChoice[i][t].in[0] <== choiceOld[i];
          isOldChoice[i][t].in[1] <== t + 1;

          tallyAcc[i + 1][t] <== tallyAcc[i][t] + isSlotEnabled[i] * (isNewChoice[i][t].out - isOldChoice[i][t].out);
        }

        cumulativeMsgHashAcc[i + 1] <== cumulativeMsgHashAcc[i]
                + indexLessThan[i] * (cumulativeMsgHashNext[i] - cumulativeMsgHashAcc[i]);
    }

    component tallyHashNewHasher = PoseidonHasher(1 + MAX_CHOICES);
    tallyHashNewHasher.inputs[0] <== tallySaltNew;
    for (var i = 0; i < MAX_CHOICES; i++) {
        tallyHashNewHasher.inputs[1 + i] <== tallyAcc[MAX_BATCH][i];
    }

    cumulativeMsgHashNew <== cumulativeMsgHashAcc[MAX_BATCH];
    tallyHashNew <== tallyHashNewHasher.out;
    rootNew <== rootAcc[MAX_BATCH];
}
