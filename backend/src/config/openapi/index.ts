import { OpenAPIRegistry, OpenApiGeneratorV3 } from '@asteasolutions/zod-to-openapi';
import { registerComponents } from './components';
import { registerAuthPaths } from './auth';
import { registerUsersPaths } from './users';
import { registerRoomsPaths } from './rooms';
import { registerChatPaths } from './chat';
import { registerClubsPaths } from './clubs';
import { registerSearchPaths } from './search';
import { registerNotificationsPaths } from './notifications';

/**
 * OpenAPI document generator. Composed from one registration module per domain
 * (./auth, ./users, …) so each slice's paths live next to a single concern and
 * the file stays small. Shared schemas (ErrorResponse, TokenPair, …) and the
 * bearer scheme are registered once in ./components. To document a new module,
 * add a `register<Domain>Paths` module and a call below.
 *
 * Registration order is preserved (components, then auth → users → rooms →
 * chat → clubs → search → notifications) so the generated document is stable.
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

  const generator = new OpenApiGeneratorV3(registry.definitions);
  return generator.generateDocument({
    openapi: '3.0.3',
    info: {
      title: 'Chathouse API',
      version: '0.1.0',
      description:
        'Auth, Users, Rooms, Chat, Clubs, Search and Notifications documented. Remaining modules (Maps, Explore, Push, Admin, /api/ext/*) follow the same pattern — `registry.registerPath(...)` per endpoint using their existing Zod schemas.',
    },
    servers: [
      { url: 'https://api.chathouse.app', description: 'prod' },
      { url: 'http://localhost:4000', description: 'dev' },
    ],
  });
};
