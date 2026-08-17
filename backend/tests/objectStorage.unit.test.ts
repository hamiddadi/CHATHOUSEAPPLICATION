export {};

/* eslint-disable @typescript-eslint/no-require-imports */
const { privateObjectStore } =
  require('../src/modules/media/object-storage') as typeof import('../src/modules/media/object-storage');
/* eslint-enable @typescript-eslint/no-require-imports */

const rand = () => Math.random().toString(36).slice(2, 10);

const readAll = async (key: string): Promise<Buffer> => {
  const opened = await privateObjectStore.open(key);
  const chunks: Buffer[] = [];
  for await (const chunk of opened.body) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
};

describe('Local private object storage', () => {
  const keys: string[] = [];

  afterAll(async () => {
    await Promise.all(keys.map(key => privateObjectStore.delete(key)));
  });

  it('publishes concurrent same-key retries as one complete atomic object', async () => {
    const key = `storage-test/voice/${rand()}.wav`;
    keys.push(key);
    const body = Buffer.alloc(512 * 1024, 0x5a);

    await Promise.all(
      Array.from({ length: 8 }, () => privateObjectStore.put(key, body, 'audio/wav')),
    );

    await expect(readAll(key)).resolves.toEqual(body);
  });

  it('repairs a legacy partial target through a complete-file replacement', async () => {
    const key = `storage-test/avatar/${rand()}.png`;
    keys.push(key);
    const complete = Buffer.alloc(128 * 1024, 0x7f);
    await privateObjectStore.put(key, Buffer.from('partial'), 'image/png');

    await privateObjectStore.put(key, complete, 'image/png');

    await expect(readAll(key)).resolves.toEqual(complete);
  });
});
