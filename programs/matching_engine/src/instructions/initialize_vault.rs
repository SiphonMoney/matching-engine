use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount, Mint};

use crate::VaultState;

const VAULT_SEED: &[u8] = b"vault";
const VAULT_STATE_SEED: &[u8] = b"vault_state";

pub fn initialize_user_vault(
    ctx: Context<InitializeUserVault>,
) -> Result<()> {

    let vault_state = &mut ctx.accounts.vault_state;
    vault_state.user = ctx.accounts.user.key();
    vault_state.mint = ctx.accounts.mint.key();
    vault_state.vault = ctx.accounts.vault.key();
    vault_state.locked_amount = 0;
    vault_state.num_active_orders = 0;
    vault_state.bump = ctx.bumps.vault_state;

    Ok(())
}

#[derive(Accounts)]
pub struct InitializeUserVault<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    
    pub mint: Account<'info, Mint>,
    
    #[account(
        init,
        payer = user,
        seeds = [VAULT_SEED, mint.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = vault_authority,
    )]
    pub vault: Account<'info, TokenAccount>,

    #[account(
        init,
        payer = user,
        space = 8 + VaultState::INIT_SPACE,
        seeds = [VAULT_STATE_SEED, mint.key().as_ref(), user.key().as_ref()],
        bump,
    )]
    pub vault_state: Box<Account<'info, VaultState>>,
    
    /// CHECK: PDA authority for vault
    #[account(
        seeds = [b"vault_authority"],
        bump,
    )]
    pub vault_authority: UncheckedAccount<'info>,
    
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}