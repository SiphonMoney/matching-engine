# Complete Callback Server Implementation - Setup Guide

## What We've Implemented

You now have a complete callback server pattern that handles large `OrderBook` encrypted data (1,024 bytes) that's too big for normal Solana callbacks.

### Changes Made

#### 1. **Updated `OrderBookState`** (`programs/matching_engine/src/states/order_book_state.rs`)
- Added `pending_finalization: bool` - Tracks if waiting for callback server
- Added `pending_orderbook_hash: [u8; 32]` - Hash of expected data
- Added `callback_authority: Pubkey` - Who can call finalize (your backend wallet)

#### 2. **Modified `submit_order_callback`** (`programs/matching_engine/src/lib.rs`)
- Now stores HASH of orderbook instead of full data
- Marks `pending_finalization = true`
- User ledger and order account still updated (they fit in callback)

#### 3. **Added `finalize_submit_order` instruction** (`programs/matching_engine/src/lib.rs`)
- Called by callback server with full orderbook data
- Verifies hash matches
- Stores the full data on-chain
- Only `callback_authority` can call this

#### 4. **Created Callback Server** (`callback-server/index.ts`)
- Express HTTP server
- Receives large data from MPC nodes
- Verifies MPC signature
- Calls `finalize_submit_order` on-chain

#### 5. **Updated `initialize` instruction**
- Now accepts `callback_authority` parameter
- This wallet will run the callback server

---

## Step-by-Step Setup

### Phase 1: Program Setup

#### 1. Update Your Test's Initialize Call

```typescript
// tests/matching_engine.ts

// Generate or load callback authority keypair
const callbackAuthority = Keypair.generate(); // or Keypair.fromSecretKey(...)

await program.methods
  .initialize(
    Array.from(backendKeypair.publicKey.toBytes()),
    baseMint.publicKey,
    quoteMint.publicKey,
    callbackAuthority.publicKey // ← NEW parameter
  )
  .accounts({
    authority: authority.publicKey,
    orderbookState: orderbookPDA,
    // ... rest of accounts
  })
  .rpc();
```

#### 2. Rebuild Your Program

```bash
anchor build
arcium build
```

### Phase 2: Callback Server Setup

#### 1. Install Dependencies

```bash
cd callback-server
npm install
```

#### 2. Create `.env` File

```bash
# callback-server/.env
RPC_URL=http://127.0.0.1:8899
KEYPAIR_PATH=/Users/yourname/.config/solana/callback-authority.json
PROGRAM_ID=DQ5MR2aPD9sPBN9ukVkhwrAn8ADxpkAE5AHUnXxKEvn1
PORT=3000
```

#### 3. Generate Callback Authority Keypair

```bash
solana-keygen new -o ~/.config/solana/callback-authority.json
```

Save this keypair - you'll need its public key when calling `initialize()`.

#### 4. Fund the Callback Authority

```bash
# For localnet
solana airdrop 10 ~/.config/solana/callback-authority.json --url localhost

# For devnet
solana airdrop 2 ~/.config/solana/callback-authority.json --url devnet
```

### Phase 3: Expose Server Publicly

Since Arcium MPC nodes need to reach your server:

#### For Local Testing: Use ngrok

```bash
# Install ngrok
brew install ngrok

# Or download from https://ngrok.com/download

# Start your callback server
cd callback-server
npm start

# In another terminal, expose it
ngrok http 3000
```

Copy the ngrok URL (e.g., `https://abc123.ngrok.io/callback`)

#### For Production: Deploy to Cloud

Options:
- **Heroku**: `git push heroku main`
- **Railway**: Connect GitHub repo
- **AWS EC2**: Run on a VPS with Elastic IP
- **Google Cloud Run**: Deploy as container

---

## Phase 4: Register Callback URL with Arcium

**IMPORTANT:** You need to tell Arcium where to send large outputs.

### Method 1: During Comp Def Initialization

Check the Arcium SDK for the exact method. It might look something like:

```typescript
await program.methods
  .initSubmitOrderCompDef()
  .accounts({
    // ... accounts
  })
  .preInstructions([
    // Register callback URL (check Arcium docs for exact API)
    await arciumProgram.methods
      .registerCallbackUrl(
        compDefPDA,
        "https://abc123.ngrok.io/callback" // Your server URL
      )
      .accounts({...})
      .instruction()
  ])
  .rpc();
```

### Method 2: Arcium Config File

Check if `Arcium.toml` supports callback URLs:

```toml
# Arcium.toml
[computation_definitions.submit_order]
callback_url = "https://abc123.ngrok.io/callback"
```

**TODO:** Check the Arcium documentation for the exact method to register callback servers.

---

## Phase 5: Testing

### Terminal 1: Start Solana Localnet

```bash
solana-test-validator
```

### Terminal 2: Start Arcium Localnet

```bash
arcium start
```

### Terminal 3: Start Callback Server

```bash
cd callback-server
npm run dev
```

You should see:
```
========================================
🚀 Callback Server Started
========================================
📍 Listening on port: 3000
📍 Callback endpoint: http://localhost:3000/callback
...
Waiting for MPC callbacks...
```

### Terminal 4: Expose with ngrok

```bash
ngrok http 3000
```

Copy the HTTPS URL (e.g., `https://abc123.ngrok.io`)

### Terminal 5: Run Tests

```bash
arcium test
```

---

## What to Expect

### Flow 1: Normal Callback (Small Data)

For `init_user_ledger`, `update_ledger_deposit` - these still work normally:

```
User → MPC Computation → Direct Callback → Program Updates State ✅
```

### Flow 2: Callback Server (Large Data)

For `submit_order` (returns large OrderBook):

```
User → submitOrder()
  ↓
MPC Computation completes
  ↓
┌─────────────┴─────────────┐
│ Split Output:              │
│ - hash(orderbook) on-chain │
│ - full orderbook to server │
└─────────────┬─────────────┘
              ↓
    ┌─────────┴──────────┐
    ↓                    ↓
On-chain callback    HTTP to /callback
stores hash          (full data)
    ↓                    ↓
    │                Verify signature
    │                    ↓
    │            Call finalize_submit_order()
    │                    ↓
    └────────→ Verify hash matches
                    ↓
                ✅ Success!
```

### Logs You'll See

**Callback Server Terminal:**
```
📥 Received callback from MPC node
📦 Parsed payload:
  Data Length: 1024 bytes
🔐 Verifying MPC node signature...
✅ Signature verified
📊 Parsing orderbook data...
✅ Parsed 32 ciphertext chunks
📤 Submitting finalization to Solana...
✅ Finalization tx: 5jd8f7s...
🎉 Orderbook successfully finalized on-chain!
✅ Callback processed successfully
```

**Solana Logs:**
```
Program log: Submit order callback - processing result
Program log: Orderbook hash stored: [32, 156, 78, ...]
Program log: Awaiting finalization from callback server
Program log: Order submitted, pending orderbook finalization

... (later when callback server calls finalize) ...

Program log: Hash verified! Storing orderbook data
Program log: Orderbook finalized successfully
```

---

## Troubleshooting

### Issue: Test stalls at submit_order

**Cause:** Callback server not running or not reachable

**Fix:**
1. Check callback server is running: `curl http://localhost:3000/health`
2. Check ngrok is running: `curl https://YOUR_NGROK_URL/health`
3. Verify callback URL was registered with Arcium

### Issue: "Invalid signature" in callback server

**Cause:** Data tampered or wrong MPC node key

**Fix:**
- This is a security feature - don't modify it!
- If persistent, check if you're using the correct MPC cluster

### Issue: "Hash mismatch" on-chain

**Cause:** Data modified between callback and finalization

**Fix:**
- Check network stability
- Ensure no modifications to data in callback server
- Verify you're submitting exactly what you received

### Issue: "Unauthorized callback finalizer"

**Cause:** Wrong wallet calling `finalize_submit_order`

**Fix:**
- Must use the wallet specified as `callback_authority` in `initialize()`
- Check `KEYPAIR_PATH` in `.env` points to correct file
- Verify public key matches: `solana address -k ~/.config/solana/callback-authority.json`

---

## Production Deployment

### 1. Deploy Callback Server to Cloud

```bash
# Example: Railway.app
railway login
railway init
railway up
```

Get the public URL (e.g., `https://your-app.railway.app`)

### 2. Update Arcium Config

Register your production callback URL with Arcium.

### 3. Set Environment Variables

In your cloud platform:
```
RPC_URL=https://api.mainnet-beta.solana.com
KEYPAIR_PATH=/app/callback-authority.json
PROGRAM_ID=YOUR_PROGRAM_ID
PORT=3000
```

### 4. Enable HTTPS

Most cloud platforms (Railway, Heroku) provide HTTPS automatically.

For custom servers, use Let's Encrypt:
```bash
certbot --nginx -d your-domain.com
```

### 5. Set Up Monitoring

- **Logs:** CloudWatch, Datadog, or Papertrail
- **Metrics:** Track callback success rate, latency
- **Alerts:** Get notified of failures

---

## Alternative: Avoid Callback Server

If callback server complexity is too much, consider:

### Option A: Reduce OrderBook Size

Change from 32 chunks to 16 chunks (512 bytes):

```rust
// encrypted-ixs/src/lib.rs
pub const MAX_ORDERS: usize = 2; // Instead of 4

// programs/.../order_book_state.rs
pub orderbook_data: [[u8; 32]; 16], // Instead of 32
```

This might fit in normal callbacks!

### Option B: Off-Chain Orderbook

Move to off-chain orderbook (like real DEXs):
- Orderbook lives in backend
- MPC only validates balances
- Emit order events
- Backend matches off-chain
- Settlement on-chain

This is simpler and more scalable!

---

## Summary

You now have:
1. ✅ Program that stores hash in callback
2. ✅ Finalize instruction that verifies and stores full data
3. ✅ HTTP server that bridges MPC → Solana
4. ✅ Signature verification for security
5. ✅ Hash verification for integrity

**Next Steps:**
1. Start the callback server
2. Expose it with ngrok
3. Register callback URL with Arcium
4. Run your tests
5. Watch the magic happen! 🎉

Need help with any step? Check the logs and error messages - they're very detailed!
