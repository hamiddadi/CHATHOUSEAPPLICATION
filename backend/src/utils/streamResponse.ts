import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Response } from 'express';

const CLIENT_DISCONNECT_CODES = new Set([
  'ABORT_ERR',
  'ECONNRESET',
  'EPIPE',
  'ERR_STREAM_DESTROYED',
  'ERR_STREAM_PREMATURE_CLOSE',
]);

/**
 * Advances a generator once before response headers are committed, then puts
 * the consumed chunk back in front of the remaining stream. Producers can use
 * that first advance for bounded database preflight work, so setup failures
 * still reach the regular JSON error middleware.
 */
export const preflightResponseChunks = async (
  chunks: AsyncGenerator<string>,
): Promise<AsyncGenerator<string>> => {
  const first = await chunks.next();

  return (async function* () {
    if (!first.done) yield first.value;
    yield* chunks;
  })();
};

/**
 * Pipes lazily-produced UTF-8 chunks to an HTTP response. Node's pipeline
 * applies backpressure, so a slow or abandoned download never forces the
 * producer to materialise the remaining archive in memory.
 */
export const streamResponseChunks = async (
  res: Response,
  chunks: AsyncIterable<string> | Iterable<string>,
): Promise<void> => {
  try {
    await pipeline(Readable.from(chunks, { encoding: 'utf8' }), res);
  } catch (error) {
    // A client closing a download is expected. Once the response is destroyed
    // there is no useful error payload left to send and pipeline has already
    // cancelled the async iterator.
    const code = (error as NodeJS.ErrnoException).code;
    if (res.destroyed && (res.req?.aborted || (code && CLIENT_DISCONNECT_CODES.has(code)))) return;
    throw error;
  }
};
