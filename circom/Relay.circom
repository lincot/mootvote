pragma circom 2.2.2;

include "./PoseidonHasher.circom";
include "smt/smtverifier.circom";
include "smt/smtprocessor.circom";
include "babyjub.circom";
include "escalarmulany.circom";
include "bitify.circom";
include "poseidon-cipher.circom";
include "ecdh.circom";

template Relay(DEPTH) {
    // ---- Public ----
    signal input msgHash;
    signal input msgLimit;
    signal output rootStateOld;
    signal output rootStateNew;
    signal output nuHash;

    // ---- Private ----
    signal input nu;

    signal input rootQuotaOld;
    signal input rootUniqOld;

    signal input countOld;
    signal input siblingsQuota[DEPTH];
    signal input noAuxQuota;
    signal input auxKeyQuota;
    signal input auxValueQuota;

    signal input siblingsUniq[DEPTH];
    signal input noAuxUniq;
    signal input auxKeyUniq;
    signal input auxValueUniq;

    signal isWithinQuota <== LessThan(16)([countOld, msgLimit]);
    isWithinQuota === 1;

    signal nuLo <-- nu & ((1 << DEPTH) - 1);
    signal nuHi <-- nu >> DEPTH;
    signal idxBits[DEPTH] <== Num2Bits(DEPTH)(nuLo); // Num2Bits asserts that lo is DEPTH bits
    nu === nuLo + nuHi * (1 << DEPTH);

    signal isPrevEmpty <== IsZero()(countOld);

    SMTVerifier(DEPTH)(
        enabled <== 1,
        root <== rootQuotaOld,
        siblings <== siblingsQuota,
        oldKey <== auxKeyQuota, // not required for inclusion
        oldValue <== auxValueQuota, // not required for inclusion
        isOld0 <== noAuxQuota, // not required for inclusion
        key <== nuLo,
        value <== countOld, // not required for non-inclusion
        fnc <== isPrevEmpty
    );

    signal rootQuotaNew <== SMTProcessor(DEPTH)(
        oldRoot <== rootQuotaOld,
        siblings <== siblingsQuota,
        oldKey <== auxKeyQuota,
        oldValue <== auxValueQuota,
        isOld0 <== noAuxQuota,
        newKey <== nuLo,
        newValue <== countOld + 1,
        // (1, 0) -> insert, (0, 1) -> update, (0, 0) -> no-op
        fnc <== [isPrevEmpty, 1 - isPrevEmpty]
    );

    SMTVerifier(DEPTH)(
        enabled <== 1,
        root <== rootUniqOld,
        siblings <== siblingsUniq,
        oldKey <== auxKeyUniq,
        oldValue <== auxValueUniq,
        isOld0 <== noAuxUniq,
        key <== msgHash,
        value <== 0,
        fnc <== 1
    );

    signal rootUniqNew <== SMTProcessor(DEPTH)(
        oldRoot <== rootUniqOld,
        siblings <== siblingsUniq,
        oldKey <== auxKeyUniq,
        oldValue <== auxValueUniq,
        isOld0 <== noAuxUniq,
        newKey <== msgHash,
        newValue <== 1,
        // (1, 0) -> insert
        fnc <== [1, 0]
    );

    nuHash <== PoseidonHasher(2)([nu, msgHash]);
    rootStateOld <== PoseidonHasher(2)([rootQuotaOld, rootUniqOld]);
    rootStateNew <== PoseidonHasher(2)([rootQuotaNew, rootUniqNew]);
}
