pragma circom 2.2.2;

include "./PoseidonHasher.circom";
include "./MerkleTreeInclusionProof.circom";
include "./EdDSAPoseidonVerifier.circom";
include "babyjub.circom";
include "escalarmulfix.circom";
include "escalarmulany.circom";
include "bitify.circom";
include "comparators.circom";

template Vote(DEPTH) {
    var LIMBS = 4; // nullifier, choice, revotingKeyOld, revotingKeyNew
    var PAD = (LIMBS % 3 == 0) ? LIMBS : LIMBS + (3 - (LIMBS % 3));
    var CT_LEN = PAD + 1;

    // ---- Public ----
    signal input censusRoot;
    signal input pollId;
    signal input nChoices;
    signal input tallierPk[2];
    signal input relayerId;
    signal output msgHash;
    signal output relayerNuHash;

    // ---- Private ----
    signal input voterPk[2];
    signal input path[DEPTH];
    signal input pathPos[DEPTH];
    signal input choice;
    signal input revotingKeyNew;
    signal input revotingKeyOld;

    signal input sigR[2];
    signal input sigS;

    signal input ephSk;
    signal input nonce;
    signal input ciphertext[CT_LEN];

    signal root <== MerkleTreeInclusionProof(DEPTH)(
        leaf <== PoseidonHasher(2)(voterPk),
        path_indices <== pathPos,
        path_elements <== path
    );
    root === censusRoot;

    // name = "MootVote"; sum([ord(ch) << (8 * (len(name) - 1 - i)) for i, ch in enumerate(name)])
    var PLATFORM_NAME = 5579801008792368229;
    signal sigValid <== EdDSAPoseidonVerifier()(
        publicKeyX <== voterPk[0],
        publicKeyY <== voterPk[1],
        signatureScalar <== sigS,
        signaturePointX <== sigR[0],
        signaturePointY <== sigR[1],
        messageHash <== PoseidonHasher(2)([PLATFORM_NAME, pollId])
    );
    sigValid === 1;

    signal sigHash <== PoseidonHasher(3)([
        sigS,
        sigR[0],
        sigR[1]
    ]);

    signal isRevotingKeyNewZero <== IsZero()(revotingKeyNew);
    isRevotingKeyNewZero === 0;
    signal isRevotingKeyNewEqualOld <== IsEqual()([revotingKeyNew, revotingKeyOld]);
    isRevotingKeyNewEqualOld === 0;

    signal nu <== PoseidonHasher(1)([sigHash]);

    var CHOICE_BITS = 16;
    assert(nChoices < 1 << CHOICE_BITS);
    signal inRange <== LessEqThan(CHOICE_BITS)([choice, nChoices]);
    inRange === 1;

    var BASE_X = 5299619240641551281634865583518297030282874472190772894086521144482721001553;
    var BASE_Y = 16950150798460657717958625567821834550301663161624707787222815936182638968203;

    signal ephSkBits[253] <== Num2Bits(253)(ephSk);
    signal ephPk[2] <== EscalarMulFix(253, [BASE_X, BASE_Y])(ephSkBits);
    signal sharedKey[2] <== EscalarMulAny(253)(ephSkBits, tallierPk);

    signal plaintext[LIMBS];
    plaintext[0] <== nu;
    plaintext[1] <== choice;
    plaintext[2] <== PoseidonHasher(1)([revotingKeyOld]);
    plaintext[3] <== PoseidonHasher(1)([revotingKeyNew]);

    component dec = PoseidonDecrypt(LIMBS);
    dec.key <== sharedKey;
    dec.nonce <== nonce;
    dec.ciphertext <== ciphertext;
    for (var i = 0; i < LIMBS; i++) {
        dec.decrypted[i] === plaintext[i];
    }

    component msgHasher = PoseidonHasher(3 + CT_LEN);
    msgHasher.inputs[0] <== ephPk[0];
    msgHasher.inputs[1] <== ephPk[1];
    msgHasher.inputs[2] <== nonce;
    for (var i = 0; i < CT_LEN; i++) {
        msgHasher.inputs[3 + i] <== ciphertext[i];
    }
    msgHash <== msgHasher.out;

    signal relayerNu <== PoseidonHasher(2)([sigHash, relayerId]);
    signal relayerNuHashRaw <== PoseidonHasher(2)([relayerNu, msgHash]);
    signal relayerIsNotProvided <== IsZero()(relayerId);
    relayerNuHash <== relayerNuHashRaw * (1 - relayerIsNotProvided);
}
