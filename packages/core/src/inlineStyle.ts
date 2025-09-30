export function inlineStyle(
  document: Document, // JSDOM or browser DOM
  cssAttr = "data-css",
  removeAttr = true,
) {
  const body = document.querySelector("body");
  const elements = Array.from(body.querySelectorAll("*"));
  elements.push(body);
  for (const el of elements) {
    const cssText = el.getAttribute(cssAttr);
    if (cssText) {
      const isStyleSheet = cssText.includes("{");
      if (isStyleSheet) {
        // inline style can contain variables and override resolved stylesheet
        (el as HTMLElement).removeAttribute("style");

        const styleEl = document.createElement("style");
        styleEl.textContent = cssText;
        const noChildTags = [
          // void elements
          // https://developer.mozilla.org/en-US/docs/Glossary/Void_element
          "AREA",
          "BASE",
          "BR",
          "COL",
          "EMBED",
          "HR",
          "IMG",
          "INPUT",
          "LINK",
          "META",
          "PARAM",
          "SOURCE",
          "TRACK",
          "WBR",
          // some others
          "TEXTAREA",
          "IFRAME",
          "TITLE",
          "SCRIPT",
          "STYLE",
        ];
        if (noChildTags.includes(el.tagName)) {
          el.parentNode.insertBefore(styleEl, el);
        } else {
          el.insertBefore(styleEl, el.children[0]);
        }
      } else {
        // inline style
        // JSDOM CSSOM is buggy, directly set style attr
        (el as HTMLElement).setAttribute("style", cssText);
      }

      // cleanup attrs
      if (removeAttr) {
        Array.from(el.attributes).forEach((attr) => {
          if (attr.name === cssAttr) {
            el.removeAttribute(attr.name);
          }
        });
      }
    }
  }
}
