/// <reference types="chrome"/>

import { Inspector, getInlinedComponent } from "@devtoolcss/parser";

import { getUniqueSelector } from "./selector.js";

const target = { tabId: chrome.devtools.inspectedWindow.tabId };
const iframe = document.getElementById("previewFrame");
const progressBarContainer = document.getElementById("exportProgressContainer");
const progressBar = document.getElementById("exportProgressBar");
const progressText = document.getElementById("exportProgressText");

function updateProgress(value, max = undefined) {
  progressBar.value = value;
  if (max !== undefined) progressBar.max = max;
  progressText.textContent = `${progressBar.value} / ${progressBar.max}`;
}

function showProgress() {
  progressBarContainer.style.display = "block";
}

function hideProgress() {
  progressBarContainer.style.display = "none";
}

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

const exportBtn = document.getElementById("exportBtn");

(async () => {
  exportBtn.onclick = async function () {
    // initialize CDP
    exportBtn.disabled = true;
    updateProgress(0, 1);
    showProgress();
    iframe.contentDocument.body.innerHTML = "";
    try {
      await chrome.debugger.attach(target, "1.3");
      const selector = await inspectedWindowEval(getUniqueSelector, "$0");
      const inspector = Inspector.fromChromeDebugger(
        chrome.debugger,
        target.tabId,
      );
      inspector.on("progress", (progress) => {
        updateProgress(progress.completed, progress.total);
      });
      const doc = await getInlinedComponent(selector, inspector);

      iframe.contentDocument.body.innerHTML = doc.body.innerHTML;

      await chrome.debugger.detach(target);
    } catch (e) {
      console.error(e instanceof Error ? e.message + "\n" + e.stack : e);
      await chrome.debugger.detach(target);
    }
    exportBtn.disabled = false;
    hideProgress();
  };
})();
