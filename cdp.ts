import fs from "fs";
import CDP from "chrome-remote-interface";
import { exec } from "child_process";
import {
  pseudoClasses,
  hasPseudoClass,
  parseCSSProperties,
  getNormalizedSuffix,
  isEffectivePseudoElem,
  toStyleSheet,
  replaceVariables,
  toInlineStyleJSON,
} from "./css_parser.js";

import { getFilename, downloadFile, MIME, getExtension } from "./file.js";

import { rewriteLinks } from "./rewrite.js";

import { inlineStyle, cleanTags, getFonts, getAnchorHref } from "./runtime.js";

import * as CSSwhat from "css-what";
import cliProgress from "cli-progress";
import path from "path";

const ELEMENT_NODE = 1;

let baseDir = "./out";
let assetDir = "./out/assets";

const fontCSSSet = new Set();

async function traverse(node, callback, parallel = false) {
  if (node.nodeType !== ELEMENT_NODE) return;
  await callback(node);
  if (node.children) {
    if (parallel) {
      try {
        await Promise.all(
          node.children.map((child) => traverse(child, callback, parallel))
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

function getPath(url) {
  const urlObj = new URL(url);
  return urlObj.pathname;
}

function getOrigin(url) {
  const urlObj = new URL(url);
  return urlObj.origin;
}

/*
async function crawlTest(pageURL) {
  // seems that each client is a tab, a tab is a ws connection
  const target = await CDP.New();
  console.log("Connecting to browser...");
  const client = await CDP({ target: target.id });
  console.log("Connected!");

  await client.Emulation.setDeviceMetricsOverride({
    width: 1280, // my browser's fullscreen innerWidth/Height
    height: 720,
    deviceScaleFactor: 1,
    mobile: false,
  });

  const { DOM, CSS, Page, Runtime, Network } = client;

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

  const { result: resultLinks } = await Runtime.evaluate({
    expression: getAnchorHref.toString() + "; getAnchorHref();",
    returnByValue: true,
  });
  const links = resultLinks.value;

  await client.close();
  await CDP.Close({ id: target.id });
  const origin = getOrigin(pageURL);

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

  return filterPageUrls(origin, links);
}
*/

async function crawl(pageURL) {
  // seems that each client is a tab, a tab is a ws connection
  const target = await CDP.New();
  const client = await CDP({ target: target.id });

  await client.Emulation.setDeviceMetricsOverride({
    width: 1280, // my browser's fullscreen innerWidth/Height
    height: 720,
    deviceScaleFactor: 1,
    mobile: false,
  });

  const { DOM, CSS, Page, Runtime, Network } = client;

  const requests = {};
  Network.on("responseReceived", (param) => {
    const url = param.response.url;
    if (url.startsWith("data:")) return;
    const filename = getFilename(url);
    const [type, subtype] = param.response.mimeType.split("/");
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
  Network.on("loadingFinished", async (param) => {
    const requestId = param.requestId;
    if (
      !requests[requestId] ||
      ["audio", "video"].includes(requests[requestId].type)
    ) {
      return;
    }

    const { body, base64Encoded } = await Network.getResponseBody({
      requestId: requestId,
    });
    requests[requestId].base64Encoded = base64Encoded;
    requests[requestId].data = body;
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

  async function cascade(node) {
    //BUG: sometimes svg or some div nodeId=0
    const css = { "": {} };

    try {
      var {
        inherited,
        inlineStyle,
        attributesStyle,
        matchedCSSRules,
        pseudoElements,
      } = await CSS.getMatchedStylesForNode({ nodeId: node.nodeId });

      if (inherited) {
        for (let i = inherited.length - 1; i >= 0; i--) {
          const inheritedStyle = inherited[i];
          if (inheritedStyle.inlineStyle) {
            parseCSSProperties(
              inheritedStyle.inlineStyle.cssProperties,
              css[""],
              true
            );
          }
          if (inheritedStyle.matchedCSSRules) {
            for (const rule of inheritedStyle.matchedCSSRules) {
              if (rule.rule.origin !== "regular") continue;
              parseCSSProperties(rule.rule.style.cssProperties, css[""], true);
            }
          }
        }
      }

      if (attributesStyle)
        parseCSSProperties(attributesStyle.cssProperties, css[""]);

      for (const rule of matchedCSSRules) {
        if (rule.rule.origin !== "regular") continue;
        parseCSSProperties(rule.rule.style.cssProperties, css[""]);
      }

      if (inlineStyle) parseCSSProperties(inlineStyle.cssProperties, css[""]);

      for (const match of pseudoElements) {
        //match.pseudoType
        if (isEffectivePseudoElem(match, node)) {
          for (const rule of match.matches) {
            if (rule.rule.origin !== "regular") continue;
            const key = "::" + match.pseudoType;
            parseCSSProperties(
              rule.rule.style.cssProperties,
              (css[key] = css[key] || {})
            );
          }
        }
      }
      // normal css always not important
      /*
        Object.entries(css).forEach(([key, value]) => {
          Object.values(value).forEach((prop) => {
            prop.important = false;
          });
        });
        */

      node.css = css;
    } catch (error) {
      console.error("cascade", error);
    }
  }

  async function cascadePseudoClass(node) {
    try {
      const pseudoCss = {};
      //BUG: sometimes svg or some div nodeId=0
      /*
        const propertiesToTrack = [
          { name: "color", value: "black" },
          //{ name: "color", value: "red" },
        ];
        for (const [name, values] of Object.entries(computedStyles)) {
          for (const value of values) {
            propertiesToTrack.push({ name, value });
          }
        }
        console.log("nodeId", node.children[0].nodeId);

        await CSS.trackComputedStyleUpdates({
          propertiesToTrack,
        });

        console.log("takeComputedStyleUpdates");
        const p = CSS.takeComputedStyleUpdates();
        */

      await CSS.forcePseudoState({
        nodeId: node.nodeId,
        forcedPseudoClasses: pseudoClasses,
      });

      /*
        console.log("await takeComputedStyleUpdates");
        const UpdatedNodeIds = await p;
        console.log("updated nodes", UpdatedNodeIds);

        await CSS.trackComputedStyleUpdates({ propertiesToTrack: [] });
        */

      var { matchedCSSRules, pseudoElements } =
        await CSS.getMatchedStylesForNode({ nodeId: node.nodeId });

      // TODO: pseudoVars for overridden
      // also cascade with non-pseudo and compare to ensure overridden

      function iteratePseudo(rules) {
        for (const rule of rules) {
          if (rule.rule.origin !== "regular") continue;
          const matchingSelectors = rule.matchingSelectors.map(
            (i) => rule.rule.selectorList.selectors[i].text
          );
          for (const selector of matchingSelectors) {
            const parsedSelector = CSSwhat.parse(selector)[0];
            if (hasPseudoClass(parsedSelector)) {
              const suffix = getNormalizedSuffix(parsedSelector);
              if (!suffix) continue;
              parseCSSProperties(
                rule.rule.style.cssProperties,
                (pseudoCss[suffix] = pseudoCss[suffix] || {})
              );
            }
          }
        }
      }

      iteratePseudo(matchedCSSRules);
      for (const match of pseudoElements) {
        if (isEffectivePseudoElem(match, node)) {
          iteratePseudo(match.matches);
        }
      }

      // TODO: to solve hover a and show b problem, use nodeId as id and construct #a #b selector.
      // select right pseudo class by search the : and verify the selector prefix

      await CSS.forcePseudoState({
        nodeId: node.nodeId,
        forcedPseudoClasses: [],
      });

      /*
        Object.entries(pseudoCss).forEach(([key, value]) => {
          Object.values(value).forEach((prop) => {
            prop.important = true;
          });
        });
        */

      node.css = { ...node.css, ...pseudoCss };
    } catch (error) {
      console.error("cascade", error);
    }
  }

  // main
  console.log("cascading");
  const pb = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
  pb.start(totalElements, 0);
  await traverse(
    root,
    async (node) => {
      await cascade(node);
      pb.increment();
    },
    true
  );
  pb.stop();

  console.log("cascading pseudo");
  pb.start(totalElements, 0);
  await traverse(
    root,
    async (node) => {
      await cascadePseudoClass(node);
      pb.increment();
    },
    false
  );
  pb.stop();

  function cleanUp(node) {
    for (const [selector, rules] of Object.entries(node.css)) {
      for (const [prop, value] of Object.entries(rules)) {
        if (!value.explicit) {
          delete rules[prop];
        }
        delete value.explicit;
      }
    }
  }

  async function setId(node) {
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

    for (const [selector, rules] of Object.entries(node.css)) {
      node.css[`#${id}` + selector] = rules;
      delete node.css[selector];
    }
  }
  await traverse(
    root,
    async (node) => {
      cleanUp(node);
      await setId(node); // add #id for css selector
      node.styleSheet = replaceVariables(toStyleSheet(node.css));
      let cssType = "styleSheet";
      if (
        Object.keys(node.css).length === 1 && // no 0 case, must have one, even empty
        Object.keys(node.css)[0] === `#${node.id}`
      ) {
        cssType = "inlineStyle";
        node.inlineStyleJSON = toInlineStyleJSON(node.styleSheet);
      }
      await DOM.setAttributeValue({
        nodeId: node.nodeId,
        name: "data-css",
        value: JSON.stringify({
          type: cssType,
          data:
            cssType === "styleSheet" ? node.styleSheet : node.inlineStyleJSON,
        }),
      });
    },
    true
  );

  //console.log("body");
  //console.log(root.css);
  //console.log(root.styleSheet);

  //console.log("a");
  //console.log(root.children[0].css);
  //console.log(root.children[0].styleSheet);

  console.log("Downloading files...");

  const urls = new Set();
  const fontFiles = [];
  pb.start(Object.keys(requests).length, 0);
  for (const req of Object.values(requests)) {
    const { type, url, data, base64Encoded } = req;
    const filename = getFilename(url);
    if (type && filename) {
      const outPath = path.join(assetDir, type, filename);
      const urlPath = path.join("./assets", type, filename);
      //console.log("saving", url, "to", outPath);
      if (type === "audio" || type === "video") {
        await downloadFile(url, outPath);
        urls.add({ url, path: urlPath });
      } else if (data) {
        if (type === "font") {
          fontFiles.push(filename);
        }
        const filePath = outPath;
        const buffer = base64Encoded
          ? Buffer.from(data, "base64")
          : Buffer.from(data);
        fs.writeFileSync(filePath, buffer);
        urls.add({ url, path: urlPath });
      }
    }
    pb.increment();
  }
  pb.stop();

  console.log("Extracting fonts...");
  const { result: resultFonts } = await Runtime.evaluate({
    expression:
      getFonts.toString() + `; getFonts(${JSON.stringify(fontFiles)});`,
    returnByValue: true,
  });
  resultFonts.value.forEach((cssText) => {
    fontCSSSet.add(cssText);
  });
  const fontLinkTag = '<link rel="stylesheet" href="./fonts.css" />\n';

  console.log("Inlining style...");
  await Runtime.evaluate({
    expression:
      cleanTags.toString() +
      "; cleanTags();" +
      inlineStyle.toString() +
      "; inlineStyle();",
  });

  // Get the updated HTML with inline styles
  var { outerHTML } = await DOM.getOuterHTML({ nodeId: root.nodeId });

  console.log("Rewriting Links...");
  outerHTML = rewriteLinks(urls, outerHTML);
  outerHTML = fontLinkTag + outerHTML;

  // Save to file
  // all filepath based on URL must be decoded
  const pagePath = decodeURIComponent(getPath(pageURL));
  let htmlDir;
  let htmlPath;
  if (pagePath.endsWith(".html")) {
    htmlDir = path.join(baseDir, path.dirname(pagePath));
    htmlPath = path.join(htmlDir, path.basename(pagePath));
  } else {
    htmlDir = path.join(baseDir, pagePath);
    htmlPath = path.join(htmlDir, "index.html");
  }
  fs.mkdirSync(htmlDir, { recursive: true });
  fs.writeFileSync(htmlPath, outerHTML, "utf-8");
  console.log(`✅ ${htmlPath} saved!`);

  const { result: resultLinks } = await Runtime.evaluate({
    expression: getAnchorHref.toString() + "; getAnchorHref();",
    returnByValue: true,
  });
  const links = resultLinks.value;

  await client.close();
  const origin = getOrigin(pageURL);

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

  const rootURLObj = new URL("http://localhost:8080");
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
