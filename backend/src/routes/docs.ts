import { Router, type Request, type Response } from 'express';
import { serve, setup } from 'swagger-ui-express';
import { buildOpenApiDocument } from '../config/openapi';

/**
 * /api/docs  → Swagger UI (interactive).
 * /api/docs/openapi.json → raw OpenAPI spec (consumable by Postman / codegen).
 * The doc is generated once at boot; call sites are never contacted.
 */
export const docsRouter: Router = Router();

const document = buildOpenApiDocument();

docsRouter.get('/openapi.json', (_req: Request, res: Response) => {
  res.json(document);
});

docsRouter.use('/', serve, setup(document));
