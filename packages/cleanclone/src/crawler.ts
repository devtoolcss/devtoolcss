import fs from "fs";
import path from "path";
import { EventEmitter } from "events";
import CDP from "chrome-remote-interface";
import * as ChromeLauncher from "chrome-launcher";
import { Inspector, type Screen } from "@devtoolcss/inspector";
import { getInlinedComponent } from "@devtoolcss/inliner";
import {
  getAvailableFilename,
  getFilename,
  downloadFile,
  MIME,
  getExtension,
} from "./file.js";
import { rewriteResourceLinks, normalizeSameSiteHref } from "./rewrite.js";
import { getFontRules, getAnchorHref } from "./runtime.js";
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
  private screens: Screen[] = [];
  private mediaConditions: string[];
  private toHighlight = false;

  constructor(cfg: CrawlConfig) {
    super();
    this.cfg = cfg;
    this.assetDir = path.join(this.cfg.outDir, "assets");
    this.fontCSSPath = path.join(this.cfg.outDir, "fonts.css");
    this.screens = this.buildScreens();
    this.mediaConditions = this.buildMediaCondition(this.cfg.breakpoints);
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
      if (!url || url.startsWith("data:")) return;
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

    this.emitProgress({
      crawlProgress: {
        deviceIndex: 0,
        stageIndex: CrawlStages.Cascade,
        totalElements: 0,
        processedElements: 0,
      },
    });

    // @ts-ignore
    const inspector = Inspector.fromCDPClient(client);
    inspector.on("progress", ({ completed, total }) => {
      this.emitProgress({
        crawlProgress: {
          processedElements: completed,
          totalElements: total,
        },
      });
    });
    inspector.on("error", this.onError);
    const doc = await getInlinedComponent("body", inspector, this.onError, {
      customScreens: this.screens,
      mediaConditions: this.mediaConditions,
      highlightNode: this.toHighlight,
    });

    // stop recording requests
    // @ts-ignore TODO: fix typing upstream
    removeResponseReceived();

    // wait until all finish
    while (loadingRequestIds.size > 0) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      // TODO: progress
    }

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
    normalizeSameSiteHref(doc, origin);
    // Insert the font link tag as the first child of <head>
    const fontLink = doc.createElement("link");
    fontLink.rel = "stylesheet";
    fontLink.href = "/fonts.css";
    const head = doc.querySelector("head");
    head.insertBefore(fontLink, head.firstChild);
    const rawHtml = doc.documentElement.outerHTML;
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

  private buildScreens(): Screen[] {
    return this.cfg.deviceWidths.map((width) => ({
      width,
      height: this.cfg.screenHeight,
      deviceScaleFactor: this.cfg.deviceScaleFactor,
      mobile: false, // TODO: option? but seems not matter if no touch event
    }));
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
