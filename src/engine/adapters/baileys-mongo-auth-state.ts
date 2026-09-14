import { AnyBulkWriteOperation, Collection, MongoClient } from 'mongodb';
import type * as BaileysLib from '@whiskeysockets/baileys';
import type {
  AuthenticationCreds,
  AuthenticationState,
  SignalDataSet,
  SignalDataTypeMap,
} from '@whiskeysockets/baileys';

interface AuthDocument {
  _id: string;
  sessionId: string;
  type: string;
  value: string;
  updatedAt: Date;
}

type AuthCollection = Pick<Collection<AuthDocument>, 'find' | 'bulkWrite' | 'replaceOne' | 'deleteMany' | 'findOne'>;

let clientPromise: Promise<MongoClient> | undefined;

function serialize(value: unknown, b: typeof BaileysLib): string {
  return JSON.stringify(value, b.BufferJSON.replacer);
}

function deserialize<T>(value: string, b: typeof BaileysLib): T {
  return JSON.parse(value, b.BufferJSON.reviver) as T;
}

function documentId(sessionId: string, type: string, id: string): string {
  return JSON.stringify([sessionId, type, id]);
}

async function mongoCollection(): Promise<Collection<AuthDocument>> {
  const uri = process.env.MONGODB_URI?.trim();
  if (!uri) throw new Error('MONGODB_URI is required when BAILEYS_AUTH_STORE=mongodb');
  clientPromise ??= new MongoClient(uri, { maxPoolSize: 5, serverSelectionTimeoutMS: 10_000 }).connect();
  const client = await clientPromise;
  return client
    .db(process.env.MONGODB_DATABASE?.trim() || 'openwa')
    .collection<AuthDocument>(process.env.MONGODB_AUTH_COLLECTION?.trim() || 'baileys_auth');
}

/** Mongo-backed Baileys auth state. Values use Baileys' own BufferJSON codec so keys round-trip exactly. */
export async function createMongoAuthState(
  sessionId: string,
  b: typeof BaileysLib,
  collection: AuthCollection,
): Promise<{ state: AuthenticationState; saveCreds: () => Promise<void> }> {
  const credsId = documentId(sessionId, 'creds', 'creds');
  const storedCreds = await collection.findOne({ _id: credsId });
  const creds = storedCreds ? deserialize<AuthenticationCreds>(storedCreds.value, b) : b.initAuthCreds();

  const state: AuthenticationState = {
    creds,
    keys: {
      get: async <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => {
        const documents = await collection
          .find({ _id: { $in: ids.map(id => documentId(sessionId, type, id)) } })
          .toArray();
        const byId = new Map(documents.map(document => [document._id, document.value]));
        const result: { [id: string]: SignalDataTypeMap[T] } = {};
        for (const id of ids) {
          const encoded = byId.get(documentId(sessionId, type, id));
          if (!encoded) continue;
          let value = deserialize<SignalDataTypeMap[T]>(encoded, b);
          if (type === 'app-state-sync-key') {
            value = b.proto.Message.AppStateSyncKeyData.fromObject(
              value as unknown as Record<string, unknown>,
            ) as unknown as SignalDataTypeMap[T];
          }
          result[id] = value;
        }
        return result;
      },
      set: async (data: SignalDataSet) => {
        const operations: AnyBulkWriteOperation<AuthDocument>[] = [];
        for (const [type, entries] of Object.entries(data)) {
          for (const [id, value] of Object.entries(entries ?? {})) {
            const _id = documentId(sessionId, type, id);
            operations.push(
              value == null
                ? { deleteOne: { filter: { _id } } }
                : {
                    replaceOne: {
                      filter: { _id },
                      replacement: { sessionId, type, value: serialize(value, b), updatedAt: new Date() },
                      upsert: true,
                    },
                  },
            );
          }
        }
        if (operations.length) await collection.bulkWrite(operations, { ordered: false });
      },
    },
  };

  return {
    state,
    saveCreds: async () => {
      await collection.replaceOne(
        { _id: credsId },
        { sessionId, type: 'creds', value: serialize(creds, b), updatedAt: new Date() },
        { upsert: true },
      );
    },
  };
}

export async function useMongoAuthState(
  sessionId: string,
  b: typeof BaileysLib,
): Promise<{ state: AuthenticationState; saveCreds: () => Promise<void> }> {
  return createMongoAuthState(sessionId, b, await mongoCollection());
}

export async function clearMongoAuthState(sessionId: string): Promise<void> {
  await (await mongoCollection()).deleteMany({ sessionId });
}
