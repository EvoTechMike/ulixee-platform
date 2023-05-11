import Resolvable from '@ulixee/commons/lib/Resolvable';
import INodeInfo from '@ulixee/platform-specification/types/INodeInfo';
import Log from '@ulixee/commons/lib/Logger';
import type * as Libp2pModule from 'libp2p';
import type * as TransportLevelSecurity from 'libp2p/insecure';
import * as Path from 'path';
import type { PeerId } from '@libp2p/interface-peer-id';
import type { Multiaddr } from '@multiformats/multiaddr';
import type * as Bootstrap from '@libp2p/bootstrap';
import type * as KadDHT from '@libp2p/kad-dht';
import type * as Websockets from '@libp2p/websockets';
import * as http from 'http';
import { isIPv4 } from 'net';
import IPeerNetwork from '@ulixee/platform-specification/types/IPeerNetwork';
import * as Fs from 'fs';
import type { Peer } from '@libp2p/interface-peer-store';
import IP2pConnectionOptions from '../interfaces/IP2pConnectionOptions';
import {
  base32,
  createRawCIDV1,
  dynamicImport,
  parseMultiaddrs,
  peerIdFromIdentity,
  peerIdFromNodeId,
} from './utils';
import SqliteDatastore from './SqliteDatastore';

type Libp2p = Libp2pModule.Libp2p;
type Libp2pOptions = Libp2pModule.Libp2pOptions;

const { log } = Log(module);

export default class P2pConnection implements IPeerNetwork {
  public nodeId: string;
  public multiaddrs: Multiaddr[];
  public nodeInfo: INodeInfo;
  public libp2p: Libp2p;
  public peerId: PeerId;

  private readonly nodeInfoById: { [id: string]: Promise<INodeInfo> } = {};
  private isClosing: Resolvable<void>;
  private dhtReadyPromise: Resolvable<void>;
  private closeAbortController = new AbortController();
  private pendingOperationAborts = new Set<AbortController>();

  constructor(private readonly options: IP2pConnectionOptions) {
    this.options.ipOrDomain ??= '127.0.0.1';
    this.options.port ??= 0;
  }

  public createP2pMultiaddr(port: number, publicIpOrDomain = '0.0.0.0'): string {
    const isIp = isIPv4(publicIpOrDomain);
    if (!isIp) {
      return `/dnsaddr/${publicIpOrDomain}/tcp/${port}/ws`;
    }
    return `/ip4/${publicIpOrDomain}/tcp/${port}/ws`;
  }

  public async start(boostrapList: string[], attachToServer?: http.Server): Promise<this> {
    const { identity, port, ipOrDomain, ulixeeApiHost } = this.options;

    this.peerId = await peerIdFromIdentity(identity);
    this.nodeId = P2pConnection.createNodeId(this.peerId);
    this.nodeInfo = {
      nodeId: this.nodeId,
      ulixeeApiHost,
    };

    if (!this.options.dbPath) {
      this.options.dbPath = ':memory:';
    } else if (!this.options.dbPath.endsWith('.db')) {
      this.options.dbPath = Path.join(this.options.dbPath, `${this.nodeId}.db`);
      await Fs.promises
        .mkdir(Path.dirname(this.options.dbPath), { recursive: true })
        .catch(() => null);
    }
    const datastore = new SqliteDatastore(this.options.dbPath);

    const { createLibp2p } = await dynamicImport<typeof Libp2pModule>('libp2p');
    const { bootstrap } = await dynamicImport<typeof Bootstrap>('@libp2p/bootstrap');
    const { kadDHT } = await dynamicImport<typeof KadDHT>('@libp2p/kad-dht');
    const { yamux } = await dynamicImport<typeof import('@chainsafe/libp2p-yamux')>(
      '@chainsafe/libp2p-yamux',
    );
    const { webSockets } = await dynamicImport<typeof Websockets>('@libp2p/websockets');
    const { plaintext } = await dynamicImport<typeof TransportLevelSecurity>('libp2p/insecure');
    const filters = await dynamicImport<typeof import('@libp2p/websockets/filters')>(
      '@libp2p/websockets/filters',
    );

    const address = this.createP2pMultiaddr(port, ipOrDomain);
    const config: Libp2pOptions = {
      start: false,
      peerId: this.peerId,
      addresses: {
        announce: [address],
        listen: [address],
      },
      transports: [
        webSockets({
          filter: filters.all,
          server: attachToServer,
        }),
      ],
      // use websocket transport security
      connectionEncryption: [plaintext()],
      streamMuxers: [yamux()],
      peerDiscovery: [],
      dht: kadDHT({
        clientMode: false,
        providers: {
          cleanupInterval: 60 * 60,
        },
        protocolPrefix: '/ulx',
        kBucketSize: 25,
      }),
      identify: {
        protocolPrefix: 'ulx', // doesn't want leading slash
      },
      datastore,
    };
    if (boostrapList?.length) {
      config.peerDiscovery.push(
        bootstrap({
          list: boostrapList,
          timeout: 0,
        }),
      );
    }
    this.libp2p = await createLibp2p(config);
    this.libp2p.addEventListener('peer:connect', async event => {
      const connection = event.detail;
      const peerId = connection.remotePeer;
      await this.lookupNodeInfo(peerId).catch(() => null);
      if (!this.dhtReadyPromise.isResolved) {
        await (this.libp2p.dht as any).refreshRoutingTable();
        this.dhtReadyPromise.resolve();
      }
      log.stats('P2pPeer.connect', {
        nodeId: peerId.toString(),
        sessionId: null,
      });
    });

    this.libp2p.addEventListener('peer:discovery', async event => {
      try {
        const peers = this.libp2p.getPeers();
        if (peers.length < 5) {
          const peerInfo = event.detail;
          let addresses = peerInfo.multiaddrs;
          if (('addresses' in peerInfo) as unknown as Peer) {
            addresses = (peerInfo as unknown as Peer).addresses.map(x => x.multiaddr);
          }
          if (addresses.length) {
            await this.libp2p.dial(addresses, { signal: this.closeAbortController.signal });
          }
        }
      } catch (error) {
        if (this.closeAbortController.signal.aborted) return;
        log.error('Could not connect to discovered peer', { error });
      }
    });
    await this.handleNodeInfoRequests();

    this.dhtReadyPromise = new Resolvable(
      30e3,
      `Network startup timed-out connecting to Peer network`,
    );

    this.multiaddrs = this.libp2p.getMultiaddrs();
    log.info('P2p.Starting', {
      addrs: this.multiaddrs.map(x => x.toString()),
      sessionId: null,
    });

    await this.libp2p.start();

    if (boostrapList?.length) {
      await this.ensureNetworkConnect();
    }

    log.info('P2p.Started', {
      nodeInfo: this.nodeInfo,
      sessionId: null,
    });

    return this;
  }

  public ensureNetworkConnect(): Promise<void> {
    return this.dhtReadyPromise.promise;
  }

  public async close(): Promise<void> {
    if (this.isClosing) return this.isClosing.promise;

    this.isClosing = new Resolvable();

    try {
      try {
        this.closeAbortController.abort();
      } catch {}

      for (const abort of this.pendingOperationAborts) abort.abort();
      this.pendingOperationAborts.clear();

      await this.libp2p?.stop();
      // ensure we stop this no matter what. can get stuck open if libp2p startup has errors
      await (this.libp2p?.dht as any).stop();
      this.isClosing.resolve();
    } catch (error) {
      this.isClosing.reject(error);
    }
    log.info('P2p.stopped');
  }

  public async addPeer(nodeId: string, multiaddrs: (Multiaddr | string)[]): Promise<void> {
    if (this.nodeId === nodeId) return;
    const peerId = await peerIdFromNodeId(nodeId);
    await this.libp2p.peerStore.addressBook.add(peerId, await parseMultiaddrs(multiaddrs));
    await this.libp2p.dial(peerId, { signal: this.closeAbortController.signal });
    await (this.libp2p.dht as any).refreshRoutingTable().catch(() => null);
  }

  public async getKnownNodes(maxNodes = 25): Promise<INodeInfo[]> {
    const peers = (await this.libp2p.peerStore.all()).slice(0, maxNodes).map(x => x.id);
    const nodeInfos = await Promise.all(peers.map(x => this.lookupNodeInfo(x).catch(() => null)));
    return nodeInfos.filter(Boolean) as INodeInfo[];
  }

  /**
   * Uses XOR distance to find closest peers. Auto-converts to sha256 of key
   */
  public async findClosestNodes(hash: Buffer): Promise<INodeInfo[]> {
    const query = this.libp2p.peerRouting.getClosestPeers(hash, {
      signal: this.closeAbortController.signal,
    });

    const nodeInfos: Promise<INodeInfo>[] = [];
    for await (const peer of query) {
      nodeInfos.push(this.lookupNodeInfo(peer.id).catch(() => null));
    }
    return Promise.all(nodeInfos);
  }

  /**
   * Search the dht for up to `K` providers of the given CID.
   */
  public async *findProviderNodes(
    bucket: string,
    hash: Buffer,
    { timeout = 5000, abort = null as AbortSignal } = {},
  ): AsyncGenerator<INodeInfo> {
    await this.ensureNetworkConnect();

    const abortController = new AbortController();
    this.pendingOperationAborts.add(abortController);
    const doAbort = abortController.abort.bind(abortController);
    try {
      if (abort) abort.addEventListener('abort', doAbort);
      if (timeout) {
        const timer = setTimeout(doAbort, timeout).unref();
        abortController.signal.onabort = () => clearTimeout(timer);
      }

      const key = Buffer.concat([Buffer.from(`/${bucket}/`), hash]);
      const cid = await createRawCIDV1(key);
      const query = this.libp2p.contentRouting.findProviders(cid, {
        signal: abortController.signal,
      });

      for await (const entry of query) {
        yield await this.lookupNodeInfo(entry.id);
      }
    } catch (error) {
      if (error.code === 'ERR_NOT_FOUND') {
        return;
      }
      throw error;
    } finally {
      this.pendingOperationAborts.delete(abortController);
    }
  }

  // TODO: complete implementation
  public async broadcast(_content: any): Promise<boolean> {
    // track "parent" nodes.
    // tree is initialized with a parent nodes
    const id = BigInt(Buffer.from((await peerIdFromNodeId(this.nodeId)).toBytes()).toString('hex'));
    const root = BigInt(Buffer.from('pre-shared-or-from-peer').toString('hex'));
    const m = 2n ** 256n; // 2 ^ bits
    const k = 20n; // k bucket size?
    const rootDistance = (root - id) % m;
    let parentId: BigInt;
    if (rootDistance > 0 && rootDistance <= m / 2n) {
      parentId = (root + rootDistance / k) % m;
    } else {
      parentId = (root - (m - rootDistance / k)) % m;
    }
    const parentBytes = Buffer.from(parentId.toString(16), 'hex');
    const _parent = await this.libp2p.peerRouting.getClosestPeers(parentBytes);
    // TODO: need to track as closer peers comes in and out. Registration process:
    // 1. send to parent that we are child
    // 2. parent keeps list of children
    // 2b. If > k children, tell child that fits least that it needs to reparent (each node sees if node is in it's "range")
    // 3. child keeps pinging parent to tell it status every 1 min (parent should delete if not called after 10 minutes)
    // 3b. If parent fails to reply, must find a new parent.
    // https://groups.csail.mit.edu/ana/Publications/PubPDFs/Implementing-Aggregation-and-Broadcast-over-distributed-hash-tables.pdf

    return Promise.resolve(false);
  }

  /**
   * Announce to the network that we can provide given key's value.
   */
  public async provide(bucket: string, hash: Buffer): Promise<{ providerKey: string }> {
    const key = Buffer.concat([Buffer.from(`/${bucket}/`), hash]);
    await this.ensureNetworkConnect();
    log.info('ProvidingKeyToNetwork', { key, sessionId: null });
    const cid = await createRawCIDV1(key);
    await this.libp2p.contentRouting.provide(cid);
    const base32Encoded = await base32(cid.multihash.bytes);
    // have to hardcode.. can't get out of libp2p
    const providerKey = `/dht/provider/${base32Encoded}`;
    return { providerKey };
  }

  // PRIVATE METHODS ///////////////////////////////////////////////////////////////////////////////

  private async lookupNodeInfo(peerId: PeerId): Promise<INodeInfo> {
    const nodeId = peerId.toString();
    if (nodeId === this.nodeId) return this.nodeInfo;

    this.nodeInfoById[nodeId] ??= this.dialNodeLookup(nodeId, peerId);
    return this.nodeInfoById[nodeId];
  }

  private async dialNodeLookup(nodeId: string, peerId: PeerId, attempt = 0): Promise<INodeInfo> {
    const stream = await this.libp2p.dialProtocol(peerId, '/ulx/apiInfo/v1', {
      signal: this.closeAbortController.signal,
    });
    const { pipe, lp, first } = await getIterators();

    try {
      return await pipe(
        [Buffer.from(this.nodeInfo.ulixeeApiHost)],
        source => lp.encode(source),
        stream,
        source => lp.decode(source),
        async source => {
          try {
            const response = await first(source);
            const ulixeeApiHost = Buffer.from(response.subarray()).toString();
            return {
              nodeId,
              ulixeeApiHost,
            };
          } catch (error) {
            if (!this.closeAbortController.signal.aborted) {
              await new Promise(resolve => setTimeout(resolve, 2 ** attempt * 100).unref());
              if (attempt < 5) {
                return this.dialNodeLookup(nodeId, peerId, attempt++);
              }
            }
            return undefined;
          }
        },
      );
    } catch (error) {
      if (this.closeAbortController.signal.aborted) return;
      throw error;
    }
  }

  private async handleNodeInfoRequests(): Promise<void> {
    const nodeInfo = Buffer.from(this.nodeInfo.ulixeeApiHost);
    const { pipe, lp, first } = await getIterators();
    const hostNodeInfo = this.nodeInfoById;

    await this.libp2p.handle('/ulx/apiInfo/v1', ({ stream, connection }) => {
      pipe(
        stream,
        source => lp.decode(source),
        async function* sink(source) {
          try {
            const entry = await first(source);
            const result = Buffer.from(entry.subarray());
            const ulixeeApiHost = result.toString();
            const nodeId = connection.remotePeer.toString();
            hostNodeInfo[nodeId] = Promise.resolve({ nodeId, ulixeeApiHost });

            yield nodeInfo;
          } catch (error) {}
        },
        source => lp.encode(source),
        stream,
      ).catch(error => {
        if (this.closeAbortController.signal.aborted) return;
        log.error('ERROR returning nodeInfo', error);
      });
    });
  }

  public static createNodeId(peerId: PeerId): string {
    return peerId.toString();
  }
}

async function getIterators(): Promise<{
  pipe: typeof import('it-pipe').pipe;
  lp: typeof import('it-length-prefixed');
  first: typeof import('it-first').default;
}> {
  const { pipe } = await dynamicImport<typeof import('it-pipe')>('it-pipe');
  const lp = await dynamicImport<typeof import('it-length-prefixed')>('it-length-prefixed');
  const itFirst = await dynamicImport<typeof import('it-first')>('it-first');
  return { pipe, lp, first: itFirst.default };
}
