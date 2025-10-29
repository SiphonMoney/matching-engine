use anchor_lang::prelude::*;
const ORDER_BOOK_STATE_SEED: &[u8] = b"order_book_state";
use crate::{states::OrderBookState};
use anchor_spl::token::{Token, TokenAccount, Mint};

const VAULT_SEED: &[u8] = b"vault";

pub fn initialize(ctx: Context<Initialize>, backend_pubkey: [u8; 32], base_mint: Pubkey, quote_mint: Pubkey, callback_authority: Pubkey) -> Result<()> {
    let order_book_state = &mut ctx.accounts.orderbook_state;
    order_book_state.authority = ctx.accounts.authority.key();
    order_book_state.orderbook_data = [[0u8; 32]; 32];
    order_book_state.orderbook_nonce = 0;
    order_book_state.last_match_timestamp = Clock::get()?.unix_timestamp;
    order_book_state.bump = ctx.bumps.orderbook_state;
    order_book_state.backend_pubkey = backend_pubkey;
    order_book_state.base_mint = base_mint;
    order_book_state.quote_mint = quote_mint;
    
    // Callback server fields
    order_book_state.pending_finalization = false;
    order_book_state.pending_orderbook_hash = [0u8; 32];
    order_book_state.callback_authority = callback_authority; // Who can call finalize_submit_order
    
    Ok(())
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + OrderBookState::INIT_SPACE,
        seeds = [ORDER_BOOK_STATE_SEED],
        bump
    )]
    pub orderbook_state: Box<Account<'info, OrderBookState>>,

    /// CHECK: PDA authority for vault
    #[account(
        seeds = [b"vault_authority"],
        bump,
    )]
    pub vault_authority: UncheckedAccount<'info>,

    pub base_mint: Account<'info, Mint>,
    pub quote_mint: Account<'info, Mint>,
    
    #[account(
        init,
        payer = authority,
        seeds = [VAULT_SEED, base_mint.key().as_ref()],
        bump,
        token::mint = base_mint,
        token::authority = vault_authority,
    )]
    pub base_vault: Account<'info, TokenAccount>,

    #[account(
        init,
        payer = authority,
        seeds = [VAULT_SEED, quote_mint.key().as_ref()],
        bump,
        token::mint = quote_mint,
        token::authority = vault_authority,
    )]
    pub quote_vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}
