import type { Protocol } from "devtools-protocol";

export type RuleMatch = Protocol.CSS.RuleMatch;
export type PseudoElementMatches = Protocol.CSS.PseudoElementMatches;
export type CSSProperty = Protocol.CSS.CSSProperty;
export type CSSStyle = Protocol.CSS.CSSStyle;

export type GetMatchedStylesForNodeResponse =
  Protocol.CSS.GetMatchedStylesForNodeResponse;

export type ParsedCSSPropertyValue = {
  name: string;
  value: string;
  important: boolean;
  explicit?: boolean; // whether explicitly set in the CSS (not inherited)
  applied?: boolean; // whether applied
};

export type ParsedCSSPropertyObject = {
  [property: string]: ParsedCSSPropertyValue;
};

export type AppliedCSSProperty = {
  [pseudo: string]: ParsedCSSPropertyObject;
};

// Array to allow repetitive properties for checking which one is applied
// TODO: allow selector repetition with array
export type ParsedCSSRules = {
  [selector: string]: ParsedCSSPropertyValue[];
};

// mediaKey is just for grouping, content not important
export type ParsedStyleSheet = { [mediaKey: string]: ParsedCSSRules };

export type NodeWithId = Omit<Protocol.DOM.Node, "children"> & {
  id?: string;
  children?: NodeWithId[];
  //computedStyle?: Protocol.CSS.CSSComputedStyleProperty[];
};

export type ParsedCSS = {
  inherited: ParsedCSSRules[]; // selector ":inline" is a special case
  attributes: ParsedCSSPropertyValue[];
  matched: ParsedCSSRules;
  pseudoElementMatched: { [pseudoType: string]: ParsedCSSRules };
  inline: ParsedCSSPropertyValue[];
};
