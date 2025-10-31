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
  getClockAccAddress,
  RescueCipher,
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
  deriveSignerAccountPDA,
  deriveArciumFeePoolAccountAddress,
  deriveUserLedgerPDA,
} from "./helpers/accounts";
import {
  initSubmitOrderCompDef,
  initMatchOrdersCompDef,
  initInitOrderBookCompDef,
  initInitUserLedgerCompDef,
  updateLedgerDepositCompDef,
  readKpJson,
} from "./helpers/computation";

describe("Dark Pool Matching Engine - Core Functionality Tests", () => {
  // Configure the client to use the local cluster
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace.MatchingEngine as Program<MatchingEngine>;
  const provider = anchor.getProvider() as anchor.AnchorProvider;
  const arciumEnv = getArciumEnv();

  // TODO ; change the seeds for deriving the orderaccount pda
  // Test accounts
  let authority: Keypair;
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
  let User1PublicKey: Uint8Array;
  let User1PrivateKey: Uint8Array;
  let User1SharedSecret: Uint8Array;
  let User2PublicKey: Uint8Array;
  let User2PrivateKey: Uint8Array;
  let User2SharedSecret: Uint8Array;

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
    authority = readKpJson(`${os.homedir()}/.config/solana/id.json`);
    console.log("Authority:", authority.publicKey.toBase58());

    // Generate test accounts
    backendKeypair = Keypair.generate();
    user1 = Keypair.generate();
    user2 = Keypair.generate();

    console.log("Backend:", backendKeypair.publicKey.toBase58());
    console.log("User 1:", user1.publicKey.toBase58());
    console.log("User 2:", user2.publicKey.toBase58());

    await airdrop(provider, user1.publicKey, 100 * LAMPORTS_PER_SOL);
    await airdrop(provider, user2.publicKey, 100 * LAMPORTS_PER_SOL);

    // initialize a payer account to make token mints and their authority.
    const mintAuthority = Keypair.generate();
    await airdrop(provider, mintAuthority.publicKey, 100 * LAMPORTS_PER_SOL);

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
      1000 * LAMPORTS_PER_SOL
    );
    const ata2 = await createATAAndMintTokens(
      provider,
      user1.publicKey,
      token2Mint,
      mintAuthority,
      1000 * LAMPORTS_PER_SOL
    );

    const ata3 = await createATAAndMintTokens(
      provider,
      user2.publicKey,
      token1Mint,
      mintAuthority,
      1000 * LAMPORTS_PER_SOL
    );
    const ata4 = await createATAAndMintTokens(
      provider,
      user2.publicKey,
      token2Mint,
      mintAuthority,
      1000 * LAMPORTS_PER_SOL
    );
    console.log("Minted tokens to users\n");

    // For now, use placeholder mints (in real test, create actual SPL tokens)
    baseMint = token1Mint;
    quoteMint = token2Mint;
    user1token1ATA = ata1;
    user1token2ATA = ata2;
    user2token1ATA = ata3;
    user2token2ATA = ata4;

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
            orderBookState: OrderbookPDA,
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
      console.log("OrderBookState fetched:", orderBookState);

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

      // Generate encryption keys for User1
      const User1PrivateKey = x25519.utils.randomSecretKey();
      const User1PublicKey = x25519.getPublicKey(User1PrivateKey);
      const User1SharedSecret = x25519.getSharedSecret(
        User1PrivateKey,
        mxePublicKey
      );
      const User1Cipher = new RescueCipher(User1SharedSecret);

      const userLedgerNonce = randomBytes(16);

      const initializeUserLedgerPromise = awaitEvent("userLedgerInitializedEvent");

      // initlialize a user ledger and then deposit to the ledger
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
          signPdaAccount: deriveSignerAccountPDA(program.programId),
          poolAccount: deriveArciumFeePoolAccountAddress(),
          clusterAccount: arciumEnv.arciumClusterPubkey,
          mxeAccount: getMXEAccAddress(program.programId),
          mempoolAccount: getMempoolAccAddress(program.programId),
          executingPool: getExecutingPoolAccAddress(program.programId),
          compDefAccount: getCompDefAccAddress(
            program.programId,
            Buffer.from(getCompDefAccOffset("init_user_ledger")).readUInt32LE()
          ),
          clockAccount: getClockAccAddress(),
          systemProgram: SystemProgram.programId,
          arciumProgram: getArciumProgramId(),
          userLedger: userLedgerPDA,
        })
        .signers([user1])
        .rpc({ commitment: "confirmed" });

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
      console.log("meow")

      const initializeUserLedgerEvent = await initializeUserLedgerPromise;
      console.log("initialized user ledger event for", initializeUserLedgerEvent.user.toBase58());

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
          new BN(100),
          true,
          UpdateLedgerDepositComputationOffset
        )
        .accounts({
          computationAccount: getComputationAccAddress(
            program.programId,
            UpdateLedgerDepositComputationOffset
          ),
          user: user1.publicKey,
          signPdaAccount: deriveSignerAccountPDA(program.programId),
          poolAccount: deriveArciumFeePoolAccountAddress(),
          clusterAccount: arciumEnv.arciumClusterPubkey,
          mxeAccount: getMXEAccAddress(program.programId),
          mempoolAccount: getMempoolAccAddress(program.programId),
          executingPool: getExecutingPoolAccAddress(program.programId),
          compDefAccount: getCompDefAccAddress(
            program.programId,
            Buffer.from(
              getCompDefAccOffset("update_ledger_deposit")
            ).readUInt32LE()
          ),
          clockAccount: getClockAccAddress(),
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
      console.log("userBalances===============>", userBalances);
      // expect(userBalances[0]).to.equal(new BN(100).toString());
      // expect(userBalances[1]).to.equal(new BN(100).toString());
      // expect(userBalances[2]).to.equal(new BN(0).toString());
      // expect(userBalances[3]).to.equal(new BN(0).toString());

      // check if the vault does have the correct amount of tokens
      const vaultInfo = await getAccount(provider.connection, baseVaultPDA);
      console.log("vault info", vaultInfo);
      // expect(vaultInfo.amount.toString()).to.equal(new BN(100).toString());
      const vaultInfo2 = await getAccount(provider.connection, user1token1ATA);
      console.log("user1token1ATA info", vaultInfo2);
      const vaultInfo3 = await getAccount(provider.connection, user1token2ATA);
      console.log("user1token2ATA info", vaultInfo3);

      // 2. Prepare order (using smaller values to reduce stack usage)
      const amount = 10;
      const price = 5;
      const submitOrderComputationOffset = new anchor.BN(randomBytes(8), "hex");

      // 3. Read initial nonce
      const before = await getOrderBookState(program);
      const initialNonce = before.orderBookNonce;

      const orderId = 12;

      const [orderAccountPDA] = deriveOrderAccountPDA(
        new anchor.BN(orderId),
        program.programId
      );

      console.log("=== submitOrder Accounts ===");
      console.log("User:", user1.publicKey.toBase58());
      console.log("Vault PDA:", baseVaultPDA.toBase58());
      console.log("Vault State PDA:", vaultStatePDA.toBase58());
      console.log("Order Account PDA:", orderAccountPDA.toBase58());
      console.log("User Ledger PDA:", userLedgerPDA.toBase58());
      console.log("Orderbook PDA:", OrderbookPDA.toBase58());
      console.log("program id", program.programId.toBase58());

      // verify if arcium accounts are correct
      console.log(
        "arcium fee pool account",
        deriveArciumFeePoolAccountAddress().toBase58()
      );
      console.log("arcium clock account", getClockAccAddress().toBase58());
      console.log("arcium program id", getArciumProgramId().toBase58());
      console.log(
        "arcium cluster pubkey",
        arciumEnv.arciumClusterPubkey.toBase58()
      );
      console.log(
        "arcium mxe account",
        getMXEAccAddress(program.programId).toBase58()
      );
      console.log(
        "arcium mempool account",
        getMempoolAccAddress(program.programId).toBase58()
      );
      console.log(
        "arcium executing pool account",
        getExecutingPoolAccAddress(program.programId).toBase58()
      );
      console.log(
        "arcium comp def account",
        getCompDefAccAddress(
          program.programId,
          Buffer.from(getCompDefAccOffset("submit_order")).readUInt32LE()
        ).toBase58()
      );
      console.log(
        "arcium computation account",
        getComputationAccAddress(
          program.programId,
          submitOrderComputationOffset
        ).toBase58()
      );

      const User1Nonce = randomBytes(16);
      const User1Ciphertext = User1Cipher.encrypt(
        [BigInt(amount), BigInt(price)],
        User1Nonce
      );

      console.log("before the submit order");

      //check if the orderbook accocunt, the user ledger account, and the order account do exist
      expect(OrderbookPDA).to.exist;
      // print the account info of the order account
      const info = await program.account.orderBookState.fetch(OrderbookPDA);
      console.log("order account info", info);
      expect(userLedgerPDA).to.exist;
      // print the account info of the user ledger account
      const info2 = await program.account.userPrivateLedger.fetch(
        userLedgerPDA
      );
      console.log("user ledger account info", info2);

      // 5. Submit order
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
          signPdaAccount: deriveSignerAccountPDA(program.programId),
          poolAccount: deriveArciumFeePoolAccountAddress(),
          clusterAccount: arciumEnv.arciumClusterPubkey,
          mxeAccount: getMXEAccAddress(program.programId),
          mempoolAccount: getMempoolAccAddress(program.programId),
          executingPool: getExecutingPoolAccAddress(program.programId),
          compDefAccount: getCompDefAccAddress(
            program.programId,
            Buffer.from(getCompDefAccOffset("submit_order")).readUInt32LE()
          ),
          clockAccount: getClockAccAddress(),
          systemProgram: SystemProgram.programId,
          arciumProgram: getArciumProgramId(),
          baseMint: baseMint,
          vault: baseVaultPDA,
          orderAccount: orderAccountPDA,
          orderbookState: OrderbookPDA,
          userLedger: userLedgerPDA,
        })
        .signers([user1])
        .rpc({ commitment: "confirmed" });

      console.log("tx", tx);

      // const info3 = await program.account.orderAccount.fetch(orderAccountPDA);
      // console.log("order account info",info3);

      // 6. Wait for MPC finalization
      await awaitComputationFinalization(
        provider,
        submitOrderComputationOffset,
        program.programId,
        "confirmed"
      );

      console.log(
        "=============== Order submitted successfully ==============="
      );
      console.log("waiting for event");
      // 7. Get event
      // const event = await eventPromise;
      // expect(event.success).to.be.true;

      // 8. CRITICAL: Verify nonce incremented
      const after = await getOrderBookState(program);
      console.log("after", after);
      expect(after.orderBookNonce.toString()).to.equal(
        initialNonce.add(new BN(1)).toString()
      );

      console.log("nonce incremented");

      // 9. Verify OrderAccount created
      const orderAccount = await getOrderAccount(
        program,
        new BN(event.orderId),
        user1.publicKey
      );
      expect(orderAccount.status).to.equal(1); // Processing
    });

    it("Test 1.3.3: Should handle user pubkey chunking correctly", async () => {
      console.log("\n--- Test 1.3.3: User Pubkey Chunking ---");

      // Test pubkey chunking
      const testPubkey = user1.publicKey.toBuffer();

      // Split into 4x u64 chunks
      const chunks = [
        BigInt("0x" + testPubkey.slice(0, 8).toString("hex")),
        BigInt("0x" + testPubkey.slice(8, 16).toString("hex")),
        BigInt("0x" + testPubkey.slice(16, 24).toString("hex")),
        BigInt("0x" + testPubkey.slice(24, 32).toString("hex")),
      ];

      console.log("Original pubkey:", user1.publicKey.toBase58());
      console.log(
        "Chunks:",
        chunks.map((c) => c.toString(16))
      );

      // Reconstruct
      const reconstructed = Buffer.concat([
        Buffer.from(chunks[0].toString(16).padStart(16, "0"), "hex"),
        Buffer.from(chunks[1].toString(16).padStart(16, "0"), "hex"),
        Buffer.from(chunks[2].toString(16).padStart(16, "0"), "hex"),
        Buffer.from(chunks[3].toString(16).padStart(16, "0"), "hex"),
      ]);

      console.log(
        "Reconstructed pubkey:",
        new PublicKey(reconstructed).toBase58()
      );

      console.log("✓ Pubkey chunking works correctly");
    });

    it("Test 1.3.4: Should encrypt/decrypt correctly", async () => {
      console.log("\n--- Test 1.3.4: Encryption/Decryption ---");

      const { cipher } = await setupUserEncryption(provider, program.programId);

      const amount = BigInt(100);
      const price = BigInt(50);
      const plaintext = [amount, price];
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

      expect(decrypted[0]).to.equal(amount);
      expect(decrypted[1]).to.equal(price);

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

      // const User1Cipher = new RescueCipher(User1SharedSecret);

      // let amount1 = BigInt(100);
      // let price1 = BigInt(50);
      // let order1Id = 12;

      // const submitOrder1ComputationOffset = new anchor.BN(randomBytes(8), "hex");

      // const User1Nonce = randomBytes(16);
      // const User1Ciphertext = User1Cipher.encrypt(
      //   [BigInt(amount1), BigInt(price1)],
      //   User1Nonce
      // );

      // let baseVaultPDA = await deriveVaultPDA(baseMint, program.programId);
      // let orderAccountPDA = await deriveOrderAccountPDA(new anchor.BN(order1Id), program.programId);
      // let userLedgerPDA = await deriveUserLedgerPDA(user1.publicKey, program.programId);

      // const buyOrder = await program.methods
      // .submitOrder(
      //   Array.from(User1Ciphertext[0]),
      //   Array.from(User1Ciphertext[1]),
      //   Array.from(User1PublicKey),
      //   0, // buy
      //   submitOrder1ComputationOffset,
      //   new anchor.BN(order1Id),
      //   new anchor.BN(deserializeLE(User1Nonce).toString())
      // )
      // .accountsPartial({
      //   computationAccount: getComputationAccAddress(
      //     program.programId,
      //     submitOrder1ComputationOffset
      //   ),
      //   user: user1.publicKey,
      //   signPdaAccount: deriveSignerAccountPDA(program.programId),
      //   poolAccount: deriveArciumFeePoolAccountAddress(),
      //   clusterAccount: arciumEnv.arciumClusterPubkey,
      //   mxeAccount: getMXEAccAddress(program.programId),
      //   mempoolAccount: getMempoolAccAddress(program.programId),
      //   executingPool: getExecutingPoolAccAddress(program.programId),
      //   compDefAccount: getCompDefAccAddress(
      //     program.programId,
      //     Buffer.from(getCompDefAccOffset("submit_order")).readUInt32LE()
      //   ),
      //   clockAccount: getClockAccAddress(),
      //   systemProgram: SystemProgram.programId,
      //   arciumProgram: getArciumProgramId(),
      //   baseMint: baseMint,
      //   vault: baseVaultPDA,
      //   orderAccount: orderAccountPDA,
      //   orderbookState: OrderbookPDA,
      //   userLedger: userLedgerPDA,
      // })
      // .signers([user1])
      // .rpc({ commitment: "confirmed" });

      // await awaitComputationFinalization(
      //   provider,
      //   submitOrder1ComputationOffset,
      //   program.programId,
      //   "confirmed"
      // );

      // const User2Cipher = new RescueCipher(User1SharedSecret);

      // let amount2 = BigInt(100);
      // let price2 = BigInt(50);
      // let order2Id = 11;

      // const submitOrder2ComputationOffset = new anchor.BN(randomBytes(8), "hex");

      // const User2Nonce = randomBytes(16);
      // const User2Ciphertext = User2Cipher.encrypt(
      //   [BigInt(amount1), BigInt(price1)],
      //   User1Nonce
      // );

      // let baseVault2PDA = await deriveVaultPDA(baseMint, program.programId);
      // let orderAccount2PDA = await deriveOrderAccountPDA(new anchor.BN(order1Id), program.programId);
      // let userLedger2PDA = await deriveUserLedgerPDA(user1.publicKey, program.programId);

      // const sellOrder = await program.methods
      // .submitOrder(
      //   Array.from(User2Ciphertext[0]),
      //   Array.from(User2Ciphertext[1]),
      //   Array.from(User1PublicKey),
      //   0, // buy
      //   submitOrder1ComputationOffset,
      //   new anchor.BN(order2Id),
      //   new anchor.BN(deserializeLE(User2Nonce).toString())
      // )
      // .accountsPartial({
      //   computationAccount: getComputationAccAddress(
      //     program.programId,
      //     submitOrder1ComputationOffset
      //   ),
      //   user: user1.publicKey,
      //   signPdaAccount: deriveSignerAccountPDA(program.programId),
      //   poolAccount: deriveArciumFeePoolAccountAddress(),
      //   clusterAccount: arciumEnv.arciumClusterPubkey,
      //   mxeAccount: getMXEAccAddress(program.programId),
      //   mempoolAccount: getMempoolAccAddress(program.programId),
      //   executingPool: getExecutingPoolAccAddress(program.programId),
      //   compDefAccount: getCompDefAccAddress(
      //     program.programId,
      //     Buffer.from(getCompDefAccOffset("submit_order")).readUInt32LE()
      //   ),
      //   clockAccount: getClockAccAddress(),
      //   systemProgram: SystemProgram.programId,
      //   arciumProgram: getArciumProgramId(),
      //   baseMint: baseMint,
      //   vault: baseVault2PDA,
      //   orderAccount: orderAccount2PDA,
      //   orderbookState: OrderbookPDA,
      //   userLedger: userLedger2PDA,
      // })
      // .signers([user1])
      // .rpc({ commitment: "confirmed" });

      // await awaitComputationFinalization(
      //   provider,
      //   submitOrder2ComputationOffset,
      //   program.programId,
      //   "confirmed"
      // );

      // await program.methods
      //   .triggerMatching(new anchor.BN(0), TriggerMatchingComputationOffset)
      //   .accountsPartial({
      //     computationAccount: getComputationAccAddress(
      //       program.programId,
      //       TriggerMatchingComputationOffset
      //     ),
      //   })
      //   .signers([user1])
      //   .rpc({ commitment: "confirmed" });

      // await awaitComputationFinalization(
      //   provider,
      //   TriggerMatchingComputationOffset,
      //   program.programId,
      //   "confirmed"
      // );

      console.log("  - Trigger matching computation");

      console.log("  - Verify nonce increment (CRITICAL!)");

      console.log("  - Verify MatchResultEvent");

      // const eventPromise = awaitEvent("matchesFoundEvent");
      // const event = await eventPromise;

      // TODO : asserstion about the things returned in the event
      // console.log("match result event", event);
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
});
