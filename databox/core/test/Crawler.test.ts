import * as Fs from 'fs';
import * as Path from 'path';
import DataboxPackager from '@ulixee/databox-packager';
import { Helpers } from '@ulixee/databox-testing';
import UlixeeMiner from '@ulixee/miner';
import DataboxApiClient from '@ulixee/databox/lib/DataboxApiClient';
import { Crawler } from '@ulixee/databox';

const storageDir = Path.resolve(process.env.ULX_DATA_DIR ?? '.', 'Crawler.test');

let miner: UlixeeMiner;
let client: DataboxApiClient;
const findCachedSpy = jest.spyOn<any, any>(Crawler.prototype, 'findCached');

beforeAll(async () => {
  if (Fs.existsSync(`${__dirname}/databoxes/crawl.dbx`)) {
    Fs.unlinkSync(`${__dirname}/databoxes/crawl.dbx`);
  }

  miner = new UlixeeMiner();
  miner.router.databoxConfiguration = { databoxesDir: storageDir };
  await miner.listen();
  client = new DataboxApiClient(await miner.address);
});

beforeEach(() => {
  findCachedSpy.mockClear();
});

afterEach(Helpers.afterEach);

afterAll(async () => {
  await Helpers.afterAll();
  Fs.rmSync(storageDir, { recursive: true });
});

test('should be able to run a crawler', async () => {
  const crawler = new DataboxPackager(`${__dirname}/databoxes/crawl.js`);
  await crawler.build();
  await client.upload(await crawler.dbx.asBuffer());

  await expect(client.stream(crawler.manifest.versionHash, 'crawlCall', {})).resolves.toEqual([
    { version: '1', crawler: 'none', runCrawlerTime: expect.any(Date) },
  ]);
});

test('should be able to ask a crawler for a cached result', async () => {
  const crawler = new DataboxPackager(`${__dirname}/databoxes/crawl.js`);
  await crawler.build();
  await client.upload(await crawler.dbx.asBuffer());

  const result1 = await client.stream(crawler.manifest.versionHash, 'crawlCall', {
    sessionId: '1',
  });
  expect(result1).toEqual([
    { version: '1', crawler: 'none', sessionId: '1', runCrawlerTime: expect.any(Date) },
  ]);

  // crawl is setup to pass in the run time from the first result
  await expect(
    client.stream(crawler.manifest.versionHash, 'crawlCall', {
      sessionId: '2',
      maxTimeInCache: (Date.now() - result1[0].runCrawlerTime.getTime() / 1e3),
    }),
    // should use cached version
  ).resolves.toEqual([{ version: '1', crawler: 'none', sessionId: '1' }]);
});

test('should get cached result by serialized input if no schema', async () => {
  const crawler = new DataboxPackager(`${__dirname}/databoxes/crawl.js`);
  await crawler.build();
  await client.upload(await crawler.dbx.asBuffer());

  const result1 = await client.stream(crawler.manifest.versionHash, 'crawlCall', {
    sessionId: '1',
    test1: true,
    test2: 'abc',
  });
  expect(result1).toEqual([
    { version: '1', crawler: 'none', sessionId: '1', runCrawlerTime: expect.any(Date) },
  ]);

  expect(findCachedSpy).toHaveBeenCalledTimes(1);
  await expect(findCachedSpy.mock.results[0].value).resolves.toBeNull();

  // crawl is setup to pass in the run time from the first result
  findCachedSpy.mockClear();
  await expect(
    client.stream(crawler.manifest.versionHash, 'crawlCall', {
      sessionId: '2', // should not call the crawler
      maxTimeInCache: (Date.now() - result1[0].runCrawlerTime.getTime() / 1e3),
      // change field order to test
      test2: 'abc',
      test1: true,
    }),
    // no crawler run time
  ).resolves.toEqual([{ version: '1', crawler: 'none', sessionId: '1' }]);
  expect(findCachedSpy).toHaveBeenCalledTimes(1);
  await expect(findCachedSpy.mock.results[0].value).resolves.toEqual({
    version: '1',
    crawler: 'none',
    sessionId: '1',
  });

  findCachedSpy.mockClear();
  await expect(
    client.stream(crawler.manifest.versionHash, 'crawlCall', {
      sessionId: '3',
      maxTimeInCache: (Date.now() - result1[0].runCrawlerTime.getTime() / 1e3),
      test2: 'somethingElse',
      test1: false,
    }),
  ).resolves.toEqual([
    {
      version: '1',
      crawler: 'none',
      sessionId: '3',
      runCrawlerTime: expect.any(Date),
    },
  ]);
  expect(findCachedSpy).toHaveBeenCalledTimes(1);
  await expect(findCachedSpy.mock.results[0].value).resolves.toBeNull();
});

test('should get cached result individual input columns', async () => {
  const crawler = new DataboxPackager(`${__dirname}/databoxes/crawl.js`);
  await crawler.build();
  await client.upload(await crawler.dbx.asBuffer());

  const result1 = await client.stream(crawler.manifest.versionHash, 'crawlWithSchemaCall', {
    sessionId: '1',
    colBool: true,
    colNum: 1,
  });
  expect(result1).toEqual([{ sessionId: '1', runCrawlerTime: expect.any(Date) }]);

  expect(findCachedSpy).toHaveBeenCalledTimes(1);
  await expect(findCachedSpy.mock.results[0].value).resolves.toBeNull();

  // crawl is setup to pass in the run time from the first result
  findCachedSpy.mockClear();
  await expect(
    client.stream(crawler.manifest.versionHash, 'crawlWithSchemaCall', {
      sessionId: '2', // should not call the crawler
      maxTimeInCache: (Date.now() - result1[0].runCrawlerTime.getTime() / 1e3),
      colBool: true,
      colNum: 1,
    }),
    // no crawler run time
  ).resolves.toEqual([{ sessionId: '1' }]);
  expect(findCachedSpy).toHaveBeenCalledTimes(1);
  await expect(findCachedSpy.mock.results[0].value).resolves.toEqual({
    version: '1',
    crawler: 'none',
    sessionId: '1',
  });

  findCachedSpy.mockClear();
  await expect(
    client.stream(crawler.manifest.versionHash, 'crawlWithSchemaCall', {
      sessionId: '3',
      maxTimeInCache: (Date.now() - result1[0].runCrawlerTime.getTime() / 1e3),
      colBool: false,
      colNum: 1,
    }),
  ).resolves.toEqual([
    {
      sessionId: '3',
      runCrawlerTime: expect.any(Date),
    },
  ]);
  expect(findCachedSpy).toHaveBeenCalledTimes(1);
  await expect(findCachedSpy.mock.results[0].value).resolves.toBeNull();
});
