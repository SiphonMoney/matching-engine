use anchor_lang::prelude::*;

#[account(zero_copy(unsafe))]
#[repr(C, packed)]
#[derive(Debug)]
#[derive(InitSpace)]
pub struct OrderBookState {
    pub authority: Pubkey,              // 32
    pub orderbook_data: [[u8; 32]; 42], // 1344 bytes
    pub orderbook_nonce: u128,          // 16
    pub backend_pubkey: [u8; 32],       // 32
    pub base_mint: Pubkey,              // 32
    pub quote_mint: Pubkey,             // 32
    pub last_match_timestamp: i64,      // 8
    pub total_orders_processed: u64,    // 8
    pub total_matches: u64,             // 8
    // pub match_counter: u64,             // 8
    pub bump: u8,                       // 1
}
// Total: 1481 bytes

impl Default for OrderBookState {
    fn default() -> Self {
        Self {
            authority: Pubkey::default(),
            orderbook_data: [[0u8; 32]; 42],
            orderbook_nonce: 0,
            backend_pubkey: [0u8; 32],
            base_mint: Pubkey::default(),
            quote_mint: Pubkey::default(),
            last_match_timestamp: 0,
            total_orders_processed: 0,
            total_matches: 0,
            bump: 0,
        }
    }
}
