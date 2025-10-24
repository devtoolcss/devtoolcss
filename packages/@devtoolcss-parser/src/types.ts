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
export type ParsedCSSRule = {
  allSelectors: string[];
  matchedSelectors: string[];
  properties: ParsedCSSPropertyValue[];
  origin: string;
  cssText?: string;
};

export type ParsedCSS = {
  inherited: { inline: ParsedCSSPropertyValue[]; matched: ParsedCSSRule[] }[];
  attributes: ParsedCSSPropertyValue[];
  matched: ParsedCSSRule[];
  pseudoElements: ParsedCSSRule[];
  inline: ParsedCSSPropertyValue[];
};
