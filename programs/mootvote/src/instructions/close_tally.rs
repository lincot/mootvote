use crate::state::*;
use anchor_lang::prelude::*;

#[derive(Accounts)]
#[instruction(poll_id: u64)]
pub struct CloseTally<'info> {
    #[account(mut)]
    owner: Signer<'info>,
    #[account(
        mut,
        close = owner,
        seeds = [&b"TALLY"[..], &poll_id.to_le_bytes(), &owner.key.to_bytes()],
        bump,
    )]
    tally: Account<'info, Tally>,
}

pub fn close_tally(_ctx: Context<CloseTally>, _poll_id: u64) -> Result<()> {
    Ok(())
}
