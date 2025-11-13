import chokidar from "chokidar";
import { exec } from "child_process";

const ignored = [
  "package.json",
  "package-lock.json",
  "README.md",
  "tsconfig.json",
  "ws-server.js",
];

const copyIgnoreMatcher = (path) => {
  if (
    ignored.includes(path) ||
    path.startsWith("node_modules/") ||
    path.startsWith("dist/") ||
    path.startsWith("scripts/") ||
    path.startsWith(".")
  )
    return true;

  return false;
};

chokidar.watch(".").on("change", (path) => {
  if (copyIgnoreMatcher(path)) {
    return;
  }

  if (path.endsWith(".js")) {
    // any js change could affect the bundle
    console.log(`Rebuilding due to change in ${path}`);
    exec(
      "NODE_ENV=development node scripts/esbuild.config.js",
      (error, stdout, stderr) => {
        if (error) {
          console.error(`Error during build: ${stderr}`);
        }
      },
    );
  } else {
    console.log(`Copying due to change in ${path}`);
    exec(`cp ${path} dist/`, (error, stdout, stderr) => {
      if (error) {
        console.error(`Error during copy: ${stderr}`);
      }
    });
  }
});

console.log("Watching for changes...");
