import express from 'express';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import nacl from 'tweetnacl';
import fs from 'fs';
import path from 'path';

const app = express();
app.use(express.raw({ type: '*/*', limit: '10mb' })); // Accept raw bytes

interface CallbackPayload {
  mempoolId: number;
  compDefOffset: number;
  txSig: Buffer;
  dataSig: Buffer;
  pubKey: Buffer;
  data: Buffer;
}

function parseCallbackPayload(rawBytes: Buffer): CallbackPayload {
  let offset = 0;
  
  // mempool_id: u16 (2 bytes)
  const mempoolId = rawBytes.readUInt16LE(offset);
  offset += 2;
  
  // comp_def_offset: u32 (4 bytes)
  const compDefOffset = rawBytes.readUInt32LE(offset);
  offset += 4;
  
  // tx_sig: [u8; 64] (64 bytes)
  const txSig = rawBytes.slice(offset, offset + 64);
  offset += 64;
  
  // data_sig: [u8; 64] (64 bytes)
  const dataSig = rawBytes.slice(offset, offset + 64);
  offset += 64;
  
  // pub_key: [u8; 32] (32 bytes)
  const pubKey = rawBytes.slice(offset, offset + 32);
  offset += 32;
  
  // data: Vec<u8> (remaining bytes)
  const data = rawBytes.slice(offset);
  
  return {
    mempoolId,
    compDefOffset,
    txSig,
    dataSig,
    pubKey,
    data,
  };
}

function verifySignature(
  data: Buffer,
  signature: Buffer,
  publicKey: Buffer
): boolean {
  try {
    return nacl.sign.detached.verify(data, signature, publicKey);
  } catch (error) {
    console.error('Signature verification failed:', error);
    return false;
  }
}

function parseOrderbookData(data: Buffer): number[][] {
  // Parse encrypted orderbook data
  // Format: [[u8; 32]; 32] = 32 ciphertext chunks
  const chunks: number[][] = [];
  for (let i = 0; i < 32; i++) {
    const chunk = Array.from(data.slice(i * 32, (i + 1) * 32));
    chunks.push(chunk);
  }
  
  return chunks;
}

async function submitFinalization(
  orderbookChunks: number[][]
): Promise<void> {
  console.log('📤 Submitting finalization transaction...');
  
  try {
    // Load configuration
    const connection = new Connection(
      process.env.RPC_URL || 'http://127.0.0.1:8899',
      'confirmed'
    );
    
    // Load callback server wallet (this should be the callback_authority)
    const keypairPath = process.env.KEYPAIR_PATH || path.join(process.env.HOME!, '.config/solana/id.json');
    const secretKey = Uint8Array.from(JSON.parse(fs.readFileSync(keypairPath, 'utf-8')));
    const wallet = Keypair.fromSecretKey(secretKey);
    
    console.log('🔑 Callback authority:', wallet.publicKey.toBase58());
    
    // Load program
    const provider = new anchor.AnchorProvider(
      connection,
      new anchor.Wallet(wallet),
      { commitment: 'confirmed' }
    );
    anchor.setProvider(provider);
    
    const programId = new PublicKey(process.env.PROGRAM_ID || 'DQ5MR2aPD9sPBN9ukVkhwrAn8ADxpkAE5AHUnXxKEvn1');
    const idl = JSON.parse(
      fs.readFileSync(
        path.join(__dirname, '../target/idl/matching_engine.json'),
        'utf-8'
      )
    );
    const program = new anchor.Program(idl, programId, provider);
    
    // Derive orderbook PDA
    const [orderbookPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from('order_book_state')],
      programId
    );
    
    console.log('📍 Orderbook PDA:', orderbookPDA.toBase58());
    
    // Call finalize_submit_order
    const tx = await program.methods
      .finalizeSubmitOrder(orderbookChunks)
      .accounts({
        orderbookState: orderbookPDA,
        callbackAuthority: wallet.publicKey,
      })
      .rpc();
    
    console.log('✅ Finalization tx:', tx);
    console.log('🎉 Orderbook successfully finalized on-chain!');
    
  } catch (error) {
    console.error('❌ Error submitting finalization:', error);
    throw error;
  }
}

app.post('/callback', async (req, res) => {
  console.log('\n========================================');
  console.log('📥 Received callback from MPC node');
  console.log('========================================');
  console.log('Time:', new Date().toISOString());
  console.log('Content-Type:', req.headers['content-type']);
  console.log('Content-Length:', req.headers['content-length']);
  
  try {
    const rawBytes = req.body as Buffer;
    
    if (!Buffer.isBuffer(rawBytes)) {
      console.error('❌ Request body is not a Buffer');
      return res.status(400).json({ error: 'Invalid request body' });
    }
    
    console.log('📦 Total bytes received:', rawBytes.length);
    
    const payload = parseCallbackPayload(rawBytes);
    
    console.log('\n📦 Parsed payload:');
    console.log('  Mempool ID:', payload.mempoolId);
    console.log('  Comp Def Offset:', payload.compDefOffset);
    console.log('  TX Sig:', payload.txSig.toString('hex').slice(0, 20) + '...');
    console.log('  Data Sig:', payload.dataSig.toString('hex').slice(0, 20) + '...');
    console.log('  MPC Node PubKey:', payload.pubKey.toString('hex'));
    console.log('  Data Length:', payload.data.length, 'bytes');
    console.log('  Expected: 32 chunks × 32 bytes = 1024 bytes');
    
    // 1. Verify the signature
    console.log('\n🔐 Verifying MPC node signature...');
    const isValid = verifySignature(
      payload.data,
      payload.dataSig,
      payload.pubKey
    );
    
    if (!isValid) {
      console.error('❌ INVALID SIGNATURE from MPC node!');
      console.error('This data may be tampered with. Rejecting.');
      return res.status(401).json({ error: 'Invalid signature' });
    }
    
    console.log('✅ Signature verified - data is authentic');
    
    // 2. Parse the orderbook data
    console.log('\n📊 Parsing orderbook data...');
    const orderbookChunks = parseOrderbookData(payload.data);
    console.log(`✅ Parsed ${orderbookChunks.length} ciphertext chunks`);
    
    // Log first chunk as sample
    console.log('  Sample chunk [0]:', orderbookChunks[0].slice(0, 8).join(',') + '...');
    
    // 3. Submit finalization transaction
    console.log('\n📤 Submitting finalization to Solana...');
    await submitFinalization(orderbookChunks);
    
    console.log('\n========================================');
    console.log('✅ Callback processed successfully');
    console.log('========================================\n');
    
    res.status(200).json({ 
      success: true,
      message: 'Orderbook finalized on-chain',
      chunks: orderbookChunks.length,
    });
    
  } catch (error: any) {
    console.error('\n========================================');
    console.error('❌ Error processing callback');
    console.error('========================================');
    console.error(error);
    res.status(500).json({ 
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    service: 'Arcium Callback Server',
    timestamp: new Date().toISOString(),
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('\n========================================');
  console.log('🚀 Callback Server Started');
  console.log('========================================');
  console.log('📍 Listening on port:', PORT);
  console.log('📍 Callback endpoint: http://localhost:' + PORT + '/callback');
  console.log('📍 Health check: http://localhost:' + PORT + '/health');
  console.log('🔑 Using keypair:', process.env.KEYPAIR_PATH || '~/.config/solana/id.json');
  console.log('🌐 RPC URL:', process.env.RPC_URL || 'http://127.0.0.1:8899');
  console.log('========================================\n');
  console.log('Waiting for MPC callbacks...\n');
});
