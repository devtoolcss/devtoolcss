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

export type Node = {
  nodeId: number;
  nodeType: number;
  localName: string;
  attributes?: string[];
  children?: Node[];
  styles?: ParsedCSS | GetMatchedStylesForNodeResponse;
  computed?: object;
  [key: string]: any; // Allow any other properties
};

export type CDPClient = {
  send: (method: string, params?: object) => Promise<any>;
  on: (event: string, callback: (data: any) => void) => void;
  off: (event: string, callback: (data: any) => void) => void;
};

export type Screen = {
  width: number;
  height: number;
  deviceScaleFactor: number;
  mobile: boolean;
};

export type InspectOptions = {
  depth?: number;
  raw?: boolean;
  computed?: boolean;
  parseOptions?: ParseOptions;
  customScreen?: Screen;
  beforeTraverse?: (
    rootNode: Node,
    inspector: Inspector,
    rootElement: Element,
  ) => Promise<void>;
  beforeGetMatchedStyle?: (
    node: Node,
    inspector: Inspector,
    rootElement: Element,
  ) => Promise<void>;
  afterGetMatchedStyle?: (
    node: Node,
    inspector: Inspector,
    rootElement: Element,
  ) => Promise<void>;
};
