use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;
use arcium_client::idl::arcium::types::CallbackAccount;

const COMP_DEF_OFFSET_MATCH_ORDERS: u32 = comp_def_offset("match_orders");
const COMP_DEF_OFFSET_SUBMIT_ORDER: u32 = comp_def_offset("submit_order");
const COMP_DEF_OFFSET_INIT_ORDER_BOOK: u32 = comp_def_offset("init_order_book");
const COMP_DEF_OFFSET_UPDATE_LEDGER_DEPOSIT: u32 = comp_def_offset("update_ledger_deposit");
const COMP_DEF_OFFSET_UPDATE_LEDGER_WITHDRAW: u32 = comp_def_offset("update_ledger_withdraw");
const COMP_DEF_OFFSET_UPDATE_SETTLEMENT: u32 = comp_def_offset("update_settlement");
const COMP_DEF_OFFSET_INIT_USER_LEDGER: u32 = comp_def_offset("init_user_ledger");
declare_id!("DQ5MR2aPD9sPBN9ukVkhwrAn8ADxpkAE5AHUnXxKEvn1");

pub mod instructions;
pub mod states;
pub use instructions::*;
pub use states::*;
pub mod errors;
pub use errors::ErrorCode;


#[arcium_program]
pub mod matching_engine {
    use super::*;
    use crate::errors::ErrorCode;


    pub fn init_user_ledger_comp_def(ctx: Context<InitializeUserLedgerCompDef>) -> Result<()> {
        init_comp_def(ctx.accounts, true, 0, None, None)?;
        Ok(())
    }

    pub fn init_update_ledger_deposit_comp_def(ctx: Context<InitUpdateLedgerDepositCompDef>) -> Result<()> {
        init_comp_def(ctx.accounts, true, 0, None, None)?;
        Ok(())
    }

    pub fn deposit_to_ledger(ctx: Context<DepositToLedger>, amount: u64, is_base_token: bool, computation_offset: u64) -> Result<()> {
        instructions::deposit_to_ledger(ctx, amount, is_base_token, computation_offset)?;
        Ok(())
    }

    pub fn init_submit_order_comp_def(ctx: Context<InitSubmitOrderCompDef>) -> Result<()> {
        init_comp_def(ctx.accounts, true, 0, None, None)?;
        Ok(())
    }

    pub fn init_match_orders_comp_def(ctx: Context<InitMatchOrdersCompDef>) -> Result<()> {
        init_comp_def(ctx.accounts, true, 0, None, None)?;
        Ok(())
    }

    pub fn init_order_book_comp_def(ctx: Context<InitOrderBookCompDef>) -> Result<()> {
        init_comp_def(ctx.accounts, true, 0, None, None)?;
        Ok(())
    }
    pub fn initialize_vault(ctx: Context<InitializeUserVault>) -> Result<()> {
        instructions::initialize_user_vault(ctx)?;
        Ok(())
    }

    pub fn initialize(
        ctx: Context<Initialize>,
        backend_pubkey: [u8; 32],
        base_mint: Pubkey,
        quote_mint: Pubkey,
        callback_authority: Pubkey,
    ) -> Result<()> {
        instructions::initialize(ctx, backend_pubkey, base_mint, quote_mint, callback_authority)?;
        Ok(())
    }

    pub fn init_encrypted_orderbook(
        ctx: Context<InitEncryptedOrderbook>,
        computation_offset: u64,
        nonce: u128,
    ) -> Result<()> {

        let orderbook_state = &mut ctx.accounts.orderbook_state;
        orderbook_state.total_orders_processed = 0;
        orderbook_state.total_matches = 0;
        orderbook_state.last_match_timestamp = Clock::get()?.unix_timestamp;
        orderbook_state.orderbook_nonce = nonce;

        // Queue MPC computation to initialize encrypted orderbook
        let args = vec![
            Argument::PlaintextU128(nonce), // Initial nonce
        ];

        msg!("meow meow meow 4===========================================================================");

        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;


        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            None,
            vec![InitOrderBookCallback::callback_ix(&[
                CallbackAccount {
                pubkey: ctx.accounts.orderbook_state.key(),
                is_writable: true,
            }
            ])],
        )?;
        Ok(())
    }

    #[arcium_callback(encrypted_ix = "init_order_book", network = "localnet")]
    pub fn init_order_book_callback(
        ctx: Context<InitOrderBookCallback>,
        output: ComputationOutputs<InitOrderBookOutput>,
    ) -> Result<()> {
        process_init_orderbook_result(ctx, output)
    }
    #[inline(never)]
    pub fn process_init_orderbook_result(
        ctx: Context<InitOrderBookCallback>,
        output: ComputationOutputs<InitOrderBookOutput>,
    ) -> Result<()> {
        let orderbook_enc = match &output {
            ComputationOutputs::Success(InitOrderBookOutput { field_0 }) => field_0,
            _ => return Err(ErrorCode::AbortedComputation.into()),
        };

        // Copy orderbook data
        let orderbook_state = &mut ctx.accounts.orderbook_state;
        orderbook_state.orderbook_nonce = orderbook_enc.nonce;
        orderbook_state.orderbook_data = orderbook_enc.ciphertexts;

        // msg!("Orderbook initialized with placeholder {:?}", somehting);
        Ok(())
    }

    pub fn deposit_to_vault(ctx: Context<DepositToVault>, amount: u64) -> Result<()> {
        instructions::deposit_to_vault(ctx, amount)?;
        Ok(())
    }

    pub fn submit_order(
        ctx: Context<SubmitOrder>,
        amount: [u8; 32],
        price: [u8; 32],
        user_pubkey: [u8; 32],
        order_type: u8,
        computation_offset: u64,
        order_id: u64,
        order_nonce: u128,
    ) -> Result<()> {
        instructions::submit_order(
            ctx,
            amount,
            price,
            user_pubkey,
            order_type,
            computation_offset,
            order_id,
            order_nonce,
        )?;
        Ok(())
    }

    pub fn trigger_matching(ctx: Context<TriggerMatching>, computation_offset: u64) -> Result<()> {
        instructions::trigger_matching(ctx, computation_offset)?;
        Ok(())
    }

    #[arcium_callback(encrypted_ix = "match_orders", network = "localnet")]
    pub fn match_orders_callback(
        ctx: Context<MatchOrdersCallback>,
        output: ComputationOutputs<MatchOrdersOutput>,
    ) -> Result<()> {
        process_match_orders_result(ctx, output)
    }

    #[inline(never)]
    pub fn process_match_orders_result(
        ctx: Context<MatchOrdersCallback>,
        output: ComputationOutputs<MatchOrdersOutput>,
    ) -> Result<()> {
        match &output {
            ComputationOutputs::Success(MatchOrdersOutput { field_0 }) => {
                let orderbook_enc = &field_0.field_0;
                let matches_enc = &field_0.field_1;
                let num_matches = field_0.field_2;
                
                // Update orderbook

                let orderbook_state = &mut ctx.accounts.orderbook_state;
                orderbook_state.orderbook_nonce = orderbook_enc.nonce;
                orderbook_state.orderbook_data = orderbook_enc.ciphertexts;
                
                if num_matches > 0 {
                    // Create MatchResult accounts for each match
                    // The encrypted matches will be decrypted by backend

                    let match1 = matches_enc.ciphertexts[0..5].try_into().unwrap();
                    let mut match2 = [[0u8; 32]; 5];
                    let mut match3 = [[0u8; 32]; 5];
                    let mut match4 = [[0u8; 32]; 5];
                    if num_matches > 1 {
                        match2 = matches_enc.ciphertexts[5..10].try_into().unwrap();
                    }
                    if num_matches > 2 {
                        match3 = matches_enc.ciphertexts[10..15].try_into().unwrap();
                    }
                    if num_matches > 3 {
                        match4 = matches_enc.ciphertexts[15..20].try_into().unwrap();
                    }
                    ctx.accounts.orderbook_state.total_matches += num_matches as u64;
                    
                    emit!(MatchesFoundEvent {
                        num_matches,
                        match1,
                        match2,
                        match3,
                        match4,
                        nonce: matches_enc.nonce,
                        timestamp: Clock::get()?.unix_timestamp,
                    });
                }
                
                Ok(())
            }
            _ => Err(ErrorCode::AbortedComputation.into()),
        }
    }


    // #[arcium_callback(encrypted_ix = "submit_order", network = "localnet")]
    // pub fn submit_order_callback(
    //     ctx: Context<SubmitOrderCallback>,
    //     output: ComputationOutputs<SubmitOrderOutput>,
    // ) -> Result<()> {
    //     let o = match output {
    //         ComputationOutputs::Success(SubmitOrderOutput {
    //             field_0:
    //                 SubmitOrderOutputStruct0 {
    //                     field_0: orderbook_enc,
    //                     field_1: ledger_enc,
    //                     field_2: status_enc,
    //                     field_3: success,
    //                 },
    //         }) => (orderbook_enc, ledger_enc, status_enc, success),
    //         _ => return Err(ErrorCode::AbortedComputation.into()),
    //     };

    //     let orderbook_enc = o.0;
    //     let ledger_enc = o.1;
    //     let status_enc = o.2;
    //     let success = o.3;

    //     // update orderbook
    //     ctx.accounts.orderbook_state.orderbook_nonce = orderbook_enc.nonce;
    //     ctx.accounts.orderbook_state.orderbook_data = orderbook_enc.ciphertexts;

    //     // update user ledger
    //     ctx.accounts.user_ledger.balance_nonce = ledger_enc.nonce;
    //     ctx.accounts.user_ledger.encrypted_balances = ledger_enc.ciphertexts;
    //     ctx.accounts.user_ledger.last_update = Clock::get()?.unix_timestamp;
        
    //     // update order account
    //     ctx.accounts.order_account.order_nonce = status_enc.nonce;
    //     ctx.accounts.order_account.encrypted_order = status_enc.ciphertexts;

    //     emit!(OrderSubmittedEvent {
    //         order_id: ctx.accounts.order_account.order_id,
    //         user: ctx.accounts.order_account.user,
    //         success,
    //         timestamp: Clock::get()?.unix_timestamp,
    //     });

    //     Ok(())
    // }

    #[arcium_callback(encrypted_ix = "submit_order", network = "localnet")]
    pub fn submit_order_callback(
        ctx: Context<SubmitOrderCallback>,
        output: ComputationOutputs<SubmitOrderOutput>,
    ) -> Result<()> {
        process_submit_order_result(ctx, output)
    }

    #[inline(never)]
    pub fn process_submit_order_result(
        ctx: Context<SubmitOrderCallback>,
        output: ComputationOutputs<SubmitOrderOutput>,
    ) -> Result<()> {
        msg!("Submit order callback - processing result");
        match &output {
            ComputationOutputs::Success(SubmitOrderOutput { field_0 }) => {
                let orderbook_enc = &field_0.field_0;
                let ledger_enc = &field_0.field_1;
                let status_enc = &field_0.field_2;
                let success = field_0.field_3;
                
                // CALLBACK SERVER PATTERN:
                // The full orderbook data is TOO LARGE for on-chain callback
                // Instead, we store a hash and mark as pending finalization
                // The callback server will receive the full data and call finalize_submit_order
                
                // Hash the orderbook ciphertext chunks
                use anchor_lang::solana_program::hash::hash;
                let orderbook_bytes: Vec<u8> = orderbook_enc.ciphertexts
                    .iter()
                    .flat_map(|chunk| chunk.iter().copied())
                    .collect();
                let orderbook_hash = hash(&orderbook_bytes);
                
                // Store hash and mark as pending
                ctx.accounts.orderbook_state.pending_orderbook_hash = orderbook_hash.to_bytes();
                ctx.accounts.orderbook_state.orderbook_nonce = orderbook_enc.nonce;
                ctx.accounts.orderbook_state.pending_finalization = true;
                
                msg!("Orderbook hash stored: {:?}", orderbook_hash.to_bytes());
                msg!("Awaiting finalization from callback server");
                
                // Update user ledger (this fits in the callback)
                ctx.accounts.user_ledger.balance_nonce = ledger_enc.nonce;
                ctx.accounts.user_ledger.encrypted_balances = ledger_enc.ciphertexts;
                ctx.accounts.user_ledger.last_update = Clock::get()?.unix_timestamp;
                
                // Update order account (this fits in the callback)
                ctx.accounts.order_account.order_nonce = status_enc.nonce;
                ctx.accounts.order_account.encrypted_order = status_enc.ciphertexts;
                
                msg!("Order submitted, pending orderbook finalization");
                emit!(OrderSubmittedEvent {
                    order_id: ctx.accounts.order_account.order_id,
                    user: ctx.accounts.order_account.user,
                    success,
                    timestamp: Clock::get()?.unix_timestamp,
                });
                
                Ok(())
            }
            _ => Err(ErrorCode::AbortedComputation.into()),
        }
    }
    // NEW: Finalize instruction called by callback server with full orderbook data
    #[inline(never)]
    pub fn finalize_submit_order(
        ctx: Context<FinalizeSubmitOrder>,
        orderbook_data: [[u8; 32]; 32], // Full encrypted orderbook from callback server
    ) -> Result<()> {
        let orderbook_state = &mut ctx.accounts.orderbook_state;
        
        // 1. Verify we're expecting a finalization
        require!(
            orderbook_state.pending_finalization,
            ErrorCode::NotPendingFinalization
        );
        
        // 2. Compute hash of submitted data
        use anchor_lang::solana_program::hash::hash;
        let submitted_bytes: Vec<u8> = orderbook_data
            .iter()
            .flat_map(|chunk| chunk.iter().copied())
            .collect();
        let submitted_hash = hash(&submitted_bytes);
        
        // 3. Verify it matches the hash from the MPC callback
        let expected_hash = orderbook_state.pending_orderbook_hash;
        
        require!(
            submitted_hash.to_bytes() == expected_hash,
            ErrorCode::HashMismatch
        );
        
        msg!("Hash verified! Storing orderbook data");
        
        // 4. Hash matches! Store the full data
        orderbook_state.orderbook_data = orderbook_data;
        orderbook_state.pending_finalization = false;
        orderbook_state.pending_orderbook_hash = [0u8; 32]; // Clear the hash
        orderbook_state.total_orders_processed += 1;
        
        msg!("Orderbook finalized successfully");
        Ok(())
    }

    pub fn withdraw_from_vault(ctx: Context<WithdrawFromVault>, amount: u64) -> Result<()> {
        instructions::withdraw_from_vault(ctx, amount)?;
        Ok(())
    }

    pub fn execute_settlement(
        ctx: Context<ExecuteSettlement>,
        match_id: u64,
        quantity: u64,
        execution_price: u64,
    ) -> Result<()> {
        instructions::execute_settlement(ctx, match_id, quantity, execution_price)?;
        Ok(())
    }

    pub fn initialize_user_ledger(ctx: Context<InitializeUserLedger>, computation_offset: u64) -> Result<()> {
        instructions::initialize_user_ledger(ctx, computation_offset)?;
        Ok(())
    }

    #[arcium_callback(encrypted_ix = "update_ledger_deposit", network = "localnet")]
    pub fn update_ledger_deposit_callback(
        ctx: Context<UpdateLedgerDepositCallback>,
        output: ComputationOutputs<UpdateLedgerDepositOutput>,
    ) -> Result<()> {
        match &output {
            ComputationOutputs::Success(UpdateLedgerDepositOutput {
                field_0: balances_enc,
            }) => {
                let ledger = &mut ctx.accounts.user_ledger;

                ledger.balance_nonce = balances_enc.nonce;
                ledger.encrypted_balances = balances_enc.ciphertexts;
                ledger.last_update = Clock::get()?.unix_timestamp;

                msg!("User ledger updated after deposit");
                Ok(())
            }
            _ => Err(ErrorCode::AbortedComputation.into()),
        }
    }

    pub fn init_user_ledger(ctx: Context<InitializeUserLedger>, computation_offset: u64) -> Result<()> {
        instructions::initialize_user_ledger(ctx, computation_offset)?;
        Ok(())
    }

    #[arcium_callback(encrypted_ix = "init_user_ledger", network = "localnet")]
    pub fn init_user_ledger_callback(
        ctx: Context<InitUserLedgerCallback>,
        output: ComputationOutputs<InitUserLedgerOutput>,
    ) -> Result<()> {
        process_init_user_ledger_result(ctx, output)
    }

    pub fn process_init_user_ledger_result(ctx: Context<InitUserLedgerCallback>, output: ComputationOutputs<InitUserLedgerOutput>) -> Result<()> {
        match &output {
            ComputationOutputs::Success(InitUserLedgerOutput { field_0: ledger_enc }) => {
                let ledger = &mut ctx.accounts.user_ledger;
                ledger.balance_nonce = ledger_enc.nonce;
                ledger.encrypted_balances = ledger_enc.ciphertexts;
                ledger.last_update = Clock::get()?.unix_timestamp;
                Ok(())
            }
            _ => Err(ErrorCode::AbortedComputation.into()),
        }
    }

}

#[event]
pub struct OrderProcessedEvent {
    pub order_id: u64,
    pub success: bool,
    pub buy_count: u8,
    pub sell_count: u8,
    pub orderbook_nonce: u128,
}

#[callback_accounts("match_orders")]
#[derive(Accounts)]
pub struct MatchOrdersCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_MATCH_ORDERS))]
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,
    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    /// CHECK: instructions_sysvar, checked by the account constraint
    pub instructions_sysvar: AccountInfo<'info>,
    #[account(mut)]
    pub orderbook_state: Box<Account<'info, OrderBookState>>,
}


#[callback_accounts("submit_order")]
#[derive(Accounts)]
pub struct SubmitOrderCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_SUBMIT_ORDER))]
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,
    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    /// CHECK: instructions_sysvar, checked by the account constraint
    pub instructions_sysvar: AccountInfo<'info>,

    #[account(mut)]
    pub orderbook_state: Box<Account<'info, OrderBookState>>,
    #[account(mut)]
    pub user_ledger: Box<Account<'info, UserPrivateLedger>>,
    #[account(mut)]
    pub order_account: Box<Account<'info, OrderAccount>>,
}

#[callback_accounts("init_user_ledger")]
#[derive(Accounts)]
pub struct InitUserLedgerCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_INIT_USER_LEDGER))]
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,
    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    /// CHECK: instructions_sysvar
    pub instructions_sysvar: AccountInfo<'info>,
    #[account(mut)]
    pub user_ledger: Account<'info, UserPrivateLedger>,
}

#[queue_computation_accounts("init_order_book", payer)]
#[derive(Accounts)]
#[instruction(computation_offset: u64)]
pub struct InitEncryptedOrderbook<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(
        init_if_needed,
        space = 9,
        payer = payer,
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
    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_INIT_ORDER_BOOK))]
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
    pub orderbook_state: Box<Account<'info, OrderBookState>>,
}

#[callback_accounts("init_order_book")]
#[derive(Accounts)]
pub struct InitOrderBookCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,
    #[account(
        address = derive_comp_def_pda!(COMP_DEF_OFFSET_INIT_ORDER_BOOK)
    )]
    pub comp_def_account: Account<'info, ComputationDefinitionAccount>,
    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    /// CHECK: instructions_sysvar, checked by the account constraint
    pub instructions_sysvar: AccountInfo<'info>,
    #[account(mut)]
    pub orderbook_state: Box<Account<'info, OrderBookState>>,
}

#[callback_accounts("update_ledger_deposit")]
#[derive(Accounts)]
pub struct UpdateLedgerDepositCallback<'info> {
    pub arcium_program: Program<'info, Arcium>,

    #[account(address = derive_comp_def_pda!(COMP_DEF_OFFSET_UPDATE_LEDGER_DEPOSIT))]
    pub comp_def_account: Box<Account<'info, ComputationDefinitionAccount>>,

    #[account(address = ::anchor_lang::solana_program::sysvar::instructions::ID)]
    /// CHECK: instructions_sysvar
    pub instructions_sysvar: AccountInfo<'info>,

    #[account(mut)]
    pub user_ledger: Account<'info, UserPrivateLedger>,
}

// Accounts for finalize_submit_order (called by callback server)
#[derive(Accounts)]
pub struct FinalizeSubmitOrder<'info> {
    #[account(mut)]
    pub orderbook_state: Account<'info, OrderBookState>,
    
    // Only the callback authority can finalize
    #[account(constraint = callback_authority.key() == orderbook_state.callback_authority @ ErrorCode::UnauthorizedCallbackFinalizer)]
    pub callback_authority: Signer<'info>,
}

#[event]
pub struct OrderBookInitializedEvent {
    pub orderbook_nonce: u128,
    pub total_orders_processed: u64,
    pub total_matches: u64,
    pub last_match_timestamp: i64,
}

#[event]
pub struct OrderSubmittedEvent {
    pub user: Pubkey,
    pub order_id: u64,
    pub success: bool,
    pub timestamp: i64,
}

#[event]
pub struct MatchesFoundEvent {
    pub num_matches: u8,
    pub match1: [[u8; 32]; 5],
    pub match2: [[u8; 32]; 5],
    pub match3: [[u8; 32]; 5],
    pub match4: [[u8; 32]; 5],
    pub nonce: u128,
    pub timestamp: i64,
}

//each match is a 5 chunks of 32 bytes each
// pub match_id: u64,
// pub buyer_order_id: u64,
// pub seller_order_id: u64,
// pub quantity: u64,
// pub execution_price: u64,