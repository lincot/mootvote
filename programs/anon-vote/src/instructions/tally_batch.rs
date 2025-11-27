use crate::{error::AnonVoteError, state::*, vk::VK_TALLY};
use anchor_lang::prelude::*;
use groth16_solana::groth16::Groth16Verifier;

#[derive(Accounts)]
pub struct TallyBatch<'info> {
    #[account(mut)]
    tally: Account<'info, Tally>,
}

pub fn tally_batch(
    ctx: Context<TallyBatch>,
    proof: CompressedProof,
    root_new: [u8; 32],
    cumulative_msg_hash_new: [u8; 32],
    tally_hash_new: [u8; 32],
) -> Result<()> {
    let tally = &mut ctx.accounts.tally;

    let proof = proof
        .decompress()
        .map_err(|_| AnonVoteError::ProofDecompressionError)?;
    let public_inputs = [
        tally.tally_hash,
        root_new,
        cumulative_msg_hash_new,
        tally_hash_new,
        tally.root,
        tally.cumulative_msg_hash,
    ];
    let mut v = Groth16Verifier::<6>::new(&proof.a, &proof.b, &proof.c, &public_inputs, &VK_TALLY)
        .map_err(|_| AnonVoteError::InvalidProof)?;
    v.verify().map_err(|_| AnonVoteError::InvalidProof)?;

    tally.root = root_new;
    tally.cumulative_msg_hash = cumulative_msg_hash_new;
    tally.tally_hash = tally_hash_new;

    Ok(())
}
