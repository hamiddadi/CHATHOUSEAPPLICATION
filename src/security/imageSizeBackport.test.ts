import { spawnSync } from 'node:child_process';

type ParserName = 'HEIF' | 'ICNS' | 'JXL';

const parserModules: Record<ParserName, string> = {
  HEIF: require.resolve('image-size/dist/types/heif'),
  ICNS: require.resolve('image-size/dist/types/icns'),
  JXL: require.resolve('image-size/dist/types/jxl'),
};

/**
 * Run each parser in a separate process. If the regression ever comes back,
 * spawnSync kills the stuck process and the test fails instead of hanging Jest.
 */
function expectMalformedImageToReject(parser: ParserName, bytes: number[], message: RegExp) {
  const childScript = `
    const { ${parser} } = require(${JSON.stringify(parserModules[parser])});
    try {
      ${parser}.calculate(Uint8Array.from(${JSON.stringify(bytes)}));
      process.stdout.write('unexpected success');
    } catch (error) {
      process.stderr.write(String(error && error.message));
      process.exitCode = 2;
    }
  `;

  const result = spawnSync(process.execPath, ['-e', childScript], {
    encoding: 'utf8',
    timeout: 1_000,
    windowsHide: true,
  });

  expect(result.error).toBeUndefined();
  expect(result.signal).toBeNull();
  expect(result.status).toBe(2);
  expect(result.stderr).toMatch(message);
}

describe('image-size 1.2.1 security backport', () => {
  it('GHSA-w3rx-r6r6-pgpr: ICNS rejects a truncated file-length header', () => {
    expectMalformedImageToReject('ICNS', [0x69, 0x63, 0x6e, 0x73], /Invalid ICNS file length/);
  });

  test.each([
    ['zero', [0, 0, 0, 0]],
    ['smaller than its header', [0, 0, 0, 4]],
  ])('GHSA-w3rx-r6r6-pgpr: ICNS rejects an entry length that is %s', (_label, entryLength) => {
    expectMalformedImageToReject(
      'ICNS',
      [
        0x69,
        0x63,
        0x6e,
        0x73, // icns
        0x00,
        0x00,
        0x00,
        0x10, // declared file length: 16
        0x69,
        0x73,
        0x33,
        0x32, // is32
        ...entryLength,
      ],
      /Invalid ICNS entry length/,
    );
  });

  it('GHSA-5p2g-fcmc-qvqq: JXL rejects a zero-sized jxlp box', () => {
    expectMalformedImageToReject(
      'JXL',
      [
        0x00,
        0x00,
        0x00,
        0x00, // zero box size
        0x6a,
        0x78,
        0x6c,
        0x70, // jxlp
        0x00,
        0x00,
        0x00,
        0x00,
      ],
      /No codestream found/,
    );
  });

  it('GHSA-5p2g-fcmc-qvqq: HEIF rejects a zero-sized ispe box', () => {
    expectMalformedImageToReject(
      'HEIF',
      [
        0x00,
        0x00,
        0x00,
        0x0c,
        0x6d,
        0x65,
        0x74,
        0x61,
        0x00,
        0x00,
        0x00,
        0x00, // meta
        0x00,
        0x00,
        0x00,
        0x08,
        0x69,
        0x70,
        0x72,
        0x70, // iprp
        0x00,
        0x00,
        0x00,
        0x08,
        0x69,
        0x70,
        0x63,
        0x6f, // ipco
        0x00,
        0x00,
        0x00,
        0x00,
        0x69,
        0x73,
        0x70,
        0x65, // zero-sized ispe
      ],
      /Invalid HEIF, no size found/,
    );
  });
});
