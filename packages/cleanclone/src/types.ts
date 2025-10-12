// here devtools-protocol is the old version of chrome-remote-interface
// to fit the DOMApi type
import type { Protocol } from "devtools-protocol";
import type { ProtocolProxyApi } from "devtools-protocol/types/protocol-proxy-api.js";
import type { ParsedStyleSheet } from "@devtoolcss/parser";

export type {
  ParsedStyleSheet,
  ParsedCSSProperties,
  ParsedCSSRules,
  GetMatchedStylesForNodeResponse,
  RuleMatch,
  CSSProperty,
} from "@devtoolcss/parser";

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
