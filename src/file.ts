import fs from "fs";
import https from "https";
import http from "http";
import { URL } from "url";
import path from "path";

export const MIME = [
  "application",
  "audio",
  "example",
  "font",
  "image",
  "model",
  "text",
  "video",
];

// handle wordpress %3F ending of filename
export function getExtension(url) {
  const match = url.match(/\.([a-z0-9]+)(?:\?|%3F|#|$)/i);
  return match ? match[1] : "";
}

// handle wordpress %3F ending of filename
var counter = 0;
export async function getFilename(url: string) {
  const urlObj = new URL(url);
  const lastSegment = urlObj.pathname.substring(
    urlObj.pathname.lastIndexOf("/") + 1,
  );
  if (lastSegment)
    // TODO: handle non-/ endpoint
    return decodeURIComponent(lastSegment.replace(/([#?]|%3F).*$/, ""));
  else {
    // /-ended endpoint
    try {
      const res = await fetch(url, { method: "HEAD" });
      const disposition = res.headers.get("content-disposition");
      if (disposition) {
        const match = disposition.match(
          /filename\*?=(?:UTF-8'')?["']?([^;"']+)/i,
        );
        if (match) {
          return match[1];
        }
      }
      // fallback: use host as filename
      var fileExt = "";
      const contentType = res.headers.get("content-type");
      if (contentType) {
        const parts = contentType.split("/");
        if (parts.length === 2) {
          fileExt = `${parts[1].split(";")[0].trim()}`;
        }
      }
      return `${counter++}${fileExt ? "." + fileExt : ""}`;
    } catch {
      return urlObj.host;
    }
  }
}

function windowsFilename(name) {
  return name.replace(/[<>:"/\\|?*]/g, "_");
}

export function getAvailableFilename(dir, filename) {
  // Replace Windows-invalid filename characters with _
  const sanitized =
    process.platform === "win32" ? windowsFilename(filename) : filename;
  const { name, ext } = path.parse(sanitized);
  let candidate = sanitized;
  let counter = 1;
  while (fs.existsSync(`${dir}/${candidate}`)) {
    candidate = `${name}(${counter})${ext}`;
    counter++;
  }
  return candidate;
}

export async function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const mod = parsedUrl.protocol === "https:" ? https : http;
    const file = fs.createWriteStream(dest);
    mod
      .get(url, (response) => {
        if (response.statusCode !== 200) {
          file.close();
          fs.unlink(dest, () => {});
          return reject(
            new Error(`Failed to get '${url}' (${response.statusCode})`),
          );
        }
        response.pipe(file);
        file.on("finish", () => file.close(resolve));
      })
      .on("error", (err) => {
        file.close();
        fs.unlink(dest, () => {});
        reject(err);
      });
  });
}
