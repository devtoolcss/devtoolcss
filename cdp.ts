import fs from "fs";
import CDP from "chrome-remote-interface";
import { exec } from "child_process";
import { toStyleSheet, replaceVariables, toStyleJSON } from "./css_parser.js";

import { Node } from "./types.js";

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
  sameSiteHrefToRelativePath,
} from "./runtime.js";

import { cascade, cascadePseudoClass } from "./cascade.js";

import { getPath, getOrigin } from "./url.js";

import cliProgress from "cli-progress";
import path from "path";

import { CDPNodeType } from "./types.js";

let baseDir = "./out";
let assetDir = "./out/assets";

const fontCSSSet = new Set();
const downloadedURLs = new Set();

async function traverse(node: Node, callback, parallel = false) {
  if (node.nodeType !== CDPNodeType.ELEMENT_NODE) return;
  await callback(node);
  if (node.children) {
    if (parallel) {
      try {
        await Promise.all(
          node.children.map((child) => traverse(child, callback, parallel)),
        );
      } catch (error) {
        console.log(error);
      }
    } else {
      for (const child of node.children) {
        await traverse(child, callback);
      }
    }
  }
}

async function crawl(pageURL) {
  // seems that each client is a tab, a tab is a ws connection
  const target = await CDP.New();
  const client = await CDP({ target: target.id });

  const { DOM, CSS, Page, Runtime, Network, Emulation } = client;

  const requests: {
    [requestId: string]: { url: string; filename: string; type: string };
  } = {};
  Network.on("responseReceived", (param) => {
    const url = param.response.url;
    if (url.startsWith("data:")) return;
    const filename = getFilename(url);
    const [type, subtype] = param.response.mimeType.split("/");

    // filter out unneeded resources
    if (["html", "javascript", "css"].includes(subtype)) return;
    try {
      if (
        subtype === "octet-stream" &&
        [".html", ".js", ".css"].includes(getExtension(filename))
      )
        return;
    } catch {}

    requests[param.requestId] = { url, filename, type };
  });

  await Network.setCacheDisabled({ cacheDisabled: true });

  // enable events
  await DOM.enable();
  await CSS.enable();
  await Page.enable();
  await Network.enable();

  console.log(`Loading "${pageURL}" ...`);
  // BUG: not sure why after testing with --headless, it doesn't navigate at all
  // leading to wrong inline style (somehow correct stylesheets?)
  // must reboot (or change url?) to fix
  const navResult = await Page.navigate({
    url: pageURL,
  });
  if (navResult.errorText) {
    throw new Error(`Navigation failed: ${navResult.errorText}`);
  }
  await Page.loadEventFired();
  console.log("Loaded!");
  // trigger all lazyloading
  await Runtime.evaluate({
    expression: "window.scrollTo(0, document.body.scrollHeight);",
  });

  // Find the node by ID
  const { root: docRoot } = await DOM.getDocument({ depth: -1 });
  // root
  const { nodeId } = await DOM.querySelector({
    selector: "body",
    nodeId: docRoot.nodeId,
  });

  if (!nodeId) {
    console.error("❌ Element not found");
    return;
  }
  const { node: root } = await DOM.describeNode({ nodeId, depth: -1 });
  //console.log(root)

  // TODO: get all element's computed style and CSS.trackComputedStyleUpdates(allProps) when force pseudo state
  // This works because we can have multiple values for a prop by HashSet<String>& tracked_values.
  // get changed nodes by CSS.takeComputedStyleUpdates
  // https://source.chromium.org/chromium/chromium/src/+/main:third_party/blink/renderer/core/inspector/inspector_css_agent.cc;l=4735;drc=3f8932533ccf9426786d1e0416d2cad13f1c991d
  const computedStyles = {};
  //const computedStyleSets = {};
  /*
      for (const prop of computedStyle) {
        if (!computedStyleSets[prop.name])
          computedStyleSets[prop.name] = new Set();
        computedStyleSets[prop.name].add(prop.value);
      }
    */

  var totalElements = 0;

  async function countElementNodes(node) {
    totalElements += 1;
    // init for multiple screen sizes
    node.css = {};
  }
  await traverse(root, countElementNodes, true);

  console.log("Total Elements: ", totalElements);

  /*
    async function collectNodeComputedStyle(node) {
      total += 1;
      const { computedStyle } = await CSS.getComputedStyleForNode({
        nodeId: node.nodeId,
      });
      computedStyles[node.nodeId] = computedStyle;
    }

    await traverse(root, collectNodeComputedStyle, true);
    */

  /*
    var l = 0;
    for (const [prop, values] of Object.entries(computedStyles)) {
      l += Array.from(values).length;
    }
    console.log(l); // ~1955
    */
  //console.log(total); // 932

  // main
  const breakpoints = []; // 1024
  const screens = [];
  if (breakpoints.length === 0) {
    screens.push({ width: 1280, height: 800, mobile: false });
  } else {
    for (let i = 0; i < breakpoints.length; ++i) {
      let width;
      if (i === 0) {
        width = Math.round(breakpoints[i] / 2);
      } else {
        width = Math.round((breakpoints[i] + breakpoints[i + 1]) / 2);
      }
      screens.push({
        width,
        height: 800,
        mobile: false,
      });
    }
    screens.push({
      width: breakpoints[breakpoints.length - 1] + 100,
      height: 800,
      mobile: false,
    }); // add one more for larger than largest breakpoint
  }

  const pb = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
  for (let i = 0; i < screens.length; i++) {
    const { width, height, mobile } = screens[i];
    console.log(
      `Device ${i} (width: ${width}, height: ${height}, mobile: ${mobile})`,
    );
    await Emulation.setDeviceMetricsOverride({
      width,
      height,
      deviceScaleFactor: 1,
      mobile,
    });
    console.log(`cascading`);

    pb.start(totalElements, 0);
    await traverse(
      root,
      async (node) => {
        await cascade(node, CSS, i);
        pb.increment();
      },
      true,
    );
    pb.stop();

    console.log(`cascading pseudo`);
    pb.start(totalElements, 0);
    await traverse(
      root,
      async (node) => {
        await cascadePseudoClass(node, CSS, i);
        pb.increment();
      },
      false,
    );
    pb.stop();
  }

  /*
  console.log(JSON.stringify(root.css));
  process.exit(0);
  */

  function cleanUp(node: Node) {
    for (const rulesObj of Object.values(node.css)) {
      for (const [selector, rules] of Object.entries(rulesObj)) {
        for (const [prop, value] of Object.entries(rules)) {
          if (!value.explicit) {
            delete rules[prop];
          }
          delete value.explicit;
        }
      }
    }
  }

  async function setId(node: Node) {
    var id = `node-${node.nodeId}`;
    var hasId = false;
    const { attributes } = await DOM.getAttributes({ nodeId: node.nodeId });
    // don't use indexOf in case some value is "id"
    for (let i = 0; i < attributes.length; i += 2) {
      if (attributes[i] === "id") {
        id = attributes[i + 1];
        hasId = true;
        break;
      }
    }
    if (!hasId) {
      await DOM.setAttributeValue({
        nodeId: node.nodeId,
        name: "id",
        value: id,
      });
    }
    node.id = id;

    for (const rulesObj of Object.values(node.css)) {
      for (const [selector, rules] of Object.entries(rulesObj)) {
        rulesObj[`#${id}` + selector] = rules;
        delete rulesObj[selector];
      }
    }
  }
  await traverse(
    root,
    async (node: Node) => {
      cleanUp(node);
      await setId(node); // add #id for css selector
      const styleJSONs = {};
      Object.entries(node.css).map(([screenKey, rules]) => {
        styleJSONs[screenKey] = toStyleJSON(
          replaceVariables(toStyleSheet(rules)),
        );
      });

      const sharedCSS = {};
      const [firstStyleJSON, ...otherStyleJSONs] = Object.values(styleJSONs);

      for (const [targetSelector, targetRule] of Object.entries(
        firstStyleJSON,
      )) {
        for (const [targetProp, targetValue] of Object.entries(targetRule)) {
          // Check if all other styleJSONs have the same selector and property with the same value
          const isShared = otherStyleJSONs.every((styleJSON) => {
            return (
              styleJSON[targetSelector] &&
              JSON.stringify(styleJSON[targetSelector][targetProp]) ===
                JSON.stringify(targetValue)
            );
          });
          if (isShared) {
            if (!sharedCSS[targetSelector]) sharedCSS[targetSelector] = {};
            sharedCSS[targetSelector][targetProp] = targetValue;
            Object.values(styleJSONs).forEach((styleJSON) => {
              if (styleJSON[targetSelector]) {
                delete styleJSON[targetSelector][targetProp];
              }
            });
          }
        }
        // clean up empty selectors and screenKeys
        for (const screenKey of Object.keys(styleJSONs)) {
          const styleKeyJSON = styleJSONs[screenKey];
          for (const selector of Object.keys(styleKeyJSON)) {
            if (Object.keys(styleKeyJSON[selector]).length === 0) {
              delete styleKeyJSON[selector];
            }
          }
          if (Object.keys(styleJSONs[screenKey]).length === 0) {
            delete styleJSONs[screenKey];
          }
        }
      }
      let cssType = "styleSheet";
      let cssData;
      if (
        Object.keys(styleJSONs).length === 0 &&
        Object.keys(sharedCSS).length === 0
      ) {
        return;
      } else if (
        Object.keys(styleJSONs).length === 0 &&
        Object.keys(sharedCSS).length === 1 &&
        Object.keys(sharedCSS)[0] === `#${node.id}`
      ) {
        cssType = "inlineStyle";
        cssData = sharedCSS[`#${node.id}`];
      } else {
        cssData = "";
        if (Object.keys(sharedCSS).length > 0) {
          cssData += toStyleSheet(sharedCSS);
        }
        for (const key of Object.keys(styleJSONs)) {
          const i = parseInt(key);
          if (i === 0) {
            cssData += toStyleSheet(styleJSONs[i], null, breakpoints[i]);
          } else if (i === screens.length - 1) {
            cssData += toStyleSheet(styleJSONs[i], breakpoints[i - 1], null);
          } else {
            cssData += toStyleSheet(
              styleJSONs[i],
              breakpoints[i - 1],
              breakpoints[i],
            );
          }
        }
      }
      await DOM.setAttributeValue({
        nodeId: node.nodeId,
        name: "data-css",
        value: JSON.stringify({
          type: cssType,
          data: cssData,
        }),
      });
    },
    false, //true
  );

  //console.log("body");
  //console.log(root.css);
  //console.log(root.styleSheet);

  //console.log("a");
  //console.log(root.children[0].css);
  //console.log(root.children[0].styleSheet);

  console.log("Downloading files...");

  const fontFiles = [];
  const resources = [];
  pb.start(Object.keys(requests).length, 0);
  for (const [requestId, req] of Object.entries(requests)) {
    const { type, url, filename } = req;
    if (type && filename) {
      const outDir = path.join(assetDir, type);
      const outFilename = getAvailableFilename(outDir, filename);
      const outPath = path.join(outDir, outFilename);
      const urlPath = path.join("/assets", type, outFilename);
      //console.log("saving", url, "to", outPath);

      // not checking loaded so can error, just try
      if (!downloadedURLs.has(url)) {
        try {
          if (type === "audio" || type === "video") {
            await downloadFile(url, outPath);
            resources.push({ url, path: urlPath });
          } else {
            if (type === "font") {
              fontFiles.push(filename);
            }

            const { body, base64Encoded } = await Network.getResponseBody({
              requestId: requestId,
            });
            const buffer = base64Encoded
              ? Buffer.from(body, "base64")
              : Buffer.from(body);
            fs.writeFileSync(outPath, buffer);
            resources.push({ url, path: urlPath });
          }
          downloadedURLs.add(url);
        } catch (e) {
          console.warn("download error:", e);
        }
      } else {
        // have downloaded and now used
        resources.push({ url, path: urlPath });
      }
    }
    pb.increment();
  }
  pb.stop();

  console.log("Extracting fonts...");
  const { result: resultFonts } = await Runtime.evaluate({
    expression:
      getFontRules.toString() + `; getFontRules(${JSON.stringify(fontFiles)});`,
    returnByValue: true,
  });
  resultFonts.value.forEach((cssText) => {
    fontCSSSet.add(cssText);
  });
  const fontLinkTag = '<link rel="stylesheet" href="/fonts.css" />\n';

  console.log("Inlining style...");
  await Runtime.evaluate({
    expression:
      cleanTags.toString() +
      "; cleanTags();" +
      inlineStyle.toString() +
      "; inlineStyle();",
  });

  console.log("Rewriting Links...");
  const pagePath = decodeURIComponent(getPath(pageURL));
  let htmlDir, pageBase, htmlPath;
  if (pagePath.endsWith(".html")) {
    // can't tell dir or file by trailing slash
    htmlDir = path.join(baseDir, path.dirname(pagePath));
    htmlPath = path.join(htmlDir, path.basename(pagePath));
    pageBase = path.dirname(pagePath);
  } else {
    htmlDir = path.join(baseDir, pagePath);
    htmlPath = path.join(htmlDir, "index.html");
    pageBase = path.dirname(path.join(pagePath, "a"));
  }
  const origin = getOrigin(pageURL);
  await Runtime.evaluate({
    expression:
      sameSiteHrefToRelativePath.toString() +
      `; sameSiteHrefToRelativePath(${JSON.stringify(origin)});`,
  });

  // Get the updated HTML with inline styles
  var { outerHTML } = await DOM.getOuterHTML({ nodeId: root.nodeId });

  outerHTML = rewriteResourceLinks(pageBase, resources, outerHTML);
  outerHTML = fontLinkTag + outerHTML;

  // Save to file
  // all filepath based on URL must be decoded
  fs.mkdirSync(htmlDir, { recursive: true });
  fs.writeFileSync(htmlPath, outerHTML, "utf-8");
  console.log(`✅ ${htmlPath} saved!`);

  const { result: resultLinks } = await Runtime.evaluate({
    expression: getAnchorHref.toString() + "; getAnchorHref();",
    returnByValue: true,
  });
  const links = resultLinks.value;

  function filterPageUrls(origin, links) {
    const results = [];

    for (const link of links) {
      try {
        // Normalize to absolute URL
        const url = new URL(link, origin);

        // Check same origin
        if (url.origin !== origin) {
          continue;
        }

        // Heuristic: treat URLs with "file-like" extensions as not pages
        const fileExt = url.pathname.split(".").pop().toLowerCase();
        // prettier-ignore
        const nonPageExts=["pdf","jpg","jpeg","png","gif","svg","zip","exe","mp4","mp3","webm"];
        const isFile = nonPageExts.includes(fileExt);
        if (!isFile) results.push(url.origin + url.pathname);
      } catch (e) {}
    }

    return results;
  }

  await client.close();

  return filterPageUrls(origin, links);
}

const BROWSER = "../chrome/linux-141.0.7378.3/chrome-linux64/chrome";
//const BROWSER = "brave-browser";
//--headless
const browserProc = exec(`${BROWSER} --headless --remote-debugging-port=9222`);

// --user-data-dir=/tmp/chrome-devtools

function cleanup() {
  if (browserProc) browserProc.kill();
}

try {
  process.on("SIGINT", () => {
    cleanup();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    cleanup();
    process.exit(0);
  });
  process.on("exit", cleanup);

  //const rootURLObj = new URL(
  //  "https://www.cs.cornell.edu/courses/cs6120/2020fa/self-guided/"
  //);
  //const rootURLObj = new URL("https://chatgpt.com/");
  //const rootURLObj = new URL("https://bmaa.tw");
  //const rootURLObj = new URL("https://react.dev/");
  //const rootURLObj = new URL("https://wmail1.cc.ntu.edu.tw/rc/");
  //const rootURLObj = new URL("https://scholar.google.com/");
  //const rootURLObj = new URL("https://www.comfy.org/");
  const rootURLObj = new URL("http://localhost:8080/d.html");
  const rootURL = rootURLObj.origin + rootURLObj.pathname;
  let pageQueue = [rootURL];
  const seenURLs = new Set();
  if (rootURL.endsWith("/")) seenURLs.add(rootURL + "index.html");
  baseDir = "./out";
  assetDir = path.join(baseDir, "/assets");
  // wait browser
  await new Promise((resolve) => setTimeout(resolve, 1500));

  //setup dir
  if (fs.existsSync(baseDir)) {
    fs.rmSync(baseDir, { recursive: true, force: true });
  }
  for (const mimeType of MIME) {
    fs.mkdirSync(path.join(assetDir, mimeType), { recursive: true });
  }

  while (pageQueue.length !== 0) {
    const url = pageQueue.shift();

    const links = await crawl(url);
    seenURLs.add(url);

    const newLinks = links.filter((link) => {
      if (!seenURLs.has(link)) {
        if (link.endsWith("/")) seenURLs.add(link + "index.html");
        seenURLs.add(link);
        return true;
      }
    });
    pageQueue = pageQueue.concat(newLinks);
    //console.log("concat:", newLinks);
    console.log(pageQueue);
    console.log(pageQueue.length);
  }

  const fontCSSPath = path.join(baseDir, "fonts.css");
  console.log(`Writing ${fontCSSPath}`);
  fs.writeFileSync(fontCSSPath, [...fontCSSSet].join("\n"), "utf-8");
  console.log("visited", [...seenURLs]);

  // cleanup empty dir
  for (const mimeType of MIME) {
    const dirPath = path.join(assetDir, mimeType);
    if (fs.existsSync(dirPath) && fs.readdirSync(dirPath).length === 0) {
      fs.rmdirSync(dirPath);
    }
  }
} catch (err) {
  console.error(err);
} finally {
  process.exit(0);
}
