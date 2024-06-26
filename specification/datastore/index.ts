import { IZodHandlers, IZodSchemaToApiTypes } from '../utils/IZodApi';
import { DatastoreApiSchemas } from './DatastoreApis';
import { DomainLookupApiSchema } from './DomainLookupApis';
import { EscrowApisSchema, IEscrowEvents } from './EscrowApis';
import { PaymentServiceApisSchema } from './PaymentServiceApis';

export type IDatastoreApiTypes = IZodSchemaToApiTypes<typeof DatastoreApiSchemas>;

export type IDatastoreApis = IZodHandlers<typeof DatastoreApiSchemas>;

export type IEscrowApis<TContext = any> = IZodHandlers<typeof EscrowApisSchema, TContext>;
export type IPaymentServiceApis<TContext = any> = IZodHandlers<
  typeof PaymentServiceApisSchema,
  TContext
>;

export type IDomainLookupApis<TContext = any> = IZodHandlers<typeof DomainLookupApiSchema, TContext>;

export { IEscrowEvents };

export default DatastoreApiSchemas;
