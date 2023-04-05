import * as Fs from 'fs';
import * as Path from 'path';
import Axios from 'axios';
import DatastorePackager from '@ulixee/datastore-packager';
import { CloudNode } from '@ulixee/cloud';
import DatastoreApiClient from '@ulixee/datastore/lib/DatastoreApiClient';
import UlixeeHostsConfig from '@ulixee/commons/config/hosts';
import IDatastoreManifest from '@ulixee/platform-specification/types/IDatastoreManifest';
import * as Hostile from 'hostile';
import Identity from '@ulixee/crypto/lib/Identity';

const storageDir = Path.resolve(process.env.ULX_DATA_DIR ?? '.', 'Datastore.docpage.test');

let dbxFile: Buffer;
let cloudNode: CloudNode;
let manifest: IDatastoreManifest;
let client: DatastoreApiClient;
const adminIdentity = Identity.createSync();

beforeAll(async () => {
  jest.spyOn<any, any>(UlixeeHostsConfig.global, 'save').mockImplementation(() => null);

  if (Fs.existsSync(`${__dirname}/datastores/docpage.dbx.build`)) {
    Fs.rmSync(`${__dirname}/datastores/docpage.dbx.build`, { recursive: true });
  }
  if (process.env.CI !== 'true') Hostile.set('127.0.0.1', 'docs.datastoresrus.com');
  const packager = new DatastorePackager(`${__dirname}/datastores/docpage.js`);
  await packager.build();
  dbxFile = await packager.dbx.tarGzip();
  manifest = packager.manifest.toJSON();
  cloudNode = new CloudNode();
  cloudNode.router.datastoreConfiguration = {
    datastoresDir: storageDir,
    datastoresTmpDir: Path.join(storageDir, 'tmp'),
    cloudAdminIdentities: [adminIdentity.bech32],
  };
  await cloudNode.listen();
  client = new DatastoreApiClient(await cloudNode.address);
  await client.upload(dbxFile, { identity: adminIdentity });
});

afterAll(async () => {
  await cloudNode?.close();
  if (process.env.CI !== 'true') Hostile.remove('127.0.0.1', 'docs.datastoresrus.com');
  if (Fs.existsSync(storageDir)) {
    if (Fs.existsSync(storageDir)) Fs.rmSync(storageDir, { recursive: true });
  }
});

test('should be able to load datastore documentation', async () => {
  const address = await cloudNode.address;
  const res = await Axios.get(`http://${address}/${manifest.versionHash}`);
  expect(res.data.includes('<title>Ulixee</title>')).toBe(true);

  const config = await Axios.get(`http://${address}/${manifest.versionHash}/docpage.json`);
  expect(config.data.name).toBe('Docpage');
});

test('should be able to load datastore documentation with a credit hash', async () => {
  const address = await cloudNode.address;
  const res = await Axios.get(`http://${address}/${manifest.versionHash}?crd2342342`);
  expect(res.data.includes('<title>Ulixee</title>')).toBe(true);
  const config = await Axios.get(`http://${address}/${manifest.versionHash}/docpage.json`);
  expect(config.data.name).toBe('Docpage');
});

test('should be able to access documentation through a datastore domain', async () => {
  const port = await cloudNode.port;
  const res = await Axios.get(`http://docs.datastoresRus.com:${port}`);
  expect(res.data.includes('<title>Ulixee</title>')).toBe(true);
  const config = await Axios.get(`http://docs.datastoresRus.com:${port}/docpage.json`);
  expect(config.data.name).toBe('Docpage');
});

test('should be able to use a domain to get a credit balance', async () => {
  const port = await cloudNode.port;
  const credits = await client.createCredits(manifest.versionHash, 1002, adminIdentity);
  await expect(
    Axios.get(
      `http://docs.datastoresRus.com:${port}/free-credits?${credits.id}:${credits.secret}`,
      {
        responseType: 'json',
        headers: { accept: 'application/json' },
      },
    ).then(x => x.data),
  ).resolves.toEqual({
    balance: 1002,
    issuedCredits: 1002,
  });

  // can also use the full address
  await expect(
    Axios.get(
      `http://${await cloudNode.address}/${manifest.versionHash}/free-credits?${credits.id}:${
        credits.secret
      }`,
      { responseType: 'json', headers: { accept: 'application/json' } },
    ).then(x => x.data),
  ).resolves.toEqual({
    balance: 1002,
    issuedCredits: 1002,
  });
});

test('should be able to parse domain urls', async () => {
  const port = await cloudNode.port;
  const expectedOutput = {
    host: await cloudNode.address,
    datastoreVersionHash: manifest.versionHash,
  };
  await expect(
    DatastoreApiClient.resolveDatastoreDomain(`http://docs.datastoresRus.com:${port}`),
  ).resolves.toEqual(expectedOutput);

  await expect(
    DatastoreApiClient.resolveDatastoreDomain(
      `docs.datastoresRus.com:${port}/free-credit?crd2342342:234234333`,
    ),
  ).resolves.toEqual(expectedOutput);

  await expect(
    DatastoreApiClient.resolveDatastoreDomain(`${await cloudNode.address}/${manifest.versionHash}`),
  ).resolves.toEqual(expectedOutput);

  await expect(
    DatastoreApiClient.resolveDatastoreDomain(`localhost:52759/dbx1wwqx5h854eq6tq9ggl`),
  ).resolves.toEqual({
    host: 'localhost:52759',
    datastoreVersionHash: 'dbx1wwqx5h854eq6tq9ggl',
  });

  await expect(
    DatastoreApiClient.resolveDatastoreDomain(
      `ulx://${await cloudNode.address}/${manifest.versionHash}/free-credit/?crd2342342:234234333`,
    ),
  ).resolves.toEqual(expectedOutput);
});
