import Client from '@ulixee/client';
import { inspect } from 'util';

inspect.defaultOptions.depth = 10;
async function main() {
  const client = new Client('ulx://localhost:1818/dbx12404kxe6f58aq62zwn');
  try {
    const results = await client.query(`SELECT * from getDocumentation(url => $1)`, [
      'https://ulixee.org/docs/hero/basic-client/hero',
    ]);
    console.log(results);
  } finally {
    await client.disconnect();
  }
}

main().catch(console.error);
