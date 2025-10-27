use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct OrderAccount {
    pub order_id: u64,                      // 8
    pub user: Pubkey,                       // 32
    pub user_enc_pubkey: [u8; 32],          // 32 (user's x25519 for viewing status)
    
    // Encrypted with user's x25519 key (so user can view)
    // [0] = order_type (0=buy, 1=sell)
    // [1] = amount
    // [2] = price
    // [3] = status (0=pending, 1=processing, 2=rejected, 3=filled, 4=cancelled, 5 = insufficient balance)
    // [4] = locked_amount
    // [5] = filled_amount
    // [6] = execution_price
    pub encrypted_order: [[u8; 32]; 7],     // 224
    pub order_nonce: u128,                  // 16
    
    pub timestamp: i64,                     // 8
    pub bump: u8,                           // 1
}