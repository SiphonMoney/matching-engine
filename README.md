# Dark Pool Matching Engine with MPC-Powered Liquidity Management

A next-generation privacy-preserving trading system built on Solana using Arcium's Multi-Party Computation (MPC) network. This protocol combines encrypted order matching with **user-decryptable balance management** and **MPC-verified withdrawals** to create a truly confidential yet user-transparent trading experience.

## Overview

Traditional on-chain DEXs expose all order details, balances, and trading activity publicly. This dark pool solves multiple problems simultaneously:

1. **Privacy**: Order amounts and prices encrypted, matching happens on encrypted data
2. **User Transparency**: Users can decrypt their own balances using x25519 keys (not possible in traditional ZK systems)
3. **Security**: MPC validates all operations cryptographically before execution
4. **No Blind Trust**: Unlike traditional dark pools, users always know their exact balance

## 🚀 Key Innovation: User-Decryptable Encrypted Balances

Unlike traditional privacy systems where balances are completely opaque, this protocol uses **dual-encryption architecture**:

- **For User Balances**: `Enc<Shared, Balances>` - Both user AND MPC can decrypt
- **For Order Details**: `Enc<Shared, Balances>` - Only user can decrypt

This means users can query and verify their encrypted balances at any time, while order details remain completely private.

## Key Features

### 🔐 User-Decryptable Balance Management
- **UserPrivateLedger**: Encrypted with `Enc<Shared, Balances>` scheme
- Users can decrypt their own balances using x25519 private keys
- MPC network can validate balances for withdrawals
- Real-time balance updates via event system
- Supports base token (SOL) and quote token (USDC) pairs

### 🏦 Secure Liquidity Operations
- **Deposit Flow**: SPL tokens → Vault → MPC updates encrypted balance
- **Two-Step Withdrawal**:
  1. `withdraw_from_ledger_verify` - MPC validates sufficient funds
  2. `withdraw_from_vault` - Cranker bot executes token transfer
- **PDA-Based Vault Security**: Program-controlled vault authority
- **Event-Driven**: Real-time notifications for all balance changes

### 🕵️ Privacy-Preserving Orders (Future)
- Order amounts and prices encrypted using x25519 key exchange + RescueCipher
- Only MPC network can decrypt and process orderbook operations
- Confidential matching: Orders matched on encrypted data without revealing details
- Dark pool functionality: Traders can't see other orders or liquidity depth

### 🔒 MPC-Powered Validation
- **Balance Verification**: MPC checks `available >= withdrawal_amount` on encrypted data
- **Order Matching**: Finds price crossings without decrypting individual orders
- **Settlement Validation**: Cryptographic proof of correct execution
- **Nonce Protection**: Every operation increments nonce to prevent replay attacks

### 📡 Real-Time Event System
- **WebSocket Support**: Live balance updates, withdrawal status, order fills
- **Event Types**:
  - `UserLedgerInitializedEvent`
  - `UserLedgerDepositedEvent`
  - `UserLedgerWithdrawVerifiedSuccessEvent`
  - `UserLedgerWithdrawVerifiedFailedEvent`
  - `WithdrawEvent`
  - `OrderProcessedEvent` / `MatchResultEvent` (future)
- **Backend Indexer**: PostgreSQL persistence for historical queries
- **User-Specific Filtering**: WebSocket subscriptions filtered by user pubkey

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ Layer 5: User Interface & Real-Time Events                  │
│ • React frontend with x25519 key management                 │
│ • WebSocket live updates (balances, withdrawals, orders)    │
│ • User decrypts Enc<Shared, Balances> with private key      │
│ • Event indexer + PostgreSQL for historical data            │
└─────────────────────────────────────────────────────────────┘
                              ↕
┌─────────────────────────────────────────────────────────────┐
│ Layer 4: Withdrawal & Settlement Validation                 │
│ • Two-step withdrawal: MPC verify → Cranker execute         │
│ • MPC validates: available >= withdrawal_amount             │
│ • Cranker bot: Authorized executor for vault transfers      │
│ • Event-driven: Success event triggers token transfer       │
└─────────────────────────────────────────────────────────────┘
                              ↕
┌─────────────────────────────────────────────────────────────┐
│ Layer 3: MPC Computation Network (Arcium)                   │
│ • init_user_ledger: Create encrypted balance (Shared)       │
│ • update_ledger_deposit: Add to encrypted balance           │
│ • update_ledger_withdraw_verify: Validate + subtract        │
│ • submit_order: Add to encrypted orderbook (Mxe)            │
│ • match_orders: Find crossings on encrypted data            │
│ • execute_settlement: Update balances after trade           │
└─────────────────────────────────────────────────────────────┘
                              ↕
┌─────────────────────────────────────────────────────────────┐
│ Layer 2: Encrypted State Management (On-Chain)              │
│ • UserPrivateLedger: Enc<Shared, Balances> [user-readable] │
│ • OrderBookState: Enc<Mxe, OrderBook> [MPC-only]            │
│ • Nonce-based replay protection                             │
│ • Event emission for all state changes                      │
└─────────────────────────────────────────────────────────────┘
                              ↕
┌─────────────────────────────────────────────────────────────┐
│ Layer 1: Vault & Token Management (Solana SPL)              │
│ • PDA-controlled vaults (base_mint, quote_mint)             │
│ • Deposit: User ATA → Vault (public SPL transfer)           │
│ • Withdraw: Vault → User ATA (cranker-signed)               │
│ • Vault authority PDA ensures program-only control          │
└─────────────────────────────────────────────────────────────┘
```

### Core Components

#### 1. Encrypted Instructions (`encrypted-ixs/`)
MPC circuits written in Arcis (Arcium's Rust framework):

**Liquidity Management (✅ Implemented)**
- `init_user_ledger(user: Shared) -> Enc<Shared, Balances>` - Initialize user balance
- `update_ledger_deposit(ledger, amount, is_base) -> Enc<Shared, Balances>` - Add deposit
- `update_ledger_withdraw_verify(ledger, amount, is_base) -> (Enc<Shared, Balances>, bool)` - Validate withdrawal

**Trading Operations (🚧 Future)**
- `submit_order` - Adds encrypted orders to orderbook
- `match_orders` - Finds crossing orders and generates matches
- `execute_settlement` - Updates balances after trade execution

#### 2. Solana Program (`programs/matching_engine/`)
On-chain program orchestrating MPC operations:

**Account Structures**
- `MXEAccount` - MPC network public key + cluster info
- `UserPrivateLedger` - User's encrypted balances (base/quote, total/available)
- `OrderBookState` - Encrypted orderbook state
- `SignerAccount` - PDA bump for computation signing

**Instructions**
- `initialize` - Set up MXE account with Arcium cluster
- `initialize_user_ledger` - Create user's private ledger
- `deposit_to_ledger` - Deposit SPL tokens + queue MPC balance update
- `withdraw_from_ledger_verify` - Queue MPC withdrawal validation
- `withdraw_from_vault` - Execute verified withdrawal (cranker-signed)
- `submit_order` / `trigger_matching` / `execute_settlement` (future)

**Callbacks**
- `init_user_ledger_callback` - Process MPC result, emit event
- `update_ledger_deposit_callback` - Update encrypted balance, emit event
- `update_ledger_withdraw_verify_callback` - Handle success/failure, emit events

## Workflow

### 💰 Deposit Flow (✅ Implemented)
```
1. User calls: deposit_to_ledger(amount, is_base_token)
   ↓
2. SPL Token Transfer: User ATA → Vault (public on-chain)
   ↓
3. Queue MPC: update_ledger_deposit(encrypted_balance, amount, is_base)
   ↓
4. MPC Circuit:
   - Decrypt user's balance using shared secret
   - Add deposit: total += amount, available += amount
   - Re-encrypt with new nonce
   ↓
5. Callback: update_ledger_deposit_callback()
   - Update UserPrivateLedger.encrypted_balances
   - Increment balance_nonce
   - Emit UserLedgerDepositedEvent
   ↓
6. User Frontend:
   - Receives event via WebSocket
   - Decrypts balance with x25519 private key
   - Updates UI: "Balance: 100 SOL"
```

### 🏧 Withdrawal Flow (✅ Implemented)
```
STEP 1: MPC Validation
─────────────────────
1. User calls: withdraw_from_ledger_verify(amount, is_base_token)
   ↓
2. Queue MPC: update_ledger_withdraw_verify(encrypted_balance, amount)
   ↓
3. MPC Circuit:
   - Decrypt user's balance
   - Check: available >= amount?
   
   IF YES:
     - Subtract: available -= amount, total -= amount
     - Re-encrypt balance
     - Return: (new_balance, true)
   
   IF NO:
     - Return: (unchanged_balance, false)
   ↓
4. Callback: update_ledger_withdraw_verify_callback()
   
   IF success:
     - Update encrypted_balances (funds locked)
     - Emit: UserLedgerWithdrawVerifiedSuccessEvent { user, amount }
   
   IF failure:
     - No balance change
     - Emit: UserLedgerWithdrawVerifiedFailedEvent { user }

STEP 2: Cranker Execution
──────────────────────────
5. Cranker Bot listens for UserLedgerWithdrawVerifiedSuccessEvent
   ↓
6. Cranker calls: withdraw_from_vault(amount, user_pubkey)
   ↓
7. SPL Token Transfer: Vault → User ATA
   - Signed by cranker bot (8wJE7H7svhpz...)
   - Uses vault_authority PDA for signing
   ↓
8. Emit: WithdrawEvent { user, amount }
   ↓
9. User receives tokens + balance update event
```

### 📊 Order Submission (🚧 Future)
1. User creates encrypted order (amount, price) using x25519 + RescueCipher
2. Program queues MPC computation with encrypted data
3. MPC network adds order to encrypted orderbook
4. Callback updates on-chain state and nonce
5. OrderAccount created with status and locked funds

### 🔀 Order Matching (🚧 Future)
1. Backend triggers matching computation (rate-limited to 15s intervals)
2. MPC network decrypts orderbook, finds price crossings
3. Generates up to 5 matches with execution prices
4. Encrypts match results for backend (Enc<Shared, MatchResult>)
5. Callback emits MatchResultEvent with encrypted matches

### ⚖️ Settlement (🚧 Future)
1. Backend decrypts match results using match nonce
2. Derives buyer/seller vault PDAs from user pubkeys
3. Executes settlement instruction with match details
4. Program transfers tokens between vaults
5. Updates order statuses and vault balances

## Prerequisites

- **Rust** 1.75+ with Solana toolchain
- **Solana CLI** 2.2.0 (required for local testing)
- **Anchor Framework** 0.31.1
- **Arcium CLI** 0.3 (required for local testing)
- **Node.js** 18+ with Yarn package manager

## Installation

NOTE: Istall arcium cli for your system from the following page: https://docs.arcium.com/developers/installation 

```bash
# Clone the repository
git clone github.com/arnabnandikgp/matching-engine
cd matching_engine

# Install dependencies
yarn install

# Build Anchor program
arcium build

```

## Local Development

### Start Arcium Localnet
```bash
# Start local Arcium MPC network (in separate terminal)
arcium localnet
```


## Testing

### Prerequisites for Local Testing

Before running tests locally, ensure you have the correct versions installed:

- **Solana CLI 2.2.0** - Required for local validator compatibility
- **Arcium CLI 0.3** - Required for MPC network localnet

To verify your versions:
```bash
solana --version  # Should show 2.2.0
arcium --version  # Should show 0.3.x
```

### Running Tests

Run the comprehensive test suite:

```bash
# Run all tests
anchor test

# Run specific test file
yarn run ts-mocha -p ./tsconfig.json -t 1000000 tests/matching_engine.ts

# Run with verbose logging
anchor test -- --grep "pattern"
```

Test suite covers:
- Core functionality (initialization, vaults, orders, matching, settlement)
- Edge cases (validation, boundaries, error handling)
- Performance (load testing, throughput)
- Security (privacy verification, access control)
- Integration (end-to-end user journeys)

See [TESTING_STRATEGY.md](./TESTING_STRATEGY.md) for detailed testing documentation.

## Project Structure

```
matching_engine/
├── encrypted-ixs/              # MPC computation circuits
│   └── src/
│       └── lib.rs              # submit_order, match_orders logic
├── programs/matching_engine/   # Solana on-chain program
│   └── src/
│       ├── lib.rs              # Program entrypoint & callbacks
│       ├── instructions/       # Instruction handlers
│       │   ├── initialize.rs
│       │   ├── submit_order.rs
│       │   ├── trigger_matching.rs
│       │   └── execute_settlement.rs
│       └── states/             # Account structures
│           ├── order_book_state.rs
│           ├── order_account.rs
│           └── vault_state.rs
├── tests/                      # Integration tests
├── Anchor.toml                 # Anchor configuration
└── Arcium.toml                 # Arcium network configuration
```

## Key Concepts

### Encryption Types
- `Enc<Shared, T>` - Encrypted data shared between user and MPC network
- `Enc<Mxe, T>` - Encrypted data only MPC network can decrypt

### Order Lifecycle
1. **Pending (0)** - Order account created, funds locked
2. **Processing (1)** - Added to encrypted orderbook
3. **Rejected (2)** - Orderbook full or validation failed
4. **Partially Filled (3)** - Matched but not fully filled
5. **Fully Filled (4)** - Completely matched and settled

<!-- ### Nonce Management
Every MPC operation requires a nonce and produces a new nonce. The program tracks:
- `orderbook_nonce` - Current nonce for orderbook encryption
- `match_nonce` - Fresh nonce for each match result

Critical: Callbacks must update stored nonces or subsequent operations will fail. -->

## Configuration

### Orderbook Limits
- `MAX_ORDERS = 10` (per side)
- `MAX_MATCHES_PER_BATCH = 5`
- Matching rate limit: 15 seconds between triggers

### Account PDAs
- OrderBookState: `[b"order_book_state"]`
- OrderAccount: `[b"order", order_id]`
<!-- 
## Documentation

- [ARCHITECTURE_DIAGRAM.md](./ARCHITECTURE_DIAGRAM.md) - System architecture overview -->
<!-- - [COMPLETE_FLOW_DIAGRAMS.md](./COMPLETE_FLOW_DIAGRAMS.md) - Detailed flow diagrams -->
<!-- - [TESTING_STRATEGY.md](./TESTING_STRATEGY.md) - Test suite documentation -->
<!-- - [COMPREHENSIVE_TEST_CHECKLIST.md](./COMPREHENSIVE_TEST_CHECKLIST.md) - Full test checklist -->

## Current Status

### ✅ Fully Implemented & Tested
- [x] MXE initialization with Arcium cluster
- [x] User private ledger creation (user-decryptable)
- [x] Deposit flow with MPC balance updates
- [x] Two-step withdrawal (MPC verify → Cranker execute)
- [x] Event emission for all liquidity operations
- [x] Comprehensive test suite (14 passing tests)
- [x] Nonce-based replay protection
- [x] PDA-based vault security
- [x] Order submission with large encrypted data handling

### 🚧 In Development
- [ ] Order matching circuits
- [ ] Settlement execution
- [ ] Backend event indexer (Node.js + PostgreSQL)

### 🔮 Future Enhancements
- [ ] Cross-program invocation for DeFi integrations
- [ ] Multi-token pair support
- [ ] Advanced order types (limit, stop-loss, IOC, FOK)
- [ ] MEV protection mechanisms

## Security Considerations

**Privacy Guarantees:**
- ✅ User balances encrypted on-chain (Enc<Shared, Balances>)
- ✅ Users can decrypt their own balances (x25519 private key)
- ✅ MPC validates withdrawals on encrypted data
- ✅ Order amounts and prices never stored in plaintext (future)
- ✅ Orderbook structure hidden in encrypted ciphertext (future)

**Known Public Information:**
- User public keys (for PDA derivation)
- Transaction signatures and timestamps
- Event types (deposit, withdraw, order submission)
- Vault balances (total locked funds)

**Security Mechanisms:**
- ✅ Nonce-based replay protection
- ✅ PDA-based access control
- ✅ Cranker bot authentication (hardcoded pubkey)
- ✅ MPC cryptographic validation
- ✅ Two-step withdrawal prevents unauthorized transfers

**Trust Assumptions:**
- Arcium MPC network operates honestly
- Cranker bot executes withdrawals correctly
- Users/client code protects their x25519 private keys
- Solana validators don't collude
<!-- 
**⚠️ Security Notes:**
- This is a **prototype** for educational purposes
- **Not audited** for production use
- Cranker bot private key must be secured (HSM recommended)
- Test thoroughly before mainnet deployment -->

## License

GPL v3

## Acknowledgments

Built with [Arcium](https://arcium.com) - Confidential Computing Network for Blockchain
