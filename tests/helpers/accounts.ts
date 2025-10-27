import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { MatchingEngine } from "../../target/types/matching_engine";
import { getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";

const ORDERBOOK_SEED = Buffer.from("order_book_state");
const VAULT_SEED = Buffer.from("vault");
const VAULT_STATE_SEED = Buffer.from("vault_state");
const ORDER_SEED = Buffer.from("order");
const USER_LEDGER_SEED = Buffer.from("user_ledger");

/**
 * Derive OrderBookState PDA
 */
export function deriveOrderbookPDA(
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([ORDERBOOK_SEED], programId);
}

/**
 * Derive OrderAccount PDA
 */
export function deriveOrderAccountPDA(
  orderId: anchor.BN,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      ORDER_SEED,
      orderId.toArrayLike(Buffer, "le", 8),
    ],
    programId
  );
}

/**
 * Derive UserLedger PDA
 */
export function deriveUserLedgerPDA(
  userPubkey: PublicKey,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([USER_LEDGER_SEED, userPubkey.toBuffer()], programId);
}

/**
 * Derive Vault (TokenAccount) PDA
 */
export function deriveVaultPDA(
  mint: PublicKey,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [VAULT_SEED, mint.toBuffer()],
    programId
  );
}

/**
 * Derive VaultState PDA
 */
export function deriveVaultStatePDA(
  mint: PublicKey,
  userPubkey: PublicKey,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [VAULT_STATE_SEED, mint.toBuffer(), userPubkey.toBuffer()],
    programId
  );
}

/**
 * Fetch OrderBookState account
 */
export async function getOrderBookState(
  program: Program<MatchingEngine>
): Promise<any> {
  const [pda] = deriveOrderbookPDA(program.programId);
  return await program.account.orderBookState.fetch(pda);
}

/**
 * Fetch OrderAccount
 */
export async function getOrderAccount(
  program: Program<MatchingEngine>,
  orderId: anchor.BN,
  userPubkey: PublicKey
): Promise<any> {
  const [pda] = deriveOrderAccountPDA(orderId, program.programId);
  return await program.account.orderAccount.fetch(pda);
}

/**
 * Fetch VaultState account
 */
export async function getVaultState(
  program: Program<MatchingEngine>,
  mint: PublicKey,
  userPubkey: PublicKey
): Promise<any> {
  const [pda] = deriveVaultStatePDA(mint, userPubkey, program.programId);
  return await program.account.vaultState.fetch(pda);
}

/**
 * Check if account exists
 */
export async function accountExists(
  provider: anchor.AnchorProvider,
  address: PublicKey
): Promise<boolean> {
  const accountInfo = await provider.connection.getAccountInfo(address);
  return accountInfo !== null;
}

/**
 * Derive Vault Authority PDA
 */
export function deriveVaultAuthorityPDA(
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from("vault_authority")], programId);
}

/**
 * Airdrop SOL to account
 */
export async function airdrop(
  provider: anchor.AnchorProvider,
  pubkey: PublicKey,
  amount: number
): Promise<void> {
  const signature = await provider.connection.requestAirdrop(pubkey, amount);
  await provider.connection.confirmTransaction(signature, "confirmed");
}

/**
 * take public key of users and token mints and authority
 * create ATA of users and then mint token to them
 */
export async function createATAAndMintTokens(
  provider: anchor.AnchorProvider,
  user: PublicKey,
  mint: PublicKey,
  authority: Keypair, // mint authority
  amount: number
): Promise<PublicKey> {
  const ata = await getOrCreateAssociatedTokenAccount(provider.connection, authority, mint, user);
  await mintTo(provider.connection, authority, mint, ata.address, authority, amount);
  return ata.address;
}

/**
 * Derive SignerAccount PDA
 */
export function deriveSignerAccountPDA(
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from("signer_account")], programId);
}


// pub const ARCIUM_FEE_POOL_ACCOUNT_ADDRESS: Pubkey = Pubkey::new_from_array([
//   94, 87, 49, 175, 232, 200, 92, 37, 140, 243, 194, 109, 249, 141, 31, 66, 59, 91, 113, 165, 232,
//   167, 54, 30, 164, 219, 3, 225, 61, 227, 94, 8,
// ]);

export function deriveArciumFeePoolAccountAddress(): PublicKey {
  return new PublicKey([
    94, 87, 49, 175, 232, 200, 92, 37, 140, 243, 194, 109, 249, 141, 31, 66, 59, 91, 113, 165, 232,
    167, 54, 30, 164, 219, 3, 225, 61, 227, 94, 8,
  ])
}
