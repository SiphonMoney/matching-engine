# Arcium Callback Server

This server receives large computation outputs from Arcium MPC nodes and submits them on-chain via the `finalize_submit_order` instruction.

## Why is this needed?

The encrypted `OrderBook` structure is too large (32 chunks × 32 bytes = 1,024 bytes) to fit in a single Solana callback transaction (limit ~1KB). When returning `Enc<Mxe, OrderBook>` from circuits:

1. **Normal callback** receives a HASH of the orderbook data
2. **This HTTP server** receives the FULL orderbook data
3. **Server verifies** the MPC signature
4. **Server calls** `finalize_submit_order` with the full data
5. **Program verifies** hash(data) matches the stored hash

## Setup

### 1. Install Dependencies

```bash
cd callback-server
npm install
```

### 2. Set Environment Variables

Create a `.env` file:

```bash
# Solana RPC URL
RPC_URL=http://127.0.0.1:8899

# Path to your wallet (must be the callback_authority)
KEYPAIR_PATH=~/.config/solana/id.json

# Your program ID
PROGRAM_ID=DQ5MR2aPD9sPBN9ukVkhwrAn8ADxpkAE5AHUnXxKEvn1

# Server port
PORT=3000
```

### 3. Generate Callback Authority Keypair (if needed)

```bash
solana-keygen new -o ~/.config/solana/callback-authority.json
```

Then use this pubkey when calling `initialize()`:

```typescript
await program.methods
  .initialize(
    backendPubkey,
    baseMint,
    quoteMint,
    callbackAuthority.publicKey // ← This wallet will run the callback server
  )
  .accounts({...})
  .rpc();
```

## Running the Server

### Local Development

```bash
npm run dev
```

The server will start on `http://localhost:3000`

### Production

```bash
npm start
```

## Exposing the Server to Arcium MPC Nodes

### For Local Testing (using ngrok)

Since Arcium MPC nodes need to reach your server, you must expose it publicly:

```bash
# Install ngrok
brew install ngrok

# Or download from https://ngrok.com

# Expose port 3000
ngrok http 3000
```

Copy the ngrok URL (e.g., `https://abc123.ngrok.io`) and use it when registering your callback URL.

### For Production

Deploy to a cloud service with a public URL:
- **AWS EC2** + Elastic IP
- **Google Cloud Run**
- **Heroku**
- **Digital Ocean Droplet**
- **Railway.app**

## Registering Callback URL with Arcium

When initializing your computation definition, register the callback URL:

```typescript
// During comp def initialization
const callbackUrl = "https://your-server.com/callback"; // or ngrok URL

await program.methods
  .initSubmitOrderCompDef()
  .accounts({...})
  .preInstructions([
    // TODO: Check Arcium SDK for the exact method to register callback server
    // This might be part of init_comp_def parameters
  ])
  .rpc();
```

**Note:** Check the Arcium SDK documentation for the exact API to register a callback server URL with a computation definition.

## How It Works

### Flow Diagram

```
User → submitOrder()
  ↓
MPC Computation completes
  ↓
  ├─→ On-chain callback: stores hash(orderbook_data)
  │
  └─→ HTTP POST /callback: receives full orderbook_data
        ↓
      Verify MPC signature
        ↓
      Call finalize_submit_order()
        ↓
      Program verifies: hash(data) == stored_hash
        ↓
      ✅ Orderbook updated!
```

### Endpoint: POST /callback

**Request Format:**
- Content-Type: `application/octet-stream`
- Body: Raw bytes with structure:
  ```
  mempool_id     | u16         | 2 bytes
  comp_def_offset| u32         | 4 bytes
  tx_sig         | [u8; 64]    | 64 bytes
  data_sig       | [u8; 64]    | 64 bytes
  pub_key        | [u8; 32]    | 32 bytes
  data           | Vec<u8>     | remaining (1024 bytes for orderbook)
  ```

**Response:**
```json
{
  "success": true,
  "message": "Orderbook finalized on-chain",
  "chunks": 32
}
```

### Endpoint: GET /health

Health check endpoint for monitoring.

**Response:**
```json
{
  "status": "healthy",
  "service": "Arcium Callback Server",
  "timestamp": "2024-10-29T12:00:00.000Z"
}
```

## Security

### 1. Signature Verification

The server ALWAYS verifies that `data_sig` is a valid signature from an Arcium MPC node:

```typescript
nacl.sign.detached.verify(data, data_sig, mpc_node_pubkey)
```

### 2. Hash Verification

On-chain, the program verifies:

```rust
require!(
    hash(submitted_data) == stored_hash_from_callback,
    ErrorCode::HashMismatch
);
```

This ensures data integrity from MPC → Server → Solana.

### 3. Authorization

Only the `callback_authority` wallet can call `finalize_submit_order`:

```rust
#[account(constraint = callback_authority.key() == orderbook_state.callback_authority)]
pub callback_authority: Signer<'info>,
```

## Monitoring

### Logs

The server logs all activity:
- Incoming callbacks
- Signature verification results
- Finalization transaction signatures
- Errors

### Metrics to Track

- Number of callbacks received
- Signature verification success rate
- Finalization transaction success rate
- Average processing time

## Troubleshooting

### "Invalid signature" error

- The MPC node's public key is incorrect
- Data was tampered with in transit
- Use HTTPS to prevent MITM attacks

### "Hash mismatch" error

- Data was modified between callback and finalization
- Wrong orderbook data submitted
- Check the MPC computation logs

### "Unauthorized callback finalizer" error

- Wrong wallet is calling `finalize_submit_order`
- Must use the wallet specified as `callback_authority` during `initialize()`

### Callback never arrives

- Server URL not registered with Arcium
- Server is not publicly accessible
- Check ngrok is running
- Check firewall rules

## Testing

### Manual Test

```bash
# Send a test payload
curl -X POST http://localhost:3000/callback \
  -H "Content-Type: application/octet-stream" \
  --data-binary @test-payload.bin
```

### Integration Test

Run the full test suite which will trigger actual callbacks:

```bash
cd ..
arcium test
```

Watch the callback server logs to see it receive and process the orderbook data.

## Production Checklist

- [ ] Deploy server to cloud with static IP/domain
- [ ] Set up HTTPS (use Let's Encrypt)
- [ ] Configure environment variables
- [ ] Set up monitoring (logs, metrics)
- [ ] Implement rate limiting
- [ ] Set up alerting for failures
- [ ] Test with testnet first
- [ ] Register callback URL with Arcium
- [ ] Fund callback authority wallet with SOL for transaction fees
- [ ] Set up auto-restart (systemd, PM2, or Docker)

## References

- [Arcium Callback Server Documentation](https://docs.arcium.com/developers/callback-server)
- [Arcium SDK](https://github.com/Arcium-MPC/sdk)
