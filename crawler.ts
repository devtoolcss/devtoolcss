import fs from "fs";
import path from "path";
import { EventEmitter } from "events";
import CDP from "chrome-remote-interface";
import { exec, ChildProcess } from "child_process";
import { toStyleSheet, replaceVariables, toStyleJSON } from "./css_parser.js";
import type { Node, DOMApi } from "./types.js";
import { CDPNodeType } from "./types.js";
import {
  getAvailableFilename,
  getFilename,
  downloadFile,
  MIME,
  getExtension,
} from "./file.js";
import { rewriteResourceLinks } from "./rewrite.js";
import {
  inlineStyle,
  cleanTags,
  getFontRules,
  getAnchorHref,
  normalizeSameSiteHref,
} from "./runtime.js";
import { cascade, cascadePseudoClass } from "./cascade.js";
import {
  getPath,
  getOrigin,
  normalizePageURL,
  selectPageLinks,
} from "./url.js";
import { JSDOM } from "jsdom";

export interface CrawlConfig {
  url: string;
  outDir: string;
  browserPath: string;
  headless: boolean;
  breakpoints: number[];
  screenHeight: number;
  deviceScaleFactor: number;
  recursive: boolean;
  browserScan: boolean;
  maxPages?: number;
  delayAfterNavigateMs: number;
}

export interface CrawlProgress {
  phase: string;
  currentUrl?: string;
  queueSize?: number;
  visitedCount?: number;
  totalElements?: number;
  processedElements?: number;
  resourcesDownloaded?: number;
  fontsExtracted?: number;
  message?: string;
}

export interface CrawlSummary {
  visited: string[];
  outDir: string;
  fontsCssCount: number;
}

export class Crawler extends EventEmitter {
  private cfg: CrawlConfig;
  private browserProc: ChildProcess | null = null;
  private fontCSSSet = new Set<string>();
  private downloadedURLs = new Set<string>();
  private assetDir = "";
  private fontCSSPath = "";

  constructor(cfg: CrawlConfig) {
    super();
    this.cfg = cfg;
    this.assetDir = path.join(this.cfg.outDir, "assets");
    this.fontCSSPath = path.join(this.cfg.outDir, "fonts.css");
  }

  async start(): Promise<CrawlSummary> {
    await this.launchBrowser();
    const pageURLs = this.cfg.recursive
      ? await this.scanSitePages(this.cfg.browserScan)
      : [this.cfg.url];

    const succURLs: string[] = [];

    this.prepareDir();

    // crawling
    this.emitProgress({ message: "Crawling..." });
    for (var i = 0; i < pageURLs.length; i++) {
      const url = pageURLs[i];
      try {
        await this.crawlSingle(url, this.assetDir);
        this.emitProgress({
          phase: "crawled",
          currentUrl: url,
          queueSize: pageURLs.length - i - 1,
          visitedCount: succURLs.length,
        });
        succURLs.push(url);
        fs.writeFileSync(
          this.fontCSSPath,
          [...this.fontCSSSet].join("\n"),
          "utf-8",
        );
      } catch (e) {
        console.error(e);
      }
    }

    // cleanup empty dirs
    for (const mimeType of MIME) {
      const dirPath = path.join(this.cfg.outDir, "assets", mimeType);
      if (fs.existsSync(dirPath) && fs.readdirSync(dirPath).length === 0)
        fs.rmdirSync(dirPath);
    }

    this.emitProgress({ phase: "done", message: "Completed crawl" });
    return {
      visited: [...succURLs],
      outDir: this.cfg.outDir,
      fontsCssCount: this.fontCSSSet.size,
    };
  }

  stop() {
    if (this.browserProc) this.browserProc.kill();
  }

  private emitProgress(p: Partial<CrawlProgress>) {
    this.emit("progress", p);
  }

  private async launchBrowser() {
    const { browserPath, headless } = this.cfg;
    this.emitProgress({ phase: "starting", message: "Launching browser" });
    const headlessFlag = headless ? "--headless" : "";
    const browserCmd = `${browserPath} ${headlessFlag} --remote-debugging-port=9222`;
    this.browserProc = exec(browserCmd);
    await new Promise((r) => setTimeout(r, 1500));
  }

  private async extractLinksFetch(pageURL: string): Promise<string[]> {
    //const startTime = Date.now();
    const response = await fetch(pageURL);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    } else if (
      response.headers.get("content-type")?.includes("text/html") === false
    ) {
      throw new Error("Not an HTML page");
    }

    const html = await response.text();
    //const elapsed = Date.now() - startTime;
    //console.log(`Fetched ${pageURL} in ${elapsed} ms`);
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
    while (
      queue.length &&
      (!this.cfg.maxPages || pages.size < this.cfg.maxPages)
    ) {
      const url = queue.shift()!;
      this.emitProgress({
        phase: "scannning pages",
        currentUrl: url,
        queueSize: queue.length,
        visitedCount: pages.size,
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
          if (!seen.has(normalizedLink)) {
            seen.add(normalizedLink);
            queue.push(normalizedLink);
          }
        }
      } catch (e: any) {
        console.error(`Error scanning ${url}: ${e.message}`);
        continue;
      }
    }
    console.log([...pages]);
    console.log("Total pages found", pages.size);
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
    const target = await CDP.New();
    const client = await CDP({ target: target.id });
    const { DOM, CSS, Page, Runtime, Network, Emulation } = client;

    const requests: {
      [requestId: string]: {
        url: string;
        filenamePromise: Promise<string>;
        mimeType: string;
      };
    } = {};
    Network.on("responseReceived", (param) => {
      const url = param.response.url;
      if (url.startsWith("data:")) return;
      const filenamePromise = getFilename(url);
      const mimeType = param.response.mimeType;
      const subtype = mimeType.split("/")[1];
      if (["html", "javascript", "css"].includes(subtype)) return;
      requests[param.requestId] = {
        url,
        filenamePromise: filenamePromise,
        mimeType: mimeType,
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
          const urlPath = path.join("/assets", type, outFilename);
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

    this.emitProgress({ phase: "navigate", currentUrl: pageURL });
    const navResult = await Page.navigate({ url: pageURL });
    if (navResult.errorText)
      throw new Error(`Navigation failed: ${navResult.errorText}`);
    await Page.loadEventFired();
    await Runtime.evaluate({
      expression: "window.scrollTo(0, document.body.scrollHeight);",
    });

    let root: Node;
    const screens = this.buildScreens();
    for (let i = 0; i < screens.length; i++) {
      const { width, height, mobile } = screens[i];
      await Emulation.setDeviceMetricsOverride({
        width,
        height,
        deviceScaleFactor: this.cfg.deviceScaleFactor,
        mobile,
      });

      if (this.cfg.delayAfterNavigateMs)
        await new Promise((r) => setTimeout(r, this.cfg.delayAfterNavigateMs));

      const { root: docRoot } = await DOM.getDocument({ depth: -1 });
      const { nodeId } = await DOM.querySelector({
        selector: "body",
        nodeId: docRoot.nodeId,
      });
      if (!nodeId) throw new Error("Body not found");
      const res = await DOM.describeNode({ nodeId, depth: -1 });
      root = res.node;

      let totalElements = 0;
      const countElements = async (node: Node) => {
        totalElements += 1;
        node.css = {};
      };
      await this.traverse(root as any, countElements, true);
      this.emitProgress({
        phase: "cascade",
        totalElements,
        processedElements: 0,
      });

      let processed = 0;
      await this.traverse(
        root as any,
        async (node) => {
          await cascade(node, CSS, i);
          processed += 1;
          this.emitProgress({
            phase: "cascade",
            processedElements: processed,
            totalElements,
          });
        },
        true,
      );
      processed = 0;
      await this.traverse(
        root as any,
        async (node) => {
          await cascadePseudoClass(node, CSS, i);
          processed += 1;
          this.emitProgress({
            phase: "cascade-pseudo",
            processedElements: processed,
            totalElements,
          });
        },
        false,
      );
    }

    // stop recording requests
    Network.on("responseReceived", (param) => {});

    // wait until all finish
    while (loadingRequestIds.size > 0) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      // TODO: progress
    }

    await this.prepareCSSAttributes(root as any, DOM, screens);

    this.emitProgress({ phase: "fonts", message: "Extracting fonts" });
    const { result: resultFonts } = await Runtime.evaluate({
      expression:
        getFontRules.toString() +
        `; getFontRules(${JSON.stringify(fontFiles)});`,
      returnByValue: true,
    });
    resultFonts.value.forEach((cssText: string) => {
      this.fontCSSSet.add(cssText);
    });

    await Runtime.evaluate({
      expression:
        cleanTags.toString() +
        "; cleanTags();" +
        inlineStyle.toString() +
        "; inlineStyle();",
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
        pagePathDecoded.slice(0, pagePathDecoded.length - ext.length) + "html";
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
    await Runtime.evaluate({
      expression:
        normalizeSameSiteHref.toString() +
        `; normalizeSameSiteHref(${JSON.stringify(origin)});`,
    });
    const { outerHTML: rawHtml } = await DOM.getOuterHTML({
      nodeId: root.nodeId,
    });
    const fontLinkTag = '<link rel="stylesheet" href="/fonts.css" />\n';
    let outerHTML = rewriteResourceLinks(pageBase, resources, rawHtml);
    outerHTML = fontLinkTag + outerHTML;
    fs.mkdirSync(htmlDir, { recursive: true });
    fs.writeFileSync(htmlPath, outerHTML, "utf-8");

    await Page.close();
    await client.close();
  }

  private buildScreens() {
    const breakpoints = this.cfg.breakpoints;
    const screens: { width: number; height: number; mobile: boolean }[] = [];
    if (breakpoints.length === 0) {
      screens.push({
        width: 1280,
        height: this.cfg.screenHeight,
        mobile: false,
      });
    } else {
      for (let i = 0; i < breakpoints.length; i++) {
        let width: number;
        if (i === 0) width = Math.round(breakpoints[i] / 2);
        else width = Math.round((breakpoints[i] + breakpoints[i + 1]) / 2);
        screens.push({
          width,
          height: this.cfg.screenHeight,
          mobile: false,
        });
      }
      screens.push({
        width: breakpoints[breakpoints.length - 1] + 100,
        height: this.cfg.screenHeight,
        mobile: false,
      });
    }
    return screens;
  }

  private async traverse(
    node: Node,
    callback: (n: Node) => Promise<void>,
    parallel = false,
  ) {
    if (node.nodeType !== CDPNodeType.ELEMENT_NODE) return; // element
    await callback(node);
    if (node.children) {
      if (parallel)
        await Promise.all(
          node.children.map((c) => this.traverse(c as any, callback, parallel)),
        );
      else
        for (const c of node.children)
          await this.traverse(c as any, callback, parallel);
    }
  }

  private async prepareCSSAttributes(root: Node, DOM: DOMApi, screens: any[]) {
    function cleanUp(node: Node) {
      for (const rulesObj of Object.values(node.css || {})) {
        for (const [selector, rules] of Object.entries(rulesObj)) {
          for (const [prop, value] of Object.entries(rules)) {
            if (!value.explicit) {
              delete rules[prop];
            } else {
              delete value.explicit;
            }
          }
        }
      }
    }
    async function setId(node: Node) {
      let id = `node-${(node as any).nodeId}`;
      let hasId = false;
      const { attributes } = await DOM.getAttributes({
        nodeId: (node as any).nodeId,
      });
      for (let i = 0; i < attributes.length; i += 2) {
        if (attributes[i] === "id") {
          id = attributes[i + 1];
          hasId = true;
          break;
        }
      }
      if (!hasId)
        await DOM.setAttributeValue({
          nodeId: (node as any).nodeId,
          name: "id",
          value: id,
        });
      (node as any).id = id;
      for (const rulesObj of Object.values(node.css || {})) {
        for (const [selector, rules] of Object.entries(rulesObj)) {
          (rulesObj as any)[`#${id}` + selector] = rules;
          delete (rulesObj as any)[selector];
        }
      }
    }
    await this.traverse(
      root,
      async (node) => {
        if (!node.css) return;
        cleanUp(node);
        await setId(node);
        const styleJSONs: any = {};
        Object.entries(node.css || {}).forEach(([screenKey, rules]) => {
          styleJSONs[screenKey] = toStyleJSON(
            replaceVariables(toStyleSheet(rules as any)),
          );
        });
        const sharedCSS: any = {};
        const [firstStyleJSON, ...otherStyleJSONs] = Object.values(styleJSONs);
        if (firstStyleJSON) {
          for (const [targetSelector, targetRule] of Object.entries(
            firstStyleJSON as any,
          )) {
            for (const [targetProp, targetValue] of Object.entries(
              targetRule as any,
            )) {
              const isShared = otherStyleJSONs.every(
                (styleJSON: any) =>
                  styleJSON[targetSelector] &&
                  JSON.stringify(styleJSON[targetSelector][targetProp]) ===
                    JSON.stringify(targetValue),
              );
              if (isShared) {
                if (!sharedCSS[targetSelector]) sharedCSS[targetSelector] = {};
                sharedCSS[targetSelector][targetProp] = targetValue;
                Object.values(styleJSONs).forEach((styleJSON: any) => {
                  if (styleJSON[targetSelector])
                    delete styleJSON[targetSelector][targetProp];
                });
              }
            }
            for (const screenKey of Object.keys(styleJSONs)) {
              const styleKeyJSON = styleJSONs[screenKey];
              for (const selector of Object.keys(styleKeyJSON))
                if (Object.keys(styleKeyJSON[selector]).length === 0)
                  delete styleKeyJSON[selector];
              if (Object.keys(styleJSONs[screenKey]).length === 0)
                delete styleJSONs[screenKey];
            }
          }
        }
        let cssType = "styleSheet";
        let cssData: any;
        if (
          Object.keys(styleJSONs).length === 0 &&
          Object.keys(sharedCSS).length === 0
        )
          return;
        else if (
          Object.keys(styleJSONs).length === 0 &&
          Object.keys(sharedCSS).length === 1 &&
          Object.keys(sharedCSS)[0] === `#${(node as any).id}`
        ) {
          cssType = "inlineStyle";
          cssData = sharedCSS[`#${(node as any).id}`];
        } else {
          cssData = "";
          if (Object.keys(sharedCSS).length > 0)
            cssData += toStyleSheet(sharedCSS);
          for (const key of Object.keys(styleJSONs)) {
            const i = parseInt(key);
            if (i === 0)
              cssData += toStyleSheet(
                styleJSONs[i],
                null,
                this.cfg.breakpoints[i],
              );
            else if (i === screens.length - 1)
              cssData += toStyleSheet(
                styleJSONs[i],
                this.cfg.breakpoints[i - 1],
                null,
              );
            else
              cssData += toStyleSheet(
                styleJSONs[i],
                this.cfg.breakpoints[i - 1],
                this.cfg.breakpoints[i],
              );
          }
        }
        await DOM.setAttributeValue({
          nodeId: (node as any).nodeId,
          name: "data-css",
          value: JSON.stringify({ type: cssType, data: cssData }),
        });
      },
      false,
    );
  }
}
