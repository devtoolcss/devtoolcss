// function to call in Runtime.evaluate, no context

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
