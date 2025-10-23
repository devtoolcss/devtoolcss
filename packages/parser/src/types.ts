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
  inherited?: boolean; // not needed for final output, TODO: better typing
  explicit?: boolean; // whether explicitly set in the CSS (not inherited), not needed for final output
  applied?: boolean; // whether applied
};

export type ParsedCSSPropertyObject = {
  [property: string]: ParsedCSSPropertyValue;
};

// Array to allow repetitive properties for checking which one is applied
// TODO: allow selector repetition with array
// TODO: add stylesheet source
export type ParsedCSSRules = {
  [selector: string]: ParsedCSSPropertyValue[];
};

export type NodeWithId = Omit<Protocol.DOM.Node, "children"> & {
  id?: string;
  css?: any; //ParsedCSS | ParsedCSS[];
  children?: NodeWithId[];
  //computedStyle?: Protocol.CSS.CSSComputedStyleProperty[];
};

export type ParsedCSS = {
  inherited: ParsedCSSRules[]; // selector "::inline", "::attributes" are special cases
  attributes: ParsedCSSPropertyValue[];
  matched: ParsedCSSRules;
  pseudoElementMatched: { [pseudoType: string]: ParsedCSSRules };
  inline: ParsedCSSPropertyValue[];
};

export type Screen = {
  width: number;
  height: number;
  deviceScaleFactor: number;
  mobile: boolean;
};
