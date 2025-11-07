
use crate::errors::ErrorCode;
use crate::states::*;
use crate::SignerAccount;
use crate::InitUserLedgerCallback;
use crate::COMP_DEF_OFFSET_INIT_USER_LEDGER;
use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;
use arcium_client::idl::arcium::types::CallbackAccount;
 
use crate::ID;
use crate::ID_CONST;

pub fn initialize_user_ledger(
    ctx: Context<InitializeUserLedger>,
    user_pubkey: [u8; 32],
    user_nonce: u128,
    computation_offset: u64,
) -> Result<()> {
    let ledger = &mut ctx.accounts.user_ledger;

    ledger.owner = ctx.accounts.user.key();
    ledger.balance_nonce = 0;
    ledger.last_update = Clock::get()?.unix_timestamp;
    ledger.bump = ctx.bumps.user_ledger;


    ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;
    let args = vec![
        Argument::ArcisPubkey(user_pubkey),
        Argument::PlaintextU128(user_nonce),
    ];

    queue_computation(
        ctx.accounts,
        computation_offset,
        args,
        None,
        vec![InitUserLedgerCallback::callback_ix(&[
            CallbackAccount {
                pubkey: ctx.accounts.user_ledger.key(),
                is_writable: true,
            },
        ])],
   )?;
    
    msg!("User ledger initialized for {}", ctx.accounts.user.key());
    
    Ok(())
}


#[queue_computation_accounts("init_user_ledger", user)]
#[derive(Accounts)]
#[instruction(user_pubkey: [u8; 32], user_nonce: u128, computation_offset: u64)]
pub struct InitializeUserLedger<'info> {
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
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_INIT_USER_LEDGER))]
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,
    #[account(mut, address = derive_cluster_pda!(mxe_account))]
    pub cluster_account: Box<Account<'info, Cluster>>,
    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Box<Account<'info, FeePool>>,
    #[account(address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Account<'info, ClockAccount>,
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,

    #[account(
        init,
        payer = user,
        space = 8 + UserPrivateLedger::INIT_SPACE,
        seeds = [b"user_ledger", user.key().as_ref()],
        bump,
    )]
    pub user_ledger: Box<Account<'info, UserPrivateLedger>>,

}