import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import path from "path";
import fs from "fs";

import { CrawlConfig } from "./crawler.js";

const defaultBrowserCmds = ["chrome", "chromium", "google-chrome"];

function isExecutable(filePath: string) {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function isInPath(cmd: string): boolean {
  const exts = process.platform === "win32" ? ["", ".exe"] : [""];
  const dirs = process.env.PATH?.split(path.delimiter) ?? [];
  for (const dir of dirs) {
    for (const ext of exts) {
      const fullPath = path.join(dir, cmd + ext);
      if (fs.existsSync(fullPath) && isExecutable(fullPath)) {
        return true;
      }
    }
  }
  return false;
}

function validateWidths(breakpoints: number[], deviceWidths: number[]) {
  if (deviceWidths.length !== breakpoints.length + 1) {
    console.error(
      `Error: device-widths must have exactly one more entry than breakpoint-widths.\n` +
        `Got ${deviceWidths.length} device widths and ${breakpoints.length} breakpoints.`,
    );
    process.exit(1);
  }
  for (let i = 0; i < breakpoints.length; i++) {
    if (
      !(
        deviceWidths[i] < breakpoints[i] && breakpoints[i] < deviceWidths[i + 1]
      )
    ) {
      console.error(
        `Error: deviceWidths and breakpoints must interleave: deviceWidths[${i}] < breakpoints[${i}] < deviceWidths[${i + 1}].\n` +
          `Got deviceWidths[${i}]=${deviceWidths[i]}, breakpoints[${i}]=${breakpoints[i]}, deviceWidths[${i + 1}]=${deviceWidths[i + 1]}.`,
      );
      process.exit(1);
    }
    if (deviceWidths[i] <= 0) {
      console.error(
        `Error: deviceWidths must be positive numbers.\n` +
          `Got deviceWidths[${i}]=${deviceWidths[i]}.`,
      );
      process.exit(1);
    }
  }
}

function toNumList(arg: string): number[] {
  return arg
    ? arg
        .split(",")
        .map((s) => parseInt(s.trim()))
        .filter((n) => !isNaN(n))
    : [];
}

export function argsToConfig(): CrawlConfig {
  // --no- is reserved for negation
  const argv = yargs(hideBin(process.argv))
    .scriptName("crawler")
    .option("url", {
      type: "string",
      demandOption: true,
      desc: "Page URL to crawl",
    })
    .option("out-dir", {
      alias: "o",
      type: "string",
      default: "./out",
      desc: "Output directory",
    })
    .option("browser-path", {
      alias: "b",
      type: "string",
      desc: `Chromium/Chrome executable path, default will try ${defaultBrowserCmds.join(", ")}`,
    })
    .option("disable-headless", {
      type: "boolean",
      desc: "Run browser with headful mode",
    })
    .option("device-widths", {
      type: "string",
      default: "1024",
      desc: "Comma-separated device widths for crawling",
    })
    .option("breakpoint-widths", {
      type: "string",
      default: "",
      desc: "Comma-separated widths for @media condition, must interleave device-widths",
    })
    .option("device-scale-factor", {
      type: "number",
      default: 1,
      desc: "Device scale factor",
    })
    .option("screen-height", {
      type: "number",
      default: 800,
      desc: "Viewport height for screens",
    })
    .option("recursive", {
      alias: "r",
      type: "boolean",
      default: false,
      desc: "Recursively crawl same-site links",
    })
    .option("url-filter", {
      type: "string",
      default: ".*",
      desc: "Regex pattern for filtering URLs when crawling recursively",
    })
    .option("browser-scan", {
      type: "boolean",
      default: false,
      desc: "Use browser for link extraction (slower, handling JS)",
    })
    .option("max-pages", {
      type: "number",
      default: 0,
      desc: "Maximum number of pages to crawl (0 = no limit)",
    })
    .option("delay-after-nav", {
      type: "number",
      default: 1000,
      desc: "Delay ms after navigation before processing",
    })
    .option("browser-flag", {
      type: "string",
      array: true,
      default: [],
      desc:
        "Additional flags to pass to browser. Can be specified multiple times." +
        " e.g. --browser-flag='--window-size=x,y' --browser-flag='--no-sandbox'." +
        " Note that the = is necessary to not misinterpret values as another flag." +
        " CDP doesn't allow --incognito to persist for new tabs opened.",
      // https://issues.chromium.org/issues/41363417
    })
    .option("debug", {
      type: "boolean",
      default: false,
      desc: "Debug log and --overlay --disable-headless, can be override",
    })
    .option("overlay", {
      type: "boolean",
      desc: "Show overlay when cascading elements when disable headless",
    })
    .help()
    .parseSync();

  const breakpoints = toNumList(argv["breakpoint-widths"]);
  const deviceWidths = toNumList(argv["device-widths"]);

  validateWidths(breakpoints, deviceWidths);

  let browserPath: string | undefined = argv["browser-path"];
  if (!browserPath) {
    for (const cmd of defaultBrowserCmds) {
      if (isInPath(cmd)) {
        browserPath = cmd;
        break;
      }
    }
    if (!browserPath) {
      console.error(`Error: Chrome/Chromium executable not found in PATH.
Please specify the path with --browser-path.
Tried: ${defaultBrowserCmds.join(", ")}`);
      process.exit(1);
    }
  }

  return {
    url: argv.url,
    outDir: argv["out-dir"],
    browserPath: browserPath,
    headless:
      argv["disable-headless"] === undefined
        ? !argv["debug"]
        : !argv["disable-headless"],
    screenHeight: argv["screen-height"],
    breakpoints,
    deviceWidths,
    deviceScaleFactor: argv["device-scale-factor"],
    recursive: argv["recursive"],
    urlFilter: new RegExp(argv["url-filter"]),
    browserScan: argv["browser-scan"],
    maxPages: argv["max-pages"],
    delayAfterNavigateMs: argv["delay-after-nav"],
    browserFlags: argv["browser-flag"],
    debug: argv["debug"],
    overlay: argv["overlay"] === undefined ? argv["debug"] : argv["overlay"],
  };
}
