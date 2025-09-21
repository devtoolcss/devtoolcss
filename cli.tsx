#!/usr/bin/env node
import React, { useEffect, useState } from "react";
import { render, Box, Text, useApp } from "ink";
import {
  Crawler,
  CrawlConfig,
  CrawlProgress,
  CrawlSummary,
} from "./crawler.js";

import { argsToConfig } from "./config.js";

interface State {
  progress: CrawlProgress;
  summary?: CrawlSummary;
  startTime: number;
}

const config = argsToConfig();

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
