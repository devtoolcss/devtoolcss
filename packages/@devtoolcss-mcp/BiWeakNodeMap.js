export class BiWeakNodeMap {
  constructor() {
    this.idCnt = 0;
    this._idToRef = new Map(); // id -> WeakRef(node)
    this._nodeToId = new WeakMap(); // node -> id
  }

  set(node) {
    const id = `${node.nodeName.toLowerCase()}_${++this.idCnt}`;
    this._idToRef.set(id, new WeakRef(node));
    this._nodeToId.set(node, id);
    return id;
  }

  getNode(id) {
    const ref = this._idToRef.get(id);
    if (!ref) return undefined;
    const node = ref.deref();
    if (!node) {
      // Node GC'd, clean up stale entry
      this._idToRef.delete(id);
    }
    return node;
  }

  getId(node) {
    return this._nodeToId.get(node);
  }

  cleanUp() {
    for (const [id, ref] of this._idToRef.entries()) {
      if (ref.deref() === undefined) {
        this._idToRef.delete(id);
      }
    }
  }
}
