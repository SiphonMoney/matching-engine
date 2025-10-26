use anchor_lang::prelude::*;
const ORDER_BOOK_STATE_SEED: &[u8] = b"order_book_state";
use crate::{states::OrderBookState};

pub fn initialize(ctx: Context<Initialize>, backend_pubkey: [u8; 32], base_mint: Pubkey, quote_mint: Pubkey) -> Result<()> {
    let order_book_state = &mut ctx.accounts.orderbook_state;
    order_book_state.authority = ctx.accounts.authority.key();
    // order_book_state.orderbook_data = [0u8; 651]; 
    order_book_state.orderbook_data = [[0u8; 32]; 52];
    order_book_state.orderbook_nonce = 0;
    order_book_state.last_match_timestamp = Clock::get()?.unix_timestamp;
    order_book_state.bump = ctx.bumps.orderbook_state;
    order_book_state.backend_pubkey = backend_pubkey;
    order_book_state.base_mint = base_mint;
    order_book_state.quote_mint = quote_mint;
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
    pub system_program: Program<'info, System>,
}
