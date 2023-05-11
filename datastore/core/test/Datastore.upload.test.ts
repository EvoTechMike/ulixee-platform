import * as Fs from 'fs';
import * as Path from 'path';
import DatastorePackager from '@ulixee/datastore-packager';
import { CloudNode } from '@ulixee/cloud';
import IDatastoreManifest from '@ulixee/platform-specification/types/IDatastoreManifest';
import Identity from '@ulixee/crypto/lib/Identity';
import DatastoreApiClient from '@ulixee/datastore/lib/DatastoreApiClient';
import UlixeeHostsConfig from '@ulixee/commons/config/hosts';
import DatastoreCore from '../index';

const storageDir = Path.resolve(process.env.ULX_DATA_DIR ?? '.', 'Datastore.upload.test');

let dbxFile: Buffer;
let manifest: IDatastoreManifest;
let cloudNode: CloudNode;
let client: DatastoreApiClient;

beforeAll(async () => {
  jest.spyOn<any, any>(UlixeeHostsConfig.global, 'save').mockImplementation(() => null);
  const packager = new DatastorePackager(`${__dirname}/datastores/upload.js`);
  await packager.build();
  dbxFile = await packager.dbx.tarGzip();
  manifest = packager.manifest.toJSON();
  cloudNode = new CloudNode();
  cloudNode.router.datastoreConfiguration = {
    datastoresDir: storageDir,
    datastoresTmpDir: Path.join(storageDir, 'tmp'),
  };
  await cloudNode.listen();
  client = new DatastoreApiClient(await cloudNode.address);
});

afterAll(async () => {
  await cloudNode?.close();
  if (Fs.existsSync(storageDir)) {
    if (Fs.existsSync(storageDir)) Fs.rmSync(storageDir, { recursive: true });
  }
});

test('should be able upload a datastore', async () => {
  try {
    await client.upload(dbxFile);
    expect(Fs.existsSync(storageDir)).toBeTruthy();
    expect(manifest.schemaInterface).toBe(`{
  tables: {};
  extractors: {
    upTest: {
      output: {
        /**
         * Whether or not this test succeeded
         */
        upload: boolean;
      };
    };
  };
  crawlers: {};
}`);
    expect(Fs.existsSync(`${storageDir}/upload@${manifest.versionHash}.dbx`)).toBeTruthy();
  } catch (error) {
    console.log('TEST ERROR: ', error);
    throw error;
  }
});

test('should be able to restrict uploads', async () => {
  const identity = await Identity.create();
  DatastoreCore.options.cloudAdminIdentities = [identity.bech32];

  await expect(client.upload(dbxFile)).rejects.toThrowError('valid AdminIdentity signature');
  await expect(client.upload(dbxFile, { identity })).resolves.toBeTruthy();
});

test('should be able to download dbx files', async () => {
  const identity = await Identity.create();
  DatastoreCore.options.cloudAdminIdentities = [identity.bech32];

  await expect(client.download(manifest.versionHash)).rejects.toThrowError(
    'Admin Identity does not have permissions',
  );
  await expect(client.download(manifest.versionHash, { identity })).resolves.toBeTruthy();
});
