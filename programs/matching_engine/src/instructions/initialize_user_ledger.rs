use crate::errors::ErrorCode;
use crate::states::*;
use crate::utils::*;
use crate::InitUserLedgerCallback;
use crate::SignerAccount;
use crate::COMP_DEF_OFFSET_INIT_USER_LEDGER;
use arcium_anchor::prelude::*;
use arcium_client::idl::arcium::types::CallbackAccount;

use anchor_lang::{prelude::*, system_program};

pub const USER_LEDGER_SEED: &str = "user_ledger";

use crate::ID;
use crate::ID_CONST;

pub fn initialize_user_ledger(
    ctx: Context<InitializeUserLedger>,
    user_pubkey: [u8; 32],
    user_nonce: u128,
    computation_offset: u64,
) -> Result<()> {
    let user_ledger_loader = create_user_ledger(
        &ctx.accounts.user.to_account_info(),
        &ctx.accounts.user.to_account_info(),
        &ctx.accounts.user_ledger.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
    )?;

    let ledger = &mut user_ledger_loader.load_init()?;

    ledger.owner = ctx.accounts.user.key();
    ledger.balance_nonce = 0;
    ledger.last_update = Clock::get()?.unix_timestamp;

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
        vec![InitUserLedgerCallback::callback_ix(&[CallbackAccount {
            pubkey: ctx.accounts.user_ledger.key(),
            is_writable: true,
        }])],
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

    // #[account(
    //     init,
    //     payer = user,
    //     space = 8 + UserPrivateLedger::INIT_SPACE,
    //     seeds = [b"user_ledger", user.key().as_ref()],
    //     bump,
    // )]
    /// CHECK: user_ledger, checked by the arcium program.
    #[account(mut)]
    pub user_ledger: UncheckedAccount<'info>,
}

pub fn create_user_ledger<'info>(
    payer: &AccountInfo<'info>,
    user: &AccountInfo<'info>,
    user_ledger: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
) -> Result<AccountLoad<'info, UserPrivateLedger>> {
    if user_ledger.owner != &system_program::ID {
        return err!(ErrorCode::NotApproved);
    }

    let (expect_pda_address, bump) = Pubkey::find_program_address(
        &[USER_LEDGER_SEED.as_bytes(), user.key().as_ref()],
        &crate::id(),
    );

    if user_ledger.key() != expect_pda_address {
        require_eq!(user_ledger.is_signer, true);
    }

    token::create_or_allocate_account(
        &crate::id(),
        payer.to_account_info(),
        system_program.to_account_info(),
        user_ledger.clone(),
        &[USER_LEDGER_SEED.as_bytes(), user.key().as_ref(), &[bump]],
        8 + UserPrivateLedger::INIT_SPACE,
    )?;

    Ok(AccountLoad::<UserPrivateLedger>::try_from_unchecked(
        &crate::id(),
        &user_ledger,
    )?)
}
