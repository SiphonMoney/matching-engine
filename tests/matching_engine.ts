import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  PublicKey,
  Keypair,
  LAMPORTS_PER_SOL,
  SystemProgram,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  TOKEN_PROGRAM_ID,
  getAccount,
  getOrCreateAssociatedTokenAccount,
} from "@solana/spl-token";
import { randomBytes } from "crypto";
import { BN } from "@coral-xyz/anchor";
import {
  awaitComputationFinalization,
  getArciumEnv,
  getCompDefAccOffset,
  getCompDefAccAddress,
  getMXEAccAddress,
  getMempoolAccAddress,
  getExecutingPoolAccAddress,
  getComputationAccAddress,
  deserializeLE,
  x25519,
  getArciumProgramId,
  // getClockAccAddress,
  RescueCipher,
  getClusterAccAddress,
} from "@arcium-hq/client";
import * as os from "os";
import { expect } from "chai";
import {
  setupUserEncryption,
  getMXEPublicKeyWithRetry,
  generateNonce,
} from "./helpers/encryption";
import {
  deriveOrderbookPDA,
  deriveOrderAccountPDA,
  deriveVaultStatePDA,
  deriveVaultAuthorityPDA,
  getOrderBookState,
  getOrderAccount,
  accountExists,
  airdrop,
  deriveVaultPDA,
  createATAAndMintTokens,
  deriveUserLedgerPDA,
  deriveOrderbook,
} from "./helpers/accounts";
import {
  initSubmitOrderCompDef,
  initMatchOrdersCompDef,
  initInitOrderBookCompDef,
  initInitUserLedgerCompDef,
  updateLedgerDepositCompDef,
  withdrawFromLedgerVerifyCompDef,
  readKpJson,
  initSubmitOrderCheckCompDef,
} from "./helpers/computation";
import { MatchingEngine } from "../target/types/matching_engine";
import MatchingEngineIDL from "../target/idl/matching_engine.json";

describe("Dark Pool Matching Engine - Core Functionality Tests", async () => {
  const useDevnet = false;

  const authority = readKpJson(`${os.homedir()}/.config/solana/id.json`);

  let provider: anchor.AnchorProvider;
  let program: Program<MatchingEngine>;
  let clusterAccount: PublicKey;

  if (useDevnet) {
    // Devnet configuration
    const connection = new anchor.web3.Connection(
      "https://devnet.helius-rpc.com/?api-key=daa43648-936f-40e1-9303-2ea12ba55a2a", // or your preferred RPC
      "confirmed"
    );
    const wallet = new anchor.Wallet(authority);
    provider = new anchor.AnchorProvider(connection, wallet, {
      commitment: "confirmed",
    });
    program = new anchor.Program<MatchingEngine>(
      MatchingEngineIDL as anchor.Idl,
      provider
    );
    clusterAccount = getClusterAccAddress(1078779259); // cluster offset for the arcium testnet
    console.log(
      "==================================================================================================================================:",
      clusterAccount.toBase58()
    );
  } else {
    // Local configuration
    anchor.setProvider(anchor.AnchorProvider.env());
    provider = anchor.getProvider() as anchor.AnchorProvider;
    program = anchor.workspace.MatchingEngine as Program<MatchingEngine>;
    const arciumEnv = getArciumEnv();
    clusterAccount = arciumEnv.arciumClusterPubkey;
  }

  let backendKeypair: Keypair;
  let backendSecretKey: Uint8Array;
  let backendPublicKey: Uint8Array;
  let mxePublicKey: Uint8Array;
  let user1: Keypair;
  let user2: Keypair;
  let baseMint: PublicKey;
  let quoteMint: PublicKey;
  let OrderbookPDA: PublicKey;
  let user1token1ATA: PublicKey;
  let user1token2ATA: PublicKey;
  let user2token1ATA: PublicKey;
  let user2token2ATA: PublicKey;
  let ata1: PublicKey;
  let ata2: PublicKey;
  let ata3: PublicKey;
  let ata4: PublicKey;
  let User1Cipher: RescueCipher;
  let User1SharedSecret: Uint8Array;
  const scaleFactor: number = 100;

  const User1PrivateKey = x25519.utils.randomSecretKey();
  const User1PublicKey = x25519.getPublicKey(User1PrivateKey);
  const User2PrivateKey = x25519.utils.randomSecretKey();
  const User2PublicKey = x25519.getPublicKey(User2PrivateKey);


  // Event helper
  type Event = anchor.IdlEvents<(typeof program)["idl"]>;
  const awaitEvent = async <E extends keyof Event>(
    eventName: E,
    timeoutMs = 60000
  ): Promise<Event[E]> => {
    let listenerId: number;
    let timeoutId: NodeJS.Timeout;
    const event = await new Promise<Event[E]>((res, rej) => {
      listenerId = program.addEventListener(eventName as any, (event) => {
        if (timeoutId) clearTimeout(timeoutId);
        res(event);
      });
      timeoutId = setTimeout(() => {
        program.removeEventListener(listenerId);
        rej(new Error(`Event ${eventName} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });
    await program.removeEventListener(listenerId);
    return event;
  };

  before(async () => {
    console.log("\n========================================");
    console.log("Setting up test environment...");
    console.log("========================================\n");

    // Load authority from default Solana config
    console.log("Authority:", authority.publicKey.toBase58());

    // Generate test accounts
    backendKeypair = Keypair.generate();
    // user1 = Keypair.generate();
    user1 = readKpJson(`./user1.json`);
    user2 = Keypair.generate();

    console.log("Backend:", backendKeypair.publicKey.toBase58());
    console.log("User 1:", user1.publicKey.toBase58());
    console.log("User 2:", user2.publicKey.toBase58());

    if (!useDevnet) {
      await airdrop(provider, user1.publicKey, 100 * LAMPORTS_PER_SOL);
      await airdrop(provider, user2.publicKey, 100 * LAMPORTS_PER_SOL);
      await airdrop(provider, backendKeypair.publicKey, 100 * LAMPORTS_PER_SOL);
    }

    // initialize a payer account to make token mints and their authority.
    // const mintAuthority = Keypair.generate();
    const mintAuthority = readKpJson(`./tests/mint_authority.json`);
    console.log("MintAuthority:", mintAuthority.publicKey.toBase58());
    if (!useDevnet) {
      await airdrop(provider, mintAuthority.publicKey, 100 * LAMPORTS_PER_SOL);
    }

    const mintAuthorityBalance = await provider.connection.getBalance(
      mintAuthority.publicKey
    );
    const user1Balance = await provider.connection.getBalance(user1.publicKey);
    const user2Balance = await provider.connection.getBalance(user2.publicKey);
    console.log(
      "MintAuthority balance:",
      mintAuthorityBalance / LAMPORTS_PER_SOL,
      "SOL"
    );
    console.log("User1 balance:", user1Balance / LAMPORTS_PER_SOL, "SOL");
    console.log("User2 balance:", user2Balance / LAMPORTS_PER_SOL, "SOL");

    // make two different tokens with same authority and then mint those tokens to both the users
    const token1Mint = await createMint(
      provider.connection,
      mintAuthority,
      mintAuthority.publicKey,
      null,
      9
    );
    const token2Mint = await createMint(
      provider.connection,
      mintAuthority,
      mintAuthority.publicKey,
      null,
      9
    );
    const ata1 = await createATAAndMintTokens(
      provider,
      user1.publicKey,
      token1Mint,
      mintAuthority,
      1000*scaleFactor
    );
    const ata2 = await createATAAndMintTokens(
      provider,
      user1.publicKey,
      token2Mint,
      mintAuthority,
      1000*scaleFactor
    );

    const ata3 = await createATAAndMintTokens(
      provider,
      user2.publicKey,
      token1Mint,
      mintAuthority,
      1000*scaleFactor
    );
    const ata4 = await createATAAndMintTokens(
      provider,
      user2.publicKey,
      token2Mint,
      mintAuthority,
      1000*scaleFactor
    );
    console.log("Minted tokens to users\n");

    // For now, use placeholder mints (in real test, create actual SPL tokens)
    baseMint = token1Mint;
    quoteMint = token2Mint;
    user1token1ATA = ata1;
    user1token2ATA = ata2;
    user2token1ATA = ata3;
    user2token2ATA = ata4;
    console.log("programId", program.programId.toBase58());
    [OrderbookPDA] = deriveOrderbookPDA(program.programId);
    console.log("Orderbook PDA:", OrderbookPDA.toBase58());
  });

  describe("Suite 1.1: Program Initialization", () => {
    it("Test 1.1.1: Should initialize program with correct state", async () => {
      console.log("\n--- Test 1.1.1: Initialize Program ---");

      // Generate x25519 keypair for backend encryption (needed for verification)
      backendSecretKey = x25519.utils.randomSecretKey();
      backendPublicKey = x25519.getPublicKey(backendSecretKey);

      // Check if account already exists
      const accountAlreadyExists = await accountExists(provider, OrderbookPDA);
      console.log(
        "OrderBookState account already exists:",
        accountAlreadyExists
      );

      const [baseVaultPDA] = deriveVaultPDA(baseMint, program.programId);
      const [quoteVaultPDA] = deriveVaultPDA(quoteMint, program.programId);

      const [vaultAuthorityPDA] = deriveVaultAuthorityPDA(program.programId);

      if (!accountAlreadyExists) {
        // Initialize program
        const tx = await program.methods
          .initialize(Array.from(backendPublicKey), baseMint, quoteMint)
          .accountsPartial({
            authority: authority.publicKey,
            orderbookState: OrderbookPDA,
            systemProgram: SystemProgram.programId,
            baseVault: baseVaultPDA,
            quoteVault: quoteVaultPDA,
            baseMint: baseMint,
            quoteMint: quoteMint,
            vaultAuthority: vaultAuthorityPDA,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([authority])
          .rpc({ commitment: "confirmed" });

        console.log("Initialize tx:", tx);

        // Wait a moment for the account to be created
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } else {
        console.log("Skipping initialization - account already exists");
      }

      // Fetch and verify account state
      const orderBookState = await getOrderBookState(program);
      // console.log("OrderBookState fetched:", orderBookState);

      // Assertions
      expect(orderBookState).to.exist;
      expect(orderBookState.authority.toString()).to.equal(
        authority.publicKey.toString(),
        "Authority should match"
      );

      expect(orderBookState.orderbookNonce.toString()).to.equal(
        "0",
        "Initial orderbook nonce should be 0"
      );

      expect(Buffer.from(orderBookState.backendPubkey)).to.deep.equal(
        Buffer.from(backendPublicKey),
        "Backend pubkey should match"
      );

      expect(orderBookState.baseMint.toString()).to.equal(
        baseMint.toString(),
        "Base mint should match"
      );

      expect(orderBookState.quoteMint.toString()).to.equal(
        quoteMint.toString(),
        "Quote mint should match"
      );

      expect(orderBookState.totalOrdersProcessed.toString()).to.equal(
        "0",
        "Total orders should be 0"
      );

      expect(orderBookState.totalMatches.toString()).to.equal(
        "0",
        "Total matches should be 0"
      );

      // Verify orderbook data is initialized (all zeros)
      // const allZeros = orderBookState.orderbookData.every(
      //   (byte: number) => byte === 0
      // );
      // expect(allZeros).to.be.true;

      console.log("✓ Program initialized successfully");
      console.log("  - Authority:", orderBookState.authority.toBase58());
      // console.log("  - Orderbook nonce:", orderBookState.orderBookNonce.toString());
      console.log("  - Base mint:", orderBookState.baseMint.toBase58());
      console.log("  - Quote mint:", orderBookState.quoteMint.toBase58());
    });

    it("Test 1.1.2: Should initialize computation definitions", async () => {
      console.log("\n--- Test 1.1.2: Initialize Computation Definitions ---");

      console.log("Initializing submit_order computation definition...");
      let submitOrderCompDefSig;
      try {
        submitOrderCompDefSig = await initSubmitOrderCompDef(
          program,
          authority,
          false,
          false
        );
        console.log("Submit order comp def sig:", submitOrderCompDefSig);
      } catch (error) {
        if (error.message.includes("already in use")) {
          console.log("Submit order comp def already exists, skipping...");
          submitOrderCompDefSig = "already_exists";
        } else {
          throw error;
        }
      }
      expect(submitOrderCompDefSig).to.exist;

      console.log("\nInitializing match_orders computation definition...");
      let matchOrdersCompDefSig;
      try {
        matchOrdersCompDefSig = await initMatchOrdersCompDef(
          program,
          authority,
          false,
          false
        );
        console.log("Match orders comp def sig:", matchOrdersCompDefSig);
      } catch (error) {
        if (error.message.includes("already in use")) {
          console.log("Match orders comp def already exists, skipping...");
          matchOrdersCompDefSig = "already_exists";
        } else {
          throw error;
        }
      }
      expect(matchOrdersCompDefSig).to.exist;

      console.log("Initializing init_user_ledger computation definition...");
      let initUserLedgerCompDefSig;
      try {
        initUserLedgerCompDefSig = await initInitUserLedgerCompDef(
          program,
          authority,
          false,
          false
        );
        console.log("Init user ledger comp def sig:", initUserLedgerCompDefSig);
      } catch (error) {
        if (error.message.includes("already in use")) {
          console.log("Init user ledger comp def already exists, skipping...");
          initUserLedgerCompDefSig = "already_exists";
        } else {
          throw error;
        }
      }
      expect(initUserLedgerCompDefSig).to.exist;

      console.log(
        "Initializing update_ledger_deposit computation definition..."
      );
      let updateLedgerDepositCompDefSig;
      try {
        updateLedgerDepositCompDefSig = await updateLedgerDepositCompDef(
          program,
          authority,
          false,
          false
        );
        console.log(
          "Update ledger deposit comp def sig:",
          updateLedgerDepositCompDefSig
        );
      } catch (error) {
        if (error.message.includes("already in use")) {
          console.log(
            "Update ledger deposit comp def already exists, skipping..."
          );
          updateLedgerDepositCompDefSig = "already_exists";
        } else {
          throw error;
        }
      }
      expect(updateLedgerDepositCompDefSig).to.exist;

      console.log(
        "Initializing withdraw_from_ledger_verify computation definition..."
      );
      let withdrawFromLedgerVerifyCompDefSig;
      try {
        withdrawFromLedgerVerifyCompDefSig =
          await withdrawFromLedgerVerifyCompDef(
            program,
            authority,
            false,
            false
          );
        console.log(
          "Withdraw from ledger verify comp def sig:",
          withdrawFromLedgerVerifyCompDefSig
        );
      } catch (error) {
        if (error.message.includes("already in use")) {
          console.log(
            "Withdraw from ledger verify comp def already exists, skipping..."
          );
          withdrawFromLedgerVerifyCompDefSig = "already_exists";
        } else {
          throw error;
        }
      }
      expect(withdrawFromLedgerVerifyCompDefSig).to.exist;

      console.log("Initializing submit_order_check computation definition...");
      let submitOrderCheckCompDefSig;
      try {
        submitOrderCheckCompDefSig = await initSubmitOrderCheckCompDef(
          program,
          authority,
          false,
          false
        );
        console.log(
          "Submit order check comp def sig:",
          submitOrderCheckCompDefSig
        );
      } catch (error) {
        if (error.message.includes("already in use")) {
          console.log(
            "Submit order check comp def already exists, skipping..."
          );
          submitOrderCheckCompDefSig = "already_exists";
        } else {
          throw error;
        }
      }
      expect(submitOrderCheckCompDefSig).to.exist;

      // await setTimeout(async () => {
      //   console.log("wait for compdef to maybe get up for real for a minute")
      // }, 60*1000);

      console.log(
        "================================================================================="
      );

      // Verify comp defs are accessible
      const submitOrderCompDefPDA = getCompDefAccAddress(
        program.programId,
        Buffer.from(getCompDefAccOffset("submit_order")).readUInt32LE()
      );

      const matchOrdersCompDefPDA = getCompDefAccAddress(
        program.programId,
        Buffer.from(getCompDefAccOffset("match_orders")).readUInt32LE()
      );

      // Fetch accounts to verify they exist
      const submitOrderCompDef = await provider.connection.getAccountInfo(
        submitOrderCompDefPDA
      );
      expect(submitOrderCompDef).to.exist;

      const matchOrdersCompDef = await provider.connection.getAccountInfo(
        matchOrdersCompDefPDA
      );
      expect(matchOrdersCompDef).to.exist;

      console.log("✓ Computation definitions initialized successfully");
      console.log(
        "  - submit_order comp def PDA:",
        submitOrderCompDefPDA.toBase58()
      );
      console.log(
        "  - match_orders comp def PDA:",
        matchOrdersCompDefPDA.toBase58()
      );
    });

    it("Test 1.1.3: Should retrieve MXE public key", async () => {
      console.log("\n--- Test 1.1.3: Retrieve MXE Public Key ---");

      const mxePublicKey = await getMXEPublicKeyWithRetry(
        provider,
        program.programId
      );

      expect(mxePublicKey).to.exist;
      expect(mxePublicKey.length).to.equal(
        32,
        "MXE public key should be 32 bytes"
      );

      console.log("✓ MXE public key retrieved successfully");
      console.log(
        "  - MXE pubkey (hex):",
        Buffer.from(mxePublicKey).toString("hex")
      );

      // Test key exchange
      const userPrivateKey = x25519.utils.randomSecretKey();
      const sharedSecret = x25519.getSharedSecret(userPrivateKey, mxePublicKey);

      expect(sharedSecret).to.exist;
      expect(sharedSecret.length).to.equal(
        32,
        "Shared secret should be 32 bytes"
      );

      console.log("✓ Key exchange works correctly");
    });
  });

  describe("Suite 1.2: Vault Management", () => {
    it("Test 1.2.1: Should initialize user vault (base + quote)", async () => {
      console.log("\n--- Test 1.2.1: Initialize User Vaults ---");

      // TODO: Implement vault initialization
      // This requires the initialize_vault instruction to be implemented
      console.log("⚠ Vault initialization test - To be implemented");
      console.log("  Requires: initialize_vault instruction");
      console.log("  Creates: VaultState PDAs for base and quote tokens");
    });

    it("Test 1.2.2: Should deposit tokens to vault", async () => {
      console.log("\n--- Test 1.2.2: Deposit to Vault ---");

      // TODO: Implement deposit test
      console.log("⚠ Deposit test - To be implemented");
      console.log("  Requires: deposit_to_vault instruction");
    });

    it("Test 1.2.3: Should track vault state correctly", async () => {
      console.log("\n--- Test 1.2.3: Track Vault State ---");

      // TODO: Implement vault state tracking test
      console.log("⚠ Vault state tracking test - To be implemented");
    });

    it("Test 1.2.4: Should withdraw from vault", async () => {
      console.log("\n--- Test 1.2.4: Withdraw from Vault ---");

      // TODO: Implement withdrawal test
      console.log("⚠ Withdrawal test - To be implemented");
      console.log("  Requires: withdraw_from_vault instruction");
    });
  });

  describe("Suite 1.3: Order Submission", () => {
    it("Should submit buy order", async () => {
      let submitOrderCompDefSig;
      try {
        submitOrderCompDefSig = await initSubmitOrderCompDef(
          program,
          authority,
          false,
          false
        );
        console.log("Submit order comp def sig:", submitOrderCompDefSig);
      } catch (error) {
        if (error.message.includes("already in use")) {
          console.log("Submit order comp def already exists, skipping...");
          submitOrderCompDefSig = "already_exists";
        } else {
          throw error;
        }
      }
      expect(submitOrderCompDefSig).to.exist;

      let matchOrdersCompDefSig;
      try {
        matchOrdersCompDefSig = await initMatchOrdersCompDef(
          program,
          authority,
          false,
          false
        );
        console.log("Match orders comp def sig:", matchOrdersCompDefSig);
      } catch (error) {
        if (error.message.includes("already in use")) {
          console.log("Match orders comp def already exists, skipping...");
          matchOrdersCompDefSig = "already_exists";
        } else {
          throw error;
        }
      }
      expect(matchOrdersCompDefSig).to.exist;

      let initOrderBookCompDefSig;
      try {
        initOrderBookCompDefSig = await initInitOrderBookCompDef(
          program,
          authority,
          false,
          false
        );
      } catch (error) {
        if (error.message.includes("already in use")) {
          console.log("Init order book comp def already exists, skipping...");
          initOrderBookCompDefSig = "already_exists";
        } else {
          throw error;
        }
      }
      expect(initOrderBookCompDefSig).to.exist;

      let initUserLedgerCompDefSig;
      try {
        initUserLedgerCompDefSig = await initInitUserLedgerCompDef(
          program,
          authority,
          false,
          false
        );
        console.log("Init user ledger comp def sig:", initUserLedgerCompDefSig);
      } catch (error) {
        if (error.message.includes("already in use")) {
          console.log("Init user ledger comp def already exists, skipping...");
          initUserLedgerCompDefSig = "already_exists";
        } else {
          throw error;
        }
      }
      expect(initUserLedgerCompDefSig).to.exist;

      let updateLedgerDepositCompDefSig;
      try {
        updateLedgerDepositCompDefSig = await updateLedgerDepositCompDef(
          program,
          authority,
          false,
          false
        );
        console.log(
          "Update ledger deposit comp def sig:",
          updateLedgerDepositCompDefSig
        );
      } catch (error) {
        if (error.message.includes("already in use")) {
          console.log(
            "Update ledger deposit comp def already exists, skipping..."
          );
          updateLedgerDepositCompDefSig = "already_exists";
        } else {
          throw error;
        }
      }
      expect(updateLedgerDepositCompDefSig).to.exist;

      // 1. Setup encryption
      const { publicKey, cipher } = await setupUserEncryption(
        provider,
        program.programId
      );

      const [baseVaultPDA] = deriveVaultPDA(baseMint, program.programId);
      const [quoteVaultPDA] = deriveVaultPDA(quoteMint, program.programId);

      const [vaultStatePDA] = deriveVaultStatePDA(
        baseMint,
        user1.publicKey,
        program.programId
      );
      const [vaultAuthorityPDA] = deriveVaultAuthorityPDA(program.programId);

      const [userLedgerPDA] = deriveUserLedgerPDA(
        user1.publicKey,
        program.programId
      );

      const InitUserLedgerComputationOffset = new anchor.BN(
        randomBytes(8),
        "hex"
      );
      const UpdateLedgerDepositComputationOffset = new anchor.BN(
        randomBytes(8),
        "hex"
      );

      // Get MXE public key
      mxePublicKey = await getMXEPublicKeyWithRetry(
        provider as anchor.AnchorProvider,
        program.programId
      );

      const User1SharedSecret = x25519.getSharedSecret(
        User1PrivateKey,
        mxePublicKey
      );
      const User1Cipher = new RescueCipher(User1SharedSecret);

      const userLedgerNonce = randomBytes(16);

      const initializeUserLedgerPromise = awaitEvent(
        "userLedgerInitializedEvent"
      );

      console.log(
        "initializing user ledger======================================================="
      );
      // list all the accounts that are needed for the initialize user ledger instruction
      console.log("accounts needed for the initialize user ledger instruction");
      console.log(
        "computationAccount",
        getComputationAccAddress(
          program.programId,
          InitUserLedgerComputationOffset
        )
      );
      console.log("user", user1.publicKey.toBase58());
      console.log("clusterAccount", clusterAccount.toBase58());
      console.log("mxeAccount", getMXEAccAddress(program.programId).toBase58());
      console.log(
        "mempoolAccount",
        getMempoolAccAddress(program.programId).toBase58()
      );
      console.log(
        "executingPool",
        getExecutingPoolAccAddress(program.programId).toBase58()
      );
      console.log(
        "compDefAccount",
        getCompDefAccAddress(
          program.programId,
          Buffer.from(getCompDefAccOffset("init_user_ledger")).readUInt32LE()
        ).toBase58()
      );
      console.log("systemProgram", SystemProgram.programId.toBase58());
      console.log("arciumProgram", getArciumProgramId().toBase58());
      console.log("userLedger", userLedgerPDA.toBase58());
      const [OrderbookflatPDA] = deriveOrderbook(program.programId);

      console.log("we are entering to initialize the encrypted orderbook");

      const initEncryptedOrderbookNonce = randomBytes(16);

      const initEncryptedOrderbookComputationOffset = new anchor.BN(
        randomBytes(8),
        "hex"
      );

      const initEncryptedOrderbookTx = await program.methods
        .initEncryptedOrderbook(
          initEncryptedOrderbookComputationOffset,
          new anchor.BN(deserializeLE(initEncryptedOrderbookNonce).toString())
        )
        .accounts({
          computationAccount: getComputationAccAddress(
            program.programId,
            initEncryptedOrderbookComputationOffset
          ),
          payer: authority.publicKey,
          mxeAccount: getMXEAccAddress(program.programId),
          mempoolAccount: getMempoolAccAddress(program.programId),
          executingPool: getExecutingPoolAccAddress(program.programId),
          compDefAccount: getCompDefAccAddress(
            program.programId,
            Buffer.from(getCompDefAccOffset("init_order_book")).readUInt32LE()
          ),
          clusterAccount: clusterAccount,
          orderbookState: OrderbookPDA,
        })
        .signers([authority])
        .rpc({ commitment: "confirmed" });

      console.log(
        "Encrypted orderbook initialized with signature:",
        initEncryptedOrderbookTx
      );

      // Wait for initGame computation finalization
      const initEncryptedOrderbookFinalizeSig =
        await awaitComputationFinalization(
          provider as anchor.AnchorProvider,
          initEncryptedOrderbookComputationOffset,
          program.programId,
          "confirmed"
        );
      console.log(
        "Init game finalize signature:",
        initEncryptedOrderbookFinalizeSig
      );

      const orderBookStatenew = await getOrderBookState(program);
      console.log("orderBookState new", orderBookStatenew);

      // initlialize a user ledger and then deposit to the ledger

      try {
        await program.methods
          .initializeUserLedger(
            Array.from(User1PublicKey),
            new anchor.BN(deserializeLE(userLedgerNonce).toString()),
            InitUserLedgerComputationOffset
          )
          .accountsPartial({
            computationAccount: getComputationAccAddress(
              program.programId,
              InitUserLedgerComputationOffset
            ),
            user: user1.publicKey,
            clusterAccount: clusterAccount,
            mxeAccount: getMXEAccAddress(program.programId),
            mempoolAccount: getMempoolAccAddress(program.programId),
            executingPool: getExecutingPoolAccAddress(program.programId),
            compDefAccount: getCompDefAccAddress(
              program.programId,
              Buffer.from(
                getCompDefAccOffset("init_user_ledger")
              ).readUInt32LE()
            ),
            systemProgram: SystemProgram.programId,
            arciumProgram: getArciumProgramId(),
            userLedger: userLedgerPDA,
          })
          .signers([user1])
          .rpc({ commitment: "confirmed" });
      } catch (error) {
        const log = await error.getLogs();
        console.log("log", log);
      }

      const info11 = await program.account.userPrivateLedger.fetch(
        userLedgerPDA
      );
      console.log("user ledger account info 2", info11);

      await awaitComputationFinalization(
        provider,
        InitUserLedgerComputationOffset,
        program.programId,
        "confirmed"
      );
      const initializeUserLedgerEvent = await initializeUserLedgerPromise;
      console.log(
        "initialized user ledger event for",
        initializeUserLedgerEvent.user.toBase58()
      );

      const info12 = await program.account.userPrivateLedger.fetch(
        userLedgerPDA
      );
      console.log("user ledger account info 3", info12);

      console.log("User ledger initialized");

      console.log("entering deposit to ledger");

      const userLedgerDepositedPromise = awaitEvent("userLedgerDepositedEvent");

      await program.methods
        .depositToLedger(
          Array.from(User1PublicKey),
          new BN(100 * scaleFactor),
          true,
          UpdateLedgerDepositComputationOffset
        )
        .accounts({
          computationAccount: getComputationAccAddress(
            program.programId,
            UpdateLedgerDepositComputationOffset
          ),
          user: user1.publicKey,
          clusterAccount: clusterAccount,
          mxeAccount: getMXEAccAddress(program.programId),
          mempoolAccount: getMempoolAccAddress(program.programId),
          executingPool: getExecutingPoolAccAddress(program.programId),
          compDefAccount: getCompDefAccAddress(
            program.programId,
            Buffer.from(
              getCompDefAccOffset("update_ledger_deposit")
            ).readUInt32LE()
          ),
          systemProgram: SystemProgram.programId,
          arciumProgram: getArciumProgramId(),
          userLedger: userLedgerPDA,
          mint: baseMint,
          vault: baseVaultPDA,
          userTokenAccount: user1token1ATA,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          vaultAuthority: vaultAuthorityPDA,
        })
        .signers([user1])
        .rpc({ commitment: "confirmed" });

      await awaitComputationFinalization(
        provider,
        UpdateLedgerDepositComputationOffset,
        program.programId,
        "confirmed"
      );
      console.log("Tokens deposited to ledger");

      const userLedgerDepositedEvent = await userLedgerDepositedPromise;

      const userLedgerDepositedEventNonce = Uint8Array.from(
        userLedgerDepositedEvent.balanceNonce.toArray("le", 16)
      );

      let userBalances = User1Cipher.decrypt(
        [...userLedgerDepositedEvent.encryptedBalances],
        userLedgerDepositedEventNonce
      );
      console.log(
        "userBalances==============================================================>",
        userBalances
      );
      // check if the vault does have the correct amount of tokens
      const vaultInfo = await getAccount(provider.connection, baseVaultPDA);
      console.log("vault info", vaultInfo);
      // expect(vaultInfo.amount.toString()).to.equal(new BN(100).toString());
      const vaultInfo2 = await getAccount(provider.connection, user1token1ATA);
      console.log("user1token1ATA info", vaultInfo2);
      const vaultInfo3 = await getAccount(provider.connection, user1token2ATA);
      console.log("user1token2ATA info", vaultInfo3);

      // 2. Prepare order (using smaller values to reduce stack usage)
      const amount = 10 * scaleFactor;
      const price = 5 * scaleFactor;
      const submitOrderComputationOffset = new anchor.BN(randomBytes(8), "hex");

      const orderId = 12;

      const [orderAccountPDA] = deriveOrderAccountPDA(
        new anchor.BN(orderId),
        program.programId
      );

      const User1Nonce = randomBytes(16);
      const User1Ciphertext = User1Cipher.encrypt(
        [BigInt(amount), BigInt(price)],
        User1Nonce
      );

      const orderSubmittedCheckSuccessPromise = awaitEvent(
        "orderSubmittedCheckSuccessEvent"
      );
      const orderSubmittedCheckFailedPromise = awaitEvent(
        "orderSubmittedCheckFailedEvent"
      );

      console.log(
        "before the submit order check================================="
      );

      const submitOrderCheckComputationOffset = new anchor.BN(
        randomBytes(8),
        "hex"
      );
      const submitOrderCheckTx = await program.methods
        .submitOrderCheck(
          Array.from(User1Ciphertext[0]),
          Array.from(User1Ciphertext[1]),
          Array.from(User1PublicKey),
          0, // buy
          submitOrderCheckComputationOffset,
          new anchor.BN(orderId),
          new anchor.BN(deserializeLE(User1Nonce).toString())
        )
        .accountsPartial({
          computationAccount: getComputationAccAddress(
            program.programId,
            submitOrderCheckComputationOffset
          ),
          user: user1.publicKey,
          clusterAccount: clusterAccount,
          mxeAccount: getMXEAccAddress(program.programId),
          mempoolAccount: getMempoolAccAddress(program.programId),
          executingPool: getExecutingPoolAccAddress(program.programId),
          compDefAccount: getCompDefAccAddress(
            program.programId,
            Buffer.from(
              getCompDefAccOffset("submit_order_check")
            ).readUInt32LE()
          ),
          systemProgram: SystemProgram.programId,
          arciumProgram: getArciumProgramId(),
          baseMint: baseMint,
          vault: baseVaultPDA,
          orderAccount: orderAccountPDA,
          userLedger: userLedgerPDA,
        })
        .signers([user1])
        .rpc({ commitment: "confirmed" });

      console.log("submitOrderCheckTx", submitOrderCheckTx);

      await awaitComputationFinalization(
        provider,
        submitOrderCheckComputationOffset,
        program.programId,
        "confirmed"
      );

      console.log("submitOrderCheck completed");

      //check the contents of the order account
      const orderAccount = await program.account.orderAccount.fetch(
        orderAccountPDA
      );

      // decryypt the content of the order account's encryptedOrder field
      const decryptedOrder = User1Cipher.decrypt(
        [...orderAccount.encryptedOrder],
        Uint8Array.from(orderAccount.orderNonce.toArray("le", 16))
      );
      console.log("decrypted order", decryptedOrder);

      let success = false;

      try {
        const submitOrderCheckEvent = await Promise.race([
          orderSubmittedCheckSuccessPromise,
          orderSubmittedCheckFailedPromise,
        ]);

        console.log("submitOrderCheckEvent", submitOrderCheckEvent);

        if ("success" in submitOrderCheckEvent) {
          console.log("Received OrderSubmittedCheckSuccessEvent.");
          success = true;

          // console.log("user balances", userBalances);
        } else {
          console.log("Received OrderSubmittedCheckFailedEvent.");
        }
      } catch (e) {
        console.error("Error waiting for withdraw verify event:", e);
        throw e;
      }

      // ========== STEP 2: If verified, cranker executes order submission on the encrypted orderbook ==========
      if (success) {
        console.log("\n🤖 STEP 2: cranker executing order submission...");
        const tx = await program.methods
          .submitOrder(
            Array.from(User1Ciphertext[0]),
            Array.from(User1Ciphertext[1]),
            Array.from(User1PublicKey),
            0, // buy
            submitOrderComputationOffset,
            new anchor.BN(orderId),
            new anchor.BN(deserializeLE(User1Nonce).toString())
          )
          .accountsPartial({
            computationAccount: getComputationAccAddress(
              program.programId,
              submitOrderComputationOffset
            ),
            user: user1.publicKey,
            clusterAccount: clusterAccount,
            mxeAccount: getMXEAccAddress(program.programId),
            mempoolAccount: getMempoolAccAddress(program.programId),
            executingPool: getExecutingPoolAccAddress(program.programId),
            compDefAccount: getCompDefAccAddress(
              program.programId,
              Buffer.from(getCompDefAccOffset("submit_order")).readUInt32LE()
            ),
            systemProgram: SystemProgram.programId,
            arciumProgram: getArciumProgramId(),
            baseMint: baseMint,
            vault: baseVaultPDA,
            orderbookState: OrderbookPDA,
          })
          .signers([user1])
          .rpc({ commitment: "confirmed" });

        console.log("tx", tx);

        // 6. Wait for MPC finalization
        await awaitComputationFinalization(
          provider,
          submitOrderComputationOffset,
          program.programId,
          "confirmed"
        );

        console.log("\n✅ ==============================Order submitted successfully===========================!");
        const userLedger = await program.account.userPrivateLedger.fetch(
          userLedgerPDA
        );
  
        const thisnonce = Uint8Array.from(
          userLedger.balanceNonce.toArray("le", 16)
        );
        const userLedgerBalances = User1Cipher.decrypt(
          [...userLedger.encryptedBalances],
          thisnonce
        );
        console.log("user ledger balances", userLedgerBalances);
      } else {
        throw new Error("No event received - something went wrong!");
      }
    });


    it("Should submit sell order", async () => {

      // 1. Setup encryption
      const [baseVaultPDA] = deriveVaultPDA(baseMint, program.programId);
      const [quoteVaultPDA] = deriveVaultPDA(quoteMint, program.programId);

      const [vaultAuthorityPDA] = deriveVaultAuthorityPDA(program.programId);

      const [userLedgerPDA] = deriveUserLedgerPDA(
        user2.publicKey,
        program.programId
      );

      const InitUserLedgerComputationOffset = new anchor.BN(
        randomBytes(8),
        "hex"
      );
      const UpdateLedgerDepositComputationOffset = new anchor.BN(
        randomBytes(8),
        "hex"
      );

      // Get MXE public key
      mxePublicKey = await getMXEPublicKeyWithRetry(
        provider as anchor.AnchorProvider,
        program.programId
      );

      const User2SharedSecret = x25519.getSharedSecret(
        User2PrivateKey,
        mxePublicKey
      );
      const User2Cipher = new RescueCipher(User2SharedSecret);

      const userLedgerNonce = randomBytes(16);

      const initializeUserLedgerPromise = awaitEvent(
        "userLedgerInitializedEvent"
      );

      console.log(
        "initializing user ledger======================================================="
      );
      // list all the accounts that are needed for the initialize user ledger instruction
      console.log("accounts needed for the initialize user ledger instruction");
      console.log(
        "computationAccount",
        getComputationAccAddress(
          program.programId,
          InitUserLedgerComputationOffset
        )
      );
      console.log("user", user2.publicKey.toBase58());
      console.log("clusterAccount", clusterAccount.toBase58());
      console.log("mxeAccount", getMXEAccAddress(program.programId).toBase58());
      console.log(
        "mempoolAccount",
        getMempoolAccAddress(program.programId).toBase58()
      );
      console.log(
        "executingPool",
        getExecutingPoolAccAddress(program.programId).toBase58()
      );
      console.log(
        "compDefAccount",
        getCompDefAccAddress(
          program.programId,
          Buffer.from(getCompDefAccOffset("init_user_ledger")).readUInt32LE()
        ).toBase58()
      );
      console.log("systemProgram", SystemProgram.programId.toBase58());
      console.log("arciumProgram", getArciumProgramId().toBase58());
      console.log("userLedger", userLedgerPDA.toBase58());
      const [OrderbookflatPDA] = deriveOrderbook(program.programId);

      console.log("we are entering to initialize the encrypted orderbook");

      const initEncryptedOrderbookNonce = randomBytes(16);

      const initEncryptedOrderbookComputationOffset = new anchor.BN(
        randomBytes(8),
        "hex"
      );

      // const initEncryptedOrderbookTx = await program.methods
      //   .initEncryptedOrderbook(
      //     initEncryptedOrderbookComputationOffset,
      //     new anchor.BN(deserializeLE(initEncryptedOrderbookNonce).toString())
      //   )
      //   .accounts({
      //     computationAccount: getComputationAccAddress(
      //       program.programId,
      //       initEncryptedOrderbookComputationOffset
      //     ),
      //     payer: authority.publicKey,
      //     mxeAccount: getMXEAccAddress(program.programId),
      //     mempoolAccount: getMempoolAccAddress(program.programId),
      //     executingPool: getExecutingPoolAccAddress(program.programId),
      //     compDefAccount: getCompDefAccAddress(
      //       program.programId,
      //       Buffer.from(getCompDefAccOffset("init_order_book")).readUInt32LE()
      //     ),
      //     clusterAccount: clusterAccount,
      //     orderbookState: OrderbookPDA,
      //   })
      //   .signers([authority])
      //   .rpc({ commitment: "confirmed" });

      // console.log(
      //   "Encrypted orderbook initialized with signature:",
      //   initEncryptedOrderbookTx
      // );

      // Wait for initGame computation finalization
      // const initEncryptedOrderbookFinalizeSig =
      //   await awaitComputationFinalization(
      //     provider as anchor.AnchorProvider,
      //     initEncryptedOrderbookComputationOffset,
      //     program.programId,
      //     "confirmed"
      //   );
      // console.log(
      //   "Init game finalize signature:",
      //   initEncryptedOrderbookFinalizeSig
      // );

      // const orderBookStatenew = await getOrderBookState(program);
      // console.log("orderBookState new", orderBookStatenew);

      // initlialize a user ledger and then deposit to the ledger

      try {
        await program.methods
          .initializeUserLedger(
            Array.from(User2PublicKey),
            new anchor.BN(deserializeLE(userLedgerNonce).toString()),
            InitUserLedgerComputationOffset
          )
          .accountsPartial({
            computationAccount: getComputationAccAddress(
              program.programId,
              InitUserLedgerComputationOffset
            ),
            user: user2.publicKey,
            clusterAccount: clusterAccount,
            mxeAccount: getMXEAccAddress(program.programId),
            mempoolAccount: getMempoolAccAddress(program.programId),
            executingPool: getExecutingPoolAccAddress(program.programId),
            compDefAccount: getCompDefAccAddress(
              program.programId,
              Buffer.from(
                getCompDefAccOffset("init_user_ledger")
              ).readUInt32LE()
            ),
            systemProgram: SystemProgram.programId,
            arciumProgram: getArciumProgramId(),
            userLedger: userLedgerPDA,
          })
          .signers([user2])
          .rpc({ commitment: "confirmed" });
      } catch (error) {
        const log = await error.getLogs();
        console.log("log", log);
      }

      const info11 = await program.account.userPrivateLedger.fetch(
        userLedgerPDA
      );
      console.log("user ledger account info 2", info11);

      await awaitComputationFinalization(
        provider,
        InitUserLedgerComputationOffset,
        program.programId,
        "confirmed"
      );
      const initializeUserLedgerEvent = await initializeUserLedgerPromise;
      console.log(
        "initialized user ledger event for",
        initializeUserLedgerEvent.user.toBase58()
      );

      const info12 = await program.account.userPrivateLedger.fetch(
        userLedgerPDA
      );
      console.log("user ledger account info 3", info12);

      console.log("User ledger initialized");

      console.log("entering deposit to ledger");

      const userLedgerDepositedPromise = awaitEvent("userLedgerDepositedEvent");

      await program.methods
        .depositToLedger(
          Array.from(User2PublicKey),
          new BN(100 * scaleFactor),
          true,
          UpdateLedgerDepositComputationOffset
        )
        .accounts({
          computationAccount: getComputationAccAddress(
            program.programId,
            UpdateLedgerDepositComputationOffset
          ),
          user: user2.publicKey,
          clusterAccount: clusterAccount,
          mxeAccount: getMXEAccAddress(program.programId),
          mempoolAccount: getMempoolAccAddress(program.programId),
          executingPool: getExecutingPoolAccAddress(program.programId),
          compDefAccount: getCompDefAccAddress(
            program.programId,
            Buffer.from(
              getCompDefAccOffset("update_ledger_deposit")
            ).readUInt32LE()
          ),
          systemProgram: SystemProgram.programId,
          arciumProgram: getArciumProgramId(),
          userLedger: userLedgerPDA,
          mint: quoteMint,
          vault: quoteVaultPDA,
          userTokenAccount: user2token2ATA,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          vaultAuthority: vaultAuthorityPDA,
        })
        .signers([user2])
        .rpc({ commitment: "confirmed" });

      await awaitComputationFinalization(
        provider,
        UpdateLedgerDepositComputationOffset,
        program.programId,
        "confirmed"
      );
      console.log("Tokens deposited to ledger");

      const userLedgerDepositedEvent = await userLedgerDepositedPromise;

      const userLedgerDepositedEventNonce = Uint8Array.from(
        userLedgerDepositedEvent.balanceNonce.toArray("le", 16)
      );

      let userBalances = User2Cipher.decrypt(
        [...userLedgerDepositedEvent.encryptedBalances],
        userLedgerDepositedEventNonce
      );
      console.log(
        "userBalances==============================================================>",
        userBalances
      );
      // check if the vault does have the correct amount of tokens
      const vaultInfo = await getAccount(provider.connection, quoteVaultPDA);
      console.log("vault info", vaultInfo);
      // expect(vaultInfo.amount.toString()).to.equal(new BN(100).toString());
      const vaultInfo2 = await getAccount(provider.connection, user2token1ATA);
      console.log("user2token1ATA info", vaultInfo2);
      const vaultInfo3 = await getAccount(provider.connection, user2token2ATA);
      console.log("user2token2ATA info", vaultInfo3);

      // 2. Prepare order (using smaller values to reduce stack usage)
      const amount = 50 * scaleFactor;
      const price = 0.2 * scaleFactor;
      const submitOrderComputationOffset = new anchor.BN(randomBytes(8), "hex");

      const orderId = 14;

      const [orderAccountPDA] = deriveOrderAccountPDA(
        new anchor.BN(orderId),
        program.programId
      );

      const User2Nonce = randomBytes(16);
      const User2Ciphertext = User2Cipher.encrypt(
        [BigInt(amount), BigInt(price)],
        User2Nonce
      );

      const orderSubmittedCheckSuccessPromise = awaitEvent(
        "orderSubmittedCheckSuccessEvent"
      );
      const orderSubmittedCheckFailedPromise = awaitEvent(
        "orderSubmittedCheckFailedEvent"
      );

      console.log(
        "before the submit order check================================="
      );

      const submitOrderCheckComputationOffset = new anchor.BN(
        randomBytes(8),
        "hex"
      );
      const submitOrderCheckTx = await program.methods
        .submitOrderCheck(
          Array.from(User2Ciphertext[0]),
          Array.from(User2Ciphertext[1]),
          Array.from(User2PublicKey),
          0, // buy
          submitOrderCheckComputationOffset,
          new anchor.BN(orderId),
          new anchor.BN(deserializeLE(User2Nonce).toString())
        )
        .accountsPartial({
          computationAccount: getComputationAccAddress(
            program.programId,
            submitOrderCheckComputationOffset
          ),
          user: user2.publicKey,
          clusterAccount: clusterAccount,
          mxeAccount: getMXEAccAddress(program.programId),
          mempoolAccount: getMempoolAccAddress(program.programId),
          executingPool: getExecutingPoolAccAddress(program.programId),
          compDefAccount: getCompDefAccAddress(
            program.programId,
            Buffer.from(
              getCompDefAccOffset("submit_order_check")
            ).readUInt32LE()
          ),
          systemProgram: SystemProgram.programId,
          arciumProgram: getArciumProgramId(),
          baseMint: quoteMint,
          vault: quoteVaultPDA,
          orderAccount: orderAccountPDA,
          userLedger: userLedgerPDA,
        })
        .signers([user2])
        .rpc({ commitment: "confirmed" });

      console.log("submitOrderCheckTx", submitOrderCheckTx);

      await awaitComputationFinalization(
        provider,
        submitOrderCheckComputationOffset,
        program.programId,
        "confirmed"
      );

      console.log("submitOrderCheck completed");

      //check the contents of the order account
      const orderAccount = await program.account.orderAccount.fetch(
        orderAccountPDA
      );

      // decryypt the content of the order account's encryptedOrder field
      const decryptedOrder = User2Cipher.decrypt(
        [...orderAccount.encryptedOrder],
        Uint8Array.from(orderAccount.orderNonce.toArray("le", 16))
      );
      console.log("decrypted order", decryptedOrder);

      let success = false;

      try {
        const submitOrderCheckEvent = await Promise.race([
          orderSubmittedCheckSuccessPromise,
          orderSubmittedCheckFailedPromise,
        ]);

        console.log("submitOrderCheckEvent", submitOrderCheckEvent);

        if ("success" in submitOrderCheckEvent) {
          console.log("Received OrderSubmittedCheckSuccessEvent.");
          success = true;

          // console.log("user balances", userBalances);
        } else {
          console.log("Received OrderSubmittedCheckFailedEvent.");
        }
      } catch (e) {
        console.error("Error waiting for withdraw verify event:", e);
        throw e;
      }

      // ========== STEP 2: If verified, cranker executes order submission on the encrypted orderbook ==========
      if (success) {
        console.log("\n🤖 STEP 2: cranker executing order submission...");
        const tx = await program.methods
          .submitOrder(
            Array.from(User2Ciphertext[0]),
            Array.from(User2Ciphertext[1]),
            Array.from(User2PublicKey),
            0, // buy
            submitOrderComputationOffset,
            new anchor.BN(orderId),
            new anchor.BN(deserializeLE(User2Nonce).toString())
          )
          .accountsPartial({
            computationAccount: getComputationAccAddress(
              program.programId,
              submitOrderComputationOffset
            ),
            user: user2.publicKey,
            clusterAccount: clusterAccount,
            mxeAccount: getMXEAccAddress(program.programId),
            mempoolAccount: getMempoolAccAddress(program.programId),
            executingPool: getExecutingPoolAccAddress(program.programId),
            compDefAccount: getCompDefAccAddress(
              program.programId,
              Buffer.from(getCompDefAccOffset("submit_order")).readUInt32LE()
            ),
            systemProgram: SystemProgram.programId,
            arciumProgram: getArciumProgramId(),
            baseMint: quoteMint,
            vault: quoteVaultPDA,
            orderbookState: OrderbookPDA,
          })
          .signers([user2])
          .rpc({ commitment: "confirmed" });

        console.log("tx", tx);

        // 6. Wait for MPC finalization
        await awaitComputationFinalization(
          provider,
          submitOrderComputationOffset,
          program.programId,
          "confirmed"
        );

        console.log("\n✅ ==============================Order submitted successfully===========================!");
        const userLedger = await program.account.userPrivateLedger.fetch(
          userLedgerPDA
        );
  
        const thisnonce = Uint8Array.from(
          userLedger.balanceNonce.toArray("le", 16)
        );
        const userLedgerBalances = User2Cipher.decrypt(
          [...userLedger.encryptedBalances],
          thisnonce
        );
        console.log("user ledger balances", userLedgerBalances);
      } else {
        throw new Error("No event received - something went wrong!");
      }
    });
    


    it("Test 1.3.4: Should encrypt/decrypt correctly", async () => {
      console.log("\n--- Test 1.3.4: Encryption/Decryption ---");

      const { cipher } = await setupUserEncryption(provider, program.programId);

      const amount = 100 * scaleFactor;
      const price = 50 * scaleFactor;
      const plaintext = [BigInt(amount), BigInt(price)];
      const nonce = generateNonce();

      console.log("Original values:");
      console.log("  - Amount:", amount.toString());
      console.log("  - Price:", price.toString());

      // Encrypt
      const ciphertext = cipher.encrypt(plaintext, nonce);
      console.log(
        "Encrypted:",
        ciphertext.map(
          (c) => Buffer.from(c).toString("hex").slice(0, 16) + "..."
        )
      );

      // Decrypt
      const decrypted = cipher.decrypt(ciphertext, nonce);
      console.log("Decrypted:");
      console.log("  - Amount:", decrypted[0].toString());
      console.log("  - Price:", decrypted[1].toString());

      expect(decrypted[0]).to.equal(BigInt(amount));
      expect(decrypted[1]).to.equal(BigInt(price));

      console.log("✓ Encryption/decryption works correctly");
    });
  });

  describe("Suite 1.4: Order Matching", () => {
    it("Test 1.4.1: Should trigger matching with valid orders", async () => {
      console.log("\n--- Test 1.4.1: Trigger Matching ---");
      console.log("⚠ Matching test - To be implemented");
      console.log("  Requires:");
      console.log("  - Submit buy and sell orders");
      console.log("  - Submit 1 buy at 105 USDC/SOL");
      console.log("  - Submit 1 sell at 95 USDC/SOL");


      // two order have already been submitted by user1 and user2 respectively 
      // now simply trigger the matching and listen for the matchesfound event
     
      const triggerMatchingOffset = new anchor.BN(
        randomBytes(8),
        "hex"
      );
      const triggerMatchingTx = await program.methods
        .triggerMatching(
          triggerMatchingOffset,
          new anchor.BN(0)
        )
        .accountsPartial({  
          computationAccount: getComputationAccAddress(
            program.programId,
            triggerMatchingOffset
          ),
          payer: backendKeypair.publicKey,
          clusterAccount: clusterAccount,
          mxeAccount: getMXEAccAddress(program.programId),
          mempoolAccount: getMempoolAccAddress(program.programId),
          executingPool: getExecutingPoolAccAddress(program.programId),
          compDefAccount: getCompDefAccAddress(
            program.programId,
            Buffer.from(getCompDefAccOffset("match_orders")).readUInt32LE()
          ),
          systemProgram: SystemProgram.programId,
          arciumProgram: getArciumProgramId(),
          orderbookState: OrderbookPDA,
        })
        .signers([backendKeypair])
        .rpc({ commitment: "confirmed" });
      console.log("triggerMatchingTx", triggerMatchingTx);

      await awaitComputationFinalization(
        provider,
        triggerMatchingOffset,
        program.programId,
        "confirmed"
      );


    
    });

    it("Test 1.4.2: Should enforce rate limiting (15s)", async () => {
      console.log("\n--- Test 1.4.2: Rate Limiting ---");
      console.log("⚠ Rate limiting test - To be implemented");
    });
  });

  describe("Suite 1.5: Backend Decryption", () => {
    it("Test 1.5.1: Should decrypt match results", async () => {
      console.log("\n--- Test 1.5.1: Backend Decryption ---");
      console.log("⚠ Decryption test - To be implemented");
      console.log("  Requires:");
      console.log("  - Setup backend encryption keys");
      console.log("  - Listen for MatchResultEvent");
      console.log("  - Decrypt match ciphertext with match nonce");
    });
  });

  describe("Suite 1.6: Settlement", () => {
    it("Test 1.6.1: Should derive vault PDAs correctly", async () => {
      console.log("\n--- Test 1.6.1: Derive Vault PDAs ---");

      // get the match result event
      // const backendSharedSecret = x25519.getSharedSecret(
      //   backendSecretKey,
      //   mxePublicKey
      // );
      // const backendCipher = new RescueCipher(backendSharedSecret);
      // const eventPromise = awaitEvent("matchesFoundEvent");
      // const matchResultEvent = await eventPromise;
      // const cipher = new RescueCipher(backendSharedSecret);

      // const match1 = matchResultEvent.match1;
      // const match2 = matchResultEvent.match2;
      // const nonce = matchResultEvent.nonce;
      // const timestamp = matchResultEvent.timestamp;
      // const numMatches = matchResultEvent.numMatches;

      // const crankerNonce = Uint8Array.from(nonce.toArray("le", 16));

      // const decrypted = cipher.decrypt(
      //   [numMatches, ...match1, ...match2, timestamp],
      //   new Uint8Array(crankerNonce)
      // );

      // const matches = {
      //   orderId: [],
      //   sellOrderId: [],
      //   quantity: [],
      //   executionPrice: [],
      // }

      // for (let i = 0; i < numMatches; i++) {
      //   const orderId = decrypted[2 + i * 5];
      //   const sellOrderId = decrypted[3 + i * 5];
      //   const quantity = decrypted[4 + i * 5];
      //   const executionPrice = decrypted[5 + i * 5];

      //   matches.orderId.push(orderId);
      //   matches.sellOrderId.push(sellOrderId);
      //   matches.quantity.push(quantity);
      //   matches.executionPrice.push(executionPrice);
      // }

      // for (let i = 0; i < numMatches; i++) {
      //   //use order id to deerive the orderaccount pda and get the user pubkey and then trigger execute settlement handler with req
      //   const [orderaccountpda] = await deriveOrderAccountPDA(matches.orderId[i], program.programId);
      //   const orderAccount = await program.account.orderAccount.fetch(orderaccountpda);
      //   const userPubkey = orderAccount.userPubkey;
      //   // await program.methods.executeSettlement(matches.orderId[i], matches.quantity[i], matches.executionPrice[i]).accountsPartial({
      //   //   orderAccount: orderAccountPDA,
      //   // }).signers([user1]).rpc({ commitment: "confirmed" });
      // }
      // for both match1 and match2 take the

      console.log("✓ Vault PDA derivation works correctly");
    });

    it("Test 1.6.2: Should execute settlement", async () => {
      console.log("\n--- Test 1.6.2: Execute Settlement ---");
      console.log("⚠ Settlement test - To be implemented");
      console.log("  Requires:");
      console.log("  - Match results from previous test");
      console.log("  - Call execute_settlement instruction");
      console.log("  - Verify token transfers");
    });
  });

  describe("Suite 1.7: Withdrawal Flow", () => {
    it("Test 1.7.1: Should verify and withdraw tokens successfully", async () => {
      console.log("\n=== Test 1.7.1: Complete Withdrawal Flow ===\n");

      const crankerBotKeypair = readKpJson(
        `${os.homedir()}/.config/solana/cranker_bot.json`
      );
      console.log(
        "🔑 Cranker bot pubkey:",
        crankerBotKeypair.publicKey.toBase58()
      );

      // Airdrop SOL to cranker bot for transaction fees
      // console.log("💰 Airdropping SOL to cranker bot...");
      if (!useDevnet) {
        await airdrop(
          provider,
          crankerBotKeypair.publicKey,
          5 * LAMPORTS_PER_SOL
        );
      }

      // Use user1 who already has a ledger and deposited funds
      const withdrawAmount = 30 * scaleFactor; // Withdraw 30 tokens (user deposited 100 earlier)

      mxePublicKey = await getMXEPublicKeyWithRetry(
        provider as anchor.AnchorProvider,
        program.programId
      );

      const User1SharedSecret = x25519.getSharedSecret(
        User1PrivateKey,
        mxePublicKey
      );
      const User1Cipher = new RescueCipher(User1SharedSecret);

      // Derive PDAs
      const [userLedgerPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("user_ledger"), user1.publicKey.toBuffer()],
        program.programId
      );

      const [baseVaultPDA] = await deriveVaultPDA(baseMint, program.programId);

      console.log();

      console.log("\n📍 Account addresses:");
      console.log("  User:", user1.publicKey.toBase58());
      console.log("  User Ledger PDA:", userLedgerPDA.toBase58());
      console.log("  Base Vault PDA:", baseVaultPDA.toBase58());
      // console.log("  User Base ATA:", user1BaseATA.address.toBase58());

      // Check vault balance before withdrawal
      const vaultBefore = await getAccount(provider.connection, baseVaultPDA);
      console.log("\n💵 Vault balance before:", vaultBefore.amount.toString());

      // ========== STEP 1: Call withdraw_from_ledger_verify ==========
      console.log("\n🔄 STEP 1: Verifying withdrawal with MPC...");

      const withdrawVerifyComputationOffset = new BN(randomBytes(8), "hex");

      // Set up event listener for success/failure
      const withdrawVerifySuccessPromise = awaitEvent(
        "userLedgerWithdrawVerifiedSuccessEvent"
      );
      const withdrawVerifyFailurePromise = awaitEvent(
        "userLedgerWithdrawVerifiedFailedEvent"
      );

      // fetch the userledger and then

      const withdrawVerifyTx = await program.methods
        .withdrawFromLedgerVerify(
          Array.from(User1PublicKey),
          new BN(withdrawAmount),
          true, // is_base_token = true (SOL)
          withdrawVerifyComputationOffset
        )
        .accountsPartial({
          computationAccount: getComputationAccAddress(
            program.programId,
            withdrawVerifyComputationOffset
          ),
          user: user1.publicKey,
          clusterAccount: clusterAccount,
          mxeAccount: getMXEAccAddress(program.programId),
          mempoolAccount: getMempoolAccAddress(program.programId),
          executingPool: getExecutingPoolAccAddress(program.programId),
          compDefAccount: getCompDefAccAddress(
            program.programId,
            Buffer.from(
              getCompDefAccOffset("update_ledger_withdraw_verify")
            ).readUInt32LE()
          ),
          systemProgram: SystemProgram.programId,
          arciumProgram: getArciumProgramId(),
          vault: baseVaultPDA,
          userLedger: userLedgerPDA,
          mint: baseMint,
          vaultAuthority: (await deriveVaultAuthorityPDA(program.programId))[0],
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([user1])
        .rpc({ commitment: "confirmed" });

      console.log("📝 Withdraw verify tx:", withdrawVerifyTx);

      // Wait for MPC computation
      console.log("⏳ Waiting for MPC computation...");
      await awaitComputationFinalization(
        provider,
        withdrawVerifyComputationOffset,
        program.programId,
        "confirmed"
      );

      let success = false;

      try {
        const withdrawVerifyEvent = await Promise.race([
          withdrawVerifySuccessPromise,
          withdrawVerifyFailurePromise,
        ]);

        console.log("withdrawVerifyEvent", withdrawVerifyEvent);

        if ("balanceNonce" in withdrawVerifyEvent) {
          console.log("Received UserLedgerWithdrawVerifiedSuccessEvent.");
          success = true;

          const withdrawVerifyEventNonce = Uint8Array.from(
            withdrawVerifyEvent.balanceNonce.toArray("le", 16)
          );

          let userBalances = User1Cipher.decrypt(
            [...withdrawVerifyEvent.encryptedBalances],
            withdrawVerifyEventNonce
          );

          console.log("user balances", userBalances);
        } else {
          console.log("Received UserLedgerWithdrawVerifiedFailedEvent.");
        }
      } catch (e) {
        console.error("Error waiting for withdraw verify event:", e);
        throw e;
      }

      // ========== STEP 2: If verified, cranker executes withdrawal ==========
      if (success) {
        console.log("\n🤖 STEP 2: Cranker executing withdrawal...");
        const user1BaseATA = await getOrCreateAssociatedTokenAccount(
          provider.connection,
          authority,
          baseMint,
          user1.publicKey
        );

        const withdrawFromVaultTx = await program.methods
          .withdrawFromVault(new BN(withdrawAmount), user1.publicKey)
          .accountsPartial({
            payer: crankerBotKeypair.publicKey,
            vaultAuthority: (
              await deriveVaultAuthorityPDA(program.programId)
            )[0],
            vault: baseVaultPDA,
            userTokenAccount: user1BaseATA.address,
            mint: baseMint,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([crankerBotKeypair])
          .rpc({ commitment: "confirmed" });

        console.log("✅ Withdraw from vault tx:", withdrawFromVaultTx);

        // ========== VERIFICATION ==========
        console.log("\n📊 VERIFICATION:");
        const vaultAfter = await getAccount(provider.connection, baseVaultPDA);
        expect(Number(vaultAfter.amount)).to.equal(
          Number(vaultBefore.amount) - Number(withdrawAmount)
        );
        // check if the user1 base ata has the correct amount of tokens
        const user1BaseATAnew = await getAccount(
          provider.connection,
          user1BaseATA.address
        );
        expect(Number(user1BaseATAnew.amount)).to.equal(
          Number(user1BaseATA.amount) + Number(withdrawAmount)
        );

        console.log("\n✅ Withdrawal completed successfully!");
      } else {
        throw new Error("No event received - something went wrong!");
      }
    });

    it("Test 1.7.2: Should fail withdrawal with insufficient balance", async () => {
      console.log(
        "\n=== Test 1.7.2: Withdrawal with Insufficient Balance ===\n"
      );

      const withdrawAmount = 10000 * scaleFactor; // Try to withdraw way more than available

      const [userLedgerPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("user_ledger"), user1.publicKey.toBuffer()],
        program.programId
      );

      const [baseVaultPDA] = await deriveVaultPDA(baseMint, program.programId);
      const user1BaseATA = await getOrCreateAssociatedTokenAccount(
        provider.connection,
        authority,
        baseMint,
        user1.publicKey
      );

      const withdrawVerifyComputationOffset = new BN(randomBytes(8), "hex");

      const withdrawVerifySuccessPromise = awaitEvent(
        "userLedgerWithdrawVerifiedSuccessEvent"
      );
      const withdrawVerifyFailurePromise = awaitEvent(
        "userLedgerWithdrawVerifiedFailedEvent"
      );

      const withdrawVerifyTx = await program.methods
        .withdrawFromLedgerVerify(
          Array.from(User1PublicKey),
          new BN(withdrawAmount),
          true,
          withdrawVerifyComputationOffset
        )
        .accounts({
          user: user1.publicKey,
          userLedger: userLedgerPDA,
          vault: baseVaultPDA,
          userTokenAccount: user1BaseATA.address,
          mint: baseMint,
          vaultAuthority: (await deriveVaultAuthorityPDA(program.programId))[0],
          computationAccount: getComputationAccAddress(
            program.programId,
            withdrawVerifyComputationOffset
          ),
          clusterAccount: clusterAccount,
          mxeAccount: getMXEAccAddress(program.programId),
          mempoolAccount: getMempoolAccAddress(program.programId),
          executingPool: getExecutingPoolAccAddress(program.programId),
          compDefAccount: getCompDefAccAddress(
            program.programId,
            Buffer.from(
              getCompDefAccOffset("update_ledger_withdraw_verify")
            ).readUInt32LE()
          ),
          systemProgram: SystemProgram.programId,
          arciumProgram: getArciumProgramId(),
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        })
        .signers([user1])
        .rpc({ commitment: "confirmed" });

      console.log("📝 Withdraw verify tx:", withdrawVerifyTx);

      await awaitComputationFinalization(
        provider,
        withdrawVerifyComputationOffset,
        program.programId,
        "confirmed"
      );

      let success = false;

      try {
        const withdrawVerifyEvent = await Promise.race([
          withdrawVerifySuccessPromise,
          withdrawVerifyFailurePromise,
        ]);

        console.log("withdrawVerifyEvent", withdrawVerifyEvent);

        if ("balanceNonce" in withdrawVerifyEvent) {
          console.log("Received UserLedgerWithdrawVerifiedSuccessEvent.");
          success = true;
        } else {
          console.log("Received UserLedgerWithdrawVerifiedFailedEvent.");
        }
      } catch (e) {
        console.error("Error waiting for withdraw verify event:", e);
        throw e;
      }

      expect(success).to.be.false;
    });
  });
});
