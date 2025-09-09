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

export function getFonts(fontFiles) {
  let fontCSS = "";

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
            fontCSS += cssText + "\n";
          } else {
            for (const fontFile of fontFiles) {
              if (
                url.includes(fontFile) ||
                url.includes(encodeURIComponent(fontFile))
              ) {
                cssText = cssText.replace(
                  /url\(([^)]*?)\)/g,
                  `url('./assets/font/${fontFile}')`
                );
                fontCSS += cssText + "\n";
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
  return fontCSS;
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

export async function downloadFonts(fontCSS, fontFiles) {
  fs.mkdirSync("./out/fonts", { recursive: true });
  fs.writeFileSync("./out/fonts.css", fontCSS, "utf-8");

  for (const { url, filename } of fontFiles) {
    try {
      await downloadFile(url, `./out/fonts/${filename}`);
      console.log(`Downloaded font: ${filename}`);
    } catch (e) {
      console.warn(`Failed to download font ${url}: ${e.message}`);
    }
  }
}
