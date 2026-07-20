import { createReadStream } from 'node:fs';
import { mkdir, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { env } from '../../config/env';

export interface ByteRange {
  start: number;
  end: number;
}

export interface OpenedPrivateObject {
  body: Readable;
  contentLength: number;
  contentRange?: string;
}

interface PrivateObjectStore {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  open(key: string, range?: ByteRange): Promise<OpenedPrivateObject>;
  delete(key: string): Promise<void>;
}

const LOCAL_ROOT = path.resolve(process.cwd(), 'private-media');

const resolveLocalKey = (key: string): string => {
  const target = path.resolve(LOCAL_ROOT, ...key.split('/'));
  const rootPrefix = `${LOCAL_ROOT}${path.sep}`;
  if (!target.startsWith(rootPrefix)) {
    throw new Error('Invalid private-media storage key');
  }
  return target;
};

const localStore: PrivateObjectStore = {
  async put(key, body): Promise<void> {
    const target = resolveLocalKey(key);
    // resolveLocalKey enforces containment in the non-public LOCAL_ROOT.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    await mkdir(path.dirname(target), { recursive: true });
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    await writeFile(target, body, { flag: 'wx' });
  },

  async open(key, range): Promise<OpenedPrivateObject> {
    const target = resolveLocalKey(key);
    // resolveLocalKey rejects traversal and absolute-path injection.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const info = await stat(target);
    const start = range?.start ?? 0;
    const end = range?.end ?? info.size - 1;
    const contentLength = end - start + 1;

    return {
      // The key is generated server-side and resolveLocalKey verifies that the
      // resolved path cannot escape LOCAL_ROOT.
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      body: createReadStream(target, range ? { start, end } : undefined),
      contentLength,
      ...(range ? { contentRange: `bytes ${start}-${end}/${info.size}` } : {}),
    };
  },

  async delete(key): Promise<void> {
    const target = resolveLocalKey(key);
    try {
      // resolveLocalKey rejects traversal and absolute-path injection.
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      await unlink(target);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  },
};

let s3Client: S3Client | null = null;

const getS3Client = (): S3Client => {
  if (s3Client) return s3Client;

  const credentials =
    env.MEDIA_S3_ACCESS_KEY && env.MEDIA_S3_SECRET_KEY
      ? {
          accessKeyId: env.MEDIA_S3_ACCESS_KEY,
          secretAccessKey: env.MEDIA_S3_SECRET_KEY,
        }
      : undefined;

  s3Client = new S3Client({
    region: env.MEDIA_S3_REGION,
    forcePathStyle: env.MEDIA_S3_FORCE_PATH_STYLE,
    ...(env.MEDIA_S3_ENDPOINT ? { endpoint: env.MEDIA_S3_ENDPOINT } : {}),
    ...(credentials ? { credentials } : {}),
  });
  return s3Client;
};

const s3Store: PrivateObjectStore = {
  async put(key, body, contentType): Promise<void> {
    await getS3Client().send(
      new PutObjectCommand({
        Bucket: env.MEDIA_S3_BUCKET,
        Key: key,
        Body: body,
        ContentType: contentType,
        CacheControl: 'private, max-age=300',
      }),
    );
  },

  async open(key, range): Promise<OpenedPrivateObject> {
    const requestedRange = range ? `bytes=${range.start}-${range.end}` : undefined;
    const output = await getS3Client().send(
      new GetObjectCommand({
        Bucket: env.MEDIA_S3_BUCKET,
        Key: key,
        ...(requestedRange ? { Range: requestedRange } : {}),
      }),
    );

    if (!(output.Body instanceof Readable)) {
      throw new Error('S3 returned a non-streaming media body');
    }

    const expectedLength = range ? range.end - range.start + 1 : output.ContentLength;
    if (expectedLength === undefined) {
      throw new Error('S3 response is missing Content-Length');
    }

    return {
      body: output.Body,
      contentLength: expectedLength,
      ...(output.ContentRange ? { contentRange: output.ContentRange } : {}),
    };
  },

  async delete(key): Promise<void> {
    await getS3Client().send(
      new DeleteObjectCommand({
        Bucket: env.MEDIA_S3_BUCKET,
        Key: key,
      }),
    );
  },
};

export const privateObjectStore: PrivateObjectStore =
  env.MEDIA_STORAGE_DRIVER === 's3' ? s3Store : localStore;
