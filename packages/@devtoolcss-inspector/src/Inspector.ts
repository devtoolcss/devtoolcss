import {
  parseGetMatchedStylesForNodeResponse,
  traverse,
} from "@devtoolcss/parser";
import { CDPNodeType } from "./constants.js";
import EventEmitter from "./EventEmitter.js";
import { Node, CDPClient, Progress, InspectOptions } from "./types.js";
import highlightConfig from "./highlightConfig.js";

let JSDOM: any = null;

if (typeof window === "undefined") {
  const s = "jsdom"; // somehow have to do this to avoid bundler issue
  JSDOM = (await import(s)).JSDOM;
}

function findNodeIdx(nodes: Node[], nodeId: number): number {
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].nodeId === nodeId) {
      return i;
    }
  }
  return null;
}

export class Inspector extends EventEmitter {
  private static document: Document = JSDOM
    ? new JSDOM().window.document
    : document;

  private docRoot: Node;
  private nodeMap = new Map<number, Node>();
  private isInspecting: boolean = false;

  sendCommand: (method: string, params?: object) => Promise<any>;

  onCDP: (event: string, callback: (data: any) => void) => void;

  offCDP: (event: string, callback: (data: any) => void) => void;

  // describeNode depth -1 is buggy, often return nodeId=0, causing bug
  // devtools use DOM.requestChildNodes and receive the results from DOM.setChildNodes event
  private async getChildren(node: Node): Promise<void> {
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

  private emitProgress(p: Progress) {
    this.emit("progress", p);
  }

  private emitWarning(w: any) {
    this.emit("warning", w);
  }

  private constructor(
    sendCommand: (method: string, params?: any) => Promise<any>,
    onCDP: (event: string, callback: (data: any) => void) => void,
    offCDP: (event: string, callback: (data: any) => void) => void,
  ) {
    super();
    this.sendCommand = sendCommand;
    this.onCDP = onCDP;
    this.offCDP = offCDP;

    this.onCDP("childNodeInserted", (params) => {
      // async but fine
      this.insertNode(params);
      if (this.isInspecting) {
        this.emitWarning(
          "DOM changed during inspection, the inspected result may be incomplete.",
        );
      }
    });

    this.onCDP("childNodeRemoved", (params) => {
      this.removeNode(params);
      if (this.isInspecting) {
        this.emitWarning(
          "DOM changed during inspection, the inspected result may be incomplete.",
        );
      }
    });

    this.onCDP("documentUpdated", () => {
      this.initDOM();
      if (this.isInspecting) {
        this.emitWarning(
          "Document was updated during inspection, the inspected result may be broken.",
        );
      }
    });
  }

  static fromCDPClient(client: CDPClient): Inspector {
    const sendCommand = (method: string, params?: any) =>
      client.send(method, params);
    const onCDP = (event: string, callback: (data: any) => void) =>
      client.on(event, callback);
    const offCDP = (event: string, callback: (data: any) => void) =>
      client.off(event, callback);

    return new Inspector(sendCommand, onCDP, offCDP);
  }

  static fromChromeDebugger(
    chromeDebugger: typeof chrome.debugger,
    tabId: number,
  ): Inspector {
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
    return new Inspector(sendCommand, onCDP, offCDP);
  }

  static nodeToDOM(
    cdpRoot: Node,
    setNodeId = false,
    document: Document = Inspector.document, // can provide custom document
  ): Document {
    const buildNode = (
      cdpNode: Node,
      document: Document,
    ): HTMLElement | Text | Comment | null => {
      let node: HTMLElement | Text | Comment;

      switch (cdpNode.nodeType) {
        case CDPNodeType.ELEMENT_NODE:
          // iframe is safe because no children (not setting pierce)
          node = document.createElement(cdpNode.localName);

          if (Array.isArray(cdpNode.attributes)) {
            for (let i = 0; i < cdpNode.attributes.length; i += 2) {
              node.setAttribute(
                cdpNode.attributes[i],
                cdpNode.attributes[i + 1],
              );
            }
          }
          if (setNodeId) {
            // for selector matching during cascade
            node.setAttribute("data-nodeId", String(cdpNode.nodeId));
          }
          break;

        case CDPNodeType.TEXT_NODE:
          node = document.createTextNode(cdpNode.nodeValue || "");
          break;

        case CDPNodeType.COMMENT_NODE:
          node = document.createComment(cdpNode.nodeValue || "");
          break;

        case CDPNodeType.DOCUMENT_NODE:
          // the first one is DOCUMENT_TYPE_NODE, if exist
          // find the <html> node
          for (const child of cdpNode.children) {
            if (child.localName === "html") return buildNode(child, document);
          }

        default:
          return null;
      }

      // Recursively add children
      if (cdpNode.children) {
        for (const child of cdpNode.children) {
          const childNode = buildNode(child, document);
          if (childNode) node.appendChild(childNode);
        }
      }

      return node;
    };

    // use a new document
    document = document.implementation.createHTMLDocument();
    const componentRoot = buildNode(cdpRoot, document) as HTMLElement;
    if (componentRoot.localName === "html") {
      document.replaceChild(componentRoot, document.documentElement);
    } else if (componentRoot.localName === "head") {
      document.head.replaceWith(componentRoot);
    } else if (componentRoot.localName === "body") {
      document.body.replaceWith(componentRoot);
    } else {
      // be the only child of body
      const body = document.body;
      while (body.firstChild) {
        body.removeChild(body.firstChild);
      }
      body.appendChild(componentRoot);
    }
    return document;
  }

  private buildNodeMap(node: Node) {
    this.nodeMap.set(node.nodeId, node);
    if (node.children) {
      for (const child of node.children) {
        this.buildNodeMap(child);
      }
    }
  }

  private async insertNode(params: {
    parentNodeId: number;
    previousNodeId: number;
    node: Node;
  }) {
    const parentNode = this.nodeMap.get(params.parentNodeId);
    if (parentNode) {
      const prevIdx =
        params.previousNodeId === 0
          ? -1
          : findNodeIdx(parentNode.children, params.previousNodeId);
      if (prevIdx !== null) {
        parentNode.children.splice(prevIdx + 1, 0, params.node);

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
        const node = params.node;
        if (
          node.nodeType === CDPNodeType.ELEMENT_NODE &&
          node.childNodeCount > 0 &&
          !node.children
        ) {
          await this.getChildren(node);
        }
      }
    }
  }

  private removeNode(params: { parentNodeId: number; nodeId: number }) {
    const parentNode = this.nodeMap.get(params.parentNodeId);
    if (parentNode) {
      const idx = findNodeIdx(parentNode.children, params.nodeId);
      if (idx !== null) {
        parentNode.children.splice(idx, 1);
      }
    }
  }

  async getNodeObjectId(node: Node): Promise<string | undefined> {
    const { object } = await this.sendCommand("DOM.resolveNode", {
      nodeId: node.nodeId,
    });
    if (!object.objectId) {
      this.emitWarning(
        `Inspector.getNodeObjectId: Cannot resolve nodeId ${node.nodeId} to objectId`,
      );
      return;
    }
    return object.objectId;
  }

  // get objectId first by getNodeObjectId
  async scrollToNode(objectId: string): Promise<void> {
    await this.sendCommand("Runtime.callFunctionOn", {
      arguments: [],
      functionDeclaration:
        "function(){this.scrollIntoView({behavior: 'instant', block: 'center'});}",
      objectId,
      silent: true,
    });
  }

  // get objectId first by getNodeObjectId
  async highlightNode(objectId: string): Promise<void> {
    await this.sendCommand("Overlay.highlightNode", {
      highlightConfig,
      objectId,
    });
  }

  async hideHighlight(): Promise<void> {
    await this.sendCommand("Overlay.hideHighlight");
  }

  private async initDOM(): Promise<void> {
    const { root } = await this.sendCommand("DOM.getDocument", {
      depth: 0,
    });
    await this.getChildren(root);

    this.docRoot = root;
    this.buildNodeMap(this.docRoot);
  }

  async inspect(selector: string, options: InspectOptions = {}): Promise<Node> {
    const {
      depth = -1,
      raw = false,
      parseOptions = {},
      customScreen,
      beforeTraverse,
      beforeGetMatchedStyle,
      afterGetMatchedStyle,
    } = options;

    this.isInspecting = true;

    if (customScreen) {
      await this.sendCommand(
        "Emulation.setDeviceMetricsOverride",
        customScreen,
      );
    }

    // lazy init
    if (!this.docRoot) {
      await this.sendCommand("DOM.enable");
      await this.sendCommand("CSS.enable");
      await this.initDOM();
    }

    // Find nodeId by freezed DOM, not DOM.querySelector, which
    // returns new nodeId for the same node
    const doc = Inspector.nodeToDOM(this.docRoot, true);
    const el = doc.querySelector(selector);
    const nodeId = el ? Number(el.getAttribute("data-nodeId")) : null;

    if (!nodeId) {
      throw new Error(
        `No node found for selector: ${selector}\n${doc.documentElement.innerHTML}`,
      );
    }

    if (!this.nodeMap.has(nodeId)) {
      throw new Error(`No node found for nodeId: ${nodeId}`);
    }

    // Clone the subtree, docRoot is constantly changing by events
    const node = structuredClone(this.nodeMap.get(nodeId));

    let totalElements = 0;
    const initElements = async (node: Node, d: number) => {
      totalElements += 1;
      if (d === depth) {
        delete node.children;
      }
    };
    await traverse(node, initElements, (e) => this.emitWarning(e), depth, true);

    this.emitProgress({ completed: 0, total: totalElements });

    let completed = 0;
    beforeTraverse?.(node, this, el);
    await traverse(
      node,
      async (node) => {
        await beforeGetMatchedStyle?.(node, this, el);

        const styles = await this.sendCommand("CSS.getMatchedStylesForNode", {
          nodeId: node.nodeId,
        });

        await afterGetMatchedStyle?.(node, this, el);

        if (raw) {
          node.css = styles;
        } else {
          const parsedResponse = parseGetMatchedStylesForNodeResponse(
            styles,
            parseOptions,
          );
          node.css = parsedResponse;
        }

        ++completed;
        this.emitProgress({ completed: completed, total: totalElements });
      },
      (e) => this.emitWarning(e),
      depth,
      false,
    );
    this.isInspecting = false;
    return node;
  }
}
