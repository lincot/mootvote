## smt-circom

This crate provides a Sparse Merkle Tree implementation in Rust using Poseidon
hash, compatible with circom zero-knowledge proofs.

It can be used with an in-memory node store, a persistent RocksDB store, or
a custom store.

The implementation is inspired by
[@iden3/js-merkletree](https://github.com/iden3/js-merkletree).

## Example usage

```rust
use smt_circom::{store::MemStore, SparseMerkleTree};

let mut tree = SparseMerkleTree::<64, _>::new(MemStore::new())?;
assert_eq!(tree.root()?, [0; 32]);
let (idx, new_value) = ([1; 32], [2; 32]);
let proof = tree.get_proof(idx);
assert!(!proof.membership);
tree.add_or_update(idx, new_value)?;
```

## Benchmark results

Here's the result of running a benchmark on an AMD Ryzen 5 5600H, comparing
smt-circom against @iden3/js-merkletree (Node.js), both using trees with
depth 64 and an in-memory store. It first adds 10 random leafs, then gets
inclusion proofs for these 10 leafs (both benchmarks use the same seeded rng).

|               | Add 10 leafs | Get 10 proofs |
| ------------- | ------------ | ------------- |
| smt-circom    | 1.74 ms      | 0.00174 ms    |
| js-merkletree | 13.5 ms      | 1.05 ms       |
