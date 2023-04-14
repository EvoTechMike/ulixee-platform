import * as Fs from 'fs';
import * as Path from 'path';
import { CloudNode } from '@ulixee/cloud';
import { ConnectionToDatastoreCore } from '@ulixee/datastore';
import Client from '..';
import localDatastore from './datastores/localDatastore';

const storageDir = Path.resolve(process.env.ULX_DATA_DIR ?? '.', 'Client.localDatastore.test');
let cloudNode: CloudNode;
let connectionToCore: ConnectionToDatastoreCore;

beforeAll(async () => {
  cloudNode = new CloudNode();
  cloudNode.router.datastoreConfiguration = {
    datastoresDir: storageDir,
    datastoresTmpDir: Path.join(storageDir, 'tmp'),
  };
  await cloudNode.listen();
  connectionToCore = ConnectionToDatastoreCore.remote(await cloudNode.address);
});

afterAll(async () => {
  await cloudNode.close();
  await connectionToCore.disconnect();
  if (Fs.existsSync(storageDir)) Fs.rmSync(storageDir, { recursive: true });
});

test('should be able to query a datastore using sql', async () => {
  const client = Client.forDatastore(localDatastore, { connectionToCore });
  const results = await client.query(
    'SELECT * FROM test(shouldTest => $1) LEFT JOIN testers on testers.lastName=test.lastName',
    [true],
  );

  expect(results).toEqual([
    {
      testerEcho: true,
      lastName: 'Clark',
      greeting: 'Hello world',
      firstName: 'Caleb',
      isTester: true,
    },
  ]);
});

test('should be able to run a datastore extractor', async () => {
  const client = Client.forDatastore(localDatastore, { connectionToCore });

  // @ts-expect-error - must be a valid function
  await expect(() => client.run('test1', {})).toThrowError();
  // @ts-expect-error
  await expect(client.run('test', { notValid: 1 })).rejects.toThrow('Extractor input');

  const results = await client.run('test', { shouldTest: true });
  expect(results).toEqual([
    {
      testerEcho: true,
      lastName: 'Clark',
      greeting: 'Hello world',
    },
  ]);

  // @ts-expect-error - Test typing works
  const test: number = results[0].testerEcho;
  expect(test).not.toBe(expect.any(Number));

  // @ts-expect-error
  const first = results[0].firstName;
  expect(first).toBeUndefined();
});
