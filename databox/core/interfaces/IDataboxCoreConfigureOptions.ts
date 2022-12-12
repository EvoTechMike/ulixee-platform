import { IBlockSettings } from '@ulixee/specification';
import Identity from '@ulixee/crypto/lib/Identity';

export default interface IDataboxCoreConfigureOptions {
  serverEnvironment: 'development' | 'production';
  maxRuntimeMs: number;
  databoxesDir: string;
  databoxesTmpDir: string;
  waitForDataboxCompletionOnShutdown: boolean;
  paymentAddress: string;
  giftCardsAllowed: boolean;
  giftCardsRequiredIssuerIdentity: string;
  enableRunWithLocalPath: boolean;
  uploaderIdentities: string[];
  defaultBytesForPaymentEstimates: number;
  computePricePerQuery: number;
  approvedSidechains: IBlockSettings['sidechains'];
  approvedSidechainsRefreshInterval: number;
  defaultSidechainHost: string;
  defaultSidechainRootIdentity: string;
  identityWithSidechain: Identity;
}
