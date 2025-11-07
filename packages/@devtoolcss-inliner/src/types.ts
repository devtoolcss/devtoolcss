import type { Device, CDPNode } from "chrome-inspector";
import type {
  ParsedCSSPropertyObject,
  ParsedCSSPropertyValue,
} from "@devtoolcss/parser";

export type CDPNodeWithId = CDPNode & {
  id: string;
  children: CDPNodeWithId[];
  css: any[];
};

export type ParsedCSSRules = {
  [selector: string]: ParsedCSSPropertyValue[];
};

export type ParsedCSSRulesObjValue = {
  [selector: string]: ParsedCSSPropertyObject;
};

export type ParsedStyleSheetObjValue = {
  [mediaKey: string]: ParsedCSSRulesObjValue;
};

export type InlineOptions = {
  highlightNode?: boolean;
  customScreens?: Device[];
  mediaConditions?: string[];
};
