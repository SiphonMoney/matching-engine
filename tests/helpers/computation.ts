import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair } from "@solana/web3.js";
import { MatchingEngine } from "../../target/types/matching_engine";
import * as fs from "fs";
import {
  getCompDefAccOffset,
  getArciumAccountBaseSeed,
  getArciumProgAddress,
  uploadCircuit,
  buildFinalizeCompDefTx,
  getMXEAccAddress,
} from "@arcium-hq/client";

/**
 * Initialize submit_order computation definition
 */
export async function initSubmitOrderCompDef(
  program: Program<MatchingEngine>,
  owner: Keypair,
  uploadRawCircuit: boolean = false,
  offchainSource: boolean = false
): Promise<string> {
  const baseSeedCompDefAcc = getArciumAccountBaseSeed(
    "ComputationDefinitionAccount"
  );
  const offset = getCompDefAccOffset("submit_order");

  const compDefPDA = PublicKey.findProgramAddressSync(
    [baseSeedCompDefAcc, program.programId.toBuffer(), offset],
    getArciumProgAddress()
  )[0];

  console.log("Submit order comp def PDA:", compDefPDA.toBase58());

  const sig = await program.methods
    .initSubmitOrderCompDef()
    .accounts({
      compDefAccount: compDefPDA,
      payer: owner.publicKey,
      mxeAccount: getMXEAccAddress(program.programId),
    })
    .signers([owner])
    .rpc({
      commitment: "confirmed",
    });

  console.log("Init submit_order computation definition tx:", sig);

  const provider = program.provider as anchor.AnchorProvider;

  if (uploadRawCircuit) {
    const rawCircuit = fs.readFileSync("build/submit_order.arcis");
    await uploadCircuit(
      provider,
      "submit_order",
      program.programId,
      rawCircuit,
      true
    );
  } else if (!offchainSource) {
    const finalizeTx = await buildFinalizeCompDefTx(
      provider,
      Buffer.from(offset).readUInt32LE(),
      program.programId
    );

    const latestBlockhash = await provider.connection.getLatestBlockhash();
    finalizeTx.recentBlockhash = latestBlockhash.blockhash;
    finalizeTx.lastValidBlockHeight = latestBlockhash.lastValidBlockHeight;

    finalizeTx.sign(owner);

    await provider.sendAndConfirm(finalizeTx);
  }

  return sig;
}

/**
 * Initialize match_orders computation definition
 */
export async function initMatchOrdersCompDef(
  program: Program<MatchingEngine>,
  owner: Keypair,
  uploadRawCircuit: boolean = false,
  offchainSource: boolean = false
): Promise<string> {
  const baseSeedCompDefAcc = getArciumAccountBaseSeed(
    "ComputationDefinitionAccount"
  );
  const offset = getCompDefAccOffset("match_orders");

  const compDefPDA = PublicKey.findProgramAddressSync(
    [baseSeedCompDefAcc, program.programId.toBuffer(), offset],
    getArciumProgAddress()
  )[0];

  console.log("Match orders comp def PDA:", compDefPDA.toBase58());

  const sig = await program.methods
    .initMatchOrdersCompDef()
    .accounts({
      compDefAccount: compDefPDA,
      payer: owner.publicKey,
      mxeAccount: getMXEAccAddress(program.programId),
    })
    .signers([owner])
    .rpc({
      commitment: "confirmed",
    });

  console.log("Init match_orders computation definition tx:", sig);

  const provider = program.provider as anchor.AnchorProvider;

  if (uploadRawCircuit) {
    const rawCircuit = fs.readFileSync("build/match_orders.arcis");
    await uploadCircuit(
      provider,
      "match_orders",
      program.programId,
      rawCircuit,
      true
    );
  } else if (!offchainSource) {
    const finalizeTx = await buildFinalizeCompDefTx(
      provider,
      Buffer.from(offset).readUInt32LE(),
      program.programId
    );

    const latestBlockhash = await provider.connection.getLatestBlockhash();
    finalizeTx.recentBlockhash = latestBlockhash.blockhash;
    finalizeTx.lastValidBlockHeight = latestBlockhash.lastValidBlockHeight;

    finalizeTx.sign(owner);

    await provider.sendAndConfirm(finalizeTx);
  }

  return sig;
}

/**
 * Read keypair from JSON file
 */
export function readKpJson(path: string): Keypair {
  const file = fs.readFileSync(path);
  return Keypair.fromSecretKey(new Uint8Array(JSON.parse(file.toString())));
}


/**
 * Initialize init_order_book computation definition
 */
export async function initInitOrderBookCompDef(
  program: Program<MatchingEngine>,
  owner: Keypair,
  uploadRawCircuit: boolean = false,
  offchainSource: boolean = false
): Promise<string> {
  const baseSeedCompDefAcc = getArciumAccountBaseSeed(
    "ComputationDefinitionAccount"
  );
  const offset = getCompDefAccOffset("init_order_book");

  const compDefPDA = PublicKey.findProgramAddressSync(
    [baseSeedCompDefAcc, program.programId.toBuffer(), offset],
    getArciumProgAddress()
  )[0];

  console.log("Init order book comp def PDA:", compDefPDA.toBase58());

  const sig = await program.methods
    .initOrderBookCompDef()
    .accounts({
      compDefAccount: compDefPDA,
      payer: owner.publicKey,
      mxeAccount: getMXEAccAddress(program.programId),
    })
    .signers([owner])
    .rpc({
      commitment: "confirmed",
    });

  console.log("Init init_order_book computation definition tx:", sig);

  const provider = program.provider as anchor.AnchorProvider;

  if (uploadRawCircuit) {
    const rawCircuit = fs.readFileSync("build/init_order_book.arcis");
    await uploadCircuit(
      provider,
      "init_order_book",
      program.programId,
      rawCircuit,
      true
    );
  } else if (!offchainSource) {
    const finalizeTx = await buildFinalizeCompDefTx(
      provider,
      Buffer.from(offset).readUInt32LE(),
      program.programId
    );

    const latestBlockhash = await provider.connection.getLatestBlockhash();
    finalizeTx.recentBlockhash = latestBlockhash.blockhash;
    finalizeTx.lastValidBlockHeight = latestBlockhash.lastValidBlockHeight;

    finalizeTx.sign(owner);

    await provider.sendAndConfirm(finalizeTx);
  }

  return sig;
}

/**
 * Initialize init_user_ledger computation definition
 */
export async function initInitUserLedgerCompDef(
  program: Program<MatchingEngine>,
  owner: Keypair,
  uploadRawCircuit: boolean = false,
  offchainSource: boolean = false
): Promise<string> {
  const baseSeedCompDefAcc = getArciumAccountBaseSeed(
    "ComputationDefinitionAccount"
  );
  const offset = getCompDefAccOffset("init_user_ledger");

  const compDefPDA = PublicKey.findProgramAddressSync(
    [baseSeedCompDefAcc, program.programId.toBuffer(), offset],
    getArciumProgAddress()
  )[0];

  console.log("Init user ledger comp def PDA:", compDefPDA.toBase58());

  const sig = await program.methods
    .initUserLedgerCompDef()
    .accounts({
      compDefAccount: compDefPDA,
      payer: owner.publicKey,
      mxeAccount: getMXEAccAddress(program.programId),
    })
    .signers([owner])
    .rpc({
      commitment: "confirmed",
    });

  console.log("Init init_user_ledger computation definition tx:", sig);

  const provider = program.provider as anchor.AnchorProvider;

  if (uploadRawCircuit) {
    const rawCircuit = fs.readFileSync("build/init_user_ledger.arcis");
    await uploadCircuit(
      provider,
      "init_user_ledger",
      program.programId,
      rawCircuit,
      true
    );
  } else if (!offchainSource) {
    const finalizeTx = await buildFinalizeCompDefTx(
      provider,
      Buffer.from(offset).readUInt32LE(),
      program.programId
    );

    const latestBlockhash = await provider.connection.getLatestBlockhash();
    finalizeTx.recentBlockhash = latestBlockhash.blockhash;
    finalizeTx.lastValidBlockHeight = latestBlockhash.lastValidBlockHeight;

    finalizeTx.sign(owner);

    await provider.sendAndConfirm(finalizeTx);
  }

  return sig;
}

/**
 * Initialize update_ledger_deposit computation definition
 */
export async function updateLedgerDepositCompDef(
  program: Program<MatchingEngine>,
  owner: Keypair,
  uploadRawCircuit: boolean = false,
  offchainSource: boolean = false
): Promise<string> {
  const baseSeedCompDefAcc = getArciumAccountBaseSeed(
    "ComputationDefinitionAccount"
  );
  const offset = getCompDefAccOffset("update_ledger_deposit");

  const compDefPDA = PublicKey.findProgramAddressSync(
    [baseSeedCompDefAcc, program.programId.toBuffer(), offset],
    getArciumProgAddress()
  )[0];

  console.log("Update ledger deposit comp def PDA:", compDefPDA.toBase58());

  const sig = await program.methods
    .initUpdateLedgerDepositCompDef()
    .accounts({
      compDefAccount: compDefPDA,
      payer: owner.publicKey,
      mxeAccount: getMXEAccAddress(program.programId),
    })
    .signers([owner])
    .rpc({
      commitment: "confirmed",
    });

  console.log("Init update_ledger_deposit computation definition tx:", sig);

  const provider = program.provider as anchor.AnchorProvider;

  if (uploadRawCircuit) {
    const rawCircuit = fs.readFileSync("build/update_ledger_deposit.arcis");
    await uploadCircuit(
      provider,
      "update_ledger_deposit",
      program.programId,
      rawCircuit,
      true
    );
  } else if (!offchainSource) {
    const finalizeTx = await buildFinalizeCompDefTx(
      provider,
      Buffer.from(offset).readUInt32LE(),
      program.programId
    );

    const latestBlockhash = await provider.connection.getLatestBlockhash();
    finalizeTx.recentBlockhash = latestBlockhash.blockhash;
    finalizeTx.lastValidBlockHeight = latestBlockhash.lastValidBlockHeight;

    finalizeTx.sign(owner);

    await provider.sendAndConfirm(finalizeTx);
  }

  return sig;
}

/**
 * Initialize withdraw_from_ledger_verify computation definition
 */
export async function withdrawFromLedgerVerifyCompDef(
  program: Program<MatchingEngine>,
  owner: Keypair,
  uploadRawCircuit: boolean = false,
  offchainSource: boolean = false
): Promise<string> {
  const baseSeedCompDefAcc = getArciumAccountBaseSeed(
    "ComputationDefinitionAccount"
  );
  const offset = getCompDefAccOffset("update_ledger_withdraw_verify");

  const compDefPDA = PublicKey.findProgramAddressSync(
    [baseSeedCompDefAcc, program.programId.toBuffer(), offset],
    getArciumProgAddress()
  )[0];

  console.log("Update ledger withdraw verify comp def PDA:", compDefPDA.toBase58());

  const sig = await program.methods
    .initUpdateLedgerWithdrawVerifyCompDef()
    .accounts({
      compDefAccount: compDefPDA,
      payer: owner.publicKey,
      mxeAccount: getMXEAccAddress(program.programId),
    })
    .signers([owner])
    .rpc({
      commitment: "confirmed",
    });

  console.log("Init update_ledger_withdraw_verify computation definition tx:", sig);

  const provider = program.provider as anchor.AnchorProvider;

  if (uploadRawCircuit) {
    const rawCircuit = fs.readFileSync("build/update_ledger_withdraw_verify.arcis");
    await uploadCircuit(
      provider,
      "update_ledger_withdraw_verify",
      program.programId,
      rawCircuit,
      true
    );
  } else if (!offchainSource) {
    const finalizeTx = await buildFinalizeCompDefTx(
      provider,
      Buffer.from(offset).readUInt32LE(),
      program.programId
    );

    const latestBlockhash = await provider.connection.getLatestBlockhash();
    finalizeTx.recentBlockhash = latestBlockhash.blockhash;
    finalizeTx.lastValidBlockHeight = latestBlockhash.lastValidBlockHeight;

    finalizeTx.sign(owner);

    await provider.sendAndConfirm(finalizeTx);
  }

  return sig;
}
