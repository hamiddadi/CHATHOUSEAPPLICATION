interface SocketOriginPolicy {
  corsOrigins: readonly string[];
  publicUrl?: string;
  nodeEnv: 'development' | 'test' | 'production';
}

const normalizedOrigin = (value: string): string | null => {
  try {
    return new URL(value).origin.toLowerCase();
  } catch {
    return null;
  }
};

const isPrivateIpv4 = (hostname: string): boolean => {
  const octets = hostname.split('.').map(Number);
  if (
    octets.length !== 4 ||
    octets.some(octet => !Number.isInteger(octet) || octet < 0 || octet > 255)
  ) {
    return false;
  }
  const first = octets[0] as number;
  const second = octets[1] as number;
  return (
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
};

const isDevelopmentHost = (hostname: string): boolean =>
  hostname === 'localhost' ||
  hostname === '127.0.0.1' ||
  hostname === '[::1]' ||
  isPrivateIpv4(hostname);

/**
 * React Native's WebSocket implementation sends the Socket.IO endpoint itself
 * as the Origin (for example http://127.0.0.1:4000 through `adb reverse`), not
 * the Metro origin used by a browser. Accept the canonical API origin in every
 * environment and private/loopback API origins only outside production.
 *
 * This keeps production fail-closed: an arbitrary website is still rejected,
 * while native Android/iOS clients can connect to the configured API host.
 */
export const isSocketOriginAllowed = (
  origin: string | undefined,
  policy: SocketOriginPolicy,
): boolean => {
  // Native clients and non-browser Socket.IO clients may omit Origin entirely.
  if (!origin) return true;

  const candidate = normalizedOrigin(origin);
  if (!candidate) return false;

  const configuredOrigins = policy.corsOrigins
    .map(normalizedOrigin)
    .filter((value): value is string => value !== null);
  if (configuredOrigins.includes(candidate)) return true;

  const publicApiOrigin = policy.publicUrl ? normalizedOrigin(policy.publicUrl) : null;
  if (publicApiOrigin === candidate) return true;

  if (policy.nodeEnv === 'production') return false;

  try {
    return isDevelopmentHost(new URL(candidate).hostname);
  } catch {
    return false;
  }
};
