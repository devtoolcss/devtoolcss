import { CDPNodeType } from "./constants.js";

export type DOMNode<N> = {
  nodeType: number;
  children?: Array<N> | null | undefined;
};

// travserse ELEMENT_NODEs only
export async function traverse<N extends DOMNode<N>>(
  node: N,
  callback: (node: N, depth?: number) => Promise<void> | void,
  onError: (e: any) => void,
  maxDepth: number = -1,
  parallel = false,
) {
  async function _traverse(node: N, depth: number) {
    if (node.nodeType !== CDPNodeType.ELEMENT_NODE) return;
    if (maxDepth >= 0 && depth > maxDepth) return;
    try {
      await callback(node, depth);

      if (node.children) {
        if (parallel)
          await Promise.all(
            node.children.map((child) => _traverse(child, depth + 1)),
          );
        else
          for (const child of node.children) await _traverse(child, depth + 1);
      }
    } catch (e) {
      onError(e);
    }
  }

  await _traverse(node, 0);
}
