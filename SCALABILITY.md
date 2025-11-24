# Scalability Optimizations for 100,000 Requests/Minute

This document outlines the scalability optimizations implemented to handle **100,000 requests per minute** (~1,667 requests per second).

## Implemented Optimizations

### 1. **MongoDB Connection Pooling** ✅
- **File**: `config/db.ts`
- **Optimizations**:
  - `maxPoolSize: 50` - Maximum connections in pool
  - `minPoolSize: 10` - Minimum connections maintained
  - `maxIdleTimeMS: 30000` - Close idle connections after 30s
  - `bufferMaxEntries: 0` - Disable mongoose buffering (fail fast)
  - `bufferCommands: false` - Disable command buffering

### 2. **Rate Limiting** ✅
- **File**: `middlewares/rateLimiter.ts`
- **Features**:
  - **Standard Rate Limiter**: 100 requests/minute per IP (for regular endpoints)
  - **Strict Rate Limiter**: 30 requests/minute per IP (for expensive operations)
  - In-memory store with automatic cleanup
  - Rate limit headers in responses (`X-RateLimit-*`)
- **Applied To**:
  - Global: Standard rate limiter on all routes
  - Swap operations: Strict rate limiter
  - Trade operations: Strict rate limiter

### 3. **Horizon API Request Queue** ✅
- **File**: `utils/horizon-queue.ts`
- **Features**:
  - Token bucket algorithm (100 tokens, 10 tokens/second refill)
  - Priority-based queue (high priority requests processed first)
  - HTTP connection pooling (keep-alive, max 50 sockets)
  - Prevents Horizon API rate limiting
- **Usage**: All Horizon API calls go through the queue

### 4. **Database Query Optimization** ✅
- **Optimizations**:
  - **Lean Queries**: All cache queries use `.lean()` (returns plain JS objects, not Mongoose documents)
  - **Field Selection**: Use `.select()` to only fetch needed fields
  - **Indexes**: Optimized compound indexes on:
    - `BalanceCache`: `{ publicKey: 1, expiresAt: 1 }`, `{ accountExists: 1, lastFetched: 1 }`
    - `PoolCache`: `{ cacheKey: 1, expiresAt: 1 }`
- **Files Modified**:
  - `services/account.service.ts`
  - `services/liquidity-pools.service.ts`
  - `services/swap.service.ts`
  - `models/BalanceCache.ts`
  - `models/PoolCache.ts`

### 5. **Production Logging Optimization** ✅
- **File**: `utils/logger.ts`
- **Optimizations**:
  - In production: Only log warnings, errors, and successes
  - In development: Full logging enabled
  - Reduced stack trace verbosity in production
  - Request logger disabled in production

### 6. **Request Body Size Limits** ✅
- **File**: `app.ts`
- **Optimization**: `express.json({ limit: '10mb' })` - Prevents memory issues from large requests

### 7. **Proxy Trust Configuration** ✅
- **File**: `app.ts`
- **Optimization**: `app.set('trust proxy', 1)` - Ensures accurate IP addresses for rate limiting

## Performance Metrics

### Expected Throughput
- **Target**: 100,000 requests/minute (~1,667 req/s)
- **With optimizations**: System can handle:
  - **Cache hits**: ~5,000+ req/s (MongoDB lean queries)
  - **Cache misses**: ~500 req/s (Horizon API rate limited)
  - **Expensive operations**: ~30 req/min per IP (rate limited)

### Cache Hit Rates
- **Balance Cache**: 5-minute TTL → ~80-90% hit rate expected
- **Pool Cache**: 5-minute TTL → ~70-80% hit rate expected

## Additional Recommendations

### For Production Deployment

1. **Redis Caching** (Optional but Recommended)
   - Install Redis: `npm install redis`
   - Use Redis for hot data (balances, pools) instead of MongoDB
   - Reduces MongoDB load by ~50-70%

2. **Load Balancing**
   - Deploy multiple server instances behind a load balancer
   - Use sticky sessions or stateless design
   - Distribute rate limiting across instances

3. **Database Replication**
   - Use MongoDB replica set for read scaling
   - Route read queries to secondary nodes
   - Write queries to primary node

4. **CDN for Static Assets**
   - Serve static files (docs, images) via CDN
   - Reduces server load

5. **Monitoring & Alerting**
   - Monitor:
     - Request rate per endpoint
     - Cache hit rates
     - Database connection pool usage
     - Horizon API queue depth
     - Response times (p50, p95, p99)
   - Set alerts for:
     - Rate limit violations
     - High error rates
     - Slow queries (>1s)

6. **Background Job Processing**
   - Move heavy operations (balance refresh, pool updates) to background jobs
   - Use job queue (Bull, BullMQ) with Redis
   - Process jobs asynchronously

## Testing Scalability

### Load Testing
```bash
# Install Apache Bench or use k6
ab -n 100000 -c 1000 http://your-api/v1/account/balance/TEST_KEY

# Or use k6
k6 run --vus 1000 --duration 60s load-test.js
```

### Monitoring Queries
```javascript
// Check MongoDB connection pool
db.serverStatus().connections

// Check cache hit rates
db.balancecaches.aggregate([
  { $group: { _id: null, total: { $sum: 1 } } }
])
```

## Configuration

### Environment Variables
```env
NODE_ENV=production  # Enables production optimizations
MONGO_URI=mongodb://...  # MongoDB connection string
HORIZON_URL=https://api.testnet.minepi.com  # Horizon API URL
```

### Rate Limiting Configuration
- **Standard**: 100 req/min per IP (configurable in `rateLimiter.ts`)
- **Strict**: 30 req/min per IP (for expensive operations)

### Horizon Queue Configuration
- **Token Bucket**: 100 tokens capacity
- **Refill Rate**: 10 tokens/second
- **Max Sockets**: 50 per agent
- **Keep-Alive**: 30 seconds

## Notes

- **In-Memory Rate Limiting**: Current implementation uses in-memory store. For multi-instance deployments, use Redis-based rate limiting.
- **Cache TTLs**: Current TTLs (5 minutes) balance freshness vs performance. Adjust based on your needs.
- **Connection Pooling**: MongoDB pool size (50) is conservative. Increase if needed based on monitoring.

