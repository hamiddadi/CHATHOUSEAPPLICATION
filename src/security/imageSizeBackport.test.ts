import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { imageSize } from 'image-size';

type ParserName = 'HEIF' | 'ICNS' | 'JXL';

const parserModules: Record<ParserName, string> = {
  HEIF: require.resolve('image-size/dist/types/heif'),
  ICNS: require.resolve('image-size/dist/types/icns'),
  JXL: require.resolve('image-size/dist/types/jxl'),
};

const validJxlContainer = (finalBoxSize: 0 | 12): number[] => [
  0x00,
  0x00,
  0x00,
  0x0c,
  0x4a,
  0x58,
  0x4c,
  0x20, // JXL signature box
  0x0d,
  0x0a,
  0x87,
  0x0a,
  0x00,
  0x00,
  0x00,
  0x14,
  0x66,
  0x74,
  0x79,
  0x70, // ftyp
  0x6a,
  0x78,
  0x6c,
  0x20, // jxl brand
  0x00,
  0x00,
  0x00,
  0x00,
  0x6a,
  0x78,
  0x6c,
  0x20,
  0x00,
  0x00,
  0x00,
  finalBoxSize,
  0x6a,
  0x78,
  0x6c,
  0x63, // final jxlc box
  0xff,
  0x0a,
  0x01,
  0x00, // minimal 8 x 8 codestream header
];

const validHeifWithZeroSizedFinalBox: number[] = [
  0x00,
  0x00,
  0x00,
  0x10,
  0x66,
  0x74,
  0x79,
  0x70,
  0x68,
  0x65,
  0x69,
  0x63, // ftyp + heic brand
  0x00,
  0x00,
  0x00,
  0x00,
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
  0x00, // meta full-box header
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
  0x65, // final ispe extends through EOF
  0x00,
  0x00,
  0x00,
  0x00,
  0x00,
  0x00,
  0x02,
  0x80, // width: 640
  0x00,
  0x00,
  0x01,
  0xe0, // height: 480
];

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
  test.each([
    ['an explicit final-box size', 12 as const],
    ['the valid size-zero through-EOF form', 0 as const],
  ])('keeps a valid JXL container working with %s', (_label, finalBoxSize) => {
    expect(imageSize(Uint8Array.from(validJxlContainer(finalBoxSize)))).toMatchObject({
      width: 8,
      height: 8,
      type: 'jxl',
    });
  });

  it('keeps a valid zero-sized final HEIF box working', () => {
    expect(imageSize(Uint8Array.from(validHeifWithZeroSizedFinalBox))).toMatchObject({
      width: 640,
      height: 480,
      type: 'heic',
    });
  });

  it('keeps ICNS file-path detection working beyond the 512 KiB read window', () => {
    const directory = mkdtempSync(join(tmpdir(), 'chathouse-image-size-'));
    const file = join(directory, 'large.icns');
    const fileLength = 600 * 1024;
    const input = Buffer.alloc(fileLength);
    input.write('icns', 0, 'ascii');
    input.writeUInt32BE(fileLength, 4);
    input.write('ic10', 8, 'ascii');
    input.writeUInt32BE(fileLength - 8, 12);
    // The target is a fixed filename inside the fresh test-only temp directory.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    writeFileSync(file, input);

    try {
      expect(imageSize(file)).toMatchObject({ width: 1024, height: 1024, type: 'ic10' });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

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
      /Reached end of input/,
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
