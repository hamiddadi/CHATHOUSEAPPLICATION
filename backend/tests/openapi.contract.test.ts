import request from 'supertest';
import type { Express } from 'express';
import { buildOpenApiDocument } from '../src/config/openapi';

/* eslint-disable @typescript-eslint/no-require-imports */
const { createApp } = require('../src/app') as typeof import('../src/app');
const { disconnectRedis } = require('../src/config/redis') as typeof import('../src/config/redis');
/* eslint-enable @typescript-eslint/no-require-imports */

type JsonObject = Record<string, unknown>;

afterAll(async () => {
  await disconnectRedis();
});

const asObject = (value: unknown): JsonObject => {
  expect(value).not.toBeNull();
  expect(typeof value).toBe('object');
  expect(Array.isArray(value)).toBe(false);
  return value as JsonObject;
};

const resolvePointer = (root: JsonObject, ref: string): unknown => {
  expect(ref).toMatch(/^#\//);
  return ref
    .slice(2)
    .split('/')
    .map(part => part.replace(/~1/g, '/').replace(/~0/g, '~'))
    .reduce<unknown>((cursor, part) => asObject(cursor)[part], root);
};

describe('OpenAPI release contract', () => {
  const document = buildOpenApiDocument() as unknown as JsonObject;
  const paths = asObject(document['paths']);

  const requiredOperations = [
    ['post', '/api/auth/register'],
    ['post', '/api/auth/send-otp'],
    ['post', '/api/auth/verify-otp'],
    ['post', '/api/auth/login'],
    ['post', '/api/auth/refresh'],
    ['post', '/api/auth/logout'],
    ['post', '/api/auth/reset-password'],
    ['get', '/api/users/me'],
    ['post', '/api/users/me/request-deletion'],
    ['post', '/api/users/me/cancel-deletion'],
    ['get', '/api/users/me/export'],
    ['post', '/api/rooms'],
    ['post', '/api/rooms/{id}/join'],
    ['post', '/api/rooms/{id}/leave'],
    ['post', '/api/rooms/{id}/end'],
    ['post', '/api/follow/{userId}'],
    ['delete', '/api/follow/{userId}'],
    ['post', '/api/follow/{userId}/accept'],
    ['post', '/api/groups'],
    ['post', '/api/groups/{id}/messages'],
    ['post', '/api/groups/{id}/members'],
    ['post', '/api/groups/{id}/leave'],
    ['post', '/api/chat/messages/{messageId}/report'],
    ['post', '/api/groups/{id}/messages/{messageId}/report'],
    ['post', '/api/rooms/{id}/messages/{messageId}/report'],
    ['get', '/api/maps/users'],
    ['patch', '/api/maps/location'],
    ['post', '/api/upload/avatar'],
    ['post', '/api/upload/voice'],
  ] as const;

  it.each(requiredOperations)(
    'documents %s %s with at least one success response',
    (method, path) => {
      const operation = asObject(asObject(paths[path])[method]);
      const responses = asObject(operation['responses']);
      expect(Object.keys(responses).some(status => /^2\d\d$/.test(status))).toBe(true);
    },
  );

  it('resolves every local $ref and emits no dangling component reference', () => {
    const visited = new WeakSet<object>();
    const visit = (value: unknown): void => {
      if (!value || typeof value !== 'object') return;
      if (visited.has(value)) return;
      visited.add(value);
      if (Array.isArray(value)) {
        value.forEach(visit);
        return;
      }
      const object = value as JsonObject;
      if (typeof object['$ref'] === 'string') {
        expect(resolvePointer(document, object['$ref'])).toBeDefined();
      }
      Object.values(object).forEach(visit);
    };
    visit(document);
  });

  it('declares every templated path parameter as required path input', () => {
    for (const [path, pathItemValue] of Object.entries(paths)) {
      const expected = [...path.matchAll(/\{([^}]+)\}/g)].map(match => match[1]);
      if (expected.length === 0) continue;
      const pathItem = asObject(pathItemValue);
      for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
        if (!pathItem[method]) continue;
        const operation = asObject(pathItem[method]);
        const parameters = [
          ...((pathItem['parameters'] as unknown[] | undefined) ?? []),
          ...((operation['parameters'] as unknown[] | undefined) ?? []),
        ].map(asObject);
        for (const name of expected) {
          expect(parameters).toEqual(
            expect.arrayContaining([expect.objectContaining({ in: 'path', name, required: true })]),
          );
        }
      }
    }
  });

  it('requires bearer authentication on sensitive mobile operations', () => {
    const protectedOperations = requiredOperations.filter(
      ([, path]) => !path.startsWith('/api/auth/'),
    );
    for (const [method, path] of protectedOperations) {
      const operation = asObject(asObject(paths[path])[method]);
      expect(operation['security']).toEqual([{ bearerAuth: [] }]);
    }
  });

  it('documents idempotency headers on retry-sensitive creates', () => {
    for (const path of [
      '/api/rooms',
      '/api/groups',
      '/api/groups/{id}/messages',
      '/api/groups/{id}/members',
    ]) {
      const operation = asObject(asObject(paths[path])['post']);
      expect(operation['parameters']).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            in: 'header',
            name: 'Idempotency-Key',
            required: false,
          }),
        ]),
      );
    }
  });

  it('serves the generated JSON contract outside production', async () => {
    const app: Express = createApp();
    const response = await request(app).get('/api/docs/openapi.json');
    expect(response.status).toBe(200);
    expect(response.body.openapi).toBe('3.0.3');
    expect(response.body.paths).toEqual(document['paths']);
  });

  it.each([
    ['/privacy', 'ChatHouse Privacy Policy'],
    ['/account-deletion', 'Delete a ChatHouse account'],
  ])('serves public legal resource %s with restrictive browser headers', async (path, title) => {
    const app: Express = createApp();
    const response = await request(app).get(path);
    expect(response.status).toBe(200);
    expect(response.text).toContain(title);
    expect(response.headers['content-security-policy']).toContain("default-src 'none'");
    expect(response.headers['referrer-policy']).toBe('no-referrer');
  });
});
