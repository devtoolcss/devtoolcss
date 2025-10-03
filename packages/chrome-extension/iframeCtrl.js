import beautify from "js-beautify";
import hljs from "highlight.js/lib/core";
import xml from "highlight.js/lib/languages/xml";

// Then register the languages you need
hljs.registerLanguage("html", xml);

const beautifyConfig = {
  indent_size: 2,
  wrap_line_length: 0, // disable line wrapping
  wrap_attributes: "auto", // "auto" | "force" | "force-aligned" | "force-expand-multiline"
};

const iframe = document.getElementById("previewFrame");
iframe.srcdoc = "<!DOCTYPE html><html><head></head><body></body></html>";

const iframeContainer = document.getElementById("iframeContainer");
const widthInput = document.getElementById("previewWidthInput");
const heightInput = document.getElementById("previewHeightInput");
const scaleInput = document.getElementById("scale");

/*
function updateIframe() {
  setIframeViewport(scaleInput.value);
}
*/

widthInput.addEventListener(
  "input",
  () => (iframeContainer.style.width = `${widthInput.value}px`),
);
heightInput.addEventListener(
  "input",
  () => (iframeContainer.style.height = `${heightInput.value}px`),
);
scaleInput.addEventListener(
  "input",
  () => (iframeContainer.style.transform = `scale(${scaleInput.value})`),
);

// keep update the html to copy
const copyCodeArea = document.getElementById("copyCodeArea");

// click to select all
copyCodeArea.addEventListener("click", function () {
  const sel = window.getSelection();
  if (!sel.isCollapsed) return; // only select all if no text is currently selected

  const range = document.createRange();
  range.selectNodeContents(this);
  sel.removeAllRanges();
  sel.addRange(range);
});

function observeIframeBody() {
  const doc = iframe.contentDocument;
  if (!doc || !doc.body) return;

  // Set up MutationObserver
  const observer = new MutationObserver(() => {
    const highlightedCode = hljs.highlight(
      beautify.html(doc.body.innerHTML, beautifyConfig),
      {
        language: "html",
      },
    ).value;
    copyCodeArea.innerHTML = highlightedCode;
  });

  observer.observe(doc.body, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
  });
}

// Call this after iframe content loads/updates
// initial not work somehow
iframe.addEventListener("load", observeIframeBody);

/* not working, require document focus
document.getElementById("copyHtmlBtn").onclick = async () => {
  const bodyHtml = iframe.contentDocument?.body?.innerHTML || "";
  chrome.devtools.inspectedWindow.eval(
    `navigator.clipboard.writeText(${JSON.stringify(bodyHtml)})`,
    (result, isException) => {
      if (isException)
        console.error(isException); //console.error("Copy body html failed");
      else console.log(JSON.stringify(bodyHtml));
    },
  );
};
*/
