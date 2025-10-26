import type { ParseOptions, ParsedCSS } from "@devtoolcss/parser";
import type { Inspector } from "./Inspector.js";

// version independent types for CDP data
export type GetMatchedStylesForNodeResponse = {
  inlineStyle?: any;
  attributesStyle?: any;
  matchedCSSRules?: any[];
  pseudoElements?: any[];
  inherited?: any[];
  inheritedPseudoElements?: any[];
  cssKeyframesRules?: any[];
  cssPositionTryRules?: any[];
  activePositionFallbackIndex?: number;
  cssPropertyRules?: any[];
  cssPropertyRegistrations?: any[];
  cssFontPaletteValuesRule?: any;
  parentLayoutNodeId?: number;
  cssFunctionRules?: any[];
};

export type CDPNode = {
  nodeId: number;
  nodeType: number;
  localName: string;
  attributes?: string[];
  childNodeCount?: number;
  children?: CDPNode[];

  // custom added properties
  styles?: ParsedCSS | GetMatchedStylesForNodeResponse;
  computed?: object;
  [key: string]: any; // Allow any other properties
};

export type CDPClient = {
  send: (method: string, params?: object) => Promise<any>;
  on: (event: string, callback: (data: any) => void) => void;
  off: (event: string, callback: (data: any) => void) => void;
};

export type ScreenSetting = {
  width: number;
  height: number;
  deviceScaleFactor: number;
  mobile: boolean;
};

export type InspectOptions = {
  exclude?: {
    computed?: boolean;
    styles?: boolean;
  };
  raw?: boolean;
  parseOptions?: ParseOptions;
};

export type ParsedInspectResult = {
  styles?: ParsedCSS;
  computed?: object;
};
export type RawInspectResult = {
  styles?: GetMatchedStylesForNodeResponse;
  computed?: { name: string; value: string }[];
};

export type InspectResult = ParsedInspectResult | RawInspectResult;
