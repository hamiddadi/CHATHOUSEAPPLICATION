import request from 'supertest';
import type { Express } from 'express';
import { readFileSync } from 'node:fs';
import path from 'node:path';
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
    ['get', '/api/users/{id}'],
    ['post', '/api/users/me/request-deletion'],
    ['post', '/api/users/me/cancel-deletion'],
    ['get', '/api/users/me/export'],
    ['post', '/api/rooms'],
    ['post', '/api/rooms/{id}/join'],
    ['post', '/api/rooms/{id}/leave'],
    ['post', '/api/rooms/{id}/end'],
    ['post', '/api/rooms/{id}/messages'],
    ['post', '/api/rooms/{id}/reactions'],
    ['post', '/api/follow/{userId}'],
    ['delete', '/api/follow/{userId}'],
    ['get', '/api/follow/requests'],
    ['post', '/api/follow/{userId}/accept'],
    ['post', '/api/follow/{userId}/reject'],
    ['post', '/api/groups'],
    ['post', '/api/groups/{id}/messages'],
    ['post', '/api/groups/{id}/voice'],
    ['post', '/api/groups/{id}/members'],
    ['post', '/api/groups/{id}/leave'],
    ['post', '/api/chat/{userId}'],
    ['post', '/api/chat/{userId}/voice'],
    ['post', '/api/chat/messages/{messageId}/report'],
    ['post', '/api/groups/{id}/messages/{messageId}/report'],
    ['post', '/api/rooms/{id}/messages/{messageId}/report'],
    ['get', '/api/maps/users'],
    ['patch', '/api/maps/location'],
    ['post', '/api/upload/avatar'],
    ['post', '/api/upload/voice'],
    ['get', '/api/explore'],
    ['get', '/api/recordings'],
    ['get', '/api/recordings/room/{roomId}'],
    ['get', '/api/recordings/users/{userId}'],
    ['post', '/api/push/register'],
    ['post', '/api/push/unregister'],
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

  it('documents the explicit account-restoration session boundary', () => {
    const login = JSON.stringify(asObject(asObject(paths['/api/auth/login'])['post']));
    const otp = JSON.stringify(asObject(asObject(paths['/api/auth/verify-otp'])['post']));
    const refresh = JSON.stringify(asObject(asObject(paths['/api/auth/refresh'])['post']));
    const me = JSON.stringify(asObject(asObject(paths['/api/users/me'])['get']));
    const cancel = JSON.stringify(
      asObject(asObject(paths['/api/users/me/cancel-deletion'])['post']),
    );

    expect(login).toContain('account_recovery');
    expect(otp).toContain('recovery-only');
    expect(refresh).toContain('recovery-scoped');
    expect(me).toContain('accountState');
    expect(cancel).toContain('account_recovery');
    expect(cancel).toContain('fresh active session');
  });

  it('marks legacy email authentication unavailable in production', () => {
    for (const path of ['/api/auth/register', '/api/auth/login']) {
      const operation = asObject(asObject(paths[path])['post']);
      expect(operation['deprecated']).toBe(true);
      expect(operation['summary']).toContain('non-production only');
      expect(operation['description']).toContain('always unavailable in production');

      const unavailable = asObject(asObject(operation['responses'])['404']);
      expect(unavailable['description']).toContain('AUTH_009');
      expect(JSON.stringify(unavailable)).toContain('AUTH_009');
    }
  });

  it('documents idempotency headers on retry-sensitive creates', () => {
    for (const path of [
      '/api/rooms',
      '/api/groups',
      '/api/groups/{id}/messages',
      '/api/groups/{id}/voice',
      '/api/groups/{id}/members',
      '/api/chat/{userId}',
      '/api/chat/{userId}/voice',
      '/api/rooms/{id}/messages',
      '/api/rooms/{id}/reactions',
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

  it('keeps every mounted core mobile router represented in the contract', () => {
    const source = readFileSync(path.join(__dirname, '../src/app.ts'), 'utf8');
    const mountedPrefixes = [...source.matchAll(/app\.use\(\s*['"](\/api\/[^'"]+)['"]\s*,/g)]
      .map(match => match[1])
      .filter((prefix): prefix is string => Boolean(prefix));
    // Admin is an operator-only, feature-gated surface and intentionally not
    // part of the mobile API contract.
    const excluded = new Set([
      '/api/admin',
      // Swagger UI is a non-production documentation surface, not part of the
      // mobile API described by the document it serves.
      '/api/docs',
    ]);
    const documentedPaths = Object.keys(paths);
    for (const prefix of mountedPrefixes) {
      if (excluded.has(prefix)) continue;
      expect({
        prefix,
        documented: documentedPaths.some(route => route.startsWith(prefix)),
      }).toEqual({ prefix, documented: true });
    }
  });

  it('requires every extension mount to be documented or explicitly tracked as contract debt', () => {
    const source = readFileSync(path.join(__dirname, '../src/extensions/mount.ts'), 'utf8');
    const mounts = [...source.matchAll(/app\.use\(\s*['"](\/api\/ext\/[^'"]+)['"]\s*,/g)]
      .map(match => match[1])
      .filter((prefix): prefix is string => Boolean(prefix));
    const trackedDebt = new Set([
      '/api/ext/suggestions',
      '/api/ext/contacts',
      '/api/ext/presence',
      '/api/ext/topics',
      '/api/ext/events',
      '/api/ext/chatmod',
      '/api/ext/privacy',
      '/api/ext/search',
      '/api/ext/audio',
      '/api/ext/netquality',
      '/api/ext/clubreq',
      '/api/ext/payments',
      '/api/ext/premium',
      '/api/ext/captions',
      '/api/ext/twitter',
      '/api/ext/calendar',
      '/api/ext/share',
      '/api/ext/speak-invite',
      '/api/ext/hide-room',
      '/api/ext/notif-prefs',
      '/api/ext/chat-reactions',
      '/api/ext/recently-played',
      '/api/ext/room-settings',
      '/api/ext/badges',
      '/api/ext/nominator',
      '/api/ext/search-history',
      '/api/ext/club-meta',
      '/api/ext/profile-links',
      '/api/ext/invites',
      '/api/ext/health',
    ]);
    const documentedPaths = Object.keys(paths);
    for (const prefix of mounts) {
      expect(
        documentedPaths.some(route => route.startsWith(prefix)) || trackedDebt.has(prefix),
      ).toBe(true);
    }
    // Removing/renaming a route must also remove its debt entry; stale entries
    // make the gate fail instead of silently accumulating forever.
    expect([...trackedDebt].filter(prefix => !mounts.includes(prefix))).toEqual([]);
  });

  it('distinguishes exactly-once message persistence from best-effort arrival', () => {
    for (const path of [
      '/api/chat/{userId}',
      '/api/chat/{userId}/voice',
      '/api/groups/{id}/messages',
      '/api/groups/{id}/voice',
    ]) {
      const operation = asObject(asObject(paths[path])['post']);
      const created = asObject(asObject(operation['responses'])['201']);
      const description = created['description'];
      expect(description).toEqual(expect.any(String));
      expect(description).toContain('exactly once per Idempotency-Key');
      expect(description).toContain('best effort');
      expect(description).toContain('messageId');
      expect(description).toContain('notificationId');
      expect(description).not.toContain('fanned out exactly once');
    }
  });

  it('documents legacy arrays and opt-in paginated chat/group envelopes', () => {
    for (const path of ['/api/chat/{userId}', '/api/groups', '/api/groups/{id}/messages']) {
      const operation = asObject(asObject(paths[path])['get']);
      const ok = asObject(asObject(operation['responses'])['200']);
      expect(ok['description']).toContain('paginated=true');
      const mediaType = asObject(asObject(ok['content'])['application/json']);
      const schema = asObject(mediaType['schema']);
      const variants = (schema['anyOf'] ?? schema['oneOf']) as unknown[] | undefined;
      expect(variants).toHaveLength(2);
      const serialized = JSON.stringify(schema);
      expect(serialized).toContain('nextCursor');
      expect(serialized).toContain('hasMore');
      expect(serialized).toContain('array');
    }
  });

  it('documents the group voice payload fields', () => {
    const operation = asObject(asObject(paths['/api/groups/{id}/voice'])['post']);
    expect(JSON.stringify(operation)).toContain('audioUrl');
    expect(JSON.stringify(operation)).toContain('durationMs');
  });

  it('documents private follow state and every actionable notification kind', () => {
    const profileOperation = asObject(asObject(paths['/api/users/{id}'])['get']);
    const notificationOperation = asObject(asObject(paths['/api/notifications'])['get']);
    const profileContract = JSON.stringify(profileOperation);
    const notificationContract = JSON.stringify(notificationOperation);

    expect(profileContract).toContain('followRequestedByMe');
    expect(notificationContract).toContain('FOLLOW_REQUEST');
    expect(notificationContract).toContain('ROOM_CANCELED');
    expect(notificationContract).toContain('ROOM_ENDED_BY_ADMIN');
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
    expect(response.headers['x-chathouse-legal-document-version']).toBe('2026-07-29');
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
