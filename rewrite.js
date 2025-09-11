import escapeHTML from "escape-html";
import escapeStringRegexp from "escape-string-regexp";

export function rewriteLinks(urls, outerHTML) {
  for (const { url, path } of urls) {
    const pathEscaped = escapeHTML(path);
    //if (url.startsWith("http")) { // url must start with http
    const urlObj = new URL(url);
    const pathUri = urlObj.pathname.slice(1) + urlObj.search + urlObj.hash;
    const urlDecoded = decodeURI(url);
    // Escape special regex characters in url and urlPath
    // Replace all occurrences of url and urlPath with path
    // Replace only URLs that are quoted by ' or "
    for (const target of [url, urlDecoded]) {
      outerHTML = outerHTML
        .replace(
          new RegExp(
            `(['"])\\s*${escapeStringRegexp(escapeHTML(target))}\\s*\\1`,
            "g"
          ),
          `"${pathEscaped}"`
        )
        .replace(
          // in <style> tag, no html escape
          // TODO: different escape format? ex: amp
          new RegExp(`(['"])\\s*${escapeStringRegexp(target)}\\s*\\1`, "g"),
          `"${path}"`
        );
    }
    //}
    // replace path-only uri
    // ./ or / or without are the same, all base origin
    const pathUriDecoded = decodeURI(pathUri);
    for (const target of [pathUri, pathUriDecoded]) {
      outerHTML = outerHTML
        .replace(
          new RegExp(
            `(['"])\\s*(\.\/?)?${escapeStringRegexp(
              escapeHTML(target)
            )}\\s*\\1`,
            "g"
          ),
          `"${pathEscaped}"`
        )
        .replace(
          new RegExp(
            `(['"])\\s*(\.\/?)?${escapeStringRegexp(target)}\\s*\\1`,
            "g"
          ),
          `"${path}"`
        );
    }
  }
  return outerHTML;
}
