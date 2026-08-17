/**
 * Runtime-neutral load-test configuration helpers.
 *
 * This module intentionally uses only standard JavaScript APIs so both Node
 * and k6 can import the exact same target-safety contract.
 */

const KNOWN_PRODUCTION_SUFFIXES = ['chathouse.app', 'chathouse.com'];

export function parseBoolean(name, rawValue, defaultValue = false) {
  if (rawValue === undefined || rawValue === null || String(rawValue).trim() === '') {
    return defaultValue;
  }
  const value = String(rawValue).trim().toLowerCase();
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  throw new Error(`${name} must be true/false or 1/0`);
}

export function parseBoundedInteger(name, rawValue, { defaultValue, min, max }) {
  const value = rawValue === undefined || rawValue === '' ? defaultValue : Number(rawValue);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

export function parseBoundedRatio(name, rawValue, defaultValue) {
  const value = rawValue === undefined || rawValue === '' ? defaultValue : Number(rawValue);
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new Error(`${name} must be a number greater than or equal to 0 and less than 1`);
  }
  return value;
}

export function parseOptionalIsoDate(name, rawValue) {
  const value = String(rawValue ?? '').trim();
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    throw new Error(`${name} must be an ISO date (YYYY-MM-DD)`);
  }
  return value;
}

export function parseDuration(name, rawValue, defaultValue = '30s') {
  const value = String(rawValue ?? defaultValue).trim();
  const match = value.match(/^(\d+)(ms|s|m)$/u);
  if (!match) throw new Error(`${name} must use a duration such as 500ms, 30s or 2m`);
  const amount = Number(match[1]);
  const unit = match[2];
  const milliseconds = amount * (unit === 'm' ? 60_000 : unit === 's' ? 1_000 : 1);
  if (milliseconds < 1_000 || milliseconds > 15 * 60_000) {
    throw new Error(`${name} must be between 1s and 15m`);
  }
  return value;
}

export function isLoopbackHostname(hostname) {
  const normalized = hostname
    .replace(/^\[|\]$/gu, '')
    .replace(/\.$/u, '')
    .toLowerCase();
  const ipv4 = normalized.split('.').map(Number);
  const loopbackIpv4 =
    ipv4.length === 4 &&
    ipv4[0] === 127 &&
    ipv4.every(octet => Number.isInteger(octet) && octet >= 0 && octet <= 255);
  return (
    normalized === 'localhost' ||
    normalized === '::1' ||
    normalized === '0:0:0:0:0:0:0:1' ||
    loopbackIpv4
  );
}

export function isKnownProductionHostname(hostname) {
  const normalized = hostname
    .replace(/^\[|\]$/gu, '')
    .replace(/\.$/u, '')
    .toLowerCase();
  return KNOWN_PRODUCTION_SUFFIXES.some(
    suffix => normalized === suffix || normalized.endsWith(`.${suffix}`),
  );
}

// k6 v1 does not expose the browser's global URL constructor in every command
// (notably `k6 inspect`). Keep parsing deliberately small and deterministic:
// load targets accept ASCII hosts and bracketed IPv6, never arbitrary paths.
function parseAbsoluteUrl(name, rawValue) {
  const value = String(rawValue ?? '').trim();
  const schemeSeparator = value.indexOf('://');
  if (schemeSeparator <= 0) throw new Error(`${name} must be a valid absolute URL`);
  const scheme = value.slice(0, schemeSeparator);
  if (!/^[A-Za-z][A-Za-z0-9+.-]*$/u.test(scheme)) {
    throw new Error(`${name} must be a valid absolute URL`);
  }
  const protocol = `${scheme.toLowerCase()}:`;
  const remainder = value.slice(schemeSeparator + 3);
  const boundaryIndexes = ['/', '?', '#']
    .map(character => remainder.indexOf(character))
    .filter(index => index >= 0);
  const authorityEnd = boundaryIndexes.length ? Math.min(...boundaryIndexes) : remainder.length;
  const authority = remainder.slice(0, authorityEnd);
  const suffix = remainder.slice(authorityEnd);
  if (!authority) throw new Error(`${name} must be a valid absolute URL`);

  const hashIndex = suffix.indexOf('#');
  const beforeHash = hashIndex >= 0 ? suffix.slice(0, hashIndex) : suffix;
  const hash = hashIndex >= 0 ? suffix.slice(hashIndex) : '';
  const searchIndex = beforeHash.indexOf('?');
  const pathname = searchIndex >= 0 ? beforeHash.slice(0, searchIndex) : beforeHash;
  const search = searchIndex >= 0 ? beforeHash.slice(searchIndex) : '';
  const credentialSeparator = authority.lastIndexOf('@');
  const hasCredentials = credentialSeparator >= 0;
  const hostPort = hasCredentials ? authority.slice(credentialSeparator + 1) : authority;
  let hostname;
  let port = '';

  if (hostPort.startsWith('[')) {
    const bracket = hostPort.indexOf(']');
    if (bracket < 0) throw new Error(`${name} contains an invalid IPv6 host`);
    hostname = hostPort.slice(1, bracket);
    const remainder = hostPort.slice(bracket + 1);
    if (remainder) {
      if (!/^:\d+$/u.test(remainder)) throw new Error(`${name} contains an invalid port`);
      port = remainder.slice(1);
    }
  } else {
    const colon = hostPort.lastIndexOf(':');
    if (colon >= 0) {
      if (hostPort.slice(0, colon).includes(':')) {
        throw new Error(`${name} IPv6 hosts must be enclosed in brackets`);
      }
      hostname = hostPort.slice(0, colon);
      port = hostPort.slice(colon + 1);
    } else {
      hostname = hostPort;
    }
    if (!/^[A-Za-z0-9.-]+$/u.test(hostname)) {
      throw new Error(`${name} contains an invalid host`);
    }
  }

  if (!hostname) throw new Error(`${name} must contain a host`);
  if (port && (!/^\d+$/u.test(port) || Number(port) < 1 || Number(port) > 65_535)) {
    throw new Error(`${name} contains an invalid port`);
  }
  const defaultPort =
    (protocol === 'http:' && port === '80') || (protocol === 'https:' && port === '443');
  const normalizedPort = port && !defaultPort ? `:${Number(port)}` : '';
  const normalizedHostname = hostname.replace(/\.$/u, '').toLowerCase();
  const displayedHost = normalizedHostname.includes(':')
    ? `[${normalizedHostname}]`
    : normalizedHostname;

  return {
    protocol,
    hostname: normalizedHostname,
    hasCredentials,
    pathname: pathname || '/',
    search,
    hash,
    origin: `${protocol}//${displayedHost}${normalizedPort}`,
    href: value,
  };
}

function normalizedHttpOrigin(name, rawValue) {
  const url = parseAbsoluteUrl(name, rawValue);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`${name} must use http or https`);
  }
  if (url.hasCredentials) throw new Error(`${name} must not contain credentials`);
  if ((url.pathname && url.pathname !== '/') || url.search || url.hash) {
    throw new Error(`${name} must be an origin without a path, query string or fragment`);
  }
  return { url, origin: url.origin };
}

/**
 * Local targets are safe by default. Remote targets require both an opt-in and
 * an exact origin confirmation; known ChatHouse production domains require a
 * third, production-specific opt-in.
 */
export function validateLoadTarget(rawValue, env = {}, name = 'LOAD_TEST_API_URL') {
  const { url, origin } = normalizedHttpOrigin(name, rawValue);
  const hostname = url.hostname;
  const local = isLoopbackHostname(hostname);
  const production = isKnownProductionHostname(hostname);

  if (!local && url.protocol !== 'https:') {
    throw new Error(`${name} must use https for a remote target`);
  }
  if (!local && !parseBoolean('LOAD_TEST_ALLOW_REMOTE', env.LOAD_TEST_ALLOW_REMOTE, false)) {
    throw new Error('remote load-test targets require LOAD_TEST_ALLOW_REMOTE=true');
  }
  if (!local) {
    const confirmation = String(env.LOAD_TEST_CONFIRM_TARGET ?? '').replace(/\/+$/u, '');
    if (confirmation !== origin) {
      throw new Error(`LOAD_TEST_CONFIRM_TARGET must exactly equal ${origin}`);
    }
  }
  if (
    production &&
    !parseBoolean('LOAD_TEST_ALLOW_PRODUCTION', env.LOAD_TEST_ALLOW_PRODUCTION, false)
  ) {
    throw new Error('known ChatHouse production targets require LOAD_TEST_ALLOW_PRODUCTION=true');
  }

  return Object.freeze({ origin, hostname, local, production });
}

export function validateLocalRedisTarget(rawValue) {
  const url = parseAbsoluteUrl('LOAD_TEST_REDIS_URL', rawValue);
  if (!['redis:', 'rediss:'].includes(url.protocol)) {
    throw new Error('LOAD_TEST_REDIS_URL must use redis or rediss');
  }
  if (!isLoopbackHostname(url.hostname)) {
    throw new Error('rate-limit reset is restricted to a loopback Redis instance');
  }
  return url.href;
}

export function createFunctionalLoadConfig(env = {}) {
  const target = validateLoadTarget(
    env.LOAD_TEST_API_URL ?? env.API ?? 'http://127.0.0.1:4000',
    env,
  );
  const users = parseBoundedInteger('LOAD_TEST_USERS', env.LOAD_TEST_USERS ?? env.N, {
    defaultValue: 50,
    min: 2,
    max: 200,
  });
  const concurrency = parseBoundedInteger(
    'LOAD_TEST_CONCURRENCY',
    env.LOAD_TEST_CONCURRENCY ?? env.CONCURRENCY,
    { defaultValue: Math.min(10, users), min: 1, max: 50 },
  );
  if (concurrency > users) {
    throw new Error('LOAD_TEST_CONCURRENCY must not exceed LOAD_TEST_USERS');
  }

  const resetRateLimits = parseBoolean(
    'LOAD_TEST_RESET_RATE_LIMITS',
    env.LOAD_TEST_RESET_RATE_LIMITS,
    false,
  );
  const redisUrl = env.LOAD_TEST_REDIS_URL ?? env.REDIS_URL ?? 'redis://127.0.0.1:6379';
  if (resetRateLimits) validateLocalRedisTarget(redisUrl);

  return Object.freeze({
    apiUrl: target.origin,
    target,
    users,
    concurrency,
    requestTimeoutMs: parseBoundedInteger(
      'LOAD_TEST_REQUEST_TIMEOUT_MS',
      env.LOAD_TEST_REQUEST_TIMEOUT_MS,
      { defaultValue: 5_000, min: 1_000, max: 30_000 },
    ),
    socketTimeoutMs: parseBoundedInteger(
      'LOAD_TEST_SOCKET_TIMEOUT_MS',
      env.LOAD_TEST_SOCKET_TIMEOUT_MS,
      { defaultValue: 10_000, min: 1_000, max: 30_000 },
    ),
    httpRetries: parseBoundedInteger('LOAD_TEST_HTTP_RETRIES', env.LOAD_TEST_HTTP_RETRIES, {
      defaultValue: 2,
      min: 0,
      max: 5,
    }),
    maxFailureRate: parseBoundedRatio(
      'LOAD_TEST_MAX_FAILURE_RATE',
      env.LOAD_TEST_MAX_FAILURE_RATE,
      0,
    ),
    legalDocumentVersion: parseOptionalIsoDate(
      'LOAD_TEST_LEGAL_DOCUMENT_VERSION',
      env.LOAD_TEST_LEGAL_DOCUMENT_VERSION,
    ),
    resetRateLimits,
    redisUrl,
  });
}
