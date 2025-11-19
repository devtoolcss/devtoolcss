import { truncateHTML } from "./htmlUtils";
import { filterMatchedStyles, toStyleSheetText } from "./styleUtils";
import { evaluateDOMExpression } from "./DOMExpression";

import { NodeUidManager } from "./NodeUidManager";
import { InspectorManager } from "./InspectorManager";

const inspectorManager = new InspectorManager();
const nodeManager = new NodeUidManager();

async function processRequest(request) {
  console.log("processRequest - request:", request);
  const inspector =
    inspectorManager.get(request.tabId) ??
    (await inspectorManager.create(request.tabId));

  switch (request.tool) {
    case "getNodes": {
      // Unified node retrieval using DOM expression syntax
      if (!request.expression) {
        throw new Error("Missing 'expression' parameter");
      }
      return await evaluateDOMExpression(
        request.expression,
        inspector,
        nodeManager,
      );
    }

    case "getMatchedStyles": {
      const {
        uid,
        removeUnusedVar = true,
        appliedOnly = false,
        filter,
      } = request;
      const node = getNode(uid, inspector);
      if (!node) {
        throw new Error(`Node not found for uid: ${uid}`);
      }
      const options = {
        parseOptions: { removeUnusedVar },
      };
      let styles = await node.getMatchedStyles(options);

      // Apply filters to reduce response size
      if (filter) {
        styles = filterMatchedStyles(styles, filter);
      }
      const toStyleSheetOptions = {
        applied: appliedOnly ? false : true,
        matchedSelectors: true,
      };
      const styleSheetText = toStyleSheetText(
        styles,
        node,
        toStyleSheetOptions,
      );
      console.log("serveRequest - getMatchedStyles styles:", styleSheetText);

      return { styles: styleSheetText };
    }

    case "getComputedStyle": {
      const node = getNode(request.uid, inspector);
      if (!node) {
        throw new Error("Node not found for uid: " + request.uid);
      }

      const styles = await node.getComputedStyle();
      const filtered = {};
      request.properties.map((prop) => {
        filtered[prop] = styles[prop];
      });
      console.log("serveRequest - getComputedStyle styles:", filtered);
      return { styles: filtered };
    }

    case "getOuterHTML": {
      // some safe defaults
      const {
        uid,
        maxDepth = 3,
        maxLineLength = 1000,
        maxChars = 500000,
      } = request;
      const node = getNode(uid, inspector);
      if (!node) {
        throw new Error(`Node not found for uid: ${uid}`);
      } else if (!node.tracked) {
        throw new Error(`Node is no longer existed for uid: ${uid}`);
      }
      // Apply depth and line length controls if provided
      const html = truncateHTML(
        node._docNode,
        maxDepth,
        maxLineLength,
        maxChars,
      );
      console.log("serveRequest - getOuterHTML html:", html);
      return { outerHTML: html };
    }

    default:
      throw new Error("Unknown tool: " + request.tool);
  }
}

// listener must be sync, return true to indicate async response
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.receiver !== "offscreen") return;

  switch (msg.event) {
    case "REQUEST":
      processRequest(msg.request)
        .then(sendResponse)
        .catch((error) => {
          sendResponse({ error: error.message || String(error) });
        });
      return true; // Keep the message channel open for async response
  }
});
