import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import axios from 'axios';

dotenv.config();

const userId = '6917551b11d9514682ccf741';
const username = 'junman140';
const JWT_SECRET = process.env.JWT_SECRET || 'SCB2NN44YEITKM2TEXCTPP3LB33DXFI3M7PKCVJU24UFELY6TTFGOD44';
const baseUrl = 'http://localhost:8000';

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

async function testEndpoint(name: string, method: 'GET' | 'POST', endpoint: string, data?: any) {
  try {
    console.log(`\n🧪 Testing: ${name}`);
    console.log(`   ${method} ${endpoint}`);
    
    const config: any = {
      method,
      url: `${baseUrl}${endpoint}`,
      headers,
      timeout: 30000
    };
    
    if (data && method === 'POST') {
      config.data = data;
    } else if (data && method === 'GET') {
      config.params = data;
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
      console.log(`   Response keys: ${Object.keys(response.data).join(', ')}`);
    }
  } catch (error: any) {
    const status = error.response?.status || 'N/A';
    let message = error.response?.data?.message || error.message;
    
    // More detailed error info
    if (error.code === 'ECONNREFUSED') {
      message = 'Connection refused - Is the backend running on port 8000?';
    } else if (error.code === 'ETIMEDOUT') {
      message = 'Request timeout';
    } else if (error.response?.data) {
      message = JSON.stringify(error.response.data);
    }
    
    results.push({
      name,
      success: false,
      status: error.response?.status,
      message
    });
    
    console.log(`   ❌ Failed (${status}): ${message}`);
    if (error.code) {
      console.log(`   Error code: ${error.code}`);
    }
  }
}

async function runTests() {
  console.log('🚀 Starting endpoint tests...\n');
  console.log(`Base URL: ${baseUrl}`);
  console.log(`Token: ${token.substring(0, 20)}...\n`);
  
  // Test 1: Get all tokens
  await testEndpoint('GET /v1/tokens', 'GET', '/v1/tokens');
  
  // Test 2: Get liquidity pools
  await testEndpoint('GET /v1/liquidity-pools', 'GET', '/v1/liquidity-pools');
  
  // Test 3: Get fees
  await testEndpoint('GET /v1/fees', 'GET', '/v1/fees');
  
  // Test 4: Get account balance (using known public key)
  await testEndpoint(
    'GET /v1/account/balance',
    'GET',
    '/v1/account/balance/GCAO7I2ZBIEFXNYD3KZFA3UXLMDVCYUG6CTCYG56746LZB5MIUFIIBJ5'
  );
  
  // Test 5: Get account operations
  await testEndpoint(
    'GET /v1/account/operations',
    'GET',
    '/v1/account/operations/GCAO7I2ZBIEFXNYD3KZFA3UXLMDVCYUG6CTCYG56746LZB5MIUFIIBJ5',
    { limit: 5 }
  );
  
  // Test 6: Get user liquidity pools
  await testEndpoint(
    'GET /v1/liquidity-pools/user-pools',
    'GET',
    '/v1/liquidity-pools/user-pools',
    { userPublicKey: 'GCAO7I2ZBIEFXNYD3KZFA3UXLMDVCYUG6CTCYG56746LZB5MIUFIIBJ5' }
  );
  
  // Test 7: Get pools for pair (simple test)
  await testEndpoint(
    'GET /v1/swap/pools-for-pair',
    'GET',
    '/v1/swap/pools-for-pair',
    { tokenA: 'native', tokenB: 'TEST' }
  );
  
  // Test 8: Get orderbook (using asset format: code:issuer or native)
  await testEndpoint(
    'GET /v1/market/orderbook',
    'GET',
    '/v1/market/orderbook',
    {
      base: 'native',
      counter: 'TEST:GAFSXUDWT2P5AOEFD6TGIQSHZ6FEWHNWCS554MZVVUUM3YGI7DB73YWN'
    }
  );
  
  // Test 9: Get offers by account
  await testEndpoint(
    'GET /v1/market/offers',
    'GET',
    '/v1/market/offers/GCAO7I2ZBIEFXNYD3KZFA3UXLMDVCYUG6CTCYG56746LZB5MIUFIIBJ5'
  );
  
  // Print summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 Test Summary');
  console.log('='.repeat(60));
  
  const passed = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;
  
  console.log(`\n✅ Passed: ${passed}/${results.length}`);
  console.log(`❌ Failed: ${failed}/${results.length}\n`);
  
  results.forEach(result => {
    const icon = result.success ? '✅' : '❌';
    const status = result.status ? ` (${result.status})` : '';
    console.log(`${icon} ${result.name}${status}`);
    if (!result.success && result.message) {
      console.log(`   Error: ${result.message}`);
    }
  });
  
  console.log('\n' + '='.repeat(60));
}

runTests().catch(console.error);

