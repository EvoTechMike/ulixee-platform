import { IFunctionExecOptions } from '@ulixee/datastore';
import DatastoreApiHandler from '../lib/DatastoreApiHandler';
import DatastoreCore from '../index';
import PaymentProcessor from '../lib/PaymentProcessor';
import DatastoreVm from '../lib/DatastoreVm';
import { validateAuthentication, validateFunctionCoreVersions } from '../lib/datastoreUtils';

export default new DatastoreApiHandler('Datastore.stream', {
  async handler(request, context) {
    const startTime = Date.now();
    const datastoreVersion = await context.datastoreRegistry.getByVersionHash(request.versionHash);

    const datastore = await DatastoreVm.open(datastoreVersion.path, datastoreVersion);

    const datastoreFunction = datastore.metadata.functionsByName[request.functionName];

    if (!datastoreFunction) {
      throw new Error(`${request.functionName} is not a valid Function name for this Datastore.`);
    }

    await validateAuthentication(datastore, request.payment, request.authentication);

    const paymentProcessor = new PaymentProcessor(request.payment, datastore, context);

    const { functionName, input } = request;
    await paymentProcessor.createHold(
      datastoreVersion,
      [{ functionName, id: 1 }],
      request.pricingPreferences,
    );

    validateFunctionCoreVersions(datastoreVersion, functionName, context);

    const outputs = await context.workTracker.trackRun(
      (async () => {
        const options: IFunctionExecOptions<any> = {
          input,
          authentication: request.authentication,
          affiliateId: request.affiliateId,
          payment: request.payment,
        };

        for (const plugin of Object.values(DatastoreCore.pluginCoresByName)) {
          if (plugin.beforeExecFunction) await plugin.beforeExecFunction(options);
        }

        const results = datastore.functions[functionName].runInternal(options);
        for await (const result of results) {
          context.connectionToClient.sendEvent({
            listenerId: request.streamId,
            data: result,
            eventType: 'FunctionStream.output',
          });
        }
        return results;
      })(),
    );

    const bytes = PaymentProcessor.getOfficialBytes(outputs);
    const microgons = await paymentProcessor.settle(bytes);
    const milliseconds = Date.now() - startTime;
    context.datastoreRegistry.recordStats(request.versionHash, functionName, {
      bytes,
      microgons,
      milliseconds,
    });

    return {
      latestVersionHash: datastoreVersion.latestVersionHash,
      metadata: {
        bytes,
        microgons,
        milliseconds,
      },
    };
  },
});
