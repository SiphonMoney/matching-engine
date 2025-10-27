use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct OrderBookState {
    pub authority: Pubkey,              // 32
    pub orderbook_data: [[u8; 32]; 52], // 1312
    pub orderbook_nonce: u128,          // 16
    pub backend_pubkey: [u8; 32],       // 32
    pub base_mint: Pubkey,              // 32
    pub quote_mint: Pubkey,             // 32
    pub last_match_timestamp: i64,      // 8
    pub total_orders_processed: u64,    // 8
    pub total_matches: u64,             // 8
    pub match_counter: u64,             // 8
    pub bump: u8,                       // 1
}
// Total: 1481 bytes
