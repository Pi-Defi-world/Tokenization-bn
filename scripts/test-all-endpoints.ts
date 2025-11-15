import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import axios from 'axios';

dotenv.config();

const userId = '6917551b11d9514682ccf741';
const username = 'junman140';
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
const baseUrl = 'http://localhost:8000';

// Test credentials
const distributorSecret = 'SCB2NN44YEITKM2TEXCTPP3LB33DXFI3M7PKCVJU24UFELY6TTFGOD44';
const publicKey = 'GCAO7I2ZBIEFXNYD3KZFA3UXLMDVCYUG6CTCYG56746LZB5MIUFIIBJ5';
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

interface TestResult {
  name: string;
  success: boolean;
  status?: number;
  message?: string;
  data?: any;
}

const results: TestResult[] = [];

async function testEndpoint(
  name: string,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  endpoint: string,
  data?: any,
  skipAuth = false
) {
  try {
    console.log(`\n🧪 Testing: ${name}`);
    console.log(`   ${method} ${endpoint}`);
    
    const config: any = {
      method,
      url: `${baseUrl}${endpoint}`,
      headers: skipAuth ? { 'Content-Type': 'application/json' } : headers,
      timeout: 60000
    };
    
    if (data) {
      if (method === 'GET') {
        config.params = data;
      } else {
        config.data = data;
      }
    }
    
    const response = await axios(config);
    
    results.push({
      name,
      success: true,
      status: response.status,
      data: response.data
    });
    
    console.log(`   ✅ Success (${response.status})`);
    if (response.data && typeof response.data === 'object') {
      const keys = Object.keys(response.data);
      if (keys.length > 0) {
        console.log(`   Response keys: ${keys.join(', ')}`);
      }
    }
  } catch (error: any) {
    const status = error.response?.status || 'N/A';
    let message = error.response?.data?.message || error.message;
    
    if (error.code === 'ECONNREFUSED') {
      message = 'Connection refused - Is the backend running?';
    } else if (error.code === 'ETIMEDOUT') {
      message = 'Request timeout';
    } else if (error.response?.data) {
      if (typeof error.response.data === 'object') {
        message = JSON.stringify(error.response.data).substring(0, 200);
      } else {
        message = String(error.response.data).substring(0, 200);
      }
    }
    
    results.push({
      name,
      success: false,
      status: error.response?.status,
      message
    });
    
    console.log(`   ❌ Failed (${status}): ${message}`);
  }
}

async function runTests() {
  console.log('🚀 Starting comprehensive endpoint tests...\n');
  console.log(`Base URL: ${baseUrl}`);
  console.log(`Token: ${token.substring(0, 20)}...\n`);
  
  // ========== ACCOUNT ENDPOINTS ==========
  console.log('\n📋 ACCOUNT ENDPOINTS');
  console.log('='.repeat(60));
  
  await testEndpoint(
    'GET /v1/account/balance',
    'GET',
    `/v1/account/balance/${publicKey}`
  );
  
  await testEndpoint(
    'GET /v1/account/operations',
    'GET',
    `/v1/account/operations/${publicKey}`,
    { limit: 5 }
  );
  
  // ========== TOKEN ENDPOINTS ==========
  console.log('\n📋 TOKEN ENDPOINTS');
  console.log('='.repeat(60));
  
  await testEndpoint('GET /v1/tokens', 'GET', '/v1/tokens');
  
  // Test mint (we know this works)
  const uniqueAssetCode = 'TEST' + Date.now().toString().slice(-6);
  await testEndpoint(
    'POST /v1/tokens/mint',
    'POST',
    '/v1/tokens/mint',
    {
      distributorSecret,
      assetCode: uniqueAssetCode,
      totalSupply: 100000,
      name: 'Test Token',
      description: 'A test token',
      homeDomain: 'www.zyrapay.net'
    }
  );
  
  // Test trustline
  await testEndpoint(
    'POST /v1/tokens/trustline',
    'POST',
    '/v1/tokens/trustline',
    {
      userSecret: distributorSecret,
      assetCode: uniqueAssetCode,
      issuer: issuerPublicKey
    }
  );
  
  // ========== FEES ENDPOINTS ==========
  console.log('\n📋 FEES ENDPOINTS');
  console.log('='.repeat(60));
  
  await testEndpoint('GET /v1/fees', 'GET', '/v1/fees');
  
  // Test create fee
  const feeKey = 'test.fee.' + Date.now();
  await testEndpoint(
    'POST /v1/fees',
    'POST',
    '/v1/fees',
    {
      key: feeKey,
      name: 'Test Fee',
      value: 0.01,
      currency: 'PI', // Fixed: use 'PI' instead of 'ZYRA'
      isActive: true
    }
  );
  
  // Test update fee
  await testEndpoint(
    'PUT /v1/fees',
    'PUT',
    `/v1/fees/${feeKey}`,
    {
      value: 0.02,
      name: 'Updated Test Fee'
    }
  );
  
  // ========== LIQUIDITY POOL ENDPOINTS ==========
  console.log('\n📋 LIQUIDITY POOL ENDPOINTS');
  console.log('='.repeat(60));
  
  await testEndpoint('GET /v1/liquidity-pools', 'GET', '/v1/liquidity-pools', { limit: 5 });
  
  await testEndpoint(
    'GET /v1/liquidity-pools/user-pools',
    'GET',
    '/v1/liquidity-pools/user-pools',
    { userPublicKey: publicKey }
  );
  
  await testEndpoint(
    'GET /v1/liquidity-pools/rewards',
    'GET',
    '/v1/liquidity-pools/rewards',
    {
      userPublicKey: publicKey,
      poolId: 'test-pool-id' // This will fail but tests the endpoint
    }
  );
  
  // ========== SWAP ENDPOINTS ==========
  console.log('\n📋 SWAP ENDPOINTS');
  console.log('='.repeat(60));
  
  await testEndpoint(
    'GET /v1/swap/pools-for-pair',
    'GET',
    '/v1/swap/pools-for-pair',
    { tokenA: 'native', tokenB: 'TEST' }
  );
  
  await testEndpoint(
    'GET /v1/swap/quote',
    'GET',
    '/v1/swap/quote',
    {
      poolId: 'test-pool-id',
      from: 'native',
      to: 'TEST',
      amount: '100',
      slippagePercent: 1
    }
  );
  
  // ========== MARKET/ORDERBOOK ENDPOINTS ==========
  console.log('\n📋 MARKET/ORDERBOOK ENDPOINTS');
  console.log('='.repeat(60));
  
  await testEndpoint(
    'GET /v1/market/orderbook',
    'GET',
    '/v1/market/orderbook',
    {
      base: 'native',
      counter: `TEST:${issuerPublicKey}`
    }
  );
  
  await testEndpoint(
    'GET /v1/market/offers',
    'GET',
    `/v1/market/offers/${publicKey}`
  );
  
  // ========== PAIRS ENDPOINTS ==========
  console.log('\n📋 PAIRS ENDPOINTS');
  console.log('='.repeat(60));
  
  await testEndpoint('GET /v1/pairs', 'GET', '/v1/pairs');
  
  // ========== Print Summary ==========
  console.log('\n' + '='.repeat(60));
  console.log('📊 Test Summary');
  console.log('='.repeat(60));
  
  const passed = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  
  console.log(`\n✅ Passed: ${passed}/${results.length}`);
  console.log(`❌ Failed: ${failed}/${results.length}\n`);
  
  // Group by category
  const categories: { [key: string]: TestResult[] } = {};
  results.forEach(result => {
    const category = result.name.split(' ')[1].split('/')[1] || 'Other';
    if (!categories[category]) categories[category] = [];
    categories[category].push(result);
  });
  
  Object.keys(categories).forEach(category => {
    console.log(`\n${category.toUpperCase()}:`);
    categories[category].forEach(result => {
      const icon = result.success ? '✅' : '❌';
      const status = result.status ? ` (${result.status})` : '';
      console.log(`  ${icon} ${result.name}${status}`);
      if (!result.success && result.message) {
        console.log(`     ${result.message.substring(0, 100)}`);
      }
    });
  });
  
  console.log('\n' + '='.repeat(60));
}

runTests().catch(console.error);

