
use crate::errors::ErrorCode;
use crate::states::*;
use crate::SignerAccount;
use crate::SubmitOrderCallback;
use crate::COMP_DEF_OFFSET_SUBMIT_ORDER;
use anchor_lang::prelude::*;
use anchor_spl::token::TokenAccount;
use anchor_spl::token_interface::Mint;
use arcium_anchor::prelude::*;
use arcium_client::idl::arcium::types::CallbackAccount;

const VAULT_SEED: &[u8] = b"vault";
const VAULT_STATE_SEED: &[u8] = b"vault_state";
const ORDERBOOK_SEED: &[u8] = b"order_book_state";

use crate::ID;
use crate::ID_CONST;

fn pubkey_to_u64_chunks(pubkey_bytes: &[u8; 32]) -> [u64; 4] {
    [
        u64::from_le_bytes(pubkey_bytes[0..8].try_into().unwrap()),
        u64::from_le_bytes(pubkey_bytes[8..16].try_into().unwrap()),
        u64::from_le_bytes(pubkey_bytes[16..24].try_into().unwrap()),
        u64::from_le_bytes(pubkey_bytes[24..32].try_into().unwrap()),
    ]
}

pub fn submit_order(
    ctx: Context<SubmitOrder>,
    amount: [u8; 32],
    price: [u8; 32],
    user_pubkey: [u8; 32], // x25519 public key
    order_type: u8, // 0 = buy, 1 = sell
    computation_offset: u64,
    order_id: u64,
    order_nonce: u128,
) -> Result<()> {
    // msg!("Program-side signer key received: {}", ctx.accounts.user.key());
    // let locked_amount = if order_type == 0 {
    //     u64::from_le_bytes(amount).checked_mul(u64::from_le_bytes(price)).ok_or(ErrorCode::Overflow)?
    // } else {
    //     u64::from_le_bytes(amount)
    // };

    // // Check vault has sufficient funds
    // let vault = &ctx.accounts.vault;

    // let locked_total = ctx.accounts.vault_state.locked_amount;

    // let available = vault
    //     .amount
    //     .checked_sub(locked_total)
    //     .ok_or(ErrorCode::InsufficientBalance)?;

    // msg!("available: {}", available);
    // msg!("locked_amount: {}", locked_amount);

    // require!(available >= locked_amount, ErrorCode::InsufficientBalance);


    // msg!("=== submitOrder Accounts ===");
    // msg!("User: {}", ctx.accounts.mxe_account.key());
    // msg!("Vault PDA: {}", ctx.accounts.base_mint.key());
    // msg!("Vault State PDA: {}", ctx.accounts.vault_state.key());
    // msg!("Order Account PDA: {}", ctx.accounts.order_account.key());
    // msg!("Orderbook PDA: {}", ctx.accounts.orderbook_state.key());


    // Populate order account
    let order_account = &mut ctx.accounts.order_account;
    order_account.order_id = order_id;
    order_account.user = ctx.accounts.user.key();
    order_account.order_type = order_type;
    order_account.status = 0; // Pending
    order_account.filled_amount = 0;
    order_account.timestamp = Clock::get()?.unix_timestamp;
    order_account.bump = ctx.bumps.order_account;

    // Update vault state
    ctx.accounts.vault_state.num_active_orders = ctx
        .accounts
        .vault_state
        .num_active_orders
        .checked_add(1)
        .ok_or(ErrorCode::Overflow)?;

    // Get user pubkey as bytes
    let user_pubkey_bytes = ctx.accounts.user.key().to_bytes();
    msg!("user_pubkey_bytes: {:?}", user_pubkey_bytes);
    // let user_chunks = pubkey_to_u64_chunks(&user_pubkey_bytes);


    ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;
    
    let args = vec![        // Enc<Shared, SensitiveOrderData> - encrypted amount & price
        Argument::ArcisPubkey(user_pubkey),
        Argument::PlaintextU128(order_nonce),
        Argument::EncryptedU64(amount), // Client encrypts this
        Argument::EncryptedU64(price),  // Client encrypts this
        // Enc<Mxe, OrderBook>

        Argument::PlaintextU128(ctx.accounts.orderbook_state.orderbook_nonce),
        Argument::Account(
            ctx.accounts.orderbook_state.key(),
            8 + 32,      // Offset: discriminator(8) + authority(32) = 40
            52 * 32,     // Size: 52 chunks × 32 bytes = 1312 bytes
        ),

        Argument::PlaintextU64(order_id),
        // // Pass [u8; 32] as 4x u64 chunks
        // Argument::PlaintextU64(user_chunks[0]),
        // Argument::PlaintextU64(user_chunks[1]),
        // Argument::PlaintextU64(user_chunks[2]),
        // Argument::PlaintextU64(user_chunks[3]),
        Argument::PlaintextU8(order_type),
        Argument::PlaintextU64(Clock::get()?.unix_timestamp as u64),
    ];

    queue_computation(
        ctx.accounts,
        computation_offset,
        args,
        None,
        vec![SubmitOrderCallback::callback_ix(&[
            CallbackAccount {
                pubkey: ctx.accounts.orderbook_state.key(),
                is_writable: true,
            },
            CallbackAccount {
                pubkey: ctx.accounts.order_account.key(),
                is_writable: true,
            },
        ])],
    )?;

    // panic!("test");

    Ok(())
}

#[queue_computation_accounts("submit_order", user)]
#[derive(Accounts)]
#[instruction(
    amount: [u8; 32],
    price: [u8; 32],
    user_pubkey: [u8; 32],
    order_type: u8,
    computation_offset: u64,
    order_id: u64,
    order_nonce: u128,
)]
pub struct SubmitOrder<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(
        init_if_needed,
        space = 9,
        payer = user,
        seeds = [&SIGN_PDA_SEED],
        bump,
        address = derive_sign_pda!(),
    )]
    pub sign_pda_account: Account<'info, SignerAccount>, //====================
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>, //
    #[account(mut, address = derive_mempool_pda!())]
    /// CHECK: mempool_account, checked by the arcium program.
    pub mempool_account: UncheckedAccount<'info>, //
    #[account(mut, address = derive_execpool_pda!())]
    /// CHECK: executing_pool, checked by the arcium program.
    pub executing_pool: UncheckedAccount<'info>, //
    #[account(mut, address = derive_comp_pda!(computation_offset))]
    /// CHECK: computation_account, checked by the arcium program.
    pub computation_account: UncheckedAccount<'info>, // 
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_SUBMIT_ORDER))]
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>, //
    #[account(mut, address = derive_cluster_pda!(mxe_account))]
    pub cluster_account: Box<Account<'info, Cluster>>, //
    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Box<Account<'info, FeePool>>, // ==============================
    #[account(address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Account<'info, ClockAccount>, //
    pub system_program: Program<'info, System>, //
    pub arcium_program: Program<'info, Arcium>, //

    #[account(mut)]
    pub base_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        seeds = [VAULT_SEED, base_mint.key().as_ref(), user.key().as_ref()],
        bump,
    )]
    pub vault: Account<'info, TokenAccount>,

    #[account(
        init_if_needed,
        payer = user,
        space = 8 + OrderAccount::INIT_SPACE,
        seeds = [
            b"order",
            order_id.to_le_bytes().as_ref(),
            user.key().as_ref(),
        ],
        bump,
    )]
    pub order_account: Box<Account<'info, OrderAccount>>,
    #[account(
        mut,
        seeds = [VAULT_STATE_SEED, base_mint.key().as_ref(), user.key().as_ref()],
        bump = vault_state.bump,
    )]
    pub vault_state: Box<Account<'info, VaultState>>,

    #[account(
        mut,
        seeds = [ORDERBOOK_SEED],
        bump = orderbook_state.bump,
    )]
    pub orderbook_state: Box<Account<'info, OrderBookState>>,
}

#[event]
pub struct OrderSubmittedEvent {
    pub user: Pubkey,
    pub order_id: u64,
    pub computation_offset: u64,
    pub locked_amount: u64,
    pub vault: Pubkey,
}
