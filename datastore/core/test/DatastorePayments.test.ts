import * as Fs from 'fs';
import * as Path from 'path';
import DatastorePackager from '@ulixee/datastore-packager';
import { CloudNode } from '@ulixee/cloud';
import Identity from '@ulixee/crypto/lib/Identity';
import DatastoreApiClient from '@ulixee/datastore/lib/DatastoreApiClient';
import { concatAsBuffer, encodeBuffer } from '@ulixee/commons/lib/bufferUtils';
import { sha256 } from '@ulixee/commons/lib/hashUtils';
import MicronoteBatchFunding from '@ulixee/sidechain/lib/MicronoteBatchFunding';
import ArgonUtils from '@ulixee/sidechain/lib/ArgonUtils';
import SidechainClient from '@ulixee/sidechain';
import ICoreRequestPayload from '@ulixee/net/interfaces/ICoreRequestPayload';
import { ISidechainApis } from '@ulixee/specification/sidechain';
import IMicronoteApis from '@ulixee/specification/sidechain/MicronoteApis';
import Address from '@ulixee/crypto/lib/Address';
import IMicronoteBatchApis from '@ulixee/specification/sidechain/MicronoteBatchApis';
import { IBlockSettings } from '@ulixee/specification';
import IDatastoreManifest from '@ulixee/platform-specification/types/IDatastoreManifest';
import ISidechainInfoApis from '@ulixee/specification/sidechain/SidechainInfoApis';
import UlixeeHostsConfig from '@ulixee/commons/config/hosts';
import CreditsStore from '@ulixee/datastore/lib/CreditsStore';
import cloneDatastore from '@ulixee/datastore/cli/cloneDatastore';
import moment = require('moment');
import DatastoreCore from '../index';
import DatastoreVm from '../lib/DatastoreVm';

const storageDir = Path.resolve(process.env.ULX_DATA_DIR ?? '.', 'DatastorePayments.test');

let cloudNode: CloudNode;
let client: DatastoreApiClient;
const sidechainIdentity = Identity.createSync();
const batchIdentity = Identity.createSync();
const clientIdentity = Identity.createSync();
const adminIdentity = Identity.createSync();
const batchSlug = 'ABCDEF12345125';

const address = Address.createFromSigningIdentities([clientIdentity]);

const apiCalls = jest.fn();
DatastoreCore.options.identityWithSidechain = Identity.createSync();
DatastoreCore.options.defaultSidechainHost = 'http://localhost:1337';
DatastoreCore.options.defaultSidechainRootIdentity = sidechainIdentity.bech32;
DatastoreCore.options.approvedSidechains = [
  { rootIdentity: sidechainIdentity.bech32, url: 'http://localhost:1337' },
];
CreditsStore.storePath = Path.join(storageDir, `credits.json`);
jest.spyOn<any, any>(CreditsStore, 'writeToDisk').mockImplementation(() => null);
jest.spyOn<any, any>(UlixeeHostsConfig.global, 'save').mockImplementation(() => null);

const mock = {
  sidechainClient: {
    sendRequest: jest.spyOn<any, any>(SidechainClient.prototype, 'sendRequest'),
  },
  MicronoteBatchFunding: {
    verifyBatch: jest.spyOn<any, any>(MicronoteBatchFunding.prototype, 'verifyBatch'),
    fundBatch: jest.spyOn(MicronoteBatchFunding.prototype, 'fundBatch'),
  },
};

beforeAll(async () => {
  if (Fs.existsSync(`${__dirname}/datastores/output-manifest.json`)) {
    Fs.unlinkSync(`${__dirname}/datastores/output-manifest.json`);
  }

  if (Fs.existsSync(`${__dirname}/datastores/output.dbx`)) {
    Fs.rmSync(`${__dirname}/datastores/output.dbx`, { recursive: true });
  }

  mock.MicronoteBatchFunding.fundBatch.mockImplementation(async function (batch, centagons) {
    return this.recordBatchFund(
      '1'.padEnd(30, '0'),
      ArgonUtils.centagonsToMicrogons(centagons),
      batch,
    );
  });

  mock.sidechainClient.sendRequest.mockImplementation(mockSidechainServer);

  cloudNode = new CloudNode();
  cloudNode.router.datastoreConfiguration = {
    datastoresDir: storageDir,
    datastoresTmpDir: Path.join(storageDir, 'tmp'),
  };
  await cloudNode.listen();
  client = new DatastoreApiClient(await cloudNode.address, { consoleLogErrors: true });
});

beforeEach(() => {
  mock.MicronoteBatchFunding.verifyBatch.mockClear();
  mock.MicronoteBatchFunding.fundBatch.mockClear();
  mock.sidechainClient.sendRequest.mockClear();
});

afterAll(async () => {
  await cloudNode.close();
  if (Fs.existsSync(storageDir)) Fs.rmSync(storageDir, { recursive: true });
});

test('should be able to run a datastore function with payments', async () => {
  apiCalls.mockClear();
  const packager = new DatastorePackager(`${__dirname}/datastores/output.js`);
  await Fs.writeFileSync(
    `${__dirname}/datastores/output-manifest.json`,
    JSON.stringify({
      paymentAddress: encodeBuffer(sha256('payme123'), 'ar'),
      extractorsByName: {
        putout: {
          prices: [
            {
              perQuery: 1250,
            },
          ],
        },
      },
    } as Partial<IDatastoreManifest>),
  );

  const dbx = await packager.build();
  const manifest = packager.manifest;
  expect(manifest.extractorsByName.putout.prices[0].perQuery).toBe(1250);
  await client.upload(await dbx.tarGzip());

  await expect(client.query(manifest.versionHash, 'SELECT * FROM putout()')).rejects.toThrowError(
    'requires payment',
  );
  await expect(client.stream(manifest.versionHash, 'putout', {})).rejects.toThrowError(
    'requires payment',
  );
  const sidechainClient = new SidechainClient('http://localhost:1337', {
    identity: clientIdentity,
    address,
  });
  const settings = await sidechainClient.getSettings(false);
  expect(settings.settlementFeeMicrogons).toBe(5);
  apiCalls.mockClear();

  const meta = await client.getExtractorPricing(manifest.versionHash, 'putout');
  const payment = await sidechainClient.createMicroPayment({
    microgons: meta.minimumPrice,
    ...meta,
  });
  expect(payment.micronote.microgons).toBeGreaterThanOrEqual(1255);

  expect(apiCalls.mock.calls.map(x => x[0].command)).toEqual([
    // 'Sidechain.settings', should be cached
    'Sidechain.openBatches',
    'MicronoteBatch.findFund',
    'Micronote.create',
  ]);

  apiCalls.mockClear();
  await expect(
    client.query(manifest.versionHash, 'SELECT success FROM putout()', { payment }),
  ).resolves.toEqual({
    outputs: [{ success: true }],
    metadata: {
      microgons: 1255,
      bytes: expect.any(Number),
      milliseconds: expect.any(Number),
    },
    latestVersionHash: expect.any(String),
  });
  expect(apiCalls.mock.calls.map(x => x[0].command)).toEqual([
    // from DatastoreCore
    'Sidechain.settings',
    'Micronote.hold',
    'Micronote.settle',
  ]);
  // @ts-ignore
  const statsTracker = DatastoreCore.statsTracker;
  const entry = await statsTracker.getForDatastore(manifest);
  expect(entry.stats.queries).toBe(3);
  expect(entry.stats.errors).toBe(2);
  expect(entry.stats.maxPricePerQuery).toBe(1255);
  expect(entry.statsByEntityName.putout.queries).toBe(1);
  expect(entry.statsByEntityName.putout.maxPricePerQuery).toBe(1250);

  const streamed = client.stream(manifest.versionHash, 'putout', {}, { payment });
  await expect(streamed.resultMetadata).resolves.toEqual({
    metadata: {
      microgons: 1255,
      bytes: expect.any(Number),
      milliseconds: expect.any(Number),
    },
    latestVersionHash: expect.any(String),
  });
});

test('should be able run a Datastore with Credits', async () => {
  const packager = new DatastorePackager(`${__dirname}/datastores/output.js`);
  await Fs.writeFileSync(
    `${__dirname}/datastores/output-manifest.json`,
    JSON.stringify({
      paymentAddress: encodeBuffer(sha256('payme123'), 'ar'),
      extractorsByName: {
        putout: {
          prices: [{ perQuery: 1000 }],
        },
      },
      adminIdentities: [adminIdentity.bech32],
    } as Partial<IDatastoreManifest>),
  );

  const dbx = await packager.build();
  const manifest = packager.manifest;
  await client.upload(await dbx.tarGzip(), { identity: adminIdentity });

  await expect(
    client.query(manifest.versionHash, 'SELECT * FROM putout()', {}),
  ).rejects.toThrowError('requires payment');

  const credits = await client.createCredits(manifest.versionHash, 1001, adminIdentity);
  expect(credits).toEqual({
    id: expect.any(String),
    remainingCredits: 1001,
    secret: expect.any(String),
  });

  await expect(
    client.query(manifest.versionHash, 'SELECT * FROM putout()', { payment: { credits } }),
  ).resolves.toEqual({
    outputs: [{ success: true }],
    metadata: {
      microgons: 1000,
      bytes: expect.any(Number),
      milliseconds: expect.any(Number),
    },
    latestVersionHash: manifest.versionHash,
  });

  await expect(client.getCreditsBalance(manifest.versionHash, credits.id)).resolves.toEqual({
    balance: 1,
    issuedCredits: 1001,
  });

  await expect(
    client.query(manifest.versionHash, 'SELECT * FROM putout()', { payment: { credits } }),
  ).rejects.toThrowError('insufficient balance');
});

test('should remove an empty Credits from the local cache', async () => {
  const packager = new DatastorePackager(`${__dirname}/datastores/output.js`);
  await Fs.writeFileSync(
    `${__dirname}/datastores/output-manifest.json`,
    JSON.stringify({
      extractorsByName: {
        putout: {
          prices: [{ perQuery: 1250 }],
        },
      },
      paymentAddress: encodeBuffer(sha256('payme123'), 'ar'),
      adminIdentities: [adminIdentity.bech32],
    } as Partial<IDatastoreManifest>),
  );

  const dbx = await packager.build();
  const manifest = packager.manifest;
  await client.upload(await dbx.tarGzip(), { identity: adminIdentity });
  const credits = await client.createCredits(manifest.versionHash, 1250, adminIdentity);
  await CreditsStore.store(manifest.versionHash, client.connectionToCore.transport.host, credits);
  await expect(CreditsStore.getPayment(manifest.versionHash, 1250)).resolves.toBeTruthy();
  await expect(CreditsStore.getPayment(manifest.versionHash, 1)).resolves.toBeUndefined();
});

test('should be able to embed Credits in a Datastore', async () => {
  const packager = new DatastorePackager(`${__dirname}/datastores/output.js`);
  await Fs.writeFileSync(
    `${__dirname}/datastores/output-manifest.json`,
    JSON.stringify({
      paymentAddress: encodeBuffer(sha256('payme123'), 'ar'),
      extractorsByName: {
        putout: {
          prices: [{ perQuery: 1000 }],
        },
      },
      adminIdentities: [adminIdentity.bech32],
    } as Partial<IDatastoreManifest>),
  );

  const dbx = await packager.build();
  const manifest = packager.manifest;
  await client.upload(await dbx.tarGzip(), { identity: adminIdentity });
  const credits = await client.createCredits(manifest.versionHash, 2001, adminIdentity);

  await expect(
    client.stream(manifest.versionHash, 'putout', {}, { payment: { credits } }),
  ).resolves.toEqual([{ success: true }]);

  await expect(client.getCreditsBalance(manifest.versionHash, credits.id)).resolves.toEqual({
    balance: 1001,
    issuedCredits: 2001,
  });

  await cloneDatastore(
    `ulx://${await cloudNode.address}/${manifest.versionHash}`,
    `${__dirname}/datastores/clone-output`,
    { embedCredits: credits },
  );
  await Fs.writeFileSync(
    `${__dirname}/datastores/clone-output/datastore-manifest.json`,
    JSON.stringify({
      paymentAddress: encodeBuffer(sha256('payme123'), 'ar'),
      extractorsByName: {
        putout: {
          prices: [{ perQuery: 1000 }],
        },
      },
      adminIdentities: [adminIdentity.bech32],
    } as Partial<IDatastoreManifest>),
  );

  {
    const packager2 = new DatastorePackager(`${__dirname}/datastores/clone-output/datastore.ts`);
    const dbx2 = await packager2.build();
    const manifest2 = packager2.manifest;
    await client.upload(await dbx2.tarGzip(), { identity: adminIdentity });
    const credits2 = await client.createCredits(manifest2.versionHash, 1002, adminIdentity);

    await expect(
      client.stream(manifest2.versionHash, 'putout', {}, { payment: { credits: credits2 } }),
    ).resolves.toEqual([{ success: true }]);

    await expect(client.getCreditsBalance(manifest.versionHash, credits.id)).resolves.toEqual({
      balance: 1,
      issuedCredits: 2001,
    });
    await expect(client.getCreditsBalance(manifest2.versionHash, credits2.id)).resolves.toEqual({
      balance: 2,
      issuedCredits: 1002,
    });
  }

  // @ts-expect-error
  expect(DatastoreCore.vm.apiClientCache.apiClientCacheByUrl).toEqual({
    [`ulx://${await cloudNode.address}`]: expect.any(DatastoreApiClient),
  });
}, 60e3);

async function mockSidechainServer(message: ICoreRequestPayload<ISidechainApis, any>) {
  const { command, args } = message;
  apiCalls(message);

  if (command === 'Sidechain.settings') {
    return {
      // built to handle more than one key if we need to rotate one out
      rootIdentities: [sidechainIdentity.bech32],
      identityProofSignatures: [
        sidechainIdentity.sign(sha256(concatAsBuffer(command, (args as any)?.identity))),
      ],
      latestBlockSettings: {
        height: 0,
        sidechains: [{ rootIdentity: sidechainIdentity.bech32, url: 'http://localhost:1337' }],
      } as IBlockSettings,
      batchDurationMinutes: 60 * 60e3 * 8,
      settlementFeeMicrogons: 5,
      version: '1.0.0',
    } as ISidechainInfoApis['Sidechain.settings']['result'];
  }
  if (command === 'Micronote.hold') {
    return {
      accepted: true,
      holdId: '1234'.padEnd(30, '0'),
    } as IMicronoteApis['Micronote.hold']['result'];
  }
  if (command === 'Micronote.settle') {
    const payments = Object.values(
      (args as IMicronoteApis['Micronote.settle']['args']).tokenAllocation,
    ).reduce((x, t) => x + t, 0);
    return { finalCost: payments + 5 } as IMicronoteApis['Micronote.settle']['result'];
  }
  if (command === 'MicronoteBatch.findFund') {
    return {};
  }
  if (command === 'Sidechain.openBatches') {
    return {
      micronote: [
        {
          batchSlug,
          stopNewNotesTime: moment().add(1, 'hour').toDate(),
          micronoteBatchIdentity: batchIdentity.bech32,
          sidechainIdentity: sidechainIdentity.bech32,
          sidechainValidationSignature: sidechainIdentity.sign(sha256(batchIdentity.bech32)),
        },
      ],
    } as ISidechainInfoApis['Sidechain.openBatches']['result'];
  }
  if (command === 'Micronote.create') {
    const id = encodeBuffer(sha256('micronoteId'), 'mcr');
    const mcrBatchSlug = (args as any).batchSlug;
    return {
      batchSlug: mcrBatchSlug,
      id,
      blockHeight: 0,
      guaranteeBlockHeight: 0,
      fundsId: '1'.padEnd(30, '0'),
      fundMicrogonsRemaining: 5000,
      micronoteSignature: batchIdentity.sign(sha256(concatAsBuffer(id, args.microgons))),
    } as IMicronoteApis['Micronote.create']['result'];
  }

  if (command === 'MicronoteBatch.activeFunds') {
    return [] as IMicronoteBatchApis['MicronoteBatch.activeFunds']['result'];
  }
  throw new Error(`unknown request ${command}`);
}
