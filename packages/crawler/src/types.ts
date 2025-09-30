import type { Protocol } from "devtools-protocol";
import type { ProtocolProxyApi } from "devtools-protocol/types/protocol-proxy-api.js";
import type { StyleSheet } from "@clonecss/cleanclone-core";

export type {
  StyleSheet,
  RuleMatch,
  CSSRules,
  CSSProperty,
  GetMatchedStylesForNodeResponse,
} from "@clonecss/cleanclone-core";

export type Node = Omit<Protocol.DOM.Node, "children"> & {
  id?: string;
  children?: Node[];
  css?: StyleSheet;
  //computedStyle?: Protocol.CSS.CSSComputedStyleProperty[];
};

export type CSSApi = ProtocolProxyApi.CSSApi;
export type DOMApi = ProtocolProxyApi.DOMApi;
export type OverlayApi = ProtocolProxyApi.OverlayApi;
export type RuntimeApi = ProtocolProxyApi.RuntimeApi;

export type HighlightConfig = Protocol.Overlay.HighlightConfig;

export enum CDPNodeType {
  ELEMENT_NODE = 1,
  //ATTRIBUTE_NODE = 2,
  TEXT_NODE = 3,
  //CDATA_SECTION_NODE = 4,
  //ENTITY_REFERENCE_NODE = 5,
  //ENTITY_NODE = 6,
  //PROCESSING_INSTRUCTION_NODE = 7,
  COMMENT_NODE = 8,
  DOCUMENT_NODE = 9,
  DOCUMENT_TYPE_NODE = 10,
  //DOCUMENT_FRAGMENT_NODE = 11,
  //NOTATION_NODE = 12,
}
