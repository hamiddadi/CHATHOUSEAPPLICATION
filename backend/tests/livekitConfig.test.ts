import { readFileSync } from 'node:fs';

const livekitConfigs = [
  ['livekit/livekit.yaml', readFileSync('livekit/livekit.yaml', 'utf8')],
  ['livekit/livekit.dev.yaml', readFileSync('livekit/livekit.dev.yaml', 'utf8')],
] as const;

const ttlConfigs = [
  ['.env.example', readFileSync('.env.example', 'utf8'), 'LIVEKIT_TOKEN_TTL_SECONDS=300'],
  ['.env.prod.example', readFileSync('.env.prod.example', 'utf8'), 'LIVEKIT_TOKEN_TTL_SECONDS=300'],
  [
    'docker-compose.yml',
    readFileSync('docker-compose.yml', 'utf8'),
    'LIVEKIT_TOKEN_TTL_SECONDS:-300',
  ],
  [
    'docker-compose.prod.yml',
    readFileSync('docker-compose.prod.yml', 'utf8'),
    'LIVEKIT_TOKEN_TTL_SECONDS:-300',
  ],
] as const;

const developmentCompose = readFileSync('docker-compose.yml', 'utf8');
const productionCompose = readFileSync('docker-compose.prod.yml', 'utf8');

describe('self-hosted LiveKit configuration', () => {
  it.each(livekitConfigs)('%s disables implicit room creation', (_relativePath, contents) => {
    const lines = contents.split(/\r?\n/);
    const roomLine = lines.findIndex(line => line.trim() === 'room:');
    expect(roomLine).toBeGreaterThanOrEqual(0);

    const configuredChildren: string[] = [];
    for (let index = roomLine + 1; index < lines.length; index += 1) {
      const line = lines[index] ?? '';
      if (line.trim() !== '' && /^\S/.test(line)) break;
      configuredChildren.push(line);
    }

    expect(configuredChildren.map(line => line.trim())).toContain('auto_create: false');
  });

  it.each(ttlConfigs)(
    '%s defaults the LiveKit token lifetime to 300 seconds',
    (_relativePath, contents, expected) => {
      expect(contents).toContain(expected);
    },
  );

  it('routes development admin calls through the LiveKit Docker service', () => {
    expect(developmentCompose).toContain('LIVEKIT_INTERNAL_URL: http://livekit:7880');
  });

  it('exposes the optional internal endpoint in production compose', () => {
    expect(productionCompose).toContain('LIVEKIT_INTERNAL_URL: ${LIVEKIT_INTERNAL_URL:-}');
  });
});
