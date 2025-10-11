import type { Protocol } from "devtools-protocol";

export type RuleMatch = Protocol.CSS.RuleMatch;
export type PseudoElementMatches = Protocol.CSS.PseudoElementMatches;
export type CSSProperty = Protocol.CSS.CSSProperty;

export type ParsedCSSProperties = {
  [property: string]: {
    value: string;
    important?: boolean;
    explicit?: boolean; // whether explicitly set in the CSS (not inherited)
  };
};

export type ParsedCSSRules = {
  [selector: string]: ParsedCSSProperties;
};

// mediaKey is just for grouping, content not important
export type ParsedStyleSheet = { [mediaKey: string]: ParsedCSSRules };

export type NodeWithId = Omit<Protocol.DOM.Node, "children"> & {
  id?: string;
  children?: NodeWithId[];
  //computedStyle?: Protocol.CSS.CSSComputedStyleProperty[];
};

export type GetMatchedStylesForNodeResponse =
  Protocol.CSS.GetMatchedStylesForNodeResponse;
