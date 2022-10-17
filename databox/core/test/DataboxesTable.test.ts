import DataboxesDb from '../lib/DataboxesDb';

test('it can save a databox manifest', () => {
  const db = new DataboxesDb(process.env.ULX_DATA_DIR ?? '.');
  db.databoxes.save({
    versionTimestamp: Date.now(),
    scriptHash: 'scr1',
    scriptEntrypoint: 'script/index.js',
    linkedVersions: [],
    coreVersion: '2.0.0-alpha.1',
    versionHash: 'abc',
  });

  expect(db.databoxes.getByVersionHash('abc')).toEqual({
    giftCardAddress: undefined,
    paymentAddress: undefined,
    pricePerQuery: 0,
    scriptEntrypoint: 'script/index.js',
    scriptHash: 'scr1',
    coreVersion: '2.0.0-alpha.1',
    versionHash: 'abc',
    versionTimestamp: expect.any(Number),
    storedDate: expect.any(Number),
  });
});
