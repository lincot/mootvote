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

    component tallyHashOldHasher = PoseidonHasher(1 + MAX_CHOICES);
    tallyHashOldHasher.inputs[0] <== tallySaltOld;
    for (var i = 0; i < MAX_CHOICES; i++) {
        tallyHashOldHasher.inputs[1 + i] <== tallyOld[i];
    }
    tallyHashOld <== tallyHashOldHasher.out;

    signal isFirstBatch <== IsZero()(cumulativeMsgHashOld);
    for (var i = 0; i < MAX_CHOICES; i++) {
        isFirstBatch * tallyOld[i] === 0;
    }

    signal rootAcc[MAX_BATCH + 1];
    rootAcc[0] <== rootOld;
    signal cumulativeMsgHashAcc[MAX_BATCH + 1];
    cumulativeMsgHashAcc[0] <== cumulativeMsgHashOld;
    signal tallyAcc[MAX_BATCH + 1][MAX_CHOICES];
    tallyAcc[0] <== tallyOld;

    component tallySingle[MAX_BATCH];
    for (var i = 0; i < MAX_BATCH; i++) {
        (rootAcc[i + 1], cumulativeMsgHashAcc[i + 1], tallyAcc[i + 1]) <==
            TallySingle(DEPTH, MAX_CHOICES)(
                enabled <== LessThan(16)([i, batchLen]),
                rootOld <== rootAcc[i],
                cumulativeMsgHashOld <== cumulativeMsgHashAcc[i],
                tallyOld <== tallyAcc[i],
                tallierSk <== tallierSk,
                ephPk <== ephPk[i],
                nonce <== nonce[i],
                ciphertext <== ciphertext[i],
                siblings <== siblings[i],
                choiceOld <== choiceOld[i],
                revotingKeyOld <== revotingKeyOld[i],
                noAux <== noAux[i],
                auxKey <== auxKey[i],
                auxValue <== auxValue[i],
                wasLeafEmpty <== wasLeafEmpty[i]
            );
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

template TallySingle(DEPTH, MAX_CHOICES) {
    var LIMBS = 4; // nullifier, choice, revotingKeyOld, revotingKeyNew
    var PAD = (LIMBS % 3 == 0) ? LIMBS : LIMBS + (3 - (LIMBS % 3));
    var CT_LEN = PAD + 1;

    signal input enabled;

    signal input rootOld;
    signal input cumulativeMsgHashOld;
    signal input tallyOld[MAX_CHOICES];

    signal input tallierSk; // Tallier secret scalar

    signal input ephPk[2];
    signal input nonce;
    signal input ciphertext[CT_LEN];

    signal input siblings[DEPTH];
    signal input choiceOld;
    signal input revotingKeyOld;

    signal input noAux;
    signal input auxKey;
    signal input auxValue;
    signal input wasLeafEmpty;

    signal output rootNew;
    signal output cumulativeMsgHashNew;
    signal output tallyNew[MAX_CHOICES];

    component msgHasher = PoseidonHasher(3 + CT_LEN);
    msgHasher.inputs[0] <== ephPk[0];
    msgHasher.inputs[1] <== ephPk[1];
    msgHasher.inputs[2] <== nonce;
    for (var k = 0; k < CT_LEN; k++) {
        msgHasher.inputs[3 + k] <== ciphertext[k];
    }

    signal decrypted[PAD] <== PoseidonDecrypt(LIMBS)(
        key <== Ecdh()(tallierSk, ephPk),
        nonce <== nonce,
        ciphertext <== ciphertext
    );
    signal nu <== decrypted[0];
    signal choice <== decrypted[1];
    signal revotingKeyOldFromMsg <== decrypted[2];
    signal revotingKeyNew <== decrypted[3];

    signal leafOld <== PoseidonHasher(2)([choiceOld, revotingKeyOld]);
    signal leafNew <== PoseidonHasher(2)([choice, revotingKeyNew]);

    signal revotingKeyMatches <== IsEqual()([revotingKeyOldFromMsg, revotingKeyOld]);
    signal {binary} isVoteValid <== enabled * revotingKeyMatches;

    signal nuLo <-- nu & ((1 << DEPTH) - 1);
    signal nuHi <-- nu >> DEPTH;
    // Num2Bits_strict in SMTVerifier asserts that nuLo is DEPTH bits wide.
    nu === nuLo + nuHi * (1 << DEPTH);

    // If leaf was empty, old choice should be 0.
    wasLeafEmpty * choiceOld === 0;

    SMTVerifier(DEPTH)(
        enabled <== enabled,
        root <== rootOld,
        siblings <== siblings,
        oldKey <== auxKey,
        oldValue <== auxValue,
        isOld0 <== noAux,
        key <== nuLo,
        value <== leafOld,
        fnc <== wasLeafEmpty
    );

    rootNew <== SMTProcessor(DEPTH)(
        oldRoot <== rootOld,
        siblings <== siblings,
        oldKey <== auxKey,
        oldValue <== auxValue,
        isOld0 <== noAux,
        newKey <== nuLo,
        newValue <== leafNew,
        // (1, 0) -> insert, (0, 1) -> update, (0, 0) -> no-op
        fnc <== [
            isVoteValid * wasLeafEmpty,
            isVoteValid * (1 - wasLeafEmpty)
        ]
    );

    for (var t = 0; t < MAX_CHOICES; t++) {
        tallyNew[t] <== TallyChoice()(
            enabled <== isVoteValid,
            choiceOld <== choiceOld,
            choiceNew <== choice,
            choiceNumber <== t + 1,
            tallyOld <== tallyOld[t]
        );
    }

    signal cumulativeMsgHash <== PoseidonHasher(2)([cumulativeMsgHashOld, msgHasher.out]);
    cumulativeMsgHashNew <== cumulativeMsgHashOld
            + enabled * (cumulativeMsgHash - cumulativeMsgHashOld);
}

template TallyChoice() {
    signal input {binary} enabled;
    signal input choiceOld;
    signal input choiceNew;
    signal input choiceNumber;
    signal input tallyOld;
    signal output tallyNew;

    signal isOldChoice <== IsEqual()([choiceOld, choiceNumber]);
    signal isNewChoice <== IsEqual()([choiceNew, choiceNumber]);

    tallyNew <== tallyOld + enabled * (isNewChoice - isOldChoice);
}
