import Datastore, { Extractor } from '@ulixee/datastore';
import { boolean, string } from '@ulixee/schema';

export default new Datastore({
  id: 'schema',
  version: '0.0.1',
  extractors: {
    default: new Extractor({
      run(ctx) {
        ctx.Output.emit({ success: true });
      },
      schema: {
        input: {
          field: string({ minLength: 1, description: 'a field you should use' }),
        },
        output: {
          success: boolean(),
        },
      },
    }),
  },
});
