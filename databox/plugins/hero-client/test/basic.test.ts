import ConnectionFactory from '@ulixee/hero/connections/ConnectionFactory';
import Autorun from '@ulixee/databox/lib/utils/Autorun';
import { Helpers } from '@ulixee/databox-testing';
import { Function } from '@ulixee/databox';
import { HeroFunctionPlugin } from '../index';

import MockConnectionToHeroCore from './_MockConnectionToHeroCore';

afterAll(Helpers.afterAll);

function createConnectionToHeroCore() {
  return new MockConnectionToHeroCore(({ command, messageId: responseId }) => {
    if (command === 'Core.createSession') {
      return {
        responseId,
        data: { sessionId: 'session-id' },
      };
    }
    if (command === 'Session.getDetachedElements') {
      return {
        responseId,
        data: [],
      };
    }
    if (command === 'Session.getDetachedResources') {
      return {
        responseId,
        data: [],
      };
    }
    return { responseId, data: {} };
  });
}

describe('basic Databox tests', () => {
  it('automatically runs and closes a databox', async () => {
    const connection = createConnectionToHeroCore();
    jest.spyOn(ConnectionFactory, 'createConnection').mockImplementationOnce(() => connection);

    const ranScript = new Promise(resolve => {
      const func = new Function(async context => {
        await context.hero;
        resolve(true);
      }, HeroFunctionPlugin);
      Autorun.defaultExport = func;
    });
    await Autorun.attemptAutorun(Function);
    await new Promise(resolve => process.nextTick(resolve));
    expect(await ranScript).toBe(true);

    const outgoingCommands = connection.outgoingSpy.mock.calls;
    expect(outgoingCommands.map(c => c[0].command)).toMatchObject([
      'Core.connect',
      'Core.createSession',
      'Session.close',
      'Core.disconnect',
    ]);
  });

  it('waits until run method is explicitly called', async () => {
    const connection = createConnectionToHeroCore();
    jest.spyOn(ConnectionFactory, 'createConnection').mockImplementationOnce(() => connection);
    const databoxForHero = new Function(async context => {
      const hero = context.hero;
      await hero.goto('https://news.ycombinator.org');
      await hero.close();
    }, HeroFunctionPlugin);
    databoxForHero.disableAutorun = true;
    expect(connection.outgoingSpy.mock.calls).toHaveLength(0);
    await databoxForHero.exec({});
    const outgoingHeroCommands = connection.outgoingSpy.mock.calls;
    expect(outgoingHeroCommands.map(c => c[0].command)).toMatchObject([
      'Core.connect',
      'Core.createSession',
      'Tab.goto',
      'Session.close',
      'Core.disconnect',
    ]);
  });

  it('should call close on hero automatically', async () => {
    const connection = createConnectionToHeroCore();
    jest.spyOn(ConnectionFactory, 'createConnection').mockImplementationOnce(() => connection);
    const databoxForHero = new Function(async context => {
      const hero = context.hero;
      await hero.goto('https://news.ycombinator.org');
    }, HeroFunctionPlugin);
    databoxForHero.disableAutorun = true;
    await databoxForHero.exec({});

    const outgoingHeroCommands = connection.outgoingSpy.mock.calls;
    expect(outgoingHeroCommands.map(c => c[0].command)).toContain('Session.close');
  });

  it('should emit close hero on error', async () => {
    const connection = createConnectionToHeroCore();
    jest.spyOn(ConnectionFactory, 'createConnection').mockImplementationOnce(() => connection);
    const databoxForHero = new Function(async context => {
      const hero = context.hero;
      await hero.goto('https://news.ycombinator.org').then(() => {
        throw new Error('test');
      });

      await hero.interact('click');
    }, HeroFunctionPlugin);
    databoxForHero.disableAutorun = true;

    await expect(databoxForHero.exec({})).rejects.toThrowError();

    const outgoingHeroCommands = connection.outgoingSpy.mock.calls;
    expect(outgoingHeroCommands.map(c => c[0].command)).toContain('Session.close');
  });

  it('should be able to bypass the interaction step', async () => {
    const connection = createConnectionToHeroCore();
    jest.spyOn(ConnectionFactory, 'createConnection').mockImplementationOnce(() => connection);

    const runFn = jest.fn();
    const afterRunFn = jest.fn();
    const heroFunction = new Function(
      {
        run: runFn,
        afterRun: afterRunFn,
      },
      HeroFunctionPlugin,
    );
    await heroFunction.exec({ replaySessionId: '123' });

    expect(runFn).not.toHaveBeenCalled();
    expect(afterRunFn).toHaveBeenCalledTimes(1);
  });

  it('receives DataboxMeta', async () => {
    const { functionContext, databoxClose } = await Helpers.createFullstackDatabox();
    const sessionId = await functionContext.hero.sessionId;
    expect(sessionId).toBeTruthy();
    await databoxClose();
  });
});
