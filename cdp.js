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
} from "./css_parser.js";

import {
  getFilename,
  getFonts,
  downloadFile,
  MIME,
  getExtension,
} from "./fonts.js";
import * as CSSwhat from "css-what";

const ELEMENT_NODE = 1;

const BROWSER = "../chrome/linux-141.0.7378.3/chrome-linux64/chrome";
//const BROWSER = "brave-browser";
//--headless
exec(`${BROWSER} --headless --remote-debugging-port=9222`);

// --user-data-dir=/tmp/chrome-devtools

function inlineStyle() {
  const body = document.querySelector("body");
  const elements = [...body.querySelectorAll("*")];
  elements.push(body);
  for (const el of elements) {
    const data_css = el.getAttribute("data-css");
    const styleEl = document.createElement("style");
    styleEl.textContent = data_css;

    if (el.children.length > 0) {
      el.insertBefore(styleEl, el.children[0]);
    } else {
      el.parentNode.insertBefore(styleEl, el);
    }

    // cleanup attrs
    [...el.attributes].forEach((attr) => {
      if (
        attr.name !== "id" &&
        attr.name !== "class" &&
        attr.name !== "style" &&
        attr.name !== "href" &&
        //attr.name !== "data-pseudo" &&
        !attr.name.includes("src")
      ) {
        el.removeAttribute(attr.name);
      }
    });
  }
}

function cleanTags() {
  const toClean = document.querySelectorAll("script, link, style");
  toClean.forEach((el) => el.remove());
}

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

(async function () {
  let client;
  try {
    // wait browser
    await new Promise((resolve) => setTimeout(resolve, 1500));
    //client = await CDP({ host: "140.112.30.182", port: 9222 });
    client = await CDP();

    await client.Emulation.setDeviceMetricsOverride({
      width: 1920,
      height: 1080,
      deviceScaleFactor: 1,
      mobile: false,
    });

    const { DOM, CSS, Page, Runtime, Network } = client;
    await DOM.enable();
    await CSS.enable();
    await Page.enable();
    await Network.enable();
    await Network.setCacheDisabled({ cacheDisabled: true });

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

      /*
      if (["html", "javascript", "css"].includes(subtype)) {
        // can be octet-stream
        console.log("skip", getFilename(param.response.url), subtype);
        return;
      }
      */
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

    await Page.navigate({ url: "http://localhost:8080/index.html" });
    // BUG: not sure why after testing with --headless, it doesn't navigate at all
    // leading to wrong inline style (somehow correct stylesheets?)
    // must reboot (or change url?) to fix
    await Page.loadEventFired();
    // trigger all lazyloading
    await Runtime.evaluate({
      expression: "window.scrollTo(0, document.body.scrollHeight);",
    });

    const { root: docRoot } = await DOM.getDocument({ depth: -1 });

    // Find the node by ID
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

    var total = 0;

    async function collectNodeComputedStyle(node) {
      total += 1;
      const { computedStyle } = await CSS.getComputedStyleForNode({
        nodeId: node.nodeId,
      });
      computedStyles[node.nodeId] = computedStyle;
    }

    await traverse(root, collectNodeComputedStyle, true);

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
                parseCSSProperties(
                  rule.rule.style.cssProperties,
                  css[""],
                  true
                );
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
    await traverse(root, cascade, true);
    console.log("cascading pseudo");
    await traverse(root, cascadePseudoClass, true);

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

      for (const [selector, rules] of Object.entries(node.css)) {
        node.css[`#${id}` + selector] = rules;
        delete node.css[selector];
      }
    }
    await traverse(
      root,
      async (node) => {
        cleanUp(node);
        await setId(node);
        node.styleSheet = replaceVariables(toStyleSheet(node.css));
        await DOM.setAttributeValue({
          nodeId: node.nodeId,
          name: "data-css",
          value: node.styleSheet,
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
    if (fs.existsSync("./out/assets/")) {
      fs.rmSync("./out/assets/", { recursive: true, force: true });
    }
    for (const mimeType of MIME) {
      fs.mkdirSync(`./out/assets//${mimeType}`, { recursive: true });
    }

    const fontFiles = [];
    for (const req of Object.values(requests)) {
      const { type, url, data, base64Encoded } = req;
      const filename = getFilename(url);
      if (type && filename) {
        const path = `./out/assets/${type}/${filename}`;
        console.log("saving", url, "to", path);
        if (type === "audio" || type === "video") {
          await downloadFile(url, path);
        } else {
          if (type === "font") {
            fontFiles.push(filename);
          }
          const filePath = path;
          const buffer = base64Encoded
            ? Buffer.from(data, "base64")
            : Buffer.from(data);
          fs.writeFileSync(filePath, buffer);
        }
      }
    }
    for (const mimeType of MIME) {
      const dirPath = `./out/assets/${mimeType}`;
      if (fs.existsSync(dirPath) && fs.readdirSync(dirPath).length === 0) {
        fs.rmdirSync(dirPath);
      }
    }

    console.log("Rewriting font CSS...");
    console.log(fontFiles);
    const { result } = await Runtime.evaluate({
      expression:
        getFonts.toString() + `; getFonts(${JSON.stringify(fontFiles)});`,
      returnByValue: true,
    });
    const fontCSS = result.value;
    fs.writeFileSync("./out/fonts.css", fontCSS, "utf-8");
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
    const { outerHTML } = await DOM.getOuterHTML({ nodeId: root.nodeId });

    // Save to file
    fs.writeFileSync("./out/cdp.html", fontLinkTag + outerHTML, "utf-8");
    console.log("✅ HTML with inline styles saved to cdp.html");
    process.exit(0);
  } catch (err) {
    console.error(err);
  } finally {
    if (client) {
      await client.close();
    }
  }
})();
