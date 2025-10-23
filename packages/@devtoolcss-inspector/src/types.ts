import type { ParseOptions } from "@devtoolcss/parser";
import type { Inspector } from "./Inspector.js";

export type Node = {
  nodeId: number;
  nodeType: number;
  localName: string;
  attributes?: string[];
  children?: Node[];
  [key: string]: any; // Allow any other properties
};

export type CDPClient = {
  send: (method: string, params?: object) => Promise<any>;
  on: (event: string, callback: (data: any) => void) => void;
  off: (event: string, callback: (data: any) => void) => void;
};

export type Progress = {
  completed: number;
  total: number;
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
