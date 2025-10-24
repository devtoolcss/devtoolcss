import type { Node, Screen } from "@devtoolcss/inspector";
import type {
  ParsedCSSPropertyObject,
  ParsedCSSPropertyValue,
} from "@devtoolcss/parser";

export type NodeWithId = Node & { id: string; children?: NodeWithId[] };

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
  customScreens?: Screen[];
  mediaConditions?: string[];
};
