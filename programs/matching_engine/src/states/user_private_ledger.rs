use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct UserPrivateLedger {
    pub owner: Pubkey,
    pub encrypted_balances: [[u8; 32]; 4],
    pub balance_nonce: u128,
    pub last_update: i64,
    pub bump: u8,
}