import StellarSdk from '@stellar/stellar-sdk';
import * as bip39 from 'bip39';
import { derivePath } from 'ed25519-hd-key';
import dotenv from 'dotenv';

dotenv.config();

// Normalized mnemonic (lowercase)
const mnemonic = 'beach over legal boil surface knee approve another mandate feature timber pepper furnace save fatigue axis suffer panda extend virtual obscure oak damp pulp';

// Expected public key to verify
const expectedPublicKey = 'GCAO7I2ZBIEFXNYD3KZFA3UXLMDVCYUG6CTCYG56746LZB5MIUFIIBJ5';

// BIP44 path for Pi Network (from env or default)
const BIP44_PATH = process.env.BIP44_PATH || "m/44'/314159'/0'";

async function generateSecret() {
  try {
    console.log('🔑 Generating secret key from mnemonic...\n');
    console.log('Mnemonic:', mnemonic);
    console.log('BIP44 Path:', BIP44_PATH);
    console.log('Expected Public Key:', expectedPublicKey);
    console.log('\n');

    // Convert mnemonic to seed
    const seed = await bip39.mnemonicToSeed(mnemonic);
    
    // Derive key from path
    // @ts-ignore - ed25519-hd-key types might not match exactly
    const { key } = derivePath(BIP44_PATH, seed as Buffer);
    
    // Create Stellar keypair from derived key
    const keypair = StellarSdk.Keypair.fromRawEd25519Seed(key);
    
    const publicKey = keypair.publicKey();
    const secretKey = keypair.secret();
    
    console.log('✅ Keypair generated successfully!\n');
    console.log('Public Key:', publicKey);
    console.log('Secret Key:', secretKey);
    console.log('\n');
    
    // Verify it matches expected public key
    if (publicKey === expectedPublicKey) {
      console.log('✅ Public key matches expected value!');
    } else {
      console.log('⚠️  WARNING: Public key does NOT match expected value!');
      console.log('   Expected:', expectedPublicKey);
      console.log('   Got:     ', publicKey);
    }
    
    return { publicKey, secretKey };
  } catch (error: any) {
    console.error('❌ Error generating secret:', error.message);
    throw error;
  }
}

generateSecret()
  .then(() => {
    console.log('\n✅ Done!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Failed:', error);
    process.exit(1);
  });

