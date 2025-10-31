use crate::errors::ErrorCode;
use crate::states::*;
use crate::SignerAccount;
use anchor_lang::prelude::*;
use anchor_spl::token::Mint;
use anchor_spl::token::{self, Transfer};
use arcium_anchor::prelude::*;
use arcium_client::idl::arcium::types::CallbackAccount;
use crate::UpdateLedgerWithdrawVerifyCallback;
use crate::COMP_DEF_OFFSET_UPDATE_LEDGER_DEPOSIT;
use anchor_spl::associated_token::AssociatedToken;


use anchor_spl::token::{ Token, TokenAccount};
use crate::ID;
use crate::ID_CONST;

pub fn withdraw_from_ledger_verify(
    ctx: Context<WithdrawFromLedgerVerify>,
    user_enc_pubkey: [u8; 32],
    amount: u64,
    is_base_token: bool,
    computation_offset: u64,
) -> Result<()> {
    // 1. Queue MPC computation to update encrypted balances
    ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;
    
    let args = vec![
        // Current encrypted balances
        Argument::ArcisPubkey(user_enc_pubkey),
        Argument::PlaintextU128(ctx.accounts.user_ledger.balance_nonce),
        Argument::Account(
            ctx.accounts.user_ledger.key(),
            8 + 32,          // Offset: discriminator + owner
            4 * 32,          // Size: 4 chunks
        ),
        
        // Deposit info
        Argument::PlaintextU64(amount),
        Argument::PlaintextU8(if is_base_token { 0 } else { 1 }),
    ];
    
    queue_computation(
        ctx.accounts,
        computation_offset,
        args,
        None,
        vec![UpdateLedgerWithdrawVerifyCallback::callback_ix(&[
            CallbackAccount {
                pubkey: ctx.accounts.user_ledger.key(),
                is_writable: true,
            },
        ])],
    )?;

    Ok(())

    
    // // 2. the callback will emit an event confirming if withdrawl is possible and 
    // // if possible then the cranker will prepare 
    // let cpi_accounts = token::Transfer {
    //     from: ctx.accounts.vault.to_account_info(),
    //     to: ctx.accounts.user_token_account.to_account_info(),
    //     authority: ctx.accounts.vault_authority.to_account_info(),
    // };

    // let signer_seeds: &[&[&[u8]]] = &[&[
    //     b"vault_authority", 
    //     &[ctx.bumps.vault_authority], 
    // ]];

    // let cpi_context = CpiContext::new_with_signer(
    //     ctx.accounts.token_program.to_account_info(),
    //     cpi_accounts,
    //     signer_seeds,
    // );

    // token::transfer(cpi_context, amount)?;
    // msg!("Withdrew {} tokens from ledger", amount);
    
    // Ok(())
}

#[queue_computation_accounts("update_ledger_deposit", user)]
#[derive(Accounts)]
#[instruction(
    user_enc_pubkey: [u8; 32],
    amount: u64,
    is_base_token: bool,
    computation_offset: u64,
)]
pub struct WithdrawFromLedgerVerify<'info> {
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
    /// CHECK: mempool_account
    pub mempool_account: UncheckedAccount<'info>,
    
    #[account(mut, address = derive_execpool_pda!())]
    /// CHECK: executing_pool
    pub executing_pool: UncheckedAccount<'info>,
    
    #[account(mut, address = derive_comp_pda!(computation_offset))]
    /// CHECK: computation_account
    pub computation_account: UncheckedAccount<'info>,
    
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_UPDATE_LEDGER_DEPOSIT))]
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,
    
    #[account(mut, address = derive_cluster_pda!(mxe_account))]
    pub cluster_account: Box<Account<'info, Cluster>>,
    
    #[account(mut, address = ARCIUM_FEE_POOL_ACCOUNT_ADDRESS)]
    pub pool_account: Box<Account<'info, FeePool>>,
    
    #[account(address = ARCIUM_CLOCK_ACCOUNT_ADDRESS)]
    pub clock_account: Account<'info, ClockAccount>,
    
    pub system_program: Program<'info, System>,
    pub arcium_program: Program<'info, Arcium>,

    /// CHECK: PDA authority for vault
    #[account(
        seeds = [b"vault_authority"],
        bump,
    )]
    pub vault_authority: UncheckedAccount<'info>,

    pub mint: Account<'info, Mint>,

    #[account(mut)]
    pub vault: Account<'info, TokenAccount>,
    
    #[account(
        mut,
        associated_token::authority = user,
        associated_token::mint = mint,
    )]
    pub user_token_account: Account<'info, TokenAccount>,
    
    #[account(
        mut,
        seeds = [b"user_ledger", user.key().as_ref()],
        bump = user_ledger.bump,
    )]
    pub user_ledger: Account<'info, UserPrivateLedger>,
    
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
}