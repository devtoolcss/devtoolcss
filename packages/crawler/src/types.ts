import type { Protocol } from "devtools-protocol";
import type { ProtocolProxyApi } from "devtools-protocol/types/protocol-proxy-api.js";
import type { ParsedStyleSheet } from "@clonecss/cleanclone-core";

export type {
  ParsedStyleSheet,
  ParsedCSSProperties,
  ParsedCSSRules,
  GetMatchedStylesForNodeResponse,
  RuleMatch,
  CSSProperty,
} from "@clonecss/cleanclone-core";

export type Node = Omit<Protocol.DOM.Node, "children"> & {
  id?: string;
  children?: Node[];
  css?: ParsedStyleSheet;
  //computedStyle?: Protocol.CSS.CSSComputedStyleProperty[];
};

export type CSSApi = ProtocolProxyApi.CSSApi;
export type DOMApi = ProtocolProxyApi.DOMApi;
export type OverlayApi = ProtocolProxyApi.OverlayApi;
export type RuntimeApi = ProtocolProxyApi.RuntimeApi;

export type HighlightConfig = Protocol.Overlay.HighlightConfig;
