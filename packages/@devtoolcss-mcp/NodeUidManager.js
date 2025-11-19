// generate and record uids for node.
export class NodeUidManager {
  constructor() {
    this._nodeCounters = new Map(); // nodeName -> counter
    this._idToRef = new Map(); // id -> WeakRef(node)
    this._nodeToId = new WeakMap(); // node -> id
  }

  generateId(node) {
    const nodeName = node.nodeName.toLowerCase();
    const counter = this._nodeCounters.get(nodeName) || 0;
    this._nodeCounters.set(nodeName, counter + 1);
    return `${nodeName}_${counter}`;
  }

  setNode(node) {
    if (this._nodeToId.has(node)) {
      return this._nodeToId.get(node);
    }
    const id = this.generateId(node);
    this._idToRef.set(id, new WeakRef(node));
    this._nodeToId.set(node, id);
    return id;
  }

  getNode(uid, inspector) {
    // predefined
    if (uid === "document") return inspector.document;
    if (uid === "$0") return inspector.$0;

    // from map
    const ref = this._idToRef.get(uid);
    if (!ref) return undefined;
    const node = ref.deref();
    if (!node) {
      // Node GC'd, clean up stale entry
      this._idToRef.delete(uid);
    }
    return node;
  }

  cleanUp() {
    // FIXME: didn't really cleanup deleted inspector's nodes
    for (const [id, ref] of this._idToRef.entries()) {
      if (ref.deref() === undefined) {
        this._idToRef.delete(id);
      }
    }
  }
}
