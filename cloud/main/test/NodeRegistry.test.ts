import { Helpers } from '@ulixee/datastore-testing';
import * as Path from 'path';

Helpers.blockGlobalConfigWrites();
const datastoresDir = Path.resolve(process.env.ULX_DATA_DIR ?? '.', 'NodeRegistry.test');

afterAll(Helpers.afterAll);
afterEach(Helpers.afterEach);

test('should dial the node registry on start', async () => {
  const node1 = await Helpers.createLocalNode({
    datastoreConfiguration: { datastoresDir: Path.join(datastoresDir, '1') },
    nodeRegistryHost: 'self',
    hostedServicesServerOptions: { port: 0 },
  });
  const node2 = await Helpers.createLocalNode({
    datastoreConfiguration: { datastoresDir: Path.join(datastoresDir, '2') },
    servicesSetupHost: await node1.hostedServicesServer.host,
  });
  const node3 = await Helpers.createLocalNode({
    datastoreConfiguration: { datastoresDir: Path.join(datastoresDir, '3') },
    nodeRegistryHost: await node1.hostedServicesServer.host,
  });

  await expect(node1.nodeRegistry.getNodes()).resolves.toEqual(
    expect.arrayContaining([
      {
        nodeId: node2.cloudConfiguration.networkIdentity.bech32,
        isClusterNode: true,
        lastSeenDate: expect.any(Date),
        apiHost: await node2.publicServer.host,
      },
      {
        nodeId: node3.cloudConfiguration.networkIdentity.bech32,
        isClusterNode: true,
        lastSeenDate: expect.any(Date),
        apiHost: await node3.publicServer.host,
      },
    ]),
  );

  // try from a child node
  await expect(node3.nodeRegistry.getNodes()).resolves.toEqual(
    expect.arrayContaining([
      {
        nodeId: node1.cloudConfiguration.networkIdentity.bech32,
        isClusterNode: true,
        lastSeenDate: expect.any(Date),
        apiHost: await node1.publicServer.host,
      },
      {
        nodeId: node3.cloudConfiguration.networkIdentity.bech32,
        isClusterNode: true,
        lastSeenDate: expect.any(Date),
        apiHost: await node3.publicServer.host,
      },
    ]),
  );
});
