import * as fs from 'fs';
import { IPuppetPage } from '@ulixee/hero-interfaces/IPuppetPage';
import EventSubscriber from '@ulixee/commons/lib/EventSubscriber';
import IDevtoolsSession, { Protocol } from '@ulixee/hero-interfaces/IDevtoolsSession';
import {
  ___emitFromDevtoolsToCore,
  EventType,
} from '../../injected-scripts/DevtoolsBackdoorConfig';
import ChromeAliveCore from '../../index';
import HeroCorePlugin from '../HeroCorePlugin';
import AliveBarPositioner from '../AliveBarPositioner';
import IElementSummary from '@ulixee/apps-chromealive-interfaces/IElementSummary';

export default class DevtoolsBackdoorModule {
  public pendingLiveInspectedNode: { tabId: number; backendNodeId: number; frameId: string };

  private events = new EventSubscriber();

  private devtoolsSessionMap = new Map<
    IDevtoolsSession,
    { executionContextId: number; tabId?: number }
  >();

  private tabMap = new Map<
    number,
    { executionContextId: number; devtoolsSession: IDevtoolsSession }
  >();

  constructor(readonly heroPlugin: HeroCorePlugin) {}

  public async onDevtoolsPanelAttached(devtoolsSession: IDevtoolsSession): Promise<void> {
    this.events.on(devtoolsSession, 'Runtime.executionContextCreated', event =>
      this.onExecutionContextCreated(devtoolsSession, event),
    );

    this.events.on(devtoolsSession, 'Runtime.bindingCalled', event =>
      this.handleIncomingMessageFromBrowser(devtoolsSession, event),
    );

    await Promise.all([
      devtoolsSession.send('Runtime.addBinding', { name: ___emitFromDevtoolsToCore }),
      devtoolsSession.send('Runtime.runIfWaitingForDebugger'),
    ]).catch(() => null);
  }

  public onDevtoolsPanelDetached(devtoolsSession: IDevtoolsSession): void {
    const tabId = this.devtoolsSessionMap.get(devtoolsSession)?.tabId;
    this.devtoolsSessionMap.delete(devtoolsSession);
    this.tabMap.delete(tabId);
    this.events.close();
  }

  public close(): void {
    this.devtoolsSessionMap.clear();
    this.tabMap.clear();
    this.events.close();
  }

  public async showElementsPanel(puppetPage: IPuppetPage): Promise<void> {
    const tabId = await this.heroPlugin.getTabIdByPuppetPageId(puppetPage.id);
    await this.send(tabId, 'DevtoolsBackdoor.showElementsPanel');
  }

  // COMMANDS

  public async toggleInspectElementMode(): Promise<boolean> {
    const puppetPage = this.heroPlugin.activePuppetPage;
    if (!puppetPage) return;

    await puppetPage.bringToFront();
    await puppetPage.evaluate('document.body.focus()');

    const tabId = await this.heroPlugin.getTabIdByPuppetPageId(puppetPage.id);
    return await this.send(tabId, 'DevtoolsBackdoor.toggleInspectElementMode');
  }

  public async closeDevtoolsPanelForPage(puppetPage: IPuppetPage): Promise<void> {
    const tabId = await this.heroPlugin.getTabIdByPuppetPageId(puppetPage.id);
    await this.send(tabId, 'DevtoolsBackdoor.closeDevtools');
  }

  public async searchDom(query: string): Promise<IElementSummary[]> {
    const puppetPage = this.heroPlugin.activePuppetPage;
    if (!puppetPage) return;

    const tabId = await this.heroPlugin.getTabIdByPuppetPageId(puppetPage.id);
    await this.send(tabId, 'DevtoolsBackdoor.showElementsPanel');
    const elementSummaries = await this.send(tabId, 'DevtoolsBackdoor.searchDom', [query]);

    return elementSummaries;
  }

  public async focusPendingFinderNode(): Promise<void> {
    const pendingLiveInspectedNode = this.pendingLiveInspectedNode;
    if (!pendingLiveInspectedNode) return;
    this.pendingLiveInspectedNode = null;

    // 1. Get Hero.nodeId from the source frame (re: second arg, mirror page doesn't run in isolated world)
    const heroNodeId = await this.translateBackendNodeIdToHeroId(pendingLiveInspectedNode, true);

    if (!heroNodeId) return;

    // 2. Find the backendNodeId in the target page
    const mirrorPuppetPage = this.heroPlugin.mirrorPuppetPage;
    const backendNodeId = await this.translateHeroNodeIdToBackendNodeId(
      mirrorPuppetPage,
      heroNodeId,
      false,
    );

    // 3. Send backendNodeId to the client-side Backdoor
    const mirrorTabId = await this.heroPlugin.getTabIdByPuppetPageId(mirrorPuppetPage.id);
    await this.send(mirrorTabId, 'DevtoolsBackdoor.revealNodeInElementsPanel', [backendNodeId]);
  }

  // END OF COMMANDS

  private async translateHeroNodeIdToBackendNodeId(
    page: IPuppetPage,
    heroNodeId: number,
    isolatedEnvironment = true,
  ): Promise<number> {
    // not sure how to get the right frame?
    const frame = page.mainFrame;
    const highlightNodeEvent = new Promise<Protocol.Runtime.InspectRequestedEvent>(resolve => {
      this.events.once(page.devtoolsSession, 'Runtime.inspectRequested', resolve);
    });
    await frame.evaluate(
      `inspect(NodeTracker.getWatchedNodeWithId(${heroNodeId}))`,
      isolatedEnvironment,
      { includeCommandLineAPI: true },
    );
    const highlightedNode = await highlightNodeEvent;
    const objectId = highlightedNode.object?.objectId;
    if (!objectId) return;
    const nodeDescription = await page.devtoolsSession.send('DOM.describeNode', {
      objectId,
    });
    return nodeDescription.node.backendNodeId;
  }

  private async translateBackendNodeIdToHeroId(
    nodeLocation: {
      tabId: number;
      backendNodeId: number;
      frameId?: string;
    },
    resolveNodeInIsolatedContext = true,
  ): Promise<number> {
    const { tabId, backendNodeId, frameId } = nodeLocation;
    const puppetPage = await this.heroPlugin.getPuppetPageByTabId(tabId);
    if (!puppetPage) return null;
    const sourceFrame = puppetPage.frames.find(x => x.id === frameId) ?? puppetPage.mainFrame;
    const chromeNodeId = await sourceFrame.resolveNodeId(
      backendNodeId,
      resolveNodeInIsolatedContext,
    );
    return await sourceFrame.evaluateOnNode<number>(chromeNodeId, 'NodeTracker.watchNode(this)');
  }

  private handleIncomingMessageFromBrowser(devtoolsSession: IDevtoolsSession, message: any): void {
    if (message.name !== ___emitFromDevtoolsToCore) return;
    const payload = JSON.parse(message.payload);
    const event = payload.event;
    if (event === EventType.ElementWasSelected) {
      this.emitElementWasSelected(devtoolsSession, payload.backendNodeId).catch(console.error);
    } else if (event === EventType.ToggleInspectElementMode) {
      this.emitToggleInspectElementMode(payload.isActive);
    } else if (event === EventType.DevtoolsFocus) {
      this.emitDevtoolsFocusChanged(devtoolsSession, payload.focus, payload.dockSide);
    }
  }

  private async emitElementWasSelected(
    devtoolsSession: IDevtoolsSession,
    backendNodeId: number,
  ): Promise<void> {
    const { tabId } = this.devtoolsSessionMap.get(devtoolsSession);
    const puppetPage = await this.heroPlugin.getPuppetPageByTabId(tabId);
    if (!puppetPage) {
      // TODO: This should not be thrown. Find out why.
      console.error('MISSING puppetPage: ', tabId, puppetPage);
    }
    const result = await puppetPage.devtoolsSession.send('DOM.describeNode', {
      backendNodeId,
    });

    const nodeOverview = result.node;
    const element = this.toElementSummary(nodeOverview, { backendNodeId });

    if (puppetPage.groupName === 'session') {
      this.pendingLiveInspectedNode = { tabId, frameId: nodeOverview.frameId, backendNodeId };
      return;
    }
    ChromeAliveCore.sendAppEvent('DevtoolsBackdoor.elementWasSelected', {
      element,
    });
  }

  private emitToggleInspectElementMode(isActive: boolean): void {
    ChromeAliveCore.sendAppEvent('DevtoolsBackdoor.toggleInspectElementMode', { isActive });
  }

  private emitDevtoolsFocusChanged(
    devtoolsSession: IDevtoolsSession,
    isFocused: boolean,
    dockSide: 'undocked' | 'bottom' | 'left' | 'right',
  ): void {
    const tabId = this.devtoolsSessionMap.get(devtoolsSession)?.tabId;
    void this.heroPlugin.getPuppetPageByTabId(tabId).then(puppetPage => {
      if (puppetPage) {
        AliveBarPositioner.setDevtoolsFocused(puppetPage.id, isFocused, dockSide);
      }
      return null;
    });
  }

  private toElementSummary(
    nodeOverview: Protocol.DOM.Node,
    id: { backendNodeId?: number; objectId?: string },
  ): IElementSummary {
    const attributes: IElementSummary['attributes'] = [];
    if (nodeOverview.attributes) {
      for (let i = 0; i < nodeOverview.attributes.length; i += 2) {
        const name = nodeOverview.attributes[i];
        const value = nodeOverview.attributes[i + 1];
        attributes.push({ name, value });
      }
    }
    const element: IElementSummary = {
      ...id,
      localName: nodeOverview.localName,
      nodeName: nodeOverview.nodeName,
      nodeType: nodeOverview.nodeType,
      attributes,
      hasChildren: nodeOverview.childNodeCount > 0,
      nodeValueInternal: nodeOverview.nodeValue,
    };
    return element;
  }

  private async onExecutionContextCreated(
    devtoolsSession: IDevtoolsSession,
    event: Protocol.Runtime.ExecutionContextCreatedEvent,
  ): Promise<void> {
    if (this.devtoolsSessionMap.has(devtoolsSession)) return;

    let response: Protocol.Runtime.EvaluateResponse;
    try {
      response = await devtoolsSession.send('Runtime.evaluate', {
        expression: `(function devtoolsBackdoorInjectedScripts() {
          ${injectedScript};
          return DevtoolsBackdoor.getInspectedTabId(10e3);
        })();`,
        awaitPromise: true,
        returnByValue: true,
        contextId: event.context.id,
      });
      if (response.exceptionDetails) {
        throw new Error(response.exceptionDetails.exception.description);
      }
    } catch (error) {
      if (error.message.includes('Cannot find context with specified id')) return;
      throw error;
    }
    const executionContextId = event.context.id;
    const tabId = response.result.value;

    this.devtoolsSessionMap.set(devtoolsSession, { executionContextId, tabId });
    this.tabMap.set(tabId, { executionContextId, devtoolsSession });
  }

  private async send(tabId: number, command: string, args: any[] = []): Promise<any> {
    const { devtoolsSession, executionContextId } = this.tabMap.get(tabId);
    const response = await devtoolsSession.send('Runtime.evaluate', {
      expression: `(function devtoolsBackdoorCommand() {
        return ${command}(...${JSON.stringify(args)});
      })();`,
      awaitPromise: true,
      returnByValue: true,
      contextId: executionContextId,
    });
    if (response.exceptionDetails) {
      throw new Error(response.exceptionDetails.exception.description);
    }

    return response.result.value;
  }
}

const pageScripts = {
  DevtoolsBackdoorConfig: fs.readFileSync(
    `${__dirname}/../../injected-scripts/DevtoolsBackdoorConfig.js`,
    'utf8',
  ),
  DevtoolsBackdoor: fs.readFileSync(
    `${__dirname}/../../injected-scripts/DevtoolsBackdoor.js`,
    'utf8',
  ),
};

const injectedScript = `(function devtoolsBackdoor() {
  const exports = {}; // workaround for ts adding an exports variable

  ${pageScripts.DevtoolsBackdoorConfig};
  ${pageScripts.DevtoolsBackdoor};
})();`;
