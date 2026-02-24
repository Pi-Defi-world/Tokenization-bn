import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import axios from 'axios';

dotenv.config();

// Your user info
const userId = '6917551b11d9514682ccf741';
const username = 'junman140';
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

// Debug: Check if JWT_SECRET is loaded
if (!process.env.JWT_SECRET) {
  console.warn('⚠️  WARNING: JWT_SECRET not found in .env file!');
  console.warn('   Using fallback secret. This will fail if backend uses a different secret.');
} else {
  console.log('✅ JWT_SECRET loaded from .env');
  console.log(`   Secret length: ${process.env.JWT_SECRET.length} characters`);
}

// Generate JWT token
const token = jwt.sign(
  { id: userId, username },
  JWT_SECRET,
  { expiresIn: '30d' }
);

// Verify token can be decoded (for debugging)
try {
  const decoded = jwt.verify(token, JWT_SECRET);
  console.log('✅ Token generated and verified successfully');
  console.log('   Decoded payload:', JSON.stringify(decoded, null, 2));
} catch (err: any) {
  console.error('❌ Token verification failed:', err.message);
  process.exit(1);
}

console.log('\n🔑 Generated JWT Token:');
console.log(token);
console.log('\n');

// Test mint endpoint
const baseUrl = 'http://localhost:8000';
const endpoint = `${baseUrl}/v1/tokens/mint`;

const payload = {
  distributorSecret: 'SCB2NN44YEITKM2TEXCTPP3LB33DXFI3M7PKCVJU24UFELY6TTFGOD44', // Generated from mnemonic
  assetCode: 'TEST' + Date.now().toString().slice(-6), // Unique asset code
  totalSupply: 100000, // Must be NUMBER
  name: 'Test Token',
  description: 'A test token for minting',
  homeDomain: 'www.zyrapay.net'
};

console.log('📤 Testing mint endpoint...');
console.log('Endpoint:', endpoint);
console.log('Payload:', JSON.stringify(payload, null, 2));
console.log('\n');

axios.post(endpoint, payload, {
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  },
  timeout: 60000 // 60 second timeout
})
  .then(response => {
    console.log('✅ Success!');
    console.log(JSON.stringify(response.data, null, 2));
  })
  .catch(error => {
    console.error('\n❌ Error:');
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Status Text:', error.response.statusText);
      console.error('Data:', JSON.stringify(error.response.data, null, 2));
      if (error.response.headers) {
        console.error('Headers:', JSON.stringify(error.response.headers, null, 2));
      }
    } else if (error.request) {
      console.error('Request made but no response received');
      console.error('Request:', error.request);
    } else {
      console.error('Error message:', error.message);
      console.error('Full error:', error);
    }
    process.exit(1);
  });

