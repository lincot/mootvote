#![feature(test)]

extern crate test;
use core::array;
use rand_core::RngCore;
use rand_pcg::Pcg64Mcg;
use smt_circom::{store::MemStore, SparseMerkleTree};
use test::{black_box, Bencher};

fn gen_pairs<const N: usize>(rng: &mut impl RngCore) -> [[[u8; 32]; 2]; N] {
    array::from_fn(|_| {
        let mut k = [0u8; 32];
        rng.fill_bytes(&mut k[1..]);
        let mut v = [0u8; 32];
        rng.fill_bytes(&mut v[1..]);
        [k, v]
    })
}

const N: usize = 10;
const DEPTH: usize = 64;

#[bench]
fn bench_insert(bencher: &mut Bencher) {
    let mut rng = Pcg64Mcg::new(0xcafe_f00d_d15e_a5e5);
    let pairs = gen_pairs::<N>(&mut rng);
    bencher.iter(|| {
        let mut t = SparseMerkleTree::<DEPTH, _>::new(MemStore::new()).unwrap();
        for &[k, v] in black_box(&pairs) {
            let _ = black_box(t.add(k, v));
        }
    });
}

#[bench]
fn bench_proof(bencher: &mut Bencher) {
    let mut rng = Pcg64Mcg::new(0xcafe_f00d_d15e_a5e5);
    let pairs = gen_pairs::<N>(&mut rng);
    let mut t = SparseMerkleTree::<DEPTH, _>::new(MemStore::new()).unwrap();
    for &[k, v] in &pairs {
        let _ = t.add(k, v);
    }
    bencher.iter(|| {
        for &[k, _] in black_box(&pairs) {
            let _ = black_box(t.get_proof(k));
        }
    });
}
