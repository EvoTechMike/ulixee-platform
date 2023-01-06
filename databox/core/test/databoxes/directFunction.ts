import { Function } from '@ulixee/databox';
import { boolean } from '@ulixee/schema';

export default new Function({
  run(ctx) {
    ctx.Output.emit({ testerEcho: ctx.input.tester });
  },
  schema: {
    input: {
      tester: boolean(),
    },
    output: {
      testerEcho: boolean(),
    },
  },
});
