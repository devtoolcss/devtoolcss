// here devtools-protocol is the old version of chrome-remote-interface
// to fit the DOMApi type
import type { ProtocolProxyApi } from "devtools-protocol/types/protocol-proxy-api.js";

export type CSSApi = ProtocolProxyApi.CSSApi;
export type DOMApi = ProtocolProxyApi.DOMApi;
export type OverlayApi = ProtocolProxyApi.OverlayApi;
export type RuntimeApi = ProtocolProxyApi.RuntimeApi;
