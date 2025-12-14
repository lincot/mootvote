# MootVote

MootVote is an anonymous bribery-resistant voting platform,
powered by zk-SNARKs and Solana.

## compiling the circuits

For things to work, replace `Poseidon` with `PoseidonHasher` in
`node_modules/.pnpm/circomlib@2.0.5/node_modules/circomlib/circuits/smt/smthash_poseidon.circom`
and remove `../poseidon.circom` import. Then:

```sh
pnpm install
```

```sh
pnpm circomkit compile Vote && pnpm circomkit setup Vote
pnpm circomkit compile Tally && pnpm circomkit setup Tally
pnpm circomkit compile Relay && pnpm circomkit setup Relay
```

Export verifying key to put in `programs/mootvote/src/vk.rs` and
`programs/zk-relayer/src/vk.rs`:

```sh
pnpm exportVk
```

## testing

```sh
anchor test
```

or with the indexer:

```sh
anchor build
solana-test-validator \
  --reset \
  --warp-slot 32 \
  --deactivate-feature 9LZdXeKGeBV6hRLdxS1rHbHoEUsKqesCC2ZAPTPKJAbK \
  --bpf-program target/deploy/mootvote-keypair.json target/deploy/mootvote.so \
  --bpf-program target/deploy/zk_relayer-keypair.json target/deploy/zk_relayer.so

cargo run --package mootvote-indexer -- --config indexer/config.yml

anchor test --skip-local-validator --skip-deploy
```

## compiling relayer backend

```sh
mkdir build/Relay/Relay_cpp/cpp_dat
cp build/Relay/Relay_cpp/Relay.* build/Relay/Relay_cpp/cpp_dat/
cd relayer
cargo build --release
```

## testing over nginx

There is an HMR-compatible nginx configuration at `nginx/dev/nginx.conf`
ready to be put to `/etc/nginx/nginx.conf`. Then launch nginx and the services:

```sh
cd frontend
pnpm dev
```

```sh
cd indexer
cargo run -- --config config.yml
```

```sh
cd census-service
cargo run -- --config config.yml
```

```sh
cd relayer
RELAYER_SOLANA_KEYPAIR=YOURKEYPAIRBASE58 cargo run -- --config config.yml
```

And proceed to <http://127.0.0.1>.

## running relayer

```sh
RUSTFLAGS="-Lnative=target/release/build/rust-rapidsnark-*/out/rapidsnark/x86_64/" cargo build --release

LD_LIBRARY_PATH="$LD_LIBRARY_PATH:target/release/build/zk-relayer-backend-*/out/witnesscalc/package/lib/:target/release/build/rust-rapidsnark-*/out/rapidsnark/x86_64/" RELAYER_SOLANA_KEYPAIR=YOURKEYPAIRBASE58 target/release/zk-relayer-backend --config config.yml
```
