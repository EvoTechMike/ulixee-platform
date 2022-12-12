import { ConnectionToCore, WsTransportToCore } from '@ulixee/net';
import DataboxApiSchemas, { IDataboxApis, IDataboxApiTypes } from '@ulixee/specification/databox';
import { sha3 } from '@ulixee/commons/lib/hashUtils';
import { concatAsBuffer } from '@ulixee/commons/lib/bufferUtils';
import Identity from '@ulixee/crypto/lib/Identity';
import ValidationError from '@ulixee/specification/utils/ValidationError';
import { IPayment } from '@ulixee/specification';
import { nanoid } from 'nanoid';
import ITypes from '../types';
import installSchemaType, { addSchemaAlias } from '../types/installSchemaType';

export type IDataboxExecResult = Omit<IDataboxApiTypes['Databox.query']['result'], 'output'>;
export type IDataboxExecRelayArgs = Pick<
  IDataboxApiTypes['Databox.query']['args'],
  'authentication' | 'payment'
>;

export default class DataboxApiClient {
  public connectionToCore: ConnectionToCore<IDataboxApis, {}>;
  public validateApiParameters = true;

  constructor(host: string) {
    const transport = new WsTransportToCore(`${host}/databox`);
    this.connectionToCore = new ConnectionToCore(transport);
  }

  public disconnect(): Promise<void> {
    return this.connectionToCore.disconnect();
  }

  public async getMeta(versionHash: string): Promise<IDataboxApiTypes['Databox.meta']['result']> {
    return await this.runRemote('Databox.meta', { versionHash });
  }

  public async getFunctionPricing<
    IVersionHash extends keyof ITypes & string = any,
    IFunctionName extends keyof ITypes[IVersionHash] & string = 'default',
  >(
    versionHash: IVersionHash,
    functionName: IFunctionName,
  ): Promise<
    Omit<IDataboxApiTypes['Databox.meta']['result']['functionsByName'][IFunctionName], 'name'> &
      Pick<
        IDataboxApiTypes['Databox.meta']['result'],
        'computePricePerQuery' | 'giftCardIssuerIdentities'
      >
  > {
    const meta = await this.getMeta(versionHash);
    const stats = meta.functionsByName[functionName];

    return {
      ...stats,
      computePricePerQuery: meta.computePricePerQuery,
      giftCardIssuerIdentities: meta.giftCardIssuerIdentities,
    };
  }

  public async install(
    versionHash: string,
    alias?: string,
  ): Promise<IDataboxApiTypes['Databox.meta']['result']> {
    const meta = await this.getMeta(versionHash);

    if (meta.functionsByName && meta.schemaInterface) {
      installSchemaType(meta.schemaInterface, versionHash);
    }
    if (alias) {
      addSchemaAlias(versionHash, alias);
    }

    return meta;
  }

  /**
   * NOTE: any caller must handle tracking local balances of gift cards and removing them if they're depleted!
   */
  public async query<ISchemaOutput = any, IVersionHash extends keyof ITypes & string = any>(
    versionHash: IVersionHash,
    sql: string,
    options: {
      boundValues?: any[];
      payment?: IPayment & {
        onFinalized?(metadata: IDataboxExecResult['metadata'], error?: Error): void;
      };
      authentication?: IDataboxExecRelayArgs['authentication'];
    } = {},
  ): Promise<IDataboxExecResult & { output?: ISchemaOutput[] }> {
    try {
      const result = await this.runRemote('Databox.query', {
        versionHash,
        sql,
        boundValues: options.boundValues ?? [],
        payment: options.payment,
        authentication: options.authentication,
      });
      if (options.payment?.onFinalized) {
        options.payment.onFinalized(result.metadata);
      }
      return result;
    } catch (error) {
      if (options.payment?.onFinalized) {
        options.payment.onFinalized(null, error);
      }
      throw error;
    }
  }

  public async upload(
    compressedDatabox: Buffer,
    options: {
      allowNewLinkedVersionHistory?: boolean;
      timeoutMs?: number;
      identity?: Identity;
    } = {},
  ): Promise<{ success: boolean }> {
    options.allowNewLinkedVersionHistory ??= false;
    options.timeoutMs ??= 120e3;
    const { allowNewLinkedVersionHistory, timeoutMs } = options;

    let uploaderSignature: Buffer;
    let uploaderIdentity: string;
    if (options.identity) {
      const identity = options.identity;
      uploaderIdentity = identity.bech32;
      const message = DataboxApiClient.createUploadSignatureMessage(
        compressedDatabox,
        allowNewLinkedVersionHistory,
      );
      uploaderSignature = identity.sign(message);
    }

    return await this.runRemote(
      'Databox.upload',
      {
        compressedDatabox,
        allowNewLinkedVersionHistory,
        uploaderSignature,
        uploaderIdentity,
      },
      timeoutMs,
    );
  }

  protected async runRemote<T extends keyof IDataboxApiTypes & string>(
    command: T,
    args: IDataboxApiTypes[T]['args'],
    timeoutMs?: number,
  ): Promise<IDataboxApiTypes[T]['result']> {
    try {
      if (this.validateApiParameters) {
        args = await DataboxApiSchemas[command].args.parseAsync(args);
      }
    } catch (error) {
      throw ValidationError.fromZodValidation(
        `The API parameters for ${command} have some issues`,
        error,
      );
    }

    return await this.connectionToCore.sendRequest({ command, args: [args] as any }, timeoutMs);
  }

  public static createExecSignatureMessage(payment: IPayment, nonce: string): Buffer {
    return sha3(
      concatAsBuffer('Databox.exec', payment?.giftCard?.id, payment?.micronote?.micronoteId, nonce),
    );
  }

  public static createExecAuthentication(
    payment: IPayment,
    authenticationIdentity: Identity,
    nonce?: string,
  ): IDataboxExecRelayArgs['authentication'] {
    nonce ??= nanoid(10);
    const message = DataboxApiClient.createExecSignatureMessage(payment, nonce);
    return {
      identity: authenticationIdentity.bech32,
      signature: authenticationIdentity.sign(message),
      nonce,
    };
  }

  public static createUploadSignatureMessage(
    compressedDatabox: Buffer,
    allowNewLinkedVersionHistory: boolean,
  ): Buffer {
    return sha3(
      concatAsBuffer('Databox.upload', compressedDatabox, String(allowNewLinkedVersionHistory)),
    );
  }
}
