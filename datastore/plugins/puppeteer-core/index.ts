import IExtractorPluginCore from '@ulixee/datastore/interfaces/IExtractorPluginCore';
import DatastoreCore from '@ulixee/datastore-core';

const pkg = require('@ulixee/datastore-plugins-puppeteer/package.json');

export default class DatastoreForPuppeteerCore implements IExtractorPluginCore {
  public name = pkg.name;
  public version = pkg.version;
  public nodeVmRequireWhitelist = ['@ulixee/*', 'puppeteer']

  public static register(): void {
    DatastoreCore.registerPlugin(new DatastoreForPuppeteerCore());
  }
}
