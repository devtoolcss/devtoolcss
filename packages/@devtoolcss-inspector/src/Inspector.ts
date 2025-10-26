import { parseGetMatchedStylesForNodeResponse } from "@devtoolcss/parser";
import { CDPNodeType } from "./constants.js";
import EventEmitter from "./EventEmitter.js";
import {
  CDPNode,
  CDPClient,
  InspectOptions,
  ScreenSetting,
  RawInspectResult,
  ParsedInspectResult,
  InspectResult,
} from "./types.js";
import highlightConfig from "./highlightConfig.js";

let JSDOM: any = null;

if (typeof window === "undefined") {
  const s = "jsdom"; // somehow have to do this to avoid bundler issue
  JSDOM = (await import(s)).JSDOM;
}

function findNodeIdx(nodes: CDPNode[], nodeId: number): number {
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].nodeId === nodeId) {
      return i;
    }
  }
  return null;
}

// we need EventEmitter for warning events, which can happen
// anytime event fired
export class Inspector extends EventEmitter {
  private documentImpl: Document;
  readonly document: Document;

  private idToNodes = new Map<number, { cdpNode: CDPNode; docNode: Node }>();
  private nodeToId = new Map<Node, number>(); // manage removal by events

  private sendCommand: (method: string, params?: object) => Promise<any>;

  private onCDP: (event: string, callback: (data: any) => void) => void;

  private offCDP: (event: string, callback: (data: any) => void) => void;

  // describeNode depth -1 is buggy, often return nodeId=0, causing bug
  // devtools use DOM.requestChildNodes and receive the results from DOM.setChildNodes event
  // devtools-frontend just await DOM.requestChildNodes, but for safety we also await the event
  private async getChildren(node: CDPNode): Promise<void> {
    const childrenPromise = new Promise<void>((resolve) => {
      // if no children to request, also good
      const timeoutId = setTimeout(() => {
        this.offCDP("DOM.setChildNodes", handler);
        resolve();
      }, 500);

      let handler;
      handler = (data: any) => {
        if (node.nodeId !== data.parentId) return;
        node.children = data.nodes;
        this.offCDP("DOM.setChildNodes", handler);
        clearTimeout(timeoutId);
        resolve();
      };

      this.onCDP("DOM.setChildNodes", handler);
    });
    await this.sendCommand("DOM.requestChildNodes", {
      nodeId: node.nodeId,
      depth: -1,
    });
    await childrenPromise;
  }

  private emitWarning(w: any) {
    this.emit("warning", w);
  }

  private constructor(
    sendCommand: (method: string, params?: any) => Promise<any>,
    onCDP: (event: string, callback: (data: any) => void) => void,
    offCDP: (event: string, callback: (data: any) => void) => void,
    document: Document = JSDOM
      ? new JSDOM("<!DOCTYPE html>").window.document
      : window.document,
  ) {
    super();
    // source document for calling .implementation.createHTMLDocument()
    this.documentImpl = document;
    this.sendCommand = sendCommand;
    this.onCDP = onCDP;
    this.offCDP = offCDP;
  }

  static async fromCDPClient(
    client: CDPClient,
    documentImpl?: Document,
  ): Promise<Inspector> {
    const sendCommand = (method: string, params?: any) =>
      client.send(method, params);
    const onCDP = (event: string, callback: (data: any) => void) =>
      client.on(event, callback);
    const offCDP = (event: string, callback: (data: any) => void) =>
      client.off(event, callback);

    const inspector = new Inspector(sendCommand, onCDP, offCDP, documentImpl);
    await inspector.init();
    await inspector.initDOM();
    return inspector;
  }

  static async fromChromeDebugger(
    chromeDebugger: typeof chrome.debugger,
    tabId: number,
    documentImpl?: Document,
  ): Promise<Inspector> {
    const sendCommand = async (method: string, params?: any) =>
      chromeDebugger.sendCommand({ tabId }, method, params);
    // storing wrappers to allow off
    const listenerMap = new Map<
      (data: any) => void,
      (source: any, method: string, params: any) => void
    >();
    const onCDP = (event: string, callback: (data: any) => void) => {
      const wrapper = (source, method, params) => {
        if (source.tabId === tabId && method === event) {
          callback(params);
        }
      };
      listenerMap.set(callback, wrapper);
      chromeDebugger.onEvent.addListener(wrapper);
    };
    const offCDP = (event: string, callback: (data: any) => void) => {
      const wrapper = listenerMap.get(callback);
      if (wrapper) {
        chromeDebugger.onEvent.removeListener(wrapper);
        listenerMap.delete(callback);
      }
    };
    const inspector = new Inspector(sendCommand, onCDP, offCDP, documentImpl);
    await inspector.init();
    await inspector.initDOM();
    return inspector;
  }

  private setMap(nodeId: number, cdpNode: CDPNode, docNode: Node) {
    this.idToNodes.set(nodeId, { cdpNode, docNode });
    this.nodeToId.set(docNode, nodeId);
  }

  private deleteMap(nodeId: number, recursive: boolean = true): void {
    const nodes = this.idToNodes.get(nodeId);
    if (!nodes) {
      this.emitWarning(`deleteMap: no node for nodeId ${nodeId}`);
      return;
    }
    const { cdpNode, docNode } = nodes;
    this.nodeToId.delete(docNode);
    this.idToNodes.delete(nodeId);

    if (recursive && cdpNode.children) {
      for (const child of cdpNode.children) {
        this.deleteMap(child.nodeId, true);
      }
    }
  }

  private buildDocNode(cdpNode: CDPNode): Node | null {
    let docNode: Node;

    switch (cdpNode.nodeType) {
      case CDPNodeType.ELEMENT_NODE:
        // iframe is safe because no children (not setting pierce)
        docNode = this.document.createElement(cdpNode.localName);

        if (Array.isArray(cdpNode.attributes)) {
          for (let i = 0; i < cdpNode.attributes.length; i += 2) {
            (docNode as HTMLElement).setAttribute(
              cdpNode.attributes[i],
              cdpNode.attributes[i + 1],
            );
          }
        }
        break;

      case CDPNodeType.TEXT_NODE:
        docNode = this.document.createTextNode(cdpNode.nodeValue || "");
        break;

      case CDPNodeType.COMMENT_NODE:
        docNode = this.document.createComment(cdpNode.nodeValue || "");
        break;

      case CDPNodeType.DOCUMENT_NODE:
        docNode = this.documentImpl.implementation.createHTMLDocument();
        // remove default <html> documentElement
        docNode.removeChild((docNode as Document).documentElement);
        break;

      default:
        return null;
    }
    this.setMap(cdpNode.nodeId, cdpNode, docNode);

    // Recursively add children
    if (cdpNode.children) {
      for (const child of cdpNode.children) {
        const childNode = this.buildDocNode(child);
        if (childNode) docNode.appendChild(childNode);
      }
    }

    return docNode;
  }

  private onAttributeModified(params: {
    nodeId: number;
    name: string;
    value: string;
  }) {
    const nodes = this.idToNodes.get(params.nodeId);
    if (!nodes) {
      this.emitWarning(
        `onAttributeModified: no node for nodeId ${params.nodeId}`,
      );
      return;
    }
    const { cdpNode, docNode } = nodes;
    const attrIndex = cdpNode.attributes.indexOf(params.name);
    if (attrIndex !== -1) {
      cdpNode.attributes[attrIndex + 1] = params.value;
    } else {
      cdpNode.attributes.push(params.name, params.value);
    }
    (docNode as Element).setAttribute(params.name, params.value);
  }

  private onAttributeRemoved(params: { nodeId: number; name: string }) {
    const nodes = this.idToNodes.get(params.nodeId);
    if (!nodes) {
      this.emitWarning(
        `onAttributeRemoved: no node for nodeId ${params.nodeId}`,
      );
      return;
    }
    const { cdpNode, docNode } = nodes;
    // .attributes should always there, the optional is because only Element has attributes
    const attrIndex = cdpNode.attributes.indexOf(params.name);
    if (attrIndex !== -1) {
      cdpNode.attributes.splice(attrIndex, 2);
    }
    (docNode as Element).removeAttribute(params.name);
  }

  private onCharacterDataModified(params: {
    nodeId: number;
    characterData: string;
  }) {
    const nodes = this.idToNodes.get(params.nodeId);
    if (!nodes) {
      this.emitWarning(
        `onCharacterDataModified: no node for nodeId ${params.nodeId}`,
      );
      return;
    }
    const { cdpNode, docNode } = nodes;
    cdpNode.nodeValue = params.characterData;
    docNode.nodeValue = params.characterData;
  }

  private async onChildNodeInserted(params: {
    parentNodeId: number;
    previousNodeId: number;
    node: CDPNode;
  }): Promise<void> {
    const nodes = this.idToNodes.get(params.parentNodeId);
    if (!nodes) {
      this.emitWarning(
        `onChildNodeInserted: no node for nodeId ${params.parentNodeId}`,
      );
      return;
    }
    const { cdpNode: parentCdpNode, docNode: parentDocNode } = nodes;
    // Get cdpNode children if needed
    //
    // We always maintain full tree, so unlike devtool we request children here.
    // This is async but fine because descendants won't be updated during await.
    // Even if parent is removed, the update still succeed because it holds the reference.
    //
    // The node from insert event may or maynot have children initialized,
    // hoping not partially initialized (say only one level).
    //
    // Since we update much later, node inserted and later removed won't get response.
    // This will be handled by getChildren's timeout.
    //
    // Node with only a #text child (ex: h1) won't get response.
    // DevTool UI also expand the #text as the same level.
    // Seems childNodeInserted will handle this by selective providing children.
    // So here checking !node.children is good.
    const childCdpNode = params.node;
    if (
      childCdpNode.nodeType === CDPNodeType.ELEMENT_NODE &&
      childCdpNode.childNodeCount > 0 &&
      !childCdpNode.children
    ) {
      await this.getChildren(childCdpNode);
    }

    // build docNode
    const childDocNode = this.buildDocNode(childCdpNode);

    const prevIdx =
      params.previousNodeId === 0
        ? -1
        : findNodeIdx(parentCdpNode.children, params.previousNodeId);
    if (prevIdx !== null) {
      // insert cdpNode
      parentCdpNode.children.splice(prevIdx + 1, 0, params.node);

      // insert docNode
      const referenceNode = parentDocNode.childNodes[prevIdx + 1] || null; // null for append
      parentDocNode.insertBefore(childDocNode, referenceNode);
    } else {
      this.emitWarning(
        `onChildNodeInserted: no previous node for nodeId ${params.previousNodeId}`,
      );
    }
  }

  private onChildNodeRemoved(params: { parentNodeId: number; nodeId: number }) {
    const nodes = this.idToNodes.get(params.parentNodeId);
    if (!nodes) {
      this.emitWarning(
        `onChildNodeRemoved: no node for nodeId ${params.parentNodeId}`,
      );
      return;
    }
    const { cdpNode: parentCdpNode, docNode: parentDocNode } = nodes;
    const idx = findNodeIdx(parentCdpNode.children, params.nodeId);
    if (idx !== null) {
      parentCdpNode.children.splice(idx, 1);
      this.deleteMap(params.nodeId);

      parentDocNode.removeChild(parentDocNode.childNodes[idx]);
    } else {
      this.emitWarning(
        `onChildNodeRemoved: no child node for nodeId ${params.nodeId}`,
      );
    }
  }

  private async onDocumentUpdated(): Promise<void> {
    await this.initDOM();
  }

  private registerDOMHandlers() {
    this.onCDP("DOM.attributeModified", (params) => {
      this.onAttributeModified(params);
    });
    this.onCDP("DOM.attributeRemoved", (params) => {
      this.onAttributeRemoved(params);
    });
    this.onCDP("DOM.characterDataModified", (params) => {
      this.onCharacterDataModified(params);
    });
    this.onCDP("DOM.childNodeRemoved", (params) => {
      this.onChildNodeRemoved(params);
    });

    // async handlers
    this.onCDP("DOM.childNodeInserted", async (params) => {
      await this.onChildNodeInserted(params);
    });
    this.onCDP("DOM.documentUpdated", async (params) => {
      await this.onDocumentUpdated();
    });
  }

  private async init(): Promise<void> {
    await this.sendCommand("DOM.enable");
    await this.sendCommand("CSS.enable");
    await this.sendCommand("Overlay.enable"); // somehow have to enable to use
    this.registerDOMHandlers();
  }

  private async initDOM(): Promise<void> {
    const { root } = await this.sendCommand("DOM.getDocument", {
      depth: 0,
    });
    // Use depth: -1 is probably safe, as tested in
    // https://source.chromium.org/chromium/chromium/src/+/main:third_party/blink/web_tests/inspector-protocol/dom/dom-mutationEvents.js;l=62;drc=ef646bf22edb325602a0ad200f2f4382cf1b3e08
    // but just in case we keep it.
    await this.getChildren(root);
    this.buildDocNode(root);
  }

  // user may need nodeId for other CDP operations or references
  getNodeId(node: Node): number | undefined {
    return this.nodeToId.get(node);
  }

  getNodeById(nodeId: number): Node | undefined {
    const nodes = this.idToNodes.get(nodeId);
    return nodes ? nodes.docNode : undefined;
  }

  async forcePseudoState(node: Node, pseudoClasses: string[]): Promise<void> {
    const nodeId = this.nodeToId.get(node);
    if (!nodeId) {
      throw new Error("Element not found in the inspector's document.");
    }

    await this.sendCommand("CSS.forcePseudoState", {
      nodeId,
      forcedPseudoClasses: pseudoClasses,
    });
  }

  // Assume operations needing objectId not care performance much
  // so internally getObjectId each time
  private async getObjectId(nodeId: number): Promise<string> {
    const { object } = await this.sendCommand("DOM.resolveNode", {
      nodeId,
    });
    if (!object.objectId) {
      throw new Error("Failed to resolve nodeId to objectId.");
    }
    return object.objectId;
  }

  async scrollToNode(node: Node): Promise<void> {
    const nodeId = this.nodeToId.get(node);
    if (!nodeId) {
      throw new Error("Element not found in the inspector's document.");
    }

    const objectId = await this.getObjectId(nodeId);

    await this.sendCommand("Runtime.callFunctionOn", {
      arguments: [],
      functionDeclaration:
        "function(){this.scrollIntoView({behavior: 'instant', block: 'center'});}",
      objectId,
      silent: true,
    });
  }

  async highlightNode(node: Node): Promise<void> {
    const nodeId = this.nodeToId.get(node);
    if (!nodeId) {
      throw new Error("Element not found in the inspector's document.");
    }

    const objectId = await this.getObjectId(nodeId);

    await this.sendCommand("Overlay.highlightNode", {
      highlightConfig,
      objectId,
    });
  }

  async hideHighlight(): Promise<void> {
    await this.sendCommand("Overlay.hideHighlight");
  }

  async setScreen(screen: ScreenSetting): Promise<void> {
    await this.sendCommand("Emulation.setDeviceMetricsOverride", screen);
  }

  async inspect(
    element: Element,
    options: InspectOptions & { raw: true },
  ): Promise<RawInspectResult>;
  async inspect(
    element: Element,
    options?: InspectOptions & { raw?: false },
  ): Promise<ParsedInspectResult>;

  async inspect(
    element: Element, // only allow Element, which have styles
    options: InspectOptions = {},
  ): Promise<InspectResult> {
    const { raw = false, exclude = {}, parseOptions = {} } = options;

    const nodeId = this.nodeToId.get(element);

    if (nodeId === undefined) {
      throw new Error("Element not found in the inspector's document.");
    }

    const ret = {} as InspectResult;

    if (!exclude.styles) {
      const styles = await this.sendCommand("CSS.getMatchedStylesForNode", {
        nodeId,
      });
      ret.styles = raw
        ? styles
        : parseGetMatchedStylesForNodeResponse(styles, parseOptions);
    }

    if (!exclude.computed) {
      const { computedStyle } = await this.sendCommand(
        "CSS.getComputedStyleForNode",
        { nodeId },
      );
      ret.computed = raw
        ? computedStyle
        : computedStyle.reduce(
            (
              obj: Record<string, string>,
              item: { name: string; value: string },
            ) => {
              obj[item.name] = item.value;
              return obj;
            },
            {},
          );
    }
    return ret;
  }
}
