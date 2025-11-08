use anchor_lang::{prelude::*, system_program};
const ORDER_BOOK_STATE_SEED: &[u8] = b"order_book_state";
use crate::{states::OrderBookState};
use anchor_spl::token::{Token, TokenAccount, Mint};
use crate::utils::*;
use crate::errors::ErrorCode;

const VAULT_SEED: &[u8] = b"vault";

pub fn initialize(ctx: Context<Initialize>, backend_pubkey: [u8; 32], base_mint: Pubkey, quote_mint: Pubkey) -> Result<()> {
    let order_book_state_loader = create_orderbook_state(
        &ctx.accounts.authority.to_account_info(),
        &ctx.accounts.orderbook_state.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
    )?;

    let order_book_state = &mut order_book_state_loader.load_init()?;
    order_book_state.authority = ctx.accounts.authority.key();
    // order_book_state.orderbook_data = [[0u8; 32]; 42];
    // order_book_state.orderbook_nonce = 0;
    // order_book_state.last_match_timestamp = Clock::get()?.unix_timestamp;
    order_book_state.backend_pubkey = backend_pubkey;
    order_book_state.base_mint = base_mint;
    order_book_state.quote_mint = quote_mint;
    order_book_state.total_orders_processed = 0;
    order_book_state.total_matches = 0;
    Ok(())
}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    // #[account(
    //     init,
    //     payer = authority,
    //     space = 8 + OrderBookState::INIT_SPACE,
    //     seeds = [ORDER_BOOK_STATE_SEED],
    //     bump
    // )]
    /// CHECK: Orderbook state, checked by the matching engine program.
    #[account(mut)]
    pub orderbook_state: UncheckedAccount<'info>,

    /// CHECK: PDA authority for vault
    #[account(
        seeds = [b"vault_authority"],
        bump,
    )]
    pub vault_authority: UncheckedAccount<'info>,

    pub base_mint: Box<Account<'info, Mint>>,
    pub quote_mint: Box<Account<'info, Mint>>,
    
    #[account(
        init,
        payer = authority,
        seeds = [VAULT_SEED, base_mint.key().as_ref()],
        bump,
        token::mint = base_mint,
        token::authority = vault_authority,
    )]
    pub base_vault: Box<Account<'info, TokenAccount>>,

    #[account(
        init,
        payer = authority,
        seeds = [VAULT_SEED, quote_mint.key().as_ref()],
        bump,
        token::mint = quote_mint,
        token::authority = vault_authority,
    )]
    pub quote_vault: Box<Account<'info, TokenAccount>>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn create_orderbook_state<'info>(
    payer: &AccountInfo<'info>,
    orderbook_state: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
) -> Result<AccountLoad<'info, OrderBookState>> {
    if orderbook_state.owner != &system_program::ID {
        return err!(ErrorCode::NotApproved);
    }

    let (expect_pda_address, bump) = Pubkey::find_program_address(
        &[ORDER_BOOK_STATE_SEED],
        &crate::id(),
    );

    if orderbook_state.key() != expect_pda_address {
        require_eq!(orderbook_state.is_signer, true);
    }

    token::create_or_allocate_account(
        &crate::id(),
        payer.to_account_info(),
        system_program.to_account_info(),
        orderbook_state.clone(),
        &[ORDER_BOOK_STATE_SEED, &[bump]],
        8 + OrderBookState::INIT_SPACE,
    )?;

    Ok(AccountLoad::<OrderBookState>::try_from_unchecked(
        &crate::id(),
        &orderbook_state,
    )?)
}
