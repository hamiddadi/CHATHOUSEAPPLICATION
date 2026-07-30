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
    ['/terms', 'ChatHouse Terms of Use'],
    ['/community-guidelines', 'ChatHouse Community Guidelines'],
    ['/child-safety', 'ChatHouse Child Safety Standards'],
    ['/account-deletion', 'Delete a ChatHouse account'],
    ['/support', 'ChatHouse Support'],
  ])('serves public legal resource %s with restrictive browser headers', async (path, title) => {
    const app: Express = createApp();
    const response = await request(app).get(path);
    expect(response.status).toBe(200);
    expect(response.text).toContain(title);
    expect(response.headers['content-security-policy']).toContain("default-src 'none'");
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(response.headers['content-language']).toBe('en');
    expect(response.text).toContain('<html lang="en">');
    expect(response.text).toContain('Version: 2026-07-29');
  });

  it.each([
    ['/privacy', 'Politique de confidentialité de ChatHouse'],
    ['/terms', 'Conditions d’utilisation de ChatHouse'],
    ['/community-guidelines', 'Règles de la communauté ChatHouse'],
    ['/child-safety', 'Normes de protection de l’enfance ChatHouse'],
    ['/account-deletion', 'Supprimer un compte ChatHouse'],
    ['/support', 'Assistance ChatHouse'],
  ])('serves an explicitly identified French legal resource %s', async (path, title) => {
    const app: Express = createApp();
    const response = await request(app).get(path).query({ lang: 'fr' });

    expect(response.status).toBe(200);
    expect(response.text).toContain(title);
    expect(response.text).toContain('<html lang="fr">');
    expect(response.text).toContain('Français');
    expect(response.headers['content-language']).toBe('fr');
  });

  it('cross-links the public Terms, Privacy Policy and support resources', async () => {
    const app: Express = createApp();
    const terms = await request(app).get('/terms');
    const support = await request(app).get('/support');
    const childSafety = await request(app).get('/child-safety');

    expect(terms.text).toContain('href="/privacy"');
    expect(terms.text).toContain('href="/account-deletion"');
    expect(terms.text).toContain('href="/support"');
    expect(terms.text).toContain('href="/community-guidelines"');
    expect(terms.text).toContain('href="/child-safety"');
    expect(support.text).toContain('href="/terms"');
    expect(support.text).toContain('href="/community-guidelines"');
    expect(support.text).toContain('href="/child-safety"');
    expect(childSafety.text).toContain('child-safety@example.invalid');
  });

  it('serves Android and Apple association documents without redirects', async () => {
    const app: Express = createApp();
    const assetLinks = await request(app).get('/.well-known/assetlinks.json');
    const appleAssociation = await request(app).get('/.well-known/apple-app-site-association');

    expect(assetLinks.status).toBe(200);
    expect(assetLinks.headers['content-type']).toContain('application/json');
    expect(assetLinks.body[0].target).toMatchObject({
      namespace: 'android_app',
      package_name: 'com.chathouse.app',
    });
    expect(assetLinks.body[0].target.sha256_cert_fingerprints).toHaveLength(1);

    expect(appleAssociation.status).toBe(200);
    expect(appleAssociation.headers['content-type']).toContain('application/json');
    expect(appleAssociation.body.applinks.details[0]).toMatchObject({
      appID: 'TESTTEAMID.com.chathouse.app',
      paths: ['*'],
    });
  });
});
