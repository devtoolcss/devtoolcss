import path from "path";
import { getExtension } from "./file.js";

export function getPath(url: string) {
  const urlObj = new URL(url);
  return urlObj.pathname;
}

export function getOrigin(url: string) {
  const urlObj = new URL(url);
  return urlObj.origin;
}

export function normalizePageURL(pageURL: string, origin: string = undefined) {
  const urlObj = new URL(pageURL, origin);

  // don't handle trailing slash or index.html
  // server can have different behavior for that

  // currently don't handle equivalent URLs

  /*
  const fileExt = path.extname(urlObj.pathname);
  if (urlObj.pathname.endsWith("/") || fileExt === "") {
    return urlObj.origin + path.join(urlObj.pathname, "index.html");
  }
  */

  return urlObj.origin + urlObj.pathname;
}

// links can be url or path
export function selectPageLinks(origin: string, links: string[]) {
  const results: string[] = [];
  for (const link of links) {
    const urlObj = new URL(link, origin);
    if (urlObj.origin !== origin) continue;
    const fileExt = getExtension(urlObj.pathname).toLowerCase();
    const nonPageExts = [
      "pdf",
      "jpg",
      "jpeg",
      "png",
      "gif",
      "svg",
      "zip",
      "exe",
      "mp4",
      "mp3",
      "webm",
    ];
    // heuristically filter out non-page links first
    // don't verify content-type, too slow
    if (!nonPageExts.includes(fileExt)) {
      results.push(link); // don't normalize here
    }
  }
  return results;
}
