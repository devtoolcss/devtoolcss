// function to call in Runtime.evaluate, no context

export function inlineStyle() {
  const body = document.querySelector("body");
  const elements = [...body.querySelectorAll("*")];
  elements.push(body);
  for (const el of elements) {
    const dataCSSJSON = el.getAttribute("data-css");
    if (dataCSSJSON) {
      const { type, data } = JSON.parse(dataCSSJSON);
      if (type === "styleSheet") {
        const styleEl = document.createElement("style");
        styleEl.textContent = data;
        if (el.children.length > 0) {
          el.insertBefore(styleEl, el.children[0]);
        } else {
          el.parentNode.insertBefore(styleEl, el);
        }
      } else {
        // inlineStyle
        //el.style.cssText = "";
        Object.entries(data).forEach(([key, value]) => {
          el.style.setProperty(
            key,
            value.value,
            value.important ? "important" : "",
          );
        });
      }

      // cleanup attrs
      [...el.attributes].forEach((attr) => {
        if (
          /*
          attr.name !== "id" &&
          attr.name !== "class" &&
          attr.name !== "style" &&
          attr.name !== "href" &&
          attr.name !== "value" &&
          attr.name !== "type" &&
          //attr.name !== "data-pseudo" &&
          !attr.name.includes("src")
          */
          attr.name === "data-css"
        ) {
          el.removeAttribute(attr.name);
        }
      });
    }
  }
}

export function cleanTags() {
  const toClean = document.querySelectorAll("script, link, style");
  toClean.forEach((el) => el.remove());
}

export function getFontRules(fontFiles) {
  const fontCSSs = [];

  for (const sheet of document.styleSheets) {
    try {
      for (const rule of sheet.cssRules) {
        if (rule.type === CSSRule.FONT_FACE_RULE) {
          let cssText = rule.cssText;

          //const urlMatch = cssText.match(/url\(["']?([^"')]+)["']?\)/);
          const urlMatch = cssText.match(/url\(([^)]*?)\)/);
          const url = urlMatch ? urlMatch[1] : null;
          if (!url) continue;

          if (url.match(/^['"]?\s*(data:|blob:)/)) {
            fontCSSs.push(cssText);
          } else {
            for (const fontFile of fontFiles) {
              if (
                url.includes(fontFile) ||
                url.includes(encodeURIComponent(fontFile))
              ) {
                cssText = cssText.replace(
                  /url\(([^)]*?)\)/g,
                  `url('./assets/font/${fontFile}')`,
                );
                fontCSSs.push(cssText);
                break;
              }
            }
          }
        }
      }
    } catch (err) {
      console.warn("Skipping stylesheet due to CORS:", sheet.href);
    }
  }

  //console.log("Rewritten CSS:\n", fontCSS);
  //console.log("Font file mapping:", fontFiles);
  return fontCSSs;
}

export function getAnchorHref() {
  const links = new Set();
  document.querySelectorAll("a").forEach((el) => {
    if (el.href) {
      links.add(el.href);
    }
  });
  return [...links];
}

export function normalizeSameSiteHref(origin) {
  document.querySelectorAll("a").forEach((el) => {
    if (el.href) {
      try {
        const url = new URL(el.href, document.baseURI);
        if (url.origin === origin) {
          var pathname = url.pathname ? url.pathname : "/";
          // handle extensions like .php, .asp, .aspx, etc
          const ext = pathname.split("/").pop()?.split(".").pop();
          if (
            ext &&
            ext !== "html" &&
            ext !== "htm" &&
            !pathname.endsWith("/")
          ) {
            pathname = pathname.slice(0, pathname.length - ext.length) + "html";
          }
          const newHref = pathname + url.search + url.hash;
          el.setAttribute("href", newHref || "#");
        }
      } catch (e) {
        // Ignore invalid URLs
      }
    }
  });
}
