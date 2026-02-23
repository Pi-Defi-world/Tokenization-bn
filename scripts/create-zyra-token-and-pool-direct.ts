import dotenv from 'dotenv';
import { tokenService } from '../services/token.service';
import { PoolService } from '../services/liquidity-pools.service';
import { logger } from '../utils/logger';
import * as StellarSdk from '@stellar/stellar-sdk';
import { server } from '../config/stellar';
import env from '../config/env';

dotenv.config();

// Account credentials
const distributorSecret = 'SCB2NN44YEITKM2TEXCTPP3LB33DXFI3M7PKCVJU24UFELY6TTFGOD44';
const distributorPublicKey = 'GCAO7I2ZBIEFXNYD3KZFA3UXLMDVCYUG6CTCYG56746LZB5MIUFIIBJ5';

async function checkZyraToken() {
  console.log('\n🔍 Checking if ZYRATEST token already exists...');
  console.log('='.repeat(60));
  
  try {
    const issuer = StellarSdk.Keypair.fromSecret(env.PLATFORM_ISSUER_SECRET);
    const issuerPublicKey = issuer.publicKey();
    const account = await server.loadAccount(distributorPublicKey);
    
    const zyraBalance = account.balances.find((b: any) => 
      b.asset_code === 'ZYRATEST' && b.asset_issuer === issuerPublicKey
    );
    
    if (zyraBalance) {
      console.log(`✅ ZYRATEST token already exists!`);
      console.log(`   Balance: ${zyraBalance.balance} ZYRATEST`);
      console.log(`   Issuer: ${issuerPublicKey}`);
      return {
        assetCode: 'ZYRATEST',
        issuer: issuerPublicKey,
        distributor: distributorPublicKey,
        exists: true
      };
    }
    
    return { exists: false, issuer: issuerPublicKey };
  } catch (error: any) {
    console.error('❌ Failed to check ZYRATEST token:', error.message);
    return { exists: false, issuer: '' };
  }
}

async function createZyraToken() {
  console.log('\n🪙 Step 1: Creating ZYRATEST token...');
  console.log('='.repeat(60));
  
  try {
    const issuer = StellarSdk.Keypair.fromSecret(env.PLATFORM_ISSUER_SECRET);
    const issuerPublicKey = issuer.publicKey();
    
    console.log(`   Issuer: ${issuerPublicKey}`);
    console.log(`   Distributor: ${distributorPublicKey}`);
    console.log(`   Asset Code: ZYRATEST`);
    console.log(`   Total Supply: 1,000,000,000`);
    
    const token = await tokenService.mintToken({
      distributorSecret,
      assetCode: 'ZYRATEST',
      totalSupply: '1000000000', // 1 billion ZYRATEST tokens
      data: {
        name: 'ZyraDex Test Token',
        description: 'ZyraDex test token for fees and governance',
        totalSupply: 1000000000,
        user: '6917551b11d9514682ccf741' as any, // User ID
      },
      homeDomain: 'www.zyradex.com'
    });

    console.log('✅ ZYRATEST token minted successfully!');
    console.log(`   Token ID: ${token._id}`);
    console.log(`   Asset Code: ${token.assetCode}`);
    console.log(`   Issuer: ${token.issuer}`);
    console.log(`   Distributor: ${token.distributor}`);
    console.log(`   Total Supply: ${token.totalSupply}`);
    
    return {
      assetCode: token.assetCode,
      issuer: token.issuer,
      distributor: token.distributor
    };
  } catch (error: any) {
    console.error('❌ Failed to mint ZYRATEST token:');
    if (error.response?.data) {
      console.error(JSON.stringify(error.response.data, null, 2));
    } else {
      console.error(error.message);
      if (error.stack) console.error(error.stack);
    }
    throw error;
  }
}

async function createLiquidityPool(zyraIssuer: string) {
  console.log('\n💧 Step 2: Creating liquidity pool (native/ZYRATEST)...');
  console.log('='.repeat(60));
  
  try {
    const poolService = new PoolService();
    
    // Create pool with 1000 native (Test-Pi) and 10000 ZYRATEST
    // This gives an initial price of 0.1 Test-Pi per ZYRATEST
    console.log(`   Token A: native (Test-Pi)`);
    console.log(`   Token B: ZYRATEST:${zyraIssuer}`);
    console.log(`   Amount A: 5 Test-Pi`);
    console.log(`   Amount B: 50 ZYRATEST`);
    console.log(`   Initial Price: 0.1 Test-Pi per ZYRATEST`);
    
    const result = await poolService.createLiquidityPool(
      distributorSecret,
      { code: 'native', issuer: '' },
      { code: 'ZYRATEST', issuer: zyraIssuer },
      '5', // 5 Test-Pi (leaving ~7 for fees)
      '50' // 50 ZYRATEST
    );

    console.log('✅ Liquidity pool created successfully!');
    console.log(`   Pool ID: ${result.poolId}`);
    console.log(`   Transaction Hash: ${result.liquidityTxHash}`);
    console.log(`   Initial Reserves:`);
    console.log(`     - Native (Test-Pi): 5`);
    console.log(`     - ZYRATEST: 50`);
    console.log(`   Initial Price: 0.1 Test-Pi per ZYRATEST`);
    
    return result.poolId;
  } catch (error: any) {
    console.error('❌ Failed to create liquidity pool:');
    if (error.response?.data) {
      console.error(JSON.stringify(error.response.data, null, 2));
    } else {
      console.error(error.message);
      if (error.stack) console.error(error.stack);
    }
    throw error;
  }
}

async function checkAccountBalance() {
  console.log('\n💰 Checking distributor account balance...');
  console.log('='.repeat(60));
  
  try {
    const account = await server.loadAccount(distributorPublicKey);
    const nativeBalance = account.balances.find((b: any) => b.asset_type === 'native');
    const zyraBalance = account.balances.find((b: any) => 
      b.asset_code === 'ZYRATEST' && b.asset_issuer
    );
    
    console.log(`   Native (Test-Pi): ${nativeBalance?.balance || '0'}`);
    if (zyraBalance) {
      console.log(`   ZYRATEST: ${zyraBalance.balance}`);
    } else {
      console.log(`   ZYRATEST: 0 (trustline may need to be established)`);
    }
  } catch (error: any) {
    console.error('❌ Failed to check balance:', error.message);
  }
}

async function main() {
  console.log('🚀 Starting ZYRATEST Token Creation and Pool Setup');
  console.log('='.repeat(60));
  console.log(`Distributor: ${distributorPublicKey}`);
  
  try {
    // Check initial balance
    await checkAccountBalance();
    
    // Check if ZYRA token already exists
    const existingToken = await checkZyraToken();
    
    let tokenInfo;
    if (existingToken.exists) {
      console.log('\n⏩ Skipping token creation - ZYRATEST already exists');
      tokenInfo = existingToken;
    } else {
      // Step 1: Create ZYRA token
      tokenInfo = await createZyraToken();
      
      // Wait a bit for the token to be fully processed
      console.log('\n⏳ Waiting 3 seconds for token to be processed...');
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
    
    // Check balance after minting
    await checkAccountBalance();
    
    // Step 2: Create liquidity pool
    const poolId = await createLiquidityPool(tokenInfo.issuer);
    
    // Final balance check
    await checkAccountBalance();
    
    console.log('\n' + '='.repeat(60));
    console.log('✅ SUCCESS! ZYRATEST Token and Pool Setup Complete');
    console.log('='.repeat(60));
    console.log(`\n📊 Summary:`);
    console.log(`   Token: ZYRATEST`);
    console.log(`   Issuer: ${tokenInfo.issuer}`);
    console.log(`   Distributor: ${tokenInfo.distributor}`);
    console.log(`   Pool ID: ${poolId}`);
    console.log(`\n🔗 Next Steps:`);
    console.log(`   1. Update fee configurations to use ZYRATEST token`);
    console.log(`   2. Verify pool is accessible via API`);
    console.log(`   3. Test swapping native for ZYRATEST`);
    console.log('\n');
  } catch (error: any) {
    console.error('\n❌ Process failed:', error.message);
    process.exit(1);
  }
}

main();

