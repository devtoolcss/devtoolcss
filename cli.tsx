#!/usr/bin/env node
import React, { useEffect, useState } from "react";
import { render, Box, Text, useApp } from "ink";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import {
  Crawler,
  CrawlConfig,
  CrawlProgress,
  CrawlSummary,
} from "./crawler.js";

interface State {
  progress: CrawlProgress;
  summary?: CrawlSummary;
  startTime: number;
}

// --no- is reserved for negation
const argv = yargs(hideBin(process.argv))
  .scriptName("crawler")
  .option("url", {
    type: "string",
    demandOption: true,
    desc: "Root URL to crawl",
  })
  .option("out-dir", {
    type: "string",
    default: "./out",
    desc: "Output directory",
  })
  .option("browser", {
    type: "string",
    default: "../chrome/linux-141.0.7378.3/chrome-linux64/chrome",
    desc: "Chromium/Chrome executable path",
  })
  .option("headless", {
    type: "boolean",
    default: true,
    desc: "Run browser with headful mode",
  })
  .option("breakpoints", {
    type: "string",
    default: "",
    desc: "Comma-separated breakpoint widths",
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
    type: "boolean",
    default: false,
    desc: "Recursively crawl same-site links",
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
  .help()
  .parseSync();

const breakpoints = argv.breakpoints
  ? argv.breakpoints
      .split(",")
      .map((s) => parseInt(s.trim()))
      .filter((n) => !isNaN(n))
  : [];

const config: CrawlConfig = {
  url: argv.url,
  outDir: argv["out-dir"],
  browserPath: argv.browser,
  headless: argv["headless"],
  breakpoints,
  screenHeight: argv["screen-height"],
  deviceScaleFactor: argv["device-scale-factor"],
  recursive: argv["recursive"],
  browserScan: argv["browser-scan"],
  maxPages: argv["max-pages"],
  delayAfterNavigateMs: argv["delay-after-nav"],
};

const Dashboard: React.FC<{ cfg: CrawlConfig }> = ({ cfg }) => {
  const { exit } = useApp();
  const [state, setState] = useState<State>({
    progress: { phase: "init" },
    startTime: Date.now(),
  });

  useEffect(() => {
    const crawler = new Crawler(cfg);
    const onProgress = (p: Partial<CrawlProgress>) => {
      setState((s) => ({ ...s, progress: { ...s.progress, ...p } }));
    };
    crawler.on("progress", onProgress);
    crawler.start().then((summary) => {
      setState((s) => ({ ...s, summary }));
      setTimeout(() => {
        exit();
        process.exit(0);
      }, 200); // allow last frame render
    });
    const handleSig = () => {
      //console.log(isRawModeSupported);
      //if (isRawModeSupported) setRawMode(false);
      //spawnSync("stty", ["-a"], { stdio: "inherit" }); // reset terminal after raw mode
      // the ^[[A on terminal after ctrl-c is caused by node
      // https://github.com/nodejs/node/issues/41143
      crawler.stop();
      //rl.close();
      //exit();
      process.exit(0);
    };
    process.on("SIGINT", handleSig);
    process.on("SIGTERM", handleSig);
    process.on("exit", () => {
      crawler.stop();
    });
    // Extra cleanup on unhandled rejections
    process.on("unhandledRejection", (r) => {
      setState((s) => ({
        ...s,
        progress: { ...s.progress, phase: "error", message: String(r) },
      }));
      crawler.stop();
    });
    return () => {
      crawler.stop();
      crawler.removeListener("progress", onProgress);
      process.off("SIGINT", handleSig);
      process.off("SIGTERM", handleSig);
      process.off("exit", crawler.stop.bind(crawler));
    };
  }, [cfg, exit]);

  const { progress, summary, startTime } = state;
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  return (
    <Box
      flexDirection="column"
      padding={1}
      borderStyle="round"
      borderColor="cyan"
    >
      <Text>
        Crawl <Text color="green">{cfg.url}</Text> {"->"}{" "}
        <Text color="yellow">{cfg.outDir}</Text> elapsed {elapsed}s
      </Text>
      <Box>
        <Box flexDirection="column" width={50} marginRight={2}>
          <Text>
            Breakpoints:{" "}
            {cfg.breakpoints.length ? cfg.breakpoints.join(",") : "none"}
          </Text>
          {progress.currentUrl && <Text>URL: {progress.currentUrl}</Text>}
          {progress.queueSize !== undefined && (
            <Text>Queue: {progress.queueSize}</Text>
          )}
          {progress.visitedCount !== undefined && (
            <Text>Visited: {progress.visitedCount}</Text>
          )}
          <Text>Phase: {progress.phase}</Text>
          {progress.totalElements !== undefined && (
            <Text>
              Elements: {progress.processedElements ?? 0}/
              {progress.totalElements}
            </Text>
          )}
          {progress.resourcesDownloaded !== undefined && (
            <Text>Resources: {progress.resourcesDownloaded}</Text>
          )}
          {progress.fontsExtracted !== undefined && (
            <Text>Fonts: {progress.fontsExtracted}</Text>
          )}
          {progress.message && <Text color="gray">{progress.message}</Text>}
          {summary && (
            <>
              <Text color="green">
                Done. Pages: {summary.visited.length} Fonts:{" "}
                {summary.fontsCssCount}
              </Text>
            </>
          )}
        </Box>
      </Box>
    </Box>
  );
};

render(<Dashboard cfg={config} />);
