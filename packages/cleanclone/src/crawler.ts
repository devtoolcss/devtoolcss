import fs from "fs";
import path from "path";
import { EventEmitter } from "events";
import CDP from "chrome-remote-interface";
import * as ChromeLauncher from "chrome-launcher";
import {
  parseGetMatchedStylesForNodeResponse,
  getInlineText,
  traverse,
  CDPNodeType,
  inlineStyle,
  forciblePseudoClasses,
} from "@devtoolcss/parser";
import type { Node, GetMatchedStylesForNodeResponse } from "./types.js";
import {
  getAvailableFilename,
  getFilename,
  downloadFile,
  MIME,
  getExtension,
} from "./file.js";
import { rewriteResourceLinks, normalizeSameSiteHref } from "./rewrite.js";
import { getFontRules, getAnchorHref } from "./runtime.js";
import { highlightNode } from "./highlight.js";
import {
  getPath,
  getOrigin,
  normalizePageURL,
  selectPageLinks,
} from "./url.js";
import { JSDOM } from "jsdom";
import beautify from "js-beautify";

export interface CrawlConfig {
  url: string;
  outDir: string;
  browserPath: string;
  headless: boolean;
  screenHeight: number;
  breakpoints: number[];
  deviceWidths: number[];
  deviceScaleFactor: number;
  recursive: boolean;
  urlFilter: RegExp;
  browserScan: boolean;
  maxPages?: number;
  delayAfterNavigateMs: number;
  browserFlags: string[];
  debug: boolean;
  overlay: boolean;
}

export enum CrawlStages {
  Load = 0,
  Cascade = 1,
}

export interface CrawlProgress {
  // page-level progress
  totalPages: number;
  finishedPages: number;
  url: string;
  // device-level progress within a page
  deviceIndex: number;
  // normalized stage identifier for UI highlighting
  stageIndex: CrawlStages; // undefined when scanning
  // element-level progress for cascade
  totalElements?: number;
  processedElements?: number;
}

export interface ScanProgress {
  queued: number;
  finished: number;
  url: string;
}

export interface Progress {
  phase?: "scanning" | "crawling";
  message?: { level: "debug" | "info" | "warning" | "error"; text: string };
  scanProgress?: Partial<ScanProgress>;
  crawlProgress?: Partial<CrawlProgress>;
}

export interface CrawlSummary {
  succeeded: number;
  failed: number;
  downloadCount: number;
  fontsCssCount: number;
}

export class Crawler extends EventEmitter {
  private cfg: CrawlConfig;
  private chrome: ChromeLauncher.LaunchedChrome | null = null;
  private fontCSSSet = new Set<string>();
  private downloadedURLs = new Set<string>();
  private assetDir = "";
  private fontCSSPath = "";
  private screens: { width: number; height: number; mobile: boolean }[] = [];
  private toHighlight = false;

  constructor(cfg: CrawlConfig) {
    super();
    this.cfg = cfg;
    this.assetDir = path.join(this.cfg.outDir, "assets");
    this.fontCSSPath = path.join(this.cfg.outDir, "fonts.css");
    this.screens = this.buildScreens();
    this.toHighlight = this.cfg.overlay && !this.cfg.headless;
  }

  async start(): Promise<CrawlSummary> {
    await this.launchBrowser();
    const pageURLs = this.cfg.recursive
      ? await this.scanSitePages(this.cfg.browserScan)
      : [this.cfg.url];

    const succURLs: string[] = [];
    let failedCount = 0;

    this.prepareDir();

    this.emitProgress({
      phase: "crawling",
    });
    // crawling
    for (let i = 0; i < pageURLs.length; i++) {
      const url = pageURLs[i];
      // announce page start (used by UI for progress and stage highlighting)
      this.emitProgress({
        crawlProgress: {
          totalPages: pageURLs.length,
          finishedPages: succURLs.length,
          url,
        },
      });
      const startTime = Date.now();
      try {
        await this.crawlSingle(url, this.assetDir);
        succURLs.push(url);
        fs.writeFileSync(
          this.fontCSSPath,
          [...this.fontCSSSet].join("\n"),
          "utf-8",
        );
      } catch (e) {
        this.emitProgress({
          message: {
            level: "error",
            text: e instanceof Error ? `${e.message}\n${e.stack}` : String(e),
          },
        });
        failedCount++;
      }
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      this.emitProgress({
        message: {
          level: "info",
          text: `Finished ${url} in ${elapsed}s`,
        },
      });
    }

    // cleanup empty dirs
    for (const mimeType of MIME) {
      const dirPath = path.join(this.cfg.outDir, "assets", mimeType);
      if (fs.existsSync(dirPath) && fs.readdirSync(dirPath).length === 0)
        fs.rmdirSync(dirPath);
    }

    await this.closeBrowser();

    return {
      failed: failedCount,
      succeeded: succURLs.length,
      downloadCount: this.downloadedURLs.size,
      fontsCssCount: this.fontCSSSet.size,
    };
  }

  stop() {
    if (this.chrome.process) {
      try {
        this.chrome.kill();
      } catch {}
    }
  }

  private emitProgress(p: Progress) {
    this.emit("progress", p);
  }

  private async launchBrowser() {
    const { browserPath, headless, browserFlags } = this.cfg;
    const args = ["--remote-debugging-port=9222", ...browserFlags];
    if (headless) args.push("--headless");
    this.emitProgress({
      message: {
        level: "info",
        text: `Launching browser: ${browserPath} ${args.join(" ")}`,
      },
    });
    this.chrome = await ChromeLauncher.launch({
      chromePath: this.cfg.browserPath,
      port: 9222,
      chromeFlags: args,
      maxConnectionRetries: 5,
    });
    await new Promise((r) => setTimeout(r, 1500));
  }

  private async closeBrowser() {
    const target = await CDP.New();
    const client = await CDP({ target: target.id });
    await client.Browser.close();
  }

  private async extractLinksFetch(pageURL: string): Promise<string[]> {
    const response = await fetch(pageURL);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    } else if (
      response.headers.get("content-type")?.includes("text/html") === false
    ) {
      throw new Error("Not an HTML page");
    }

    const html = await response.text();
    const dom = new JSDOM(html);
    const anchorElements = dom.window.document.querySelectorAll("a");
    const links: string[] = [];
    anchorElements.forEach((a) => {
      const href = a.getAttribute("href");
      if (href) links.push(href);
    });

    const origin = getOrigin(pageURL);
    const pageLinks = selectPageLinks(origin, links);
    return pageLinks;
  }

  private async extractLinksBrowser(pageURL: string): Promise<string[]> {
    const target = await CDP.New();
    const client = await CDP({ target: target.id });
    const { Page, Runtime } = client;
    await Page.enable();

    const navResult = await Page.navigate({ url: pageURL });
    if (navResult.errorText)
      throw new Error(`Navigation failed: ${navResult.errorText}`);
    await Page.loadEventFired();
    if (this.cfg.delayAfterNavigateMs)
      await new Promise((r) => setTimeout(r, this.cfg.delayAfterNavigateMs));

    const { result: resultLinks } = await Runtime.evaluate({
      expression: getAnchorHref.toString() + "; getAnchorHref();",
      returnByValue: true,
    });
    await Page.close();
    await client.close();

    const pageLinks = selectPageLinks(getOrigin(pageURL), resultLinks.value);
    return pageLinks;
  }

  private async scanSitePages(browser: boolean = false): Promise<string[]> {
    const seen = new Set<string>([normalizePageURL(this.cfg.url)]);
    const pages = new Set<string>();
    const queue: string[] = [normalizePageURL(this.cfg.url)];

    const origin = getOrigin(this.cfg.url);

    this.emitProgress({ phase: "scanning" });

    while (
      queue.length &&
      (!this.cfg.maxPages || pages.size < this.cfg.maxPages)
    ) {
      const url = queue.shift()!;
      this.emitProgress({
        phase: "scanning",
        scanProgress: {
          url: url,
          queued: queue.length,
          finished: pages.size,
        },
      });
      try {
        const pageLinks = browser
          ? await this.extractLinksBrowser(url)
          : await (async () => {
              const links = await this.extractLinksFetch(url);
              await new Promise((r) => setTimeout(r, 100));
              return links;
            })();

        // not throw
        pages.add(url);

        for (const rawLink of pageLinks) {
          const normalizedLink = normalizePageURL(rawLink, origin);
          // TODO: handle base, not just origin
          if (
            !seen.has(normalizedLink) &&
            this.cfg.urlFilter.test(normalizedLink)
          ) {
            seen.add(normalizedLink);
            queue.push(normalizedLink);
          }
        }
      } catch (e) {
        this.emitProgress({
          message: {
            level: "warning",
            text: `Error scanning ${url}: ${
              e instanceof Error ? `${e.message}\n${e.stack}` : String(e)
            }`,
          },
        });
        continue;
      }
    }

    const messageText = `${pages.size} pages found:\n${[...pages].join(
      "\n",
    )}\n`;
    this.emitProgress({ message: { level: "info", text: messageText } });
    return [...pages];
  }

  private prepareDir() {
    // prepare dir
    if (fs.existsSync(this.cfg.outDir))
      fs.rmSync(this.cfg.outDir, { recursive: true, force: true });
    for (const mimeType of MIME)
      fs.mkdirSync(path.join(this.assetDir, mimeType), { recursive: true });
  }

  private async crawlSingle(pageURL: string, assetDir: string): Promise<void> {
    // init progress for this page
    this.emitProgress({
      crawlProgress: {
        deviceIndex: 0,
        stageIndex: CrawlStages.Load,
        totalElements: 0,
        processedElements: 0,
      },
    });

    const target = await CDP.New();
    const client = await CDP({ target: target.id });
    const { DOM, CSS, Page, Runtime, Network, Emulation, Overlay } = client;

    const originalURL: { [requestId: string]: string } = {};
    const requests: {
      [requestId: string]: {
        url: string;
        filenamePromise: Promise<string>;
        mimeType: string;
      };
    } = {};

    // https://chromedevtools.github.io/devtools-protocol/tot/Network/#type-RequestId
    // > Note that this does not identify individual HTTP requests that are part of a network request.
    // Redirected request will use the same requestId! So we don't have to trace by ourselves
    // and responseReceived won't fire on redirect response

    // send is per http request, only record the first
    Network.on("requestWillBeSent", (param) => {
      if (!originalURL[param.requestId]) {
        originalURL[param.requestId] = param.request.url;
      }
    });

    // This is the final response of resource, not containing redirect ones
    const removeResponseReceived = Network.on("responseReceived", (param) => {
      const requestId = param.requestId;
      const url = originalURL[requestId]; // TODO: handle error
      if (url.startsWith("data:")) return;
      const filenamePromise = getFilename(url);
      const mimeType = param.response.mimeType;
      const subtype = mimeType.split("/")[1];
      if (["html", "javascript", "css"].includes(subtype)) return;
      requests[requestId] = {
        url,
        filenamePromise,
        mimeType,
      };
    });

    const fontFiles: string[] = [];
    const resources: { url: string; path: string }[] = [];
    let downloaded = 0;

    const loadingRequestIds = new Set();
    // has to download the data immediately, may lose
    Network.on("loadingFinished", async (param) => {
      const { requestId } = param;
      const req = requests[requestId];
      if (req) {
        // TODO: add at loadingFinished is weird, only ensure audio/video download
        loadingRequestIds.add(requestId);
        const { mimeType, url, filenamePromise } = req;
        const filename = await filenamePromise;
        const [type, subtype] = mimeType.split("/");

        if (
          !(
            subtype === "octet-stream" &&
            ["html", "js", "css"].includes(getExtension(filename))
          ) &&
          type &&
          filename
        ) {
          const outDir = path.join(assetDir, type);
          const outFilename = this.downloadedURLs.has(url)
            ? filename
            : getAvailableFilename(outDir, filename);
          const outPath = path.join(outDir, outFilename);
          const urlPath = path.posix.join("/assets", type, outFilename);
          if (!this.downloadedURLs.has(url)) {
            try {
              if (type === "audio" || type === "video") {
                await downloadFile(url, outPath);
                resources.push({ url, path: urlPath });
              } else {
                if (type === "font") fontFiles.push(filename);
                const { body, base64Encoded } = await Network.getResponseBody({
                  requestId,
                });
                const buffer = base64Encoded
                  ? Buffer.from(body, "base64")
                  : Buffer.from(body);
                fs.writeFileSync(outPath, buffer);
                resources.push({ url, path: urlPath });
              }
              this.downloadedURLs.add(url);
              downloaded++;
              // TODO: emit progress
            } catch {}
          } else resources.push({ url, path: urlPath });
        }
        loadingRequestIds.delete(requestId);
      }
    });

    await Network.setCacheDisabled({ cacheDisabled: true });
    await DOM.enable();
    await CSS.enable();
    await Page.enable();
    await Network.enable();
    if (!this.cfg.headless) await Overlay.enable();
    // Runtime no need to enable if not using events

    const navResult = await Page.navigate({ url: pageURL });
    if (navResult.errorText)
      throw new Error(`Navigation failed: ${navResult.errorText}`);
    await Page.loadEventFired();
    // Slowly scroll to bottom to trigger lazy loading
    await Runtime.evaluate({
      expression: `
      (async () => {
        const delay = ms => new Promise(r => setTimeout(r, ms));
        let lastScroll = -1;
        let sameCount = 0;
        for (let y = 0; y < document.body.scrollHeight; y += 200) {
        window.scrollTo(0, y);
        await delay(100);
        if (window.scrollY === lastScroll) {
          sameCount++;
          if (sameCount > 5) break;
        } else {
          sameCount = 0;
        }
        lastScroll = window.scrollY;
        }
        window.scrollTo(0, document.body.scrollHeight);
      })();
      `,
      awaitPromise: true,
    });

    const { root: docRoot } = await DOM.getDocument({ depth: 0 });
    // default 1 will cause later setChildNode parentId not docRoot's
    // always use requestChildNodes for aligning the usage of devtools

    // Maintain a map for efficient node lookup by nodeId
    const nodeMap = new Map<number, Node>(); // just for lookup, only add (nodeId unique), no delete
    const updateQueue: Array<any> = [];
    const buildNodeMap = (node: Node) => {
      nodeMap.set(node.nodeId, node);
      if (node.children) {
        for (const child of node.children) {
          buildNodeMap(child);
        }
      }
    };

    // cannot have multiple at a time
    async function getChildren(node: Node): Promise<void> {
      const childrenPromise = new Promise<void>((resolve) => {
        // no children to request, also good
        const timeoutId = setTimeout(() => {
          removeListener();
          resolve();
        }, 250);

        let removeListener;
        removeListener = DOM.on("setChildNodes", (params) => {
          if (node.nodeId !== params.parentId) return;
          removeListener();
          node.children = params.nodes;
          buildNodeMap(node);
          clearTimeout(timeoutId);
          resolve();
        });
      });
      DOM.requestChildNodes({
        nodeId: node.nodeId,
        depth: -1,
      });
      await childrenPromise;
    }

    await getChildren(docRoot);

    async function processUpdateQueue() {
      /* currently handled by setTimeout
      const deletedSet = new Set<number>();
      for (const param of updateQueue) {
        if (param["nodeId"] !== undefined) {
          deletedSet.add(param["nodeId"]);
        }
      }
      */

      async function updateNode(param) {
        function findNodeIdx(nodes: Node[], nodeId: number): number {
          for (let i = 0; i < nodes.length; i++) {
            if (nodes[i].nodeId === nodeId) {
              return i;
            }
          }
          return null;
        }

        const parentNode = nodeMap.get(param.parentNodeId);
        if (parentNode) {
          if (param["previousNodeId"] !== undefined) {
            // insert
            //if (deletedSet.has(param["nodeId"])) return;
            const prevIdx =
              param["previousNodeId"] === 0
                ? -1
                : findNodeIdx(parentNode.children, param["previousNodeId"]);
            if (prevIdx !== null) {
              // describeNode depth -1 is buggy, often return nodeId=0, causing bug
              // devtools use DOM.requestChildNodes and receive the results from DOM.setChildNodes event
              parentNode.children.splice(prevIdx + 1, 0, param["node"]);

              // the node from insert event may or maynot have children initialized
              // hope not partially initialized like describeNode

              // For node (ex: h1) with only a #text child, won't get response
              // devtool UI also expand the #text as the same level
              // seems childNodeInserted will handle this by selective providing children
              // so here checking !node.children is good
              const node: Node = param["node"];
              if (
                node.nodeType === CDPNodeType.ELEMENT_NODE &&
                node.childNodeCount > 0 &&
                !node.children
              ) {
                await getChildren(node);
              }
            }
          } else {
            const idx = findNodeIdx(parentNode.children, param["nodeId"]);
            if (idx !== -1) {
              parentNode.children.splice(idx, 1);
            }
          }
        }
      }
      while (updateQueue.length > 0) {
        await updateNode(updateQueue.shift());
      }
    }

    DOM.on("childNodeInserted", (params) => {
      updateQueue.push({
        parentNodeId: params.parentNodeId,
        previousNodeId: params.previousNodeId,
        node: params.node,
      });
    });

    DOM.on("childNodeRemoved", (params) => {
      updateQueue.push({
        parentNodeId: params.parentNodeId,
        nodeId: params.nodeId,
      });
    });

    DOM.on("documentUpdated", () => {
      throw new Error("Document completely updated, cannot cascade");
    });

    function getBody(node: Node, depth: number): Node | null {
      if (node.nodeName.toLowerCase() === "body") return node;
      else if (depth === 3) return null;

      if (node.children) {
        for (const child of node.children) {
          const res = getBody(child, depth + 1);
          if (res) return res;
        }
      }
    }

    const roots = [];
    this.emitProgress({
      phase: "crawling",
    });

    async function setIdAttrs(node: Node) {
      let id = `node-${node.nodeId}`;
      let hasId = false;
      if (!node.attributes) {
        const { attributes } = await DOM.getAttributes({
          nodeId: node.nodeId,
        });
        node.attributes = attributes;
      }
      for (let i = 0; i < node.attributes.length; i += 2) {
        if (node.attributes[i] === "id") {
          id = node.attributes[i + 1];
          if (id.includes(":")) {
            // can break selector
            id = id.replace(/:/g, "-");
            node.attributes[i + 1] = id;
          }
          hasId = true;
          break;
        }
      }
      if (!hasId) {
        node.attributes.push("id", id);
      }
      node.id = id;
    }

    for (
      let deviceIndex = 0;
      deviceIndex < this.screens.length;
      deviceIndex++
    ) {
      const { width, height, mobile } = this.screens[deviceIndex];
      await Emulation.setDeviceMetricsOverride({
        width,
        height,
        deviceScaleFactor: this.cfg.deviceScaleFactor,
        mobile,
      });

      this.emitProgress({
        crawlProgress: {
          stageIndex: CrawlStages.Load,
          deviceIndex,
        },
      });

      if (this.cfg.delayAfterNavigateMs) {
        await new Promise((r) => setTimeout(r, this.cfg.delayAfterNavigateMs));
      }

      await processUpdateQueue();
      const root = getBody(docRoot, 0);
      if (!root) throw new Error("No body element found");

      let totalElements = 0;
      const initElements = async (node: Node) => {
        await setIdAttrs(node);
        node.css = [];
        totalElements += 1;
      };
      await traverse(root, initElements, this.onError, true);

      const dom = this.toJSDOM(root, true);

      const checkChildrenNodeIds = new Set<number>();
      try {
        dom.window.document
          .querySelectorAll("li:has([aria-expanded])")
          .forEach((el: HTMLElement) => {
            checkChildrenNodeIds.add(
              Number(el.attributes["data-nodeId"].value),
            );
          });
      } catch {}

      let processed = 0;
      await traverse(
        root,
        async (node) => {
          if (this.toHighlight) {
            await highlightNode(node, DOM, Runtime, Overlay);
          }

          // collect styles
          const checkChildren =
            checkChildrenNodeIds.has(node.nodeId) && node.children;
          const childrenStyleBefore: GetMatchedStylesForNodeResponse[] = [];
          const childrenStyleAfter: GetMatchedStylesForNodeResponse[] = [];

          if (checkChildren) {
            // use for loop to await, forEach will not
            for (let i = 0; i < node.children.length; ++i) {
              const child = node.children[i];
              const childrenStyle = await CSS.getMatchedStylesForNode({
                nodeId: child.nodeId,
              });
              childrenStyleBefore.push(childrenStyle);
            }
          }

          await CSS.forcePseudoState({
            nodeId: node.nodeId,
            forcedPseudoClasses: forciblePseudoClasses,
          });

          const styles = await CSS.getMatchedStylesForNode({
            nodeId: node.nodeId,
          });

          if (checkChildren) {
            for (let i = 0; i < node.children.length; ++i) {
              const child = node.children[i];
              const childrenStyle = await CSS.getMatchedStylesForNode({
                nodeId: child.nodeId,
              });
              childrenStyleAfter.push(childrenStyle);
            }
          }

          await CSS.forcePseudoState({
            nodeId: node.nodeId,
            forcedPseudoClasses: [],
          });

          node.css[deviceIndex] = parseGetMatchedStylesForNodeResponse(styles, {
            excludeOrigin: ["user-agent"],
            removeUnusedVar: true,
          });

          processed += 1;
          this.emitProgress({
            crawlProgress: {
              stageIndex: CrawlStages.Cascade,
              totalElements,
              processedElements: processed,
            },
          });

          if (this.toHighlight) {
            setTimeout(() => Overlay.hideHighlight(), 25);
          }
        },
        this.onError,
        false,
      );

      const clonedRoot = structuredClone(root);
      roots.push(clonedRoot);
    }

    // stop recording requests
    // @ts-ignore TODO: fix typing upstream
    removeResponseReceived();

    // wait until all finish
    while (loadingRequestIds.size > 0) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      // TODO: progress
    }

    const cdpRoot = this.mergeTrees(roots);

    await traverse(
      cdpRoot,
      async (node) => {
        const inlineText = getInlineText(
          node,
          node.css,
          this.buildMediaCondition(this.cfg.breakpoints),
        );
        if (inlineText) {
          node.attributes.push("data-css", inlineText);
        }
      },
      this.onError,
      false,
    );

    const dom = this.toJSDOM(cdpRoot);
    this.cleanTags(dom.window.document);
    inlineStyle(dom.window.document, "data-css", true);

    // --disable-web-security may help, but unstable and not get all somehow
    const { result: resultFonts } = await Runtime.evaluate({
      expression:
        getFontRules.toString() +
        `; getFontRules(${JSON.stringify(fontFiles)});`,
      returnByValue: true,
    });
    resultFonts.value.forEach((cssText: string) => {
      this.fontCSSSet.add(cssText);
    });

    const pagePath = getPath(pageURL);
    // for fs path, decode URI components
    const pagePathDecoded = decodeURIComponent(pagePath);
    let htmlDir: string, htmlPath: string, pageBase: string;
    const ext = path.extname(pagePathDecoded);
    if (ext === ".html" || ext === ".htm") {
      htmlDir = path.join(this.cfg.outDir, path.dirname(pagePathDecoded));
      htmlPath = path.join(htmlDir, path.basename(pagePathDecoded));
      pageBase = path.dirname(pagePath);
    } else if (ext) {
      // handle extensions like .php, .asp, .aspx, etc
      const pagePathRewritten =
        pagePathDecoded.slice(0, pagePathDecoded.length - ext.length) + ".html";
      htmlDir = path.join(this.cfg.outDir, path.dirname(pagePathRewritten));
      htmlPath = path.join(htmlDir, path.basename(pagePathRewritten));
      pageBase = path.dirname(pagePath);
    } else {
      // no extension or trailing slash
      htmlDir = path.join(this.cfg.outDir, pagePathDecoded);
      htmlPath = path.join(htmlDir, "index.html");
      pageBase = path.dirname(path.join(pagePath, "dummy"));
    }
    const origin = getOrigin(pageURL);
    normalizeSameSiteHref(dom, origin);
    // Insert the font link tag as the first child of <head>
    const fontLink = dom.window.document.createElement("link");
    fontLink.rel = "stylesheet";
    fontLink.href = "/fonts.css";
    const head = dom.window.document.querySelector("head");
    head.insertBefore(fontLink, head.firstChild);
    const rawHtml = dom.window.document.documentElement.outerHTML;
    let outerHTML =
      "<!DOCTYPE html>\n" +
      rewriteResourceLinks(origin, pageBase, resources, rawHtml);
    outerHTML = beautify.html(outerHTML, {
      indent_size: 2,
      wrap_line_length: 0, // disable line wrapping
      wrap_attributes: "auto", // "auto" | "force" | "force-aligned" | "force-expand-multiline"
    });
    fs.mkdirSync(htmlDir, { recursive: true });
    fs.writeFileSync(htmlPath, outerHTML, "utf-8");

    await Page.close();
    await client.close();
  }

  private buildScreens(): { width: number; height: number; mobile: boolean }[] {
    return this.cfg.deviceWidths.map((width, i) => {
      return {
        width,
        height: this.cfg.screenHeight,
        mobile: false, // TODO: option? but seems not matter if no touch event
      };
    });
  }

  private buildMediaCondition(breakpoints: number[]): string[] {
    const mediaConditions: string[] = [];
    for (let i = 0; i < breakpoints.length + 1; i++) {
      let cond = "";
      if (i === 0) cond = `(width < ${breakpoints[i]}px)`;
      else if (i === breakpoints.length)
        cond = `(width >= ${breakpoints[i - 1]}px)`;
      else
        cond = `(width >= ${breakpoints[i - 1]}px) and (width < ${
          breakpoints[i]
        }px)`;

      mediaConditions.push(cond);
    }
    return mediaConditions;
  }

  private toJSDOM(cdpBody: Node, setNodeId = false) {
    const dom = new JSDOM("<html><head></head><body></body></html>");
    const document = dom.window.document;

    const buildNode = (cdpNode: Node, document: Document): HTMLElement => {
      let node;

      switch (cdpNode.nodeType) {
        case CDPNodeType.ELEMENT_NODE:
          // iframe is safe because no children (not setting pierce)
          node = document.createElement(cdpNode.nodeName.toLowerCase());

          if (Array.isArray(cdpNode.attributes)) {
            for (let i = 0; i < cdpNode.attributes.length; i += 2) {
              node.setAttribute(
                cdpNode.attributes[i],
                cdpNode.attributes[i + 1],
              );
            }
          }
          if (setNodeId) {
            // for selector matching during cascade
            node.setAttribute("data-nodeId", cdpNode.nodeId);
          }
          break;

        case CDPNodeType.TEXT_NODE:
          node = document.createTextNode(cdpNode.nodeValue || "");
          break;

        case CDPNodeType.COMMENT_NODE:
          node = document.createComment(cdpNode.nodeValue || "");
          break;

        case CDPNodeType.DOCUMENT_NODE:
          node = document.createElement(cdpNode.nodeName.toLowerCase());
          if (Array.isArray(cdpNode.attributes)) {
            for (let i = 0; i < cdpNode.attributes.length; i += 2) {
              node.setAttribute(
                cdpNode.attributes[i],
                cdpNode.attributes[i + 1],
              );
            }
          }
          return;

        case CDPNodeType.DOCUMENT_TYPE_NODE: // DOCUMENT_TYPE_NODE
          return null;

        default:
          this.emitProgress({
            message: {
              level: "warning",
              text: `Unsupported node type: ${cdpNode.nodeType}\n${cdpNode}`,
            },
          });
          return null;
      }

      // Recursively add children
      if (cdpNode.children) {
        for (const child of cdpNode.children) {
          const childNode = buildNode(child, document);
          if (childNode) node.appendChild(childNode);
        }
      }

      return node;
    };

    const jsdomRoot = buildNode(cdpBody, document);
    const htmlNode = document.querySelector("html");
    htmlNode.replaceChild(jsdomRoot, htmlNode.querySelector("body"));
    return dom;
  }

  private mergeTrees(roots: Node[]): Node {
    const mergedRoot = roots[0];
    // merge css, filling missing with display: none
    if (mergedRoot.nodeType === CDPNodeType.ELEMENT_NODE) {
      for (const root of roots.slice(1)) {
        for (let i = 0; i < this.screens.length; ++i) {
          if (root.css[i]) {
            mergedRoot.css[i] = root.css[i];
          }
        }
      }
      for (let i = 0; i < this.screens.length; ++i) {
        if (!mergedRoot.css[i]) {
          mergedRoot.css[i] = {
            inherited: [],
            attributes: [],
            matched: {},
            pseudoElementMatched: {},
            inline: [
              {
                name: "display",
                value: "none",
                important: false,
              },
            ],
          };
        }
      }
    }

    if (roots.length === 1) {
      // assume children inherits the display: none
      // can break if children have some CSS overriding
      return mergedRoot;
    }

    const nodeMap = new Map<number, Node[]>();

    for (const root of roots) {
      if (root.children) {
        for (const child of root.children) {
          if (!nodeMap.has(child.nodeId)) {
            nodeMap.set(child.nodeId, [child]);
          } else {
            nodeMap.get(child.nodeId).push(child);
          }
        }
      }
    }

    mergedRoot.children = [];
    for (const nodes of nodeMap.values()) {
      mergedRoot.children.push(this.mergeTrees(nodes));
    }
    return mergedRoot;
  }

  private cleanTags(document: Document) {
    const toClean = document.querySelectorAll("script, link, style");
    toClean.forEach((el) => el.remove());
  }

  private onError = (e: any) => {
    this.emitProgress({
      message: {
        level: "error",
        text: e instanceof Error ? `${e.message}\n${e.stack}` : String(e),
      },
    });
  };
}
