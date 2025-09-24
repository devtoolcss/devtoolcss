import escapeHTML from "escape-html";
import escapeStringRegexp from "escape-string-regexp";
import path from "path";

const urlCharSet = `[\\w\\/.~%:@&+$,!*-]?#`; // ='()\\[\\]; not included because can be boundary

function urlRegex(url: string, html: boolean, prefixRegexStr = "") {
  const content = html ? escapeHTML(url) : url;
  return new RegExp(
    `(?<!${urlCharSet})${prefixRegexStr}${escapeStringRegexp(content)}(?!${urlCharSet})`,
    "g",
  );
}

export function rewriteResourceLinks(base, resources, outerHTML) {
  // base decoded, no trailing '/' EXCEPT root /
  for (const { url, path: filePath } of resources) {
    const pathEscaped = escapeHTML(filePath);
    const urlObj = new URL(url);
    // remove leading /
    const absPath = urlObj.pathname;
    const relPath =
      path.relative(base, absPath) + (absPath.endsWith("/") ? "/" : ""); // no leading './', preserve trailing /
    const relPathUri = relPath + urlObj.search + urlObj.hash;
    const urlDecoded = decodeURI(url);
    // Escape special regex characters in url and urlPath
    // Replace all occurrences of url and urlPath with path
    // Replace only URLs that are quoted by ' or "
    for (const target of [url, urlDecoded]) {
      outerHTML = outerHTML;
      outerHTML = outerHTML
        .replace(urlRegex(target, true), pathEscaped)
        .replace(urlRegex(target, false), filePath);
    }
    // replace path-only uri
    const relPathUriDecoded = decodeURI(relPathUri);
    const prefixRegexStr = `(\\.\\/|${base === "/" ? "" : base}\\/)?`;
    for (const target of [relPathUri, relPathUriDecoded]) {
      outerHTML = outerHTML
        .replace(urlRegex(target, true, prefixRegexStr), pathEscaped)
        .replace(urlRegex(target, false, prefixRegexStr), filePath);
    }
  }
  return outerHTML;
}
