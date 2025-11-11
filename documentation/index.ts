import tokensDoc from './token.doc.json';
import liquidityDoc from './liquidity.doc.json';
import swapDoc from './swap.doc.json';
import feesDoc from './fees.doc.json';
import pairsDoc from './pairs.doc.json';
import orderbookDoc from './orderbook.doc.json';
import tradeDoc from './trade.doc.json';
import accountDoc from './account.doc.json';

export const swaggerDocs = {
  openapi: '3.0.0',
  info: {
    title: 'Pi DEX API',
    version: '1.0.0',
    description: 'Pi Blockchain-based DEX API Documentation'
  },
  servers: [
    { url: 'http://localhost:8000', description: 'Local Dev Server' }
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Enter your JWT token in the format **Bearer &lt;token&gt;**'
      }
    }
  },

  // 👇 Make all routes secured by default (optional)
  security: [
    {
      bearerAuth: []
    }
  ],
  tags: [
    ...accountDoc.tags,
    ...feesDoc.tags,
    ...tokensDoc.tags,
    ...liquidityDoc.tags,
    ...swapDoc.tags,
    ...pairsDoc.tags,
    ...orderbookDoc.tags,
    ...tradeDoc.tags,
  ],
  paths: {
    ...accountDoc.paths,
    ...feesDoc.paths,
    ...tokensDoc.paths,
    ...liquidityDoc.paths,
    ...swapDoc.paths,
    ...pairsDoc.paths,
    ...orderbookDoc.paths,
    ...tradeDoc.paths,
  }
};
