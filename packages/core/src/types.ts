import type { Protocol } from "devtools-protocol";

// mediaKey is just for grouping, content not important
export type StyleSheet = { [mediaKey: string]: CSSRules };

export type RuleMatch = Protocol.CSS.RuleMatch;
export type PseudoElementMatches = Protocol.CSS.PseudoElementMatches;
export type CSSProperty = Protocol.CSS.CSSProperty;

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
  //computedStyle?: Protocol.CSS.CSSComputedStyleProperty[];
};

export type GetMatchedStylesForNodeResponse =
  Protocol.CSS.GetMatchedStylesForNodeResponse;
