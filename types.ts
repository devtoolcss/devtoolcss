import type { Protocol } from "devtools-protocol";
import type { ProtocolProxyApi } from "devtools-protocol/types/protocol-proxy-api.js";

export type CSSRules = {
  [selector: string]: {
    [property: string]: {
      value: string;
      important?: boolean;
      explicit?: boolean;
    };
  };
};

export type Node = Omit<Protocol.DOM.Node, "children"> & {
  id?: string;
  children?: Node[];
  css?: { [key: string]: CSSRules };
};

export type CSSApi = ProtocolProxyApi.CSSApi;
