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

export type ParsedCSS = {
  inherited: ParsedCSSRules[]; // selector "::inline", "::attributes" are special cases
  attributes: ParsedCSSPropertyValue[];
  matched: ParsedCSSRules;
  pseudoElementMatched: { [pseudoType: string]: ParsedCSSRules };
  inline: ParsedCSSPropertyValue[];
};
