use anchor_lang::prelude::*;
use arcium_anchor::prelude::*;
use arcium_client::idl::arcium::types::CallbackAccount;

const COMP_DEF_OFFSET_MATCH_ORDERS: u32 = comp_def_offset("match_orders");
const COMP_DEF_OFFSET_SUBMIT_ORDER: u32 = comp_def_offset("submit_order");
const COMP_DEF_OFFSET_INIT_ORDER_BOOK: u32 = comp_def_offset("init_order_book");

declare_id!("DQ5MR2aPD9sPBN9ukVkhwrAn8ADxpkAE5AHUnXxKEvn1");

pub mod instructions;
pub mod states;
pub use instructions::*;
pub use states::*;
pub mod errors;
pub use errors::ErrorCode;

// Macro to copy orderbook data - minimizes stack usage
macro_rules! copy_orderbook_data {
    ($orderbook_state:expr, $encrypted:expr) => {{
        $orderbook_state.orderbook_nonce = $encrypted.nonce;
        let ciphertexts = &$encrypted.ciphertexts;
        for i in 0..52 {
            $orderbook_state.orderbook_data[i] = ciphertexts[i];
        }
    }};
}

#[arcium_program]
pub mod matching_engine {
    use super::*;
    use crate::errors::ErrorCode;

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
    ) -> Result<()> {
        instructions::initialize(ctx, backend_pubkey, base_mint, quote_mint)?;
        Ok(())
    }

    pub fn init_encrypted_orderbook(
        ctx: Context<InitEncryptedOrderbook>,
        computation_offset: u64,
    ) -> Result<()> {
        // Queue MPC computation to initialize encrypted orderbook
        let args = vec![
            Argument::PlaintextU128(0), // Initial nonce
        ];

        ctx.accounts.sign_pda_account.bump = ctx.bumps.sign_pda_account;

        queue_computation(
            ctx.accounts,
            computation_offset,
            args,
            None,
            vec![InitOrderBookCallback::callback_ix(&[CallbackAccount {
                pubkey: ctx.accounts.orderbook_state.key(),
                is_writable: true,
            }])],
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
        copy_orderbook_data!(&mut ctx.accounts.orderbook_state, orderbook_enc);

        ctx.accounts.orderbook_state.total_orders_processed = 0;
        ctx.accounts.orderbook_state.total_matches = 0;
        ctx.accounts.orderbook_state.last_match_timestamp = Clock::get()?.unix_timestamp;

        msg!("Orderbook initialized");
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
                // Copy orderbook data directly
                copy_orderbook_data!(&mut ctx.accounts.orderbook_state, &field_0.field_1);
                
                ctx.accounts.orderbook_state.total_matches =
                    ctx.accounts.orderbook_state.total_matches.saturating_add(1);
                
                msg!("Matching completed. {} total matches",
                     ctx.accounts.orderbook_state.total_matches);

                
                Ok(())
            }
            _ => Err(ErrorCode::AbortedComputation.into()),
        }
    }

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
        let result = match &output {
            ComputationOutputs::Success(SubmitOrderOutput { field_0 }) => field_0,
            _ => return Err(ErrorCode::AbortedComputation.into()),
        };

        let success = result.field_1;
        let buy_count = result.field_2;
        let sell_count = result.field_3;

        // Copy orderbook data
        copy_orderbook_data!(&mut ctx.accounts.orderbook_state, &result.field_0);

        ctx.accounts.orderbook_state.total_orders_processed = ctx
            .accounts
            .orderbook_state
            .total_orders_processed
            .saturating_add(1);

        let order_account = &mut ctx.accounts.order_account;
        order_account.status = if success { 1 } else { 2 };

        if success {
            msg!(
                "Order {} added. Buy: {}, Sell: {}",
                order_account.order_id,
                buy_count,
                sell_count
            );
        } else {
            msg!("Order {} rejected", order_account.order_id);
        }

        emit!(OrderProcessedEvent {
            order_id: order_account.order_id,
            success,
            buy_count,
            sell_count,
            orderbook_nonce: ctx.accounts.orderbook_state.orderbook_nonce,
        });

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
    pub order_account: Box<Account<'info, OrderAccount>>,
    #[account(mut)]
    pub orderbook_state: Box<Account<'info, OrderBookState>>,
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

#[event]
pub struct MatchResultEvent {
    pub results: [u8; 32],
    pub nonce: u128,
    pub orderbook_nonce: u128,
    pub timestamp: i64,
}

#[event]
pub struct OrderBookInitializedEvent {
    pub orderbook_nonce: u128,
    pub total_orders_processed: u64,
    pub total_matches: u64,
    pub last_match_timestamp: i64,
}
