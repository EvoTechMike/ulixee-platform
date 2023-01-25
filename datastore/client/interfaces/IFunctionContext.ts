import { IDatastoreApiTypes } from '@ulixee/specification/datastore';
import IFunctionSchema, { ExtractSchemaType } from './IFunctionSchema';
import { IOutputClass } from '../lib/Output';
import IDatastoreMetadata from './IDatastoreMetadata';
import Crawler from '../lib/Crawler';
import Function from '../lib/Function';
import Table from '../lib/Table';
import ResultIterable from '../lib/ResultIterable';
import ICrawlerOutputSchema from './ICrawlerOutputSchema';

export default interface IFunctionContext<TSchema extends IFunctionSchema> {
  input?: ExtractSchemaType<TSchema['input']>;
  readonly outputs?: ExtractSchemaType<TSchema['output']>[];
  readonly Output?: IOutputClass<ExtractSchemaType<TSchema['output']>>;
  schema?: TSchema;
  datastoreMetadata: IDatastoreMetadata;
  datastoreAffiliateId?: string;
  callerAffiliateId?: string;
  readonly authentication: IDatastoreApiTypes['Datastore.query']['args']['authentication'];
  readonly payment: IDatastoreApiTypes['Datastore.query']['args']['payment'];
  crawl<T extends Crawler>(crawler: T, options?: T['runArgsType']): Promise<ICrawlerOutputSchema>;
  run<T extends Function>(
    func: T,
    options?: T['runArgsType'],
  ): ResultIterable<ExtractSchemaType<T['schema']['output']>>;
  fetch<T extends Function>(
    func: T,
    options?: T['runArgsType'],
  ): ResultIterable<ExtractSchemaType<T['schema']['output']>>;
  // TODO: add table options typing
  fetch<T extends Table>(table: T, options?: any): ResultIterable<ExtractSchemaType<T['schema']>>;
  query<TResult>(sql: string, boundValues: any[]): Promise<TResult>;
}
