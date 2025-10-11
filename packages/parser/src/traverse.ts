import { CDPNodeType } from "./constants.js";

export type DOMNode<N> = {
  nodeType: number;
  children?: Array<N> | null | undefined;
};

// travserse ELEMENT_NODEs only
export async function traverse<N extends DOMNode<N>>(
  node: N,
  callback: (n: N) => Promise<void> | void,
  onError: (e: any) => void,
  parallel = false,
) {
  if (node.nodeType !== CDPNodeType.ELEMENT_NODE) return; // element
  try {
    await callback(node);

    if (node.children) {
      if (parallel)
        await Promise.all(
          node.children.map((child) =>
            traverse(child, callback, onError, parallel),
          ),
        );
      else
        for (const child of node.children)
          await traverse(child, callback, onError, parallel);
    }
  } catch (e) {
    onError(e);
  }
}
