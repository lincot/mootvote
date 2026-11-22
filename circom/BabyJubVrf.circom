pragma circom 2.2.2;

include "./PoseidonHasher.circom";
include "pointbits.circom";
include "escalarmulany.circom";
include "escalarmulfix.circom";

// With G = Base8 and H = hash_to_curve(pk, scope), prove log_G(8*pk) = log_H(8*gamma).
// Clearing both points puts the proof in the prime-order subgroup. Hashing 8*gamma
// makes the seed independent of the proof nonce and of the encoding's torsion component.
template BabyJubVrf() {
    signal input pk[2];
    signal input scope;
    signal input gamma[2];
    signal input challenge;
    signal input response;
    signal output seed;

    var BASE8[2] = [
        5299619240641551281634865583518297030282874472190772894086521144482721001553,
        16950150798460657717958625567821834550301663161624707787222815936182638968203
    ];
    var ORDER = 2736030358979909402780800718157159386076813972158567259200215660948447373041;
    signal pub8[2] <== VrfClearCofactor()(pk);
    signal output8[2] <== VrfClearCofactor()(gamma);

    signal mapped[2][2];
    signal u[2];
    for (var i = 0; i < 2; i++) {
        u[i] <== PoseidonHasher(5)([0x424a4a5f5652465f4d41505f5631, pk[0], pk[1], scope, i]);
        mapped[i] <== VrfElligator2()(u[i]);
    }
    signal sum[2];
    (sum[0], sum[1]) <== BabyAdd()(mapped[0][0], mapped[0][1], mapped[1][0], mapped[1][1]);
    signal base[2] <== VrfClearCofactor()(sum);

    signal c[128] <== Num2Bits(128)(challenge);
    signal s[251] <== Num2Bits(251)(response);
    signal canonical <== LessThan(251)([response, ORDER]);
    canonical === 1;
    signal sg[2] <== EscalarMulFix(251, BASE8)(s);
    signal sh[2] <== EscalarMulAny(251)(s, base);
    signal cp[2] <== EscalarMulAny(128)(c, pub8);
    signal cy[2] <== EscalarMulAny(128)(c, output8);
    signal a[2];
    signal b[2];
    (a[0], a[1]) <== BabyAdd()(sg[0], sg[1], cp[0], cp[1]);
    (b[0], b[1]) <== BabyAdd()(sh[0], sh[1], cy[0], cy[1]);
    signal transcript <== PoseidonHasher(10)([0x424a4a5f5652465f444c45515f5631, scope,
        pk[0], pk[1], output8[0], output8[1], a[0], a[1], b[0], b[1]]);
    signal bits[254] <== Num2Bits_strict()(transcript);
    var low[128];
    for (var i = 0; i < 128; i++) low[i] = bits[i];
    signal expected <== Bits2Num(128)(low);
    challenge === expected;
    seed <== PoseidonHasher(3)([0x424a4a5f5652465f4f55545f5631, output8[0], output8[1]]);
}

template VrfClearCofactor() {
    signal input p[2];
    signal output out[2];
    component check = BabyCheck();
    check.x <== p[0];
    check.y <== p[1];
    signal dbl[4][2];
    dbl[0] <== p;
    for (var i = 0; i < 3; i++) {
        (dbl[i+1][0], dbl[i+1][1]) <== BabyDbl()(dbl[i][0], dbl[i][1]);
    }
    out <== dbl[3];
    signal identity <== IsZero()(out[0]);
    identity === 0;
}

// RFC 9380 section 6.7.1 on BabyJubJub's Montgomery model, J=168698, K=1, Z=5.
template VrfElligator2() {
    signal input u;
    signal output out[2];
    // For nonzero u exactly one candidate has a square RHS. Map zero to one
    // to avoid the Montgomery two-torsion point in the Edwards conversion.
    signal zero <== IsZero()(u);
    signal t <== u + zero;
    signal z <== 5*t*t;
    signal x1;
    x1 <-- -168698 / (1 + z);
    x1*(1+z) === -168698;
    signal xx <== x1*(x1+168698);
    signal gx <== x1*(xx+1);
    signal first;
    first <-- sqrt(gx) != 0;
    first*(1-first) === 0;
    signal x <== -168698-x1 + first*(2*x1+168698);
    signal gx2 <== z*gx;
    signal yy <== gx2 + first*(gx-gx2);
    signal y;
    var root = sqrt(yy);
    y <-- ((root & 1) == first) ? root : -root;
    y*y === yy;
    signal yBits[254] <== Num2Bits_strict()(y);
    yBits[0] === first;
    out <== Montgomery2Edwards()([x,y]);
}
