import { sha256 } from '@ulixee/commons/lib/hashUtils';
import Identity from '@ulixee/crypto/lib/Identity';
import { Helpers } from '@ulixee/datastore-testing';
import INodeInfo from '@ulixee/platform-specification/types/INodeInfo';
import P2pConnection from '../lib/P2pConnection';

test('should correctly register peers', async () => {
  const publicPort1 = 4018;
  const publicPort2 = 4019;

  const p2pConnection1 = await startP2p({ port: publicPort1, ulixeeApiHost: '127.0.0.1:1818' });
  const p2pConnection2 = await startP2p({ port: publicPort2, ulixeeApiHost: '192.168.0.1:1818' });
  await p2pConnection2.addPeer(p2pConnection1.nodeId, p2pConnection1.multiaddrs);
  await p2pConnection2.ensureNetworkConnect();

  const nodeInfos1 = await p2pConnection1.getKnownNodes();
  const nodeInfos2 = await p2pConnection2.getKnownNodes();

  expect(nodeInfos1[0]).toMatchObject(p2pConnection2.nodeInfo);
  expect(nodeInfos2[0]).toMatchObject(p2pConnection1.nodeInfo);

  await p2pConnection1.close();
  await p2pConnection2.close();
});

test('should provide and find providers', async () => {
  const p2pConnection1 = await startP2p({ port: 3020 });
  const p2pConnection2 = await startP2p({
    bootstrapPeers: [p2pConnection1.multiaddrs[0].toString()],
    port: 3021,
    waitForPeerConnect: true,
  });

  const key = sha256('test');

  await p2pConnection2.provide('test', key);
  const providerPeers: INodeInfo[] = [];
  for await (const node of p2pConnection1.findProviderNodes('test', key)) {
    providerPeers.push(node);
  }

  await p2pConnection1.close();
  await p2pConnection2.close();

  expect(providerPeers).toHaveLength(1);
});

test.todo("should not connect to nodes that don't have the ulixee protocol");

test('start and connect multiple mining-bits', async () => {
  const p2pConnections = await Promise.all([
    startP2p({ port: 3020 }),
    startP2p({ port: 3021 }),
    startP2p({ port: 3022 }),
    startP2p({ port: 3023 }),
    startP2p({ port: 3024 }),
    startP2p({ port: 3025 }),
    startP2p({ port: 3026 }),
    startP2p({ port: 3027 }),
    startP2p({ port: 3028 }),
    startP2p({ port: 3029 }),
  ]);
  for (let i = 0; i < p2pConnections.length; i += 1) {
    let nextIdx = i + 1;
    if (nextIdx > p2pConnections.length - 1) nextIdx = 0;
    await p2pConnections[i].addPeer(
      p2pConnections[nextIdx].nodeId,
      p2pConnections[nextIdx].multiaddrs,
    );
  }
  await Promise.all(p2pConnections.map(x => x.ensureNetworkConnect()));
  let i = 0;
  for (const conn of p2pConnections) {
    const peerIds = conn.libp2p.getPeers();
    expect(peerIds.length).toBeGreaterThanOrEqual(2);
    i++;
  }
  const peerLookup = await p2pConnections[2].libp2p.peerRouting.findPeer(
    p2pConnections[8].libp2p.peerId,
  );
  expect(peerLookup).toBeTruthy();
  expect(peerLookup.multiaddrs[0].toString()).toContain('tcp/3028');
  await Promise.all(p2pConnections.map(x => x.close()));
}, 30000);

// HELPERS /////////////////////////////////////////////////////////////////////////////////////////

afterEach(Helpers.afterEach);
afterAll(Helpers.afterAll);
async function startP2p({
  port,
  bootstrapPeers,
  ulixeeApiHost,
}: {
  port?: number;
  waitForPeerConnect?: boolean;
  bootstrapPeers?: string[];
  ulixeeApiHost?: string;
}) {
  const identity = await Identity.create();
  const p2pConnection = new P2pConnection({
    identity,
    ipOrDomain: '127.0.0.1',
    port,
    dbPath: process.env.ULX_DATA_DIR,
    ulixeeApiHost: ulixeeApiHost ?? `127.0.0.1:${port}`,
  });
  Helpers.needsClosing.push(p2pConnection);
  return await p2pConnection.start(bootstrapPeers);
}
