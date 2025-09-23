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
    //if (url.startsWith("http")) { // url must start with http
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
      /*
        .replace(
          new RegExp(
            `(['"])\\s*${escapeStringRegexp(escapeHTML(target))}\\s*\\1`,
            "g"
          ),
          `"${pathEscaped}"`
        )
        .replace(
          new RegExp(
            `(\\&quot;|\\&apos;|\\&#34;|\\&#39;|\\&#x22;|\\&#x27;)\\s*${escapeStringRegexp(
              escapeHTML(target)
            )}\\s*\\1`,
            "g"
          ),
          `&quot;${pathEscaped}&quot;`
        )
        .replace(
          // style css url(/path) without quote
          new RegExp(`\\(\\s*${escapeStringRegexp(target)}\\s*\\)`, "g"),
          `(${path})`
        )
        .replace(
          // style css url(/path) without quote
          new RegExp(
            `\\(\\s*${escapeStringRegexp(escapeHTML(target))}\\s*\\)`,
            "g"
          ),
          `(${pathEscaped})`
        )
        .replace(
          // in <style> tag, no html escape
          // TODO: different escape format? ex: amp
          new RegExp(`(['"])\\s*${escapeStringRegexp(target)}\\s*\\1`, "g"),
          `"${path}"`
        );
        */
    }
    //}
    // replace path-only uri
    // ./ or / or without are the same, all base origin
    const relPathUriDecoded = decodeURI(relPathUri);
    const prefixRegexStr = `(\\.\\/|${base === "/" ? "" : base}\\/)?`;
    for (const target of [relPathUri, relPathUriDecoded]) {
      outerHTML = outerHTML
        .replace(urlRegex(target, true, prefixRegexStr), pathEscaped)
        .replace(urlRegex(target, false, prefixRegexStr), filePath);
      /*
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
          // inlined css with url quote
          new RegExp(
            `(\\&quot;|\\&apos;|\\&#34;|\\&#39;|\\&#x22;|\\&#x27;)\\s*(\.\/?)?${escapeStringRegexp(
              escapeHTML(target)
            )}\\s*\\1`,
            "g"
          ),
          `&quot;${pathEscaped}&quot;`
        )
        .replace(
          // style css url(/path) without quote
          new RegExp(
            `\\(\\s*(\.\/?)?${escapeStringRegexp(target)}\\s*\\)`,
            "g"
          ),
          `(${path})`
        )
        .replace(
          // style css url(/path) without quote
          new RegExp(
            `\\(\\s*(\.\/?)?${escapeStringRegexp(escapeHTML(target))}\\s*\\)`,
            "g"
          ),
          `(${pathEscaped})`
        )
        .replace(
          new RegExp(
            `(['"])\\s*(\.\/?)?${escapeStringRegexp(target)}\\s*\\1`,
            "g"
          ),
          `"${path}"`
        );
        */
    }
  }
  return outerHTML;
}
