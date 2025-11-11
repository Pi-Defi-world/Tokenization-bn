import swaggerUi from 'swagger-ui-express';
import { swaggerDocs } from '../documentation';
import { Express } from 'express';

export const setupSwagger = (app: Express) => {
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocs));
  console.log('✅ Swagger docs available at http://localhost:8000/api-docs');
};
