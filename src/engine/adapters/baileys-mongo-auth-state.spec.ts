import * as baileys from '@whiskeysockets/baileys';
import { createMongoAuthState } from './baileys-mongo-auth-state';

describe('Mongo-backed Baileys auth state', () => {
  it('round-trips credentials and binary keys, then deletes removed keys', async () => {
    const documents = new Map<string, Record<string, unknown>>();
    const collection = {
      findOne: ({ _id }: { _id: string }) => Promise.resolve(documents.get(_id) ?? null),
      find: ({ _id }: { _id: { $in: string[] } }) => ({
        toArray: () => Promise.resolve(_id.$in.flatMap(id => (documents.has(id) ? [documents.get(id)] : []))),
      }),
      replaceOne: ({ _id }: { _id: string }, replacement: Record<string, unknown>) => {
        documents.set(_id, { _id, ...replacement });
        return Promise.resolve();
      },
      bulkWrite: (operations: Array<Record<string, Record<string, unknown>>>) => {
        for (const operation of operations) {
          if (operation.deleteOne) {
            documents.delete((operation.deleteOne.filter as { _id: string })._id);
          } else {
            const replacement = operation.replaceOne;
            const _id = (replacement.filter as { _id: string })._id;
            documents.set(_id, { _id, ...(replacement.replacement as Record<string, unknown>) });
          }
        }
        return Promise.resolve();
      },
      deleteMany: () => Promise.resolve(),
    };

    const first = await createMongoAuthState('primary', baileys, collection as never);
    first.state.creds.registered = true;
    await first.saveCreds();
    await first.state.keys.set({ 'pre-key': { one: { private: Buffer.from([1]), public: Buffer.from([2]) } } });

    const restored = await createMongoAuthState('primary', baileys, collection as never);
    expect(restored.state.creds.registered).toBe(true);
    expect((await restored.state.keys.get('pre-key', ['one'])).one.private).toEqual(Buffer.from([1]));

    await restored.state.keys.set({ 'pre-key': { one: null } });
    expect(await restored.state.keys.get('pre-key', ['one'])).toEqual({});
  });
});
