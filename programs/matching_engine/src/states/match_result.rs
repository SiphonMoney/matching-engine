use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct MatchResult {
    pub match_id: u64,
    pub encrypted_match: [[u8; 32]; 6],
    pub match_nonce: u128,
    pub timestamp: i64,
    pub settled: bool,
    pub bump: u8,
}