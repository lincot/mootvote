#![expect(clippy::diverging_sub_expression)]
#![expect(clippy::too_many_arguments)]
#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;

use crate::{instructions::*, state::*};

pub mod error;
mod instructions;
pub mod state;
mod utils;
pub mod vk;

declare_id!("Re1ayvvPwJq5NME13UGtyt7X7nC9Zr8PfQdQthquks9");

/// The list of allowed programs. Relayer has to trust the program, otherwise
/// a transaction could fail and waste network fee. Transaction simulation
/// wouldn't help with that.
const ALLOWED_PROGRAMS: &[Pubkey] = &[pubkey!("MootuH214qRLx112xw76ybo1VxwZsQAR539m3Bou6GY")];

#[program]
pub mod zk_relayer {
    use super::*;

    #[instruction(discriminator = 0u8)]
    pub fn initialize(
        ctx: Context<Initialize>,
        relayer: Relayer,
        admin: Pubkey,
        fee: u64,
    ) -> Result<()> {
        instructions::initialize(ctx, relayer, admin, fee)
    }

    #[instruction(discriminator = 1u8)]
    pub fn update_config(
        ctx: Context<UpdateConfig>,
        relayer: Relayer,
        admin: Pubkey,
        fee: u64,
    ) -> Result<()> {
        instructions::update_config(ctx, relayer, admin, fee)
    }

    #[instruction(discriminator = 2u8)]
    pub fn create_relayer_state(
        ctx: Context<CreateRelayerState>,
        target_program: Pubkey,
        state_id: u64,
        msg_limit: u64,
        end_time: u64,
    ) -> Result<()> {
        instructions::create_relayer_state(ctx, target_program, state_id, msg_limit, end_time)
    }

    #[instruction(discriminator = 3u8)]
    pub fn relay<'info>(
        ctx: Context<'info, Relay<'info>>,
        state_id: u64,
        proof: CompressedProof,
        root_state_new: [u8; 32],
        msg_hash: [u8; 32],
        discriminator: u8,
        nu_hash: [u8; 32],
        data: Vec<u8>,
    ) -> Result<()> {
        instructions::relay(
            ctx,
            state_id,
            proof,
            root_state_new,
            msg_hash,
            discriminator,
            nu_hash,
            data,
        )
    }

    // TODO close_relayer_state
}
