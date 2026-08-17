import { OpenAPIRegistry, OpenApiGeneratorV3 } from '@asteasolutions/zod-to-openapi';
import { registerComponents } from './components';
import { registerAuthPaths } from './auth';
import { registerUsersPaths } from './users';
import { registerRoomsPaths } from './rooms';
import { registerChatPaths } from './chat';
import { registerClubsPaths } from './clubs';
import { registerSearchPaths } from './search';
import { registerNotificationsPaths } from './notifications';
import { registerFollowPaths } from './follow';
import { registerGroupsPaths } from './groups';
import { registerMapsPaths } from './maps';
import { registerUploadPaths } from './uploads';
import { registerOperationalPaths } from './operational';

/**
 * OpenAPI document generator. Composed from one registration module per
 * domain so each slice stays close to its runtime Zod schemas.
 */
export const buildOpenApiDocument = () => {
  const registry = new OpenAPIRegistry();
  const components = registerComponents(registry);

  registerAuthPaths(registry, components);
  registerUsersPaths(registry, components);
  registerRoomsPaths(registry, components);
  registerChatPaths(registry, components);
  registerClubsPaths(registry, components);
  registerSearchPaths(registry);
  registerNotificationsPaths(registry, components);
  registerFollowPaths(registry, components);
  registerGroupsPaths(registry, components);
  registerMapsPaths(registry, components);
  registerUploadPaths(registry, components);
  registerOperationalPaths(registry, components);

  const generator = new OpenApiGeneratorV3(registry.definitions);
  return generator.generateDocument({
    openapi: '3.0.3',
    info: {
      title: 'ChatHouse API',
      version: '0.1.0',
      description:
        'Versioned mobile API contract. Core authentication, privacy, rooms, follow, groups, maps, uploads, chat, clubs, search and notifications are generated from their runtime Zod schemas.',
    },
    servers: [
      { url: 'https://api.chathouse.app', description: 'prod' },
      { url: 'http://localhost:4000', description: 'dev' },
    ],
  });
};
