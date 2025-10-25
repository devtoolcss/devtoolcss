import fs from "fs";
import path from "path";

// Ensure dist/ directory exists
if (!fs.existsSync("dist")) {
  fs.mkdirSync("dist");
}

// Recursive directory copy function
function copyDir(srcDir, destDir) {
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir);
  fs.readdirSync(srcDir).forEach((item) => {
    const srcPath = path.join(srcDir, item);
    const destPath = path.join(destDir, item);
    if (fs.lstatSync(srcPath).isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  });
}

// Copy all .css and .html files, and manifest.json
fs.readdirSync(".")
  .filter(
    (f) => f.endsWith(".css") || f.endsWith(".html") || f === "manifest.json",
  )
  .forEach((f) => fs.copyFileSync(f, path.join("dist", f)));

copyDir("icons", path.join("dist", "icons"));
