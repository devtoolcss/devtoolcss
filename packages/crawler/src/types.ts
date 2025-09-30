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
