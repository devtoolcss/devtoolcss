import fs from "fs";
import https from "https";
import http from "http";
import { URL } from "url";

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

export function getExtension(url) {
  const match = url.match(/\.([a-z0-9]+)(?:\?|%3F|#|$)/i);
  return match ? "." + match[1].toLowerCase() : ".bin";
}

export function getFilename(url) {
  const lastSegment = url.substring(url.lastIndexOf("/") + 1);
  return decodeURIComponent(lastSegment.replace(/([#?]|%3F).*$/, ""));
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
            new Error(`Failed to get '${url}' (${response.statusCode})`)
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
