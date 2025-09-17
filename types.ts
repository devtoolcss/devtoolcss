import type { Protocol } from "devtools-protocol";
export type CSSRules = {
  [selector: string]: {
    [property: string]: {
      value: string;
      important?: boolean;
      explicit?: boolean;
    };
  };
};

export type Node = Omit<Protocol.DOM.Node, "children"> & {
  id?: string;
  children?: Node[];
  css?: { [key: string]: CSSRules };
};
