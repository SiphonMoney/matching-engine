use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct OrderBookState {
    pub authority: Pubkey,              // 32
    pub orderbook_data: [[u8; 32]; 32], // 1024 (32 chunks × 32 bytes)
    pub orderbook_nonce: u128,          // 16
    pub backend_pubkey: [u8; 32],       // 32
    pub base_mint: Pubkey,              // 32
    pub quote_mint: Pubkey,             // 32
    pub last_match_timestamp: i64,      // 8
    pub total_orders_processed: u64,    // 8
    pub total_matches: u64,             // 8
    pub bump: u8,                       // 1
    
    // Callback server pattern fields
    pub pending_finalization: bool,     // 1
    pub pending_orderbook_hash: [u8; 32], // 32 - Hash of pending data from callback
    pub callback_authority: Pubkey,     // 32 - Who can call finalize (your backend)
}
// Total: 1258 bytes
