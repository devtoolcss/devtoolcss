import { chromeDebugger } from "./ChromeDebuggerBridge";
import { Inspector } from "chrome-inspector";

// inspector management per tab
export class InspectorManager {
  constructor() {
    this.inspectors = {};
    // record $0 xpaths for tabs not having inspector yet
    this.tab$0Map = new Map();

    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      switch (msg.event) {
        case "TAB_CLOSED":
          if (this.get(msg.tabId)) {
            chromeDebugger.detach({ tabId: msg.tabId });
            this.remove(msg.tabId);
            // TODO: cleanup nodeUidManager
          }
          break;

        case "DEBUGGER_DETACHED":
          if (this.get(msg.tabId)) {
            this.remove(msg.tabId);
            console.log(
              `Inspector for tab ${msg.tabId} detached for ${msg.reason}`,
            );
            // TODO: cleanup nodeUidManager
          }
          break;

        case "SET_INSPECTED_TAB_$0":
          this.tab$0Map.set(tabId, xpath);
          break;
      }
    });
  }

  async create(tabId) {
    await chromeDebugger.attach({ tabId }, "1.3");
    this.inspectors[tabId] = await Inspector.fromChromeDebugger(
      chromeDebugger,
      tabId,
      { $0XPath: this.tab$0Map.get(tabId) },
    );
    return this.inspectors[tabId];
  }

  get(tabId) {
    return this.inspectors[tabId];
  }

  remove(tabId) {
    delete this.inspectors[tabId];
  }
}
