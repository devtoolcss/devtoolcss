// Modified From https://github.com/devtoolcss/chrome-inspector/blob/main/extension/devtools.js
// Licensed under MIT License
//
// Added SET_INSPECTED_TAB_ID messaging to inform background script of the inspected tab ID

import { getAbsoluteXPath } from "./xpath.js";

function sendSelector() {
  // TODO: debug mode
  const expression = `
(function() {
  ${getAbsoluteXPath.toString()}

  const sender = $0.ownerDocument.defaultView.__chrome_inspector_send_$0_xpath;
  try{
    const xpath = getAbsoluteXPath($0);
    if (typeof sender !== "function") return xpath;
    sender(xpath);
  } catch {}
})();
`;

  chrome.devtools.inspectedWindow.eval(
    expression,
    {},
    (result, exceptionInfo) => {
      if (result) {
        chrome.runtime.sendMessage({
          receiver: "offscreen",
          event: "SET_INSPECTED_TAB_$0",
          tabId: chrome.devtools.inspectedWindow.tabId,
          xpath: result,
        });
      } else if (exceptionInfo && exceptionInfo.isException) {
        console.error(
          `Unable to evaluate selection change script.`,
          exceptionInfo,
        );
      }
    },
  );

  chrome.runtime.sendMessage({
    receiver: "background",
    event: "SET_INSPECTED_TAB_ID",
    tabId: chrome.devtools.inspectedWindow.tabId,
  });
}

if (chrome?.devtools?.panels?.elements) {
  chrome.devtools.panels.elements.onSelectionChanged.addListener(sendSelector);
} else {
  console.warn(`chrome.devtools API is not available in this context.`);
}
