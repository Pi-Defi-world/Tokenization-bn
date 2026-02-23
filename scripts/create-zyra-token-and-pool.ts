import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import axios from 'axios';

dotenv.config();

const userId = '6917551b11d9514682ccf741';
const username = 'junman140';
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
const baseUrl = 'http://localhost:8000';

// Account credentials
const distributorSecret = 'SCB2NN44YEITKM2TEXCTPP3LB33DXFI3M7PKCVJU24UFELY6TTFGOD44';
const distributorPublicKey = 'GCAO7I2ZBIEFXNYD3KZFA3UXLMDVCYUG6CTCYG56746LZB5MIUFIIBJ5';
const issuerPublicKey = 'GAFSXUDWT2P5AOEFD6TGIQSHZ6FEWHNWCS554MZVVUUM3YGI7DB73YWN';

// Generate JWT token
const token = jwt.sign(
  { id: userId, username },
  JWT_SECRET,
  { expiresIn: '30d' }
);

const headers = {
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${token}`
};

async function createZyraToken() {
  console.log('\n🪙 Step 1: Creating ZYRA token...');
  console.log('='.repeat(60));
  
  try {
    const response = await axios.post(
      `${baseUrl}/v1/tokens/mint`,
      {
        distributorSecret,
        assetCode: 'ZYRA',
        totalSupply: 1000000, // 1 million ZYRA tokens
        name: 'ZyraPay Token',
        description: 'ZyraPay platform token for fees and governance',
        homeDomain: 'www.zyrapay.net'
      },
      { headers, timeout: 120000 }
    );

    console.log('✅ ZYRA token minted successfully!');
    console.log(`   Token ID: ${response.data._id}`);
    console.log(`   Asset Code: ${response.data.assetCode}`);
    console.log(`   Issuer: ${response.data.issuer}`);
    console.log(`   Distributor: ${response.data.distributor}`);
    console.log(`   Total Supply: ${response.data.totalSupply}`);
    
    return {
      assetCode: response.data.assetCode,
      issuer: response.data.issuer,
      distributor: response.data.distributor
    };
  } catch (error: any) {
    console.error('❌ Failed to mint ZYRA token:');
    if (error.response?.data) {
      console.error(JSON.stringify(error.response.data, null, 2));
    } else {
      console.error(error.message);
    }
    throw error;
  }
}

async function createLiquidityPool(zyraIssuer: string) {
  console.log('\n💧 Step 2: Creating liquidity pool (native/ZYRA)...');
  console.log('='.repeat(60));
  
  try {
    // Create pool with 1000 native (Test-Pi) and 10000 ZYRA
    // This gives an initial price of 0.1 Test-Pi per ZYRA
    const response = await axios.post(
      `${baseUrl}/v1/liquidity-pools`,
      {
        userSecret: distributorSecret,
        tokenA: {
          code: 'native',
          issuer: ''
        },
        tokenB: {
          code: 'ZYRA',
          issuer: zyraIssuer
        },
        amountA: '1000', // 1000 Test-Pi
        amountB: '10000' // 10000 ZYRA
      },
      { headers, timeout: 120000 }
    );

    console.log('✅ Liquidity pool created successfully!');
    console.log(`   Pool ID: ${response.data.poolId}`);
    console.log(`   Transaction Hash: ${response.data.liquidityTxHash}`);
    console.log(`   Initial Reserves:`);
    console.log(`     - Native (Test-Pi): 1000`);
    console.log(`     - ZYRA: 10000`);
    console.log(`   Initial Price: 0.1 Test-Pi per ZYRA`);
    
    return response.data.poolId;
  } catch (error: any) {
    console.error('❌ Failed to create liquidity pool:');
    if (error.response?.data) {
      console.error(JSON.stringify(error.response.data, null, 2));
    } else {
      console.error(error.message);
    }
    throw error;
  }
}

async function main() {
  console.log('🚀 Starting ZYRA Token Creation and Pool Setup');
  console.log('='.repeat(60));
  console.log(`Base URL: ${baseUrl}`);
  console.log(`Distributor: ${distributorPublicKey}`);
  console.log(`Issuer: ${issuerPublicKey}`);
  
  try {
    // Step 1: Create ZYRA token
    const tokenInfo = await createZyraToken();
    
    // Wait a bit for the token to be fully processed
    console.log('\n⏳ Waiting 3 seconds for token to be processed...');
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Step 2: Create liquidity pool
    const poolId = await createLiquidityPool(tokenInfo.issuer);
    
    console.log('\n' + '='.repeat(60));
    console.log('✅ SUCCESS! ZYRA Token and Pool Setup Complete');
    console.log('='.repeat(60));
    console.log(`\n📊 Summary:`);
    console.log(`   Token: ZYRA`);
    console.log(`   Issuer: ${tokenInfo.issuer}`);
    console.log(`   Distributor: ${tokenInfo.distributor}`);
    console.log(`   Pool ID: ${poolId}`);
    console.log(`\n🔗 Next Steps:`);
    console.log(`   1. Verify token balance: GET /v1/account/balance/${distributorPublicKey}`);
    console.log(`   2. Check pool: GET /v1/liquidity-pools`);
    console.log(`   3. Update fee configurations to use ZYRA token`);
    console.log('\n');
  } catch (error: any) {
    console.error('\n❌ Process failed:', error.message);
    process.exit(1);
  }
}

main();

