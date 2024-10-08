import { decodeAddress } from '@polkadot/util-crypto';
import Client from '@ulixee/client';
import { Helpers } from '@ulixee/datastore-testing';
import DatastoreApiClients from '@ulixee/datastore/lib/DatastoreApiClients';
import DefaultPaymentService from '@ulixee/datastore/payments/DefaultPaymentService';
import LocalchainWithSync from '@ulixee/datastore/payments/LocalchainWithSync';
import { DataDomainStore, Localchain } from '@argonprotocol/localchain';
import { getClient, Keyring, KeyringPair } from '@argonprotocol/mainchain';
import { IDatastoreMetadataResult } from '@ulixee/platform-specification/datastore/DatastoreApis';
import { gettersToObject } from '@ulixee/platform-utils/lib/objectUtils';
import * as Path from 'node:path';
import { inspect } from 'util';
import TestCloudNode, { uploadDatastore } from '../lib/TestCloudNode';
import { describeIntegration } from '../lib/testHelpers';
import TestMainchain, { activateNotary, registerZoneRecord } from '../lib/TestMainchain';
import TestNotary from '../lib/TestNotary';
import { execAndLog, getPlatformBuild } from '../lib/utils';

afterEach(Helpers.afterEach);
afterAll(Helpers.afterAll);
const storageDir = Path.resolve(process.env.ULX_DATA_DIR ?? '.', 'e2e.payments.test');

let mainchainUrl: string;
const identityPath = Path.join(storageDir, 'DatastoreDev.pem');

let ferdie: KeyringPair;
inspect.defaultOptions.depth = 10;

describeIntegration('Payments E2E', () => {
  beforeAll(async () => {
    const mainchain = new TestMainchain();
    mainchainUrl = await mainchain.launch();
    const notary = new TestNotary();
    await notary.start(mainchainUrl);

    ferdie = new Keyring({ type: 'sr25519' }).createFromUri('//Ferdie');
    const sudo = new Keyring({ type: 'sr25519' }).createFromUri('//Alice');
    const mainchainClient = await getClient(mainchainUrl);

    await activateNotary(sudo, mainchainClient, notary);
    await mainchainClient.disconnect();

    execAndLog(`npx @ulixee/datastore admin-identity create --filename="${identityPath}"`);

    execAndLog(
      `npx @argonprotocol/localchain accounts create --name=bobchain --suri="//Bob" --scheme=sr25519 --base-dir="${storageDir}"`,
    );
  }, 60e3);

  test('it can do end to end payments flow for a domain datastore', async () => {
    const buildDir = getPlatformBuild();

    const mainchainClient = await getClient(mainchainUrl);
    Helpers.onClose(() => mainchainClient.disconnect());

    const bobchain = await LocalchainWithSync.load({
      localchainPath: Path.join(storageDir, 'bobchain.db'),
      mainchainUrl,
      automaticallyRunSync: false,
      escrowAllocationStrategy: {
        type: 'multiplier',
        queries: 2,
      },
    });

    execAndLog(
      `npx @argonprotocol/localchain accounts create --name=ferdiechain --suri="//Ferdie" --scheme=sr25519 --base-dir="${storageDir}"`,
    );
    const ferdiechain = await Localchain.load({
      mainchainUrl,
      path: Path.join(storageDir, 'ferdiechain.db'),
    });
    Helpers.onClose(() => ferdiechain.close());

    const ferdieVotesAddress = ferdie.derive('//votes').address;

    const domain = 'e2e.communication';
    // Hangs with the proxy url. Not sure why
    if (!process.env.ULX_USE_DOCKER_BINS) {
      const isDomainRegistered = execAndLog(
        `npx @argonprotocol/localchain data-domains check ${domain} -m "${mainchainUrl}"`,
      );
      expect(isDomainRegistered).toContain(' No ');
      console.log('Domain registered?', isDomainRegistered);
    }
    const dataDomainHash = DataDomainStore.getHash(domain);
    await Promise.all([
      ferdiechain.mainchainTransfers.sendToLocalchain(1000n, 1),
      bobchain.mainchainTransfers.sendToLocalchain(5000n, 1),
    ]);

    let isSynched = false;
    while (!isSynched) {
      await ferdiechain.balanceSync.sync({});
      await bobchain.balanceSync.sync({});
      const ferdieOverview = await ferdiechain.accountOverview();
      const bobOverview = await bobchain.getAccountOverview();
      isSynched = ferdieOverview.balance === 1000n && bobOverview.balance === 5000n;
      await new Promise(resolve =>
        setTimeout(resolve, Number(ferdiechain.ticker.millisToNextTick())),
      );
    }

    {
      const ferdieChange = ferdiechain.beginChange();
      await ferdieChange.leaseDataDomain(domain, await ferdiechain.address);
      await ferdieChange.notarizeAndWaitForNotebook();
    }

    const identityBech32 = execAndLog(
      `npx @ulixee/datastore admin-identity read --filename="${identityPath}"`,
    )
      .split(/\r?\n/)
      .shift()
      .trim();
    expect(identityBech32).toContain('id1');
    const cloudNode = new TestCloudNode(buildDir);
    const cloudAddress = await cloudNode.start({
      ULX_CLOUD_ADMIN_IDENTITIES: identityBech32,
      ULX_IDENTITY_PATH: identityPath,
      ULX_MAINCHAIN_URL: mainchainUrl,
      ULX_LOCALCHAIN_PATH: ferdiechain.path,
      ULX_VOTES_ADDRESS: ferdieVotesAddress,
      ULX_NOTARY_ID: '1',
    });
    expect(cloudAddress).toBeTruthy();
    Helpers.onClose(() => cloudNode.close());

    const datastoreId = 'end-to-end';
    const datastoreVersion = '0.0.1';
    await uploadDatastore(
      datastoreId,
      buildDir,
      cloudAddress,
      {
        domain,
        payment: {
          notaryId: 1,
          address: ferdie.address,
        },
      },
      identityPath,
    );

    await registerZoneRecord(
      mainchainClient,
      dataDomainHash,
      ferdie,
      decodeAddress(ferdie.address, false, 42),
      1,
      {
        [datastoreVersion]: mainchainClient.createType('ArgonPrimitivesDataDomainVersionHost', {
          datastoreId: mainchainClient.createType('Bytes', datastoreId),
          host: mainchainClient.createType('Bytes', `ws://127.0.0.1:${cloudAddress.split(':')[1]}`),
        }),
      },
    );

    const datastoreApiClients = new DatastoreApiClients();
    Helpers.onClose(() => datastoreApiClients.close());
    const paymentService = await bobchain.createPaymentService(datastoreApiClients);

    const payments: DefaultPaymentService['EventTypes']['reserved'][] = [];
    const escrows: DefaultPaymentService['EventTypes']['createdEscrow'][] = [];
    paymentService.on('reserved', payment => payments.push(payment));
    paymentService.on('createdEscrow', e => escrows.push(e));
    Helpers.onClose(() => paymentService.close());
    let metadata: IDatastoreMetadataResult;
    const client = new Client(`ulx://${domain}/@v${datastoreVersion}`, {
      paymentService,
      mainchainUrl,
      onQueryResult(result) {
        metadata = result.metadata;
      },
    });
    Helpers.needsClosing.push({ close: () => client.disconnect(), onlyCloseOnFinal: false });

    const result = await client.query('SELECT * FROM default(test => $1)', [1]);

    expect(result).toEqual([{ success: true, input: { test: 1 } }]);
    expect(metadata).toEqual(
      expect.objectContaining({
        microgons: 500_000,
        milliseconds: expect.any(Number),
        bytes: expect.any(Number),
      }),
    );

    expect(escrows).toHaveLength(1);
    expect(escrows[0].allocatedMilligons).toBe(1000n);
    expect(escrows[0].datastoreId).toBe(datastoreId);
    expect(payments).toHaveLength(1);
    expect(payments[0].payment.microgons).toBe(500_000);
    expect(payments[0].payment.escrow).toBeTruthy();
    expect(payments[0].payment.escrow.settledMilligons).toBe(500n);
    expect(payments[0].remainingBalance).toBe(500_000);

    const balance = await bobchain.getAccountOverview();
    console.log('Balance:', await gettersToObject(balance));
    expect(balance.balance).toBe(4800n);
    expect(balance.heldBalance).toBe(1000n);
  }, 300e3);

  test('it can do end to end payments with no domain', async () => {
    const buildDir = getPlatformBuild();

    const identityBech32 = execAndLog(
      `npx @ulixee/datastore admin-identity read --filename="${identityPath}"`,
    )
      .split(/\r?\n/)
      .shift()
      .trim();
    expect(identityBech32).toContain('id1');

    const cloudNode = new TestCloudNode(buildDir);
    Helpers.onClose(() => cloudNode.close());
    const cloudAddress = await cloudNode.start({
      ULX_CLOUD_ADMIN_IDENTITIES: identityBech32.trim(),
      ULX_IDENTITY_PATH: identityPath,
      ULX_MAINCHAIN_URL: mainchainUrl,
      ULX_LOCALCHAIN_PATH: Path.join(storageDir, 'ferdiechain.db'),
      ULX_NOTARY_ID: '1',
    });
    expect(cloudAddress).toBeTruthy();

    await uploadDatastore(
      'no-domain',
      buildDir,
      cloudAddress,
      {
        version: '0.0.2',
        payment: {
          notaryId: 1,
          address: ferdie.address,
        },
      },
      identityPath,
    );

    const bobchain = await LocalchainWithSync.load({
      localchainPath: Path.join(storageDir, 'bobchain.db'),
      mainchainUrl,
      escrowAllocationStrategy: {
        type: 'multiplier',
        queries: 2,
      },
    });
    Helpers.onClose(() => bobchain.close());
    const wallet = await bobchain.getAccountOverview();
    // ensure wallet is loaded
    expect(wallet.balance).toBe(4800n);

    const paymentService = await bobchain.createPaymentService(new DatastoreApiClients());
    const payments: DefaultPaymentService['EventTypes']['reserved'][] = [];
    const escrows: DefaultPaymentService['EventTypes']['createdEscrow'][] = [];
    paymentService.on('reserved', payment => payments.push(payment));
    paymentService.on('createdEscrow', e => escrows.push(e));
    let metadata: IDatastoreMetadataResult;
    const client = new Client(`ulx://${cloudAddress}/no-domain@v0.0.2`, {
      paymentService,
      mainchainUrl,
      onQueryResult(result) {
        metadata = result.metadata;
      },
    });
    Helpers.onClose(() => client.disconnect());

    const result = await client.query('SELECT * FROM nod()');

    expect(result).toEqual([{ noDomain: true }]);
    expect(metadata).toEqual(
      expect.objectContaining({
        microgons: 1_000,
        milliseconds: expect.any(Number),
        bytes: expect.any(Number),
      }),
    );
    expect(escrows).toHaveLength(1);
    expect(escrows[0].allocatedMilligons).toBe(5n);
    expect(escrows[0].datastoreId).toBe('no-domain');
    expect(payments).toHaveLength(1);
    expect(payments[0].payment.microgons).toBe(1000);
    expect(payments[0].payment.escrow).toBeTruthy();
    expect(payments[0].payment.escrow.settledMilligons).toBe(5n);
    expect(payments[0].remainingBalance).toBe(5_000 - 1_000);

    const balance = await bobchain.getAccountOverview();
    console.log('Balance:', await gettersToObject(balance));
    expect(balance.balance).toBe(4798n);
    expect(balance.heldBalance).toBe(1005n);
  });
});
