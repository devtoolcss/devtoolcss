import type { Inspector } from "./Inspector.js";

export class NodeWrapper {
  protected static wrapperCache = new WeakMap<Node, NodeWrapper>();

  readonly node: Node;
  protected inspector: Inspector;
  protected objectId?: string | null;

  static get(node: Node, inspector: Inspector): NodeWrapper {
    const cached = NodeWrapper.wrapperCache.get(node);
    if (cached) return cached;
    const wrapper = new NodeWrapper(node, inspector);
    NodeWrapper.wrapperCache.set(node, wrapper);
    return wrapper;
  }

  protected constructor(node: Node, inspector: Inspector) {
    this.node = node;
    this.inspector = inspector;
  }
  protected async callFunctionOn(args: any[], functionDeclaration: string) {
    // always do live check first
    const cdpNode = this.inspector.getCdpNode(this);
    if (!cdpNode) {
      throw new Error("Node is not tracked in the inspector");
    }

    if (!this.objectId) {
      // Get the remote object ID for this node
      const { object } = await this.inspector.sendCommand("DOM.resolveNode", {
        nodeId: cdpNode.nodeId,
      });
      this.objectId = object.objectId;
    }

    const { result, exceptionDetails } = await this.inspector.sendCommand(
      "Runtime.callFunctionOn",
      {
        objectId: this.objectId,
        arguments: args.map((arg) => ({ value: arg })),
        functionDeclaration,
      },
    );
    if (exceptionDetails) {
      const errorMessage = `${
        exceptionDetails.text || "Runtime exception"
      } at line ${exceptionDetails.lineNumber}, column ${
        exceptionDetails.columnNumber
      } of ${functionDeclaration}\n with arguments ${JSON.stringify(args)}`;
      const error = new Error(errorMessage);
      error.name = "RuntimeException";
      throw error;
    }
    return result;
  }

  get nodeType() {
    return this.node.nodeType;
  }

  get nodeName() {
    return this.node.nodeName;
  }

  get nodeValue() {
    return this.node.nodeValue;
  }

  get textContent(): string | null {
    return this.node.textContent;
  }

  get parentNode(): NodeWrapper | null {
    return this.node.parentNode
      ? new NodeWrapper(this.node.parentNode, this.inspector)
      : null;
  }

  get childNodes(): NodeWrapper[] {
    return Array.from(this.node.childNodes).map(
      (child) => new NodeWrapper(child, this.inspector),
    );
  }

  get firstChild(): NodeWrapper | null {
    return this.node.firstChild
      ? new NodeWrapper(this.node.firstChild, this.inspector)
      : null;
  }

  get lastChild(): NodeWrapper | null {
    return this.node.lastChild
      ? new NodeWrapper(this.node.lastChild, this.inspector)
      : null;
  }

  get nextSibling(): NodeWrapper | null {
    return this.node.nextSibling
      ? new NodeWrapper(this.node.nextSibling, this.inspector)
      : null;
  }

  get previousSibling(): NodeWrapper | null {
    return this.node.previousSibling
      ? new NodeWrapper(this.node.previousSibling, this.inspector)
      : null;
  }

  contains(other: NodeWrapper): boolean {
    return this.node.contains(other.node);
  }

  // runtime methods (experimental, limited support)
  //
  // Current difficulties are:
  // 1. getters/setters cannot be async
  // 2. serialized arguments cannot be compared. Ex: .removeChild(child)
  //    needs the exact child object
  // 3. some returned values need extra handling (like Node)

  /**
   * @experimental
   */
  async remove(): Promise<void> {
    await this.callFunctionOn([], "function() { this.remove(); }");
  }
}

export class ElementWrapper extends NodeWrapper {
  get element(): Element {
    return this.node as Element;
  }

  static get(element: Element, inspector: Inspector): ElementWrapper {
    const cached = ElementWrapper.wrapperCache.get(element) as ElementWrapper;
    if (cached) return cached;
    const wrapper = new ElementWrapper(element, inspector);
    ElementWrapper.wrapperCache.set(element, wrapper);
    return wrapper;
  }

  protected constructor(element: Element, inspector: Inspector) {
    super(element, inspector);
  }

  get tagName() {
    return this.element.tagName;
  }

  get id() {
    return this.element.id;
  }

  get className() {
    return this.element.className;
  }

  get children(): ElementWrapper[] {
    return Array.from(this.element.children).map(
      (child) => new ElementWrapper(child, this.inspector),
    );
  }

  get attributes(): NamedNodeMap {
    return this.element.attributes;
  }

  get classList(): DOMTokenList {
    return this.element.classList;
  }

  querySelector(selector: string): ElementWrapper | null {
    const el = this.element.querySelector(selector);
    return el ? new ElementWrapper(el, this.inspector) : null;
  }

  querySelectorAll(selector: string): ElementWrapper[] {
    return Array.from(this.element.querySelectorAll(selector)).map(
      (el) => new ElementWrapper(el, this.inspector),
    );
  }

  get textContent(): string | null {
    return this.element.textContent;
  }

  get innerHTML(): string {
    return this.element.innerHTML;
  }

  get outerHTML(): string {
    return this.element.outerHTML;
  }

  get parentNode(): NodeWrapper | null {
    const parent = this.element.parentNode;
    if (!parent) return null;
    return parent instanceof Element
      ? new ElementWrapper(parent, this.inspector)
      : new NodeWrapper(parent, this.inspector);
  }

  get parentElement(): ElementWrapper | null {
    return this.element.parentElement
      ? new ElementWrapper(this.element.parentElement, this.inspector)
      : null;
  }

  get nextSibling(): NodeWrapper | null {
    const next = this.element.nextSibling;
    if (!next) return null;
    return next instanceof Element
      ? new ElementWrapper(next, this.inspector)
      : new NodeWrapper(next, this.inspector);
  }

  get nextElementSibling(): ElementWrapper | null {
    return this.element.nextElementSibling
      ? new ElementWrapper(this.element.nextElementSibling, this.inspector)
      : null;
  }

  get previousSibling(): NodeWrapper | null {
    const prev = this.element.previousSibling;
    if (!prev) return null;
    return prev instanceof Element
      ? new ElementWrapper(prev, this.inspector)
      : new NodeWrapper(prev, this.inspector);
  }

  get previousElementSibling(): ElementWrapper | null {
    return this.element.previousElementSibling
      ? new ElementWrapper(this.element.previousElementSibling, this.inspector)
      : null;
  }

  get childNodes(): NodeWrapper[] {
    return Array.from(this.element.childNodes).map((child) =>
      child instanceof Element
        ? new ElementWrapper(child, this.inspector)
        : new NodeWrapper(child, this.inspector),
    );
  }

  get firstChild(): NodeWrapper | null {
    const first = this.element.firstChild;
    if (!first) return null;
    return first instanceof Element
      ? new ElementWrapper(first, this.inspector)
      : new NodeWrapper(first, this.inspector);
  }

  get lastChild(): NodeWrapper | null {
    const last = this.element.lastChild;
    if (!last) return null;
    return last instanceof Element
      ? new ElementWrapper(last, this.inspector)
      : new NodeWrapper(last, this.inspector);
  }

  getAttribute(name: string) {
    return this.element.getAttribute(name);
  }

  matches(selector: string): boolean {
    return this.element.matches(selector);
  }

  closest(selector: string): ElementWrapper | null {
    const el = this.element.closest(selector);
    return el ? new ElementWrapper(el, this.inspector) : null;
  }

  // runtime methods (experimental, limited support)

  /**
   * @experimental
   */
  async scrollIntoView(): Promise<void> {
    await this.callFunctionOn([], "function() { this.scrollIntoView(); }");
  }

  /**
   * @experimental
   */
  async click(): Promise<void> {
    await this.callFunctionOn([], "function() { this.click(); }");
  }
}
