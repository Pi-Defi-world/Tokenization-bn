import axios, { AxiosInstance } from 'axios';
import { logger } from './logger';
import env from '../config/env';

/**
 * Request queue for Horizon API calls to prevent rate limiting
 * Implements token bucket algorithm for rate limiting
 */
class HorizonRequestQueue {
  private queue: Array<{
    request: () => Promise<any>;
    resolve: (value: any) => void;
    reject: (error: any) => void;
    priority: number;
  }> = [];
  private processing = false;
  private tokens = 100; // Token bucket capacity
  private maxTokens = 100;
  private refillRate = 10; // Tokens per second
  private lastRefill = Date.now();
  private axiosInstance: AxiosInstance;

  constructor() {
    // Create axios instance with connection pooling
    this.axiosInstance = axios.create({
      baseURL: env.HORIZON_URL,
      timeout: 10000,
      httpAgent: new (require('http').Agent)({
        keepAlive: true,
        maxSockets: 50,
        maxFreeSockets: 10,
        timeout: 60000,
        keepAliveMsecs: 30000,
      }),
      httpsAgent: new (require('https').Agent)({
        keepAlive: true,
        maxSockets: 50,
        maxFreeSockets: 10,
        timeout: 60000,
        keepAliveMsecs: 30000,
      }),
    });

    // Start processing queue
    this.startProcessing();
  }

  /**
   * Refill tokens based on time elapsed
   */
  private refillTokens() {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000; // seconds
    const tokensToAdd = Math.floor(elapsed * this.refillRate);
    
    if (tokensToAdd > 0) {
      this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
      this.lastRefill = now;
    }
  }

  /**
   * Process the queue
   */
  private async startProcessing() {
    if (this.processing) return;
    this.processing = true;

    while (true) {
      this.refillTokens();

      if (this.queue.length === 0) {
        await new Promise(resolve => setTimeout(resolve, 100));
        continue;
      }

      // Sort by priority (higher priority first)
      this.queue.sort((a, b) => b.priority - a.priority);

      // Process requests if we have tokens
      if (this.tokens >= 1) {
        const item = this.queue.shift();
        if (item) {
          this.tokens--;
          
          // Execute request
          item.request()
            .then(item.resolve)
            .catch(item.reject);
        }
      } else {
        // Wait for tokens to refill
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
  }

  /**
   * Add request to queue
   */
  public async enqueue<T>(
    request: () => Promise<T>,
    priority: number = 0
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push({ request, resolve, reject, priority });
    });
  }

  /**
   * Make HTTP request through queue
   */
  public async request<T>(config: any, priority: number = 0): Promise<T> {
    return this.enqueue(() => this.axiosInstance.request(config), priority);
  }

  /**
   * GET request
   */
  public async get<T>(url: string, config?: any, priority: number = 0): Promise<T> {
    return this.request({ method: 'GET', url, ...config }, priority);
  }

  /**
   * POST request
   */
  public async post<T>(url: string, data?: any, config?: any, priority: number = 1): Promise<T> {
    return this.request({ method: 'POST', url, data, ...config }, priority);
  }
}

// Singleton instance
export const horizonQueue = new HorizonRequestQueue();

