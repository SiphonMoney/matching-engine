# Updated Dark Pool Architecture with In-App Settlement

## Table of Contents
- [Updated Dark Pool Architecture with In-App Settlement](#updated-dark-pool-architecture-with-in-app-settlement)
  - [Table of Contents](#table-of-contents)
  - [1. System Architecture Overview](#1-system-architecture-overview)
  - [2. User Ledger Initialization Flow](#2-user-ledger-initialization-flow)
  - [3. Deposit Flow](#3-deposit-flow)
  - [4. Order Submission with Balance Validation](#4-order-submission-with-balance-validation)
  - [5. Order Matching Flow](#5-order-matching-flow)
  - [6. Backend Settlement (Event-Based)](#6-backend-settlement-event-based)
  - [7. Complete End-to-End User Journey](#7-complete-end-to-end-user-journey)
  - [8. Account Relationships](#8-account-relationships)
  - [9. Data Privacy Levels](#9-data-privacy-levels)
  - [Summary: Key Design Decisions](#summary-key-design-decisions)

---

## 1. System Architecture Overview

```mermaid
graph TB
    subgraph "Client Layer"
        USER[User Wallet]
        BACKEND[Backend Settlement Service]
        FRONTEND[Frontend dApp]
    end
    
    subgraph "Solana Program Accounts"
        PROGRAM[Matching Engine Program]
        VAULT[SPL Token Vaults<br/>PDA: vault/mint]
        LEDGER[UserPrivateLedger<br/>PDA: user_ledger/user<br/>MXE Encrypted Balances]
        ORDERACCT[OrderAccount<br/>PDA: order/order_id<br/>Shared Encrypted Status]
        OB[OrderBookState<br/>PDA: order_book_state<br/>MXE Encrypted Orders]
    end
    
    subgraph "Arcium MPC Network"
        MXE[MXE Nodes]
        CIRCUITS[Encrypted Circuits]
    end
    
    subgraph "Settlement Events"
        EVENTS[MatchesFoundEvent<br/>OrderSubmittedEvent<br/>Contains encrypted match data]
    end
    
    USER -->|1. Deposit tokens| VAULT
    PROGRAM -->|2. Update| LEDGER
    USER -->|3. Submit order| PROGRAM
    PROGRAM -->|4. Queue MPC| MXE
    MXE -->|5. Validate & match| CIRCUITS
    CIRCUITS -->|6. Return results| PROGRAM
    PROGRAM -->|7. Update| OB
    PROGRAM -->|8. Update| LEDGER
    PROGRAM -->|9. Create| ORDERACCT
    PROGRAM -->|10. Emit| EVENTS
    BACKEND -->|11. Listen & decrypt| EVENTS
    BACKEND -->|12. Execute settlement| VAULT
    
    style LEDGER fill:#ff9999
    style OB fill:#99ff99
    style MXE fill:#9999ff
    style EVENTS fill:#ffff99
```

**Key Changes:**
- **UserPrivateLedger**: MXE-encrypted balances (not backend-encrypted)
- **No MatchResult PDAs**: Events-only architecture
- **In-app settlement**: All balance tracking happens in-app via encrypted ledgers
- **Atomic settlement**: Backend listens to events and settles at SPL vault level

---

## 2. User Ledger Initialization Flow

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant Program as Matching Engine
    participant Ledger as UserPrivateLedger PDA
    participant MXE as Arcium MPC
    participant Circuit as init_user_ledger()
    
    Note over User,Circuit: Initialize encrypted balance tracking
    
    User->>Program: initializeUserLedger(computation_offset)
    
    Program->>Program: Create UserPrivateLedger PDA<br/>seeds = [b"user_ledger", user.pubkey]
    
    Program->>Ledger: Initialize account<br/>owner = user<br/>encrypted_balances = <br/>balance_nonce = 0
    
    Program->>MXE: Queue init_user_ledger computation<br/>Args: [nonce=0]
    
    MXE->>Circuit: Execute: init_balances(mxe)
    Circuit->>Circuit: Create initial balances<br/>base_total=0, base_available=0<br/>quote_total=0, quote_available=0
    Circuit-->>MXE: Return Enc<Mxe, Balances>
    
    MXE->>Program: Callback with encrypted balances
    Program->>Ledger: Store encrypted_balances[4]<br/>balance_nonce = 0
    
    Note over Ledger: User ledger ready for deposits
```

**Circuit Signature:**
```rust
pub fn init_user_ledger(mxe: Mxe) -> Enc<Mxe, Balances> {
    mxe.from_arcis(Balances {
        base_total: 0,
        base_available: 0,
        quote_total: 0,
        quote_available: 0,
    })
}
```

---

## 3. Deposit Flow

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant ATA as User's ATA
    participant Program as Matching Engine
    participant Vault as SPL Token Vault
    participant Ledger as UserPrivateLedger
    participant MXE as Arcium MPC
    participant Circuit as update_ledger_deposit()
    
    Note over User,Circuit: Deposit tokens and update encrypted balances
    
    User->>Program: depositToLedger(amount=100, is_base_token=true)
    
    Program->>Program: Transfer SPL tokens<br/>From: user_token_account<br/>To: vault<br/>Amount: 100
    
    ATA-->>Vault: Transfer 100 tokens
    
    Program->>MXE: Queue update_ledger_deposit<br/>Args: [<br/>  current_balances (Enc<Mxe, Balances>),<br/>  deposit_amount=100,<br/>  is_base_token=0<br/>]
    
    MXE->>Circuit: Execute update_ledger_deposit
    
    Circuit->>Circuit: Decrypt current balances
    Circuit->>Circuit: If is_base_token:<br/>  base_total += 100<br/>  base_available += 100
    Circuit->>Circuit: Encrypt updated balances
    
    Circuit-->>MXE: Return Enc<Mxe, Balances>
    
    MXE->>Program: Callback with encrypted balances
    
    Program->>Ledger: Update encrypted_balances[4]<br/>Increment balance_nonce
    
    Note over Ledger: Balance updated:<br/>SPL vault: +100<br/>Encrypted ledger: +100
```

**Circuit Signature:**
```rust
pub fn update_ledger_deposit(
    current_balances: Enc<Mxe, &Balances>,
    amount: u64,
    is_base_token: u8,
) -> Enc<Mxe, Balances> {
    let mut balances = *(current_balances.to_arcis());
    
    if is_base_token == 0 {
        balances.base_total += amount;
        balances.base_available += amount;
    } else {
        balances.quote_total += amount;
        balances.quote_available += amount;
    }
    
    current_balances.owner.from_arcis(balances)
}
```

---

## 4. Order Submission with Balance Validation

```mermaid
sequenceDiagram
    autonumber
    actor User
    participant FE as Frontend
    participant Program as Matching Engine
    participant Ledger as UserPrivateLedger
    participant OrderAcct as OrderAccount
    participant OB as OrderBookState
    participant MXE as Arcium MPC
    participant Circuit as submit_order()
    
    Note over User,Circuit: Submit order with in-app balance check
    
    User->>FE: Create order (amount=10, price=5, type=BUY)
    FE->>FE: Generate x25519 keypair
    FE->>FE: Get MXE public key
    FE->>FE: Encrypt [amount, price]
    
    FE->>Program: submitOrder(<br/>  encrypted_amount[32],<br/>  encrypted_price[32],<br/>  user_pubkey[32],<br/>  order_type=0,<br/>  order_id=12,<br/>  order_nonce=123<br/>)
    
    <!-- Note over Program: ⚠️ KEY ISSUE: How to pass encrypted struct? -->
    
    Program->>Program: Create OrderAccount PDA<br/>seeds = [b"order", order_id]
    
    Program->>MXE: Queue submit_order<br/>Args: [<br/>  user_sensitive (Enc<Shared, UserSensitiveData>),<br/>  user_ledger (Enc<Mxe, &Balances>),<br/>  orderbook (Enc<Mxe, &OrderBook>),<br/>  order_id=12,<br/>  order_type=0,<br/>  timestamp<br/>]
    
    <!-- Note over Program,MXE: 🔴 CURRENT PROBLEM:<br/>Passing Argument::EncryptedU64(amount)<br/>+ Argument::EncryptedU64(price)<br/>doesn't match Enc<Shared, Struct> -->
    
    MXE->>Circuit: Execute submit_order
    
    Circuit->>Circuit: Decrypt amount & price<br/>Decrypt user balances<br/>Decrypt orderbook
    
    Circuit->>Circuit: Calculate required:<br/>BUY: amount * price = 50<br/>Check: available_quote >= 50
    
    alt Sufficient Balance
        Circuit->>Circuit: Lock funds:<br/>quote_available -= 50
        Circuit->>Circuit: Add order to orderbook
        Circuit->>Circuit: Set status = PROCESSING
    else Insufficient Balance
        Circuit->>Circuit: Set status = INSUFFICIENT_BALANCE
    end
    
    Circuit-->>MXE: Return (<br/>  Enc<Mxe, OrderBook>,<br/>  Enc<Mxe, Balances>,<br/>  Enc<Shared, OrderStatus>,<br/>  success: bool<br/>)
    
    MXE->>Program: Callback with results
    
    Program->>OB: Update encrypted orderbook
    Program->>Ledger: Update encrypted balances
    Program->>OrderAcct: Store encrypted status
    
    Program->>Program: Emit OrderSubmittedEvent {<br/>  order_id=12,<br/>  user,<br/>  success=true<br/>}
```

**Circuit Signature:**
```rust
pub fn submit_order(
    user_sensitive: Enc<Shared, UserSensitiveData>,  // {amount: u64, price: u64}
    user_ledger: Enc<Mxe, &Balances>,
    orderbook_ctx: Enc<Mxe, &OrderBook>,
    order_id: u64,
    order_type: u8,  // 0=BUY, 1=SELL
    timestamp: u64,
) -> (
    Enc<Mxe, OrderBook>,      // Updated orderbook
    Enc<Mxe, Balances>,       // Updated ledger
    Enc<Shared, OrderStatus>, // For user decryption
    bool,                     // Success flag
)
```

**THE FIX (from blackjack example):**

Instead of:
```rust
// ❌ WRONG - Passes as two separate Enc<Shared, u64>
let args = vec![
    Argument::ArcisPubkey(user_pubkey),
    Argument::PlaintextU128(order_nonce),
    Argument::EncryptedU64(amount),  // Separate
    Argument::EncryptedU64(price),   // Separate
    // ...
];
```

Do this:
```rust
// ✅ CORRECT - Store encrypted data on-chain first, pass by reference
// Option 1: Store in OrderAccount before submitting
let args = vec![
    Argument::ArcisPubkey(user_pubkey),
    Argument::PlaintextU128(order_nonce),
    Argument::Account(order_account.key(), offset, size),  // Point to stored encrypted data
    // ...
];

// Option 2: Store temporarily in a PDA just for the computation
```

---

## 5. Order Matching Flow

```mermaid
sequenceDiagram
    autonumber
    participant Backend as Backend/Cranker
    participant Program as Matching Engine
    participant OB as OrderBookState
    participant MXE as Arcium MPC
    participant Circuit as match_orders()
    
    Note over Backend,Circuit: Periodic matching (every 15 seconds)
    
    Backend->>Program: triggerMatching(computation_offset)
    
    Program->>Program: Check: now - last_match >= 15s
    Program->>Program: Update last_match_timestamp
    
    Program->>MXE: Queue match_orders<br/>Args: [<br/>  backend_pubkey[32],<br/>  backend_nonce,<br/>  orderbook (Enc<Mxe, &OrderBook>)<br/>]
    
    MXE->>Circuit: Execute match_orders
    
    Circuit->>Circuit: Decrypt orderbook<br/>Get buy_orders[5], sell_orders[5]
    
    Circuit->>Circuit: Find matches:<br/>For each buy order:<br/>  For each sell order:<br/>    If buy_price >= sell_price:<br/>      Create match
    
    Circuit->>Circuit: Create MatchResults[3]:<br/>[<br/>  {order_id: 12, amount: 10, price: 5},<br/>  {order_id: 15, amount: 10, price: 5},<br/>  {order_id: 0, amount: 0, price: 0}<br/>]
    
    Circuit->>Circuit: Remove matched orders from orderbook
    Circuit->>Circuit: Encrypt results for backend
    
    Circuit-->>MXE: Return (<br/>  Enc<Shared, (MatchResult, 3))>, <br/>  Enc<Mxe, OrderBook><br/>)
    
    MXE->>Program: Callback with results
    
    Program->>OB: Update encrypted orderbook
    
    Program->>Program: Emit MatchesFoundEvent {<br/>  encrypted_matches[11 chunks],<br/>  backend_nonce,<br/>  orderbook_nonce,<br/>  timestamp<br/>}
    
    Note over Program: NO MatchResult PDAs created!<br/>Events are sufficient
```

**Match Result Structure:**
```rust
pub struct MatchResult {
    pub order_id: u64,  // Which order matched
    pub amount: u64,    // How much
    pub price: u64,     // At what price
}

// No fees, no user info - kept simple
// Backend decrypts to get settlement details
```

---

## 6. Backend Settlement (Event-Based)

```mermaid
sequenceDiagram
    autonumber
    participant Backend as Backend Service
    participant Events as Solana Event Logs
    participant MXE as Arcium MPC (for decryption)
    participant Program as Matching Engine
    participant Vault as SPL Token Vaults
    participant Ledger as UserPrivateLedger
    
    Note over Backend,Ledger: Backend listens for MatchesFoundEvent
    
    Events->>Backend: MatchesFoundEvent emitted {<br/>  encrypted_matches,<br/>  backend_nonce,<br/>  orderbook_nonce<br/>}
    
    Backend->>Backend: Extract encrypted_matches[11 chunks]
    
    Backend->>MXE: Decrypt using backend x25519 key
    
    MXE-->>Backend: Decrypted matches:<br/>[<br/>  {order_id: 12, amount: 10, price: 5},<br/>  {order_id: 15, amount: 10, price: 5}<br/>]
    
    Backend->>Backend: For each match:<br/>Lookup OrderAccount PDA<br/>Get buyer/seller pubkeys
    
    Backend->>Program: executeSettlement(<br/>  match_id,<br/>  buyer,<br/>  seller,<br/>  quantity=10,<br/>  execution_price=5<br/>)
    
    Program->>Program: Verify settlement authority<br/>(backend must be authorized)
    
    Program->>Program: Create MatchRecord PDA<br/>seeds = [b"match_record", match_id]<br/>Check: !is_settled
    
    Program->>Vault: Transfer tokens atomically:<br/>buyer_base_vault += 10<br/>buyer_quote_vault -= 50<br/>seller_base_vault -= 10<br/>seller_quote_vault += 50
    
    Program->>Program: Update MatchRecord<br/>is_settled = true
    
    Program->>Program: Emit SettlementExecutedEvent {<br/>  match_id,<br/>  buyer,<br/>  seller,<br/>  quantity=10,<br/>  execution_price=5<br/>}
    
    Note over Ledger: Encrypted ledgers NOT updated here<br/>Will be updated on next order submission
```

**Key Points:**
- Backend decrypts match results using its x25519 key
- Settlement is ATOMIC at SPL vault level
- No encrypted balance updates during settlement (too complex)
- Encrypted ledgers get synced on next user interaction
- MatchRecord prevents double-settlement

---

## 7. Complete End-to-End User Journey

```mermaid
sequenceDiagram
    autonumber
    actor Alice
    actor Bob
    participant Program
    participant Vault
    participant Ledger_A as Alice's Ledger
    participant Ledger_B as Bob's Ledger
    participant MXE
    participant Backend
    
    Note over Alice,Backend: STEP 1: Setup & Deposits
    
    Alice->>Program: initializeUserLedger()
    Program->>Ledger_A: Create PDA<br/>encrypted_balances = zeros
    
    Alice->>Program: depositToLedger(100 USDC)
    Program->>Vault: Transfer 100 USDC
    Program->>MXE: Update balances
    MXE-->>Ledger_A: quote_available = 100
    
    Bob->>Program: initializeUserLedger()
    Program->>Ledger_B: Create PDA
    
    Bob->>Program: depositToLedger(50 SOL)
    Program->>Vault: Transfer 50 SOL
    Program->>MXE: Update balances
    MXE-->>Ledger_B: base_available = 50
    
    Note over Alice,Backend: STEP 2: Order Submission
    
    Alice->>Program: submitOrder(BUY 10 SOL @ 5 USDC)
    Program->>MXE: Validate balance (need 50 USDC)
    MXE->>MXE: Check: quote_available >= 50 ✓
    MXE->>MXE: Lock: quote_available -= 50
    MXE-->>Program: Success, order added
    Program->>Ledger_A: Update encrypted balances
    
    Bob->>Program: submitOrder(SELL 10 SOL @ 5 USDC)
    Program->>MXE: Validate balance (need 10 SOL)
    MXE->>MXE: Check: base_available >= 10 ✓
    MXE->>MXE: Lock: base_available -= 10
    MXE-->>Program: Success, order added
    Program->>Ledger_B: Update encrypted balances
    
    Note over Alice,Backend: STEP 3: Matching
    
    Backend->>Program: triggerMatching()
    Program->>MXE: Find matches
    MXE->>MXE: Match found:<br/>Alice BUY 10 @ 5<br/>Bob SELL 10 @ 5
    MXE-->>Program: Encrypted match results
    Program->>Program: Emit MatchesFoundEvent
    
    Note over Alice,Backend: STEP 4: Settlement
    
    Backend->>Backend: Listen to MatchesFoundEvent
    Backend->>MXE: Decrypt match results
    MXE-->>Backend: {Alice: buy 10 @ 5, Bob: sell 10 @ 5}
    
    Backend->>Program: executeSettlement()
    Program->>Vault: Alice: +10 SOL, -50 USDC
    Program->>Vault: Bob: -10 SOL, +50 USDC
    
    Note over Alice,Bob: Settlement complete!<br/>Alice received 10 SOL<br/>Bob received 50 USDC<br/>Encrypted ledgers will sync on next interaction
```

---

## 8. Account Relationships

```mermaid
graph TB
    subgraph "Per User"
        USER[User Wallet]
        LEDGER[UserPrivateLedger<br/>PDA: user_ledger/user<br/>MXE Encrypted:<br/>- base_total<br/>- base_available<br/>- quote_total<br/>- quote_available]
        ATA_BASE[Base Token ATA]
        ATA_QUOTE[Quote Token ATA]
    end
    
    subgraph "Per Order"
        ORDER[OrderAccount<br/>PDA: order/order_id<br/>Shared Encrypted:<br/>- OrderStatus<br/>- amount, price, status<br/>- locked_amount, filled]
    end
    
    subgraph "Global State"
        OB[OrderBookState<br/>PDA: order_book_state <br/> MXE Encrypted:<br/>- buy_orders-5 <br/>- sell_orders-5<br/>- counts]
        BASE_VAULT[Base Token Vault<br/>PDA: vault/base_mint]
        QUOTE_VAULT[Quote Token Vault<br/>PDA: vault/quote_mint]
    end
    
    subgraph "Settlement Records"
        MATCH[MatchRecord<br/>PDA: match_record/match_id<br/>- is_settled<br/>- timestamp]
    end
    
    USER -->|owns| LEDGER
    USER -->|submits| ORDER
    USER -->|deposits from| ATA_BASE
    USER -->|deposits from| ATA_QUOTE
    LEDGER -.->|balance tracked| BASE_VAULT
    LEDGER -.->|balance tracked| QUOTE_VAULT
    ORDER -->|added to| OB
    OB -->|matched orders| MATCH
    MATCH -->|settles| BASE_VAULT
    MATCH -->|settles| QUOTE_VAULT
    
    style LEDGER fill:#ff9999
    style OB fill:#99ff99
    style ORDER fill:#ffff99
```

**PDA Seeds:**
- UserPrivateLedger: `[b"user_ledger", user.pubkey]`
- OrderAccount: `[b"order", order_id.to_le_bytes()]`
- OrderBookState: `[b"order_book_state"]`
- Vault: `[b"vault", mint.pubkey]`
- MatchRecord: `[b"match_record", match_id.to_le_bytes()]`

---

## 9. Data Privacy Levels

```mermaid
graph LR
    subgraph "Public On-Chain"
        PUB1[Order IDs]
        PUB2[User Pubkeys]
        PUB3[Timestamps]
        PUB4[Success flags]
    end
    
    subgraph "Shared Encrypted (User + MXE)"
        SHARED1[Order amount & price]
        SHARED2[Order status]
        SHARED3[Filled amounts]
    end
    
    subgraph "Backend Encrypted (Backend + MXE)"
        BACKEND1[Match results]
        BACKEND2[Buyer/Seller pairs]
        BACKEND3[Execution prices]
    end
    
    subgraph "MXE Only Encrypted"
        MXE1[User balances]
        MXE2[Full orderbook]
        MXE3[All order details]
    end
    
    style MXE1 fill:#ff9999
    style SHARED1 fill:#ffff99
    style BACKEND1 fill:#99ffff
    style PUB1 fill:#cccccc
```

**Privacy Guarantees:**
1. **MXE Encrypted (highest privacy):**
   - User balances (base_total, base_available, quote_total, quote_available)
   - Full orderbook with all pending orders
   - Only MPC nodes can compute on this data

2. **Shared Encrypted (user can decrypt):**
   - Individual order status (amount, price, filled_amount)
   - User can see their own order details
   - User's x25519 key required for decryption

3. **Backend Encrypted (backend can decrypt):**
   - Match results for settlement
   - Backend x25519 key required for decryption
   - Enables automated settlement

4. **Public:**
   - Order IDs, user pubkeys, timestamps
   - Success/failure flags
   - Match counts

---

## Summary: Key Design Decisions

1. ✅ **UserPrivateLedger is MXE-encrypted** (not backend-encrypted)
   - Only MPC can read/validate balances
   - Backend settles at SPL vault level, not ledger level

2. ✅ **No MatchResult PDAs** - events are sufficient
   - Backend listens to `MatchesFoundEvent`
   - Decrypts match results
   - Executes settlement atomically

3. ✅ **Fixed-size arrays** - `[MatchResult; 3]` not `Vec<MatchResult>`
   - Arcium doesn't support Vec
   - Max 3 matches per batch is reasonable

4. ✅ **OrderAccount seeds = [b"order", order_id]** - no user key needed
   - User pubkey stored in account data
   - Simpler PDA derivation

5. ✅ **Balance validation in MPC** - orders checked against encrypted ledger
   - Prevents overdraft
   - Privacy-preserving

6. ❌ **Current Issue: Passing `Enc<Shared, Struct>` with multiple fields**
   - Solution: Store encrypted data on-chain first (in OrderAccount)
   - Pass by reference using `Argument::Account` (like blackjack example)
   - OR: Change circuit to accept two separate `Enc<Shared, u64>` parameters

---
