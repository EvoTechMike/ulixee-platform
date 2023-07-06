import { IAsyncFunc } from '@ulixee/net/interfaces/IApiHandlers';
import ITransport from '@ulixee/net/interfaces/ITransport';
import ConnectionToClient from '@ulixee/net/lib/ConnectionToClient';
import {
  DatastoreRegistryApiSchemas,
  IDatastoreRegistryApis,
} from '@ulixee/platform-specification/services/DatastoreRegistryApis';
import {
  IStatsTrackerApis,
  StatsTrackerApiSchemas,
} from '@ulixee/platform-specification/services/StatsTrackerApis';
import { IZodApiTypes } from '@ulixee/specification/utils/IZodApi';
import ValidationError from '@ulixee/specification/utils/ValidationError';
import IDatastoreApiContext from '../interfaces/IDatastoreApiContext';
import { DatastoreNotFoundError } from '../lib/errors';

export type TServicesApis = IDatastoreRegistryApis<IDatastoreApiContext> &
  IStatsTrackerApis<IDatastoreApiContext>;

export type TConnectionToServicesClient = ConnectionToClient<TServicesApis, {}>;

export default class HostedServicesEndpoints {
  public connections = new Set<TConnectionToServicesClient>();

  private readonly handlersByCommand: TServicesApis;

  constructor() {
    this.handlersByCommand = {
      'DatastoreRegistry.downloadDbx': async ({ id, version }, ctx) => {
        // only get from local if installed
        const result = await ctx.datastoreRegistry.diskStore.getCompressedDbx(id, version);
        if (!result) {
          throw new DatastoreNotFoundError('Datastore could not be download. Not found locally.', {
            version,
          });
        }
        return result;
      },
      'DatastoreRegistry.get': async ({ id, version }, ctx) => {
        const datastore = await ctx.datastoreRegistry.get(id, version, false);
        return { datastore };
      },
      'DatastoreRegistry.getLatestVersion': async ({ id }, ctx) => {
        const latestVersion = await ctx.datastoreRegistry.getLatestVersion(id);
        return { latestVersion };
      },
      'DatastoreRegistry.getVersions': async ({ id }, ctx) => {
        const versions = await ctx.datastoreRegistry.getVersions(id);
        return { versions };
      },
      'DatastoreRegistry.getLatestVersionForDomain': async ({ domain }, ctx) => {
        const latestVersion = await ctx.datastoreRegistry.getByDomain(domain);
        return { ...latestVersion };
      },
      'DatastoreRegistry.list': async ({ count, offset }, ctx) => {
        // don't go out to network
        return await ctx.datastoreRegistry.diskStore.list(count, offset);
      },
      'DatastoreRegistry.upload': async (request, ctx) => {
        const { datastoreRegistry, workTracker } = ctx;
        const result = await workTracker.trackUpload(
          datastoreRegistry.saveDbx(request, ctx.connectionToClient?.transport.remoteId),
        );
        return { success: result?.didInstall ?? false };
      },
      'StatsTracker.recordEntityStats': async (args, ctx) => {
        await ctx.statsTracker.recordEntityStats(args);
        return { success: true };
      },
      'StatsTracker.recordQuery': async (args, ctx) => {
        await ctx.statsTracker.recordQuery(args);
        return { success: true };
      },
      'StatsTracker.get': async ({ datastoreId }, ctx) => {
        const manifest = await ctx.datastoreRegistry.get(datastoreId);
        return await ctx.statsTracker.getForDatastore(manifest);
      },
      'StatsTracker.getSummary': async ({ datastoreId }, ctx) => {
        return await ctx.statsTracker.getSummary(datastoreId);
      },
      'StatsTracker.getByVersion': async ({ datastoreId, version }, ctx) => {
        const manifest = await ctx.datastoreRegistry.get(datastoreId, version);
        return await ctx.statsTracker.getForDatastoreVersion(manifest);
      },
    };

    for (const [api, handler] of Object.entries(this.handlersByCommand)) {
      const validationSchema = DatastoreRegistryApiSchemas[api] ?? StatsTrackerApiSchemas[api];
      if (!validationSchema) throw new Error(`invalid api ${api}`);
      this.handlersByCommand[api] = validateThenRun.bind(
        this,
        api,
        handler.bind(this),
        validationSchema,
      );
    }
  }

  public addConnection(
    transport: ITransport,
    context: IDatastoreApiContext,
  ): TConnectionToServicesClient {
    const connection = new ConnectionToClient(transport, this.handlersByCommand);
    connection.handlerMetadata = context;
    this.connections.add(connection);
    return connection;
  }
}

export function validateThenRun(
  api: string,
  handler: IAsyncFunc,
  validationSchema: IZodApiTypes | undefined,
  args: any,
  context: IDatastoreApiContext,
): Promise<any> {
  if (!validationSchema) return handler(args, context);
  // NOTE: mutates `errors`
  const result = validationSchema.args.safeParse(args);
  if (result.success === true) return handler(result.data, context);

  throw ValidationError.fromZodValidation(
    `The parameters for this command (${api}) are invalid.`,
    result.error,
  );
}
