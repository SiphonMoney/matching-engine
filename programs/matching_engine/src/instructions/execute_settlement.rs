use crate::errors::ErrorCode;
use crate::states::*;
use crate::SignerAccount;
use crate::ExecuteSettlementCallback;
use crate::COMP_DEF_OFFSET_EXECUTE_SETTLEMENT;
use anchor_lang::prelude::*;
use anchor_spl::token::TokenAccount;
use anchor_spl::token_interface::Mint;
use arcium_anchor::prelude::*;
use arcium_client::idl::arcium::types::CallbackAccount;

use crate::ID;
use crate::ID_CONST;

const SETTLEMENT_BOT_PUBKEY: Pubkey = pubkey!("11111111111111111111111111111111");
// not the vault authority but a separate authority that can only execute settlements.
// the vault authority is the one that can execute deposits and withdrawals which is a pda derived from the main program.

pub fn execute_settlement(
    ctx: Context<ExecuteSettlement>,
    user1_enc_pubkey: [u8; 32],
    user2_enc_pubkey: [u8; 32],
    execution_price: u64,
    is_base: bool,
    computation_offset: u64,
) -> Result<()> {
    let args = vec![
        Argument::ArcisPubkey(user1_enc_pubkey),
        Argument::PlaintextU128(ctx.accounts.buyer_ledger.balance_nonce),
        Argument::Account(ctx.accounts.buyer_ledger.key(), 8 + 32, 4 * 32),

        Argument::ArcisPubkey(user2_enc_pubkey),
        Argument::PlaintextU128(ctx.accounts.seller_ledger.balance_nonce),
        Argument::Account(ctx.accounts.seller_ledger.key(), 8 + 32, 4 * 32),

        Argument::PlaintextU64(execution_price),
        Argument::PlaintextU8(is_base as u8),
    ];

    ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

    queue_computation(
        ctx.accounts,
        computation_offset,
        args,
        None,
        vec![ExecuteSettlementCallback::callback_ix(&[
            CallbackAccount {
                pubkey: ctx.accounts.buyer_ledger.key(),
                is_writable: true,
            },
            CallbackAccount {
                pubkey: ctx.accounts.seller_ledger.key(),
                is_writable: true,
            },
        ])],
    )?;

    Ok(())
}

#[queue_computation_accounts("execute_settlement", user)]
#[derive(Accounts)]
#[instruction(
    user1_enc_pubkey: [u8; 32],
    user2_enc_pubkey: [u8; 32],
    execution_price: u64,
    is_base: bool,
    computation_offset: u64,
)]
pub struct ExecuteSettlement<'info> {
    #[account(
        mut,
        address = SETTLEMENT_BOT_PUBKEY,
    )]
    pub user: Signer<'info>,
    #[account(
        init_if_needed,
        space = 9,
        payer = user,
        seeds = [&SIGN_PDA_SEED],
        bump,
        address = derive_sign_pda!(),
    )]
    pub sign_pda_account: Account<'info, SignerAccount>,
    #[account(address = derive_mxe_pda!())]
    pub mxe_account: Box<Account<'info, MXEAccount>>,
    #[account(mut, address = derive_mempool_pda!())]
    /// CHECK: mempool_account, checked by the arcium program.
    pub mempool_account: UncheckedAccount<'info>,
    #[account(mut, address = derive_execpool_pda!())]
    /// CHECK: executing_pool, checked by the arcium program.
    pub executing_pool: UncheckedAccount<'info>,
    #[account(mut, address = derive_comp_pda!(computation_offset))]
    /// CHECK: computation_account, checked by the arcium program.
    pub computation_account: UncheckedAccount<'info>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_EXECUTE_SETTLEMENT))]
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,
    #[account(mut, address = derive_cluster_pda!(mxe_account))]
    pub cluster_account: Box<Account<'info, Cluster>>,
    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Box<Account<'info, FeePool>>,
    #[account(address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Account<'info, ClockAccount>,
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,

    #[account(mut)]
    pub buyer_ledger: Account<'info, UserPrivateLedger>,
    #[account(mut)]
    pub seller_ledger: Account<'info, UserPrivateLedger>,

}
