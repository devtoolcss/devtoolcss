/// <reference types="chrome"/>

import { getUniqueSelector } from "./selector.js";

const target = { tabId: chrome.devtools.inspectedWindow.tabId };

function inspectedWindowEval(f, argStr) {
  return new Promise((resolve, reject) =>
    chrome.devtools.inspectedWindow.eval(
      `${f.toString()}\n${f.name}(${argStr});`,
      (result, isException) => {
        if (isException) {
          reject(`inspectedWindowEval: Error executing ${f.name}(${argStr})`);
        } else {
          resolve(result);
        }
      },
    ),
  );
}

async function getChildren(node) {
  const childrenPromise = new Promise((resolve) => {
    // if no children to request, also good
    const timeoutId = setTimeout(() => {
      chrome.debugger.onEvent.addListener(handler);
      console.log("No children");
      resolve();
    }, 500);

    let handler;
    handler = (source, method, params) => {
      if (method !== "DOM.setChildNodes" || node.nodeId !== params.parentId)
        return;
      node.children = params.nodes;
      chrome.debugger.onEvent.removeListener(handler);
      clearTimeout(timeoutId);
      resolve();
    };

    chrome.debugger.onEvent.addListener(handler);
  });
  await chrome.debugger.sendCommand(target, "DOM.requestChildNodes", {
    nodeId: node.nodeId,
    depth: -1,
  });
  await childrenPromise;
}

(async () => {
  document.getElementById("exportBtn").onclick = async function () {
    // initialize CDP
    try {
      await chrome.debugger.attach(target, "1.3");
      await chrome.debugger.sendCommand(target, "DOM.enable");
      await chrome.debugger.sendCommand(target, "CSS.enable");

      const selector = await inspectedWindowEval(getUniqueSelector, "$0");
      const { root } = await chrome.debugger.sendCommand(
        target,
        "DOM.getDocument",
        { depth: 0 },
      );
      const { nodeId } = await chrome.debugger.sendCommand(
        target,
        "DOM.querySelector",
        { nodeId: root.nodeId, selector },
      );
      const { node } = await chrome.debugger.sendCommand(
        target,
        "DOM.describeNode",
        {
          nodeId,
          depth: 1, // so that #text will also be retrived
        },
      );
      // depth 1 doesn't matter, it will return the same node with the
      // same children even though included before.
      await getChildren(node);

      await chrome.debugger.detach(target);
    } catch (e) {
      console.error(e.message + "\n" + e.stack);
    }
  };
})();
