#!/usr/bin/env node
import React, { useEffect, useMemo, useRef, useState } from "react";
import { render, Box, Text, useApp } from "ink";
import chalk from "chalk";
import {
  Crawler,
  CrawlConfig,
  CrawlProgress,
  ScanProgress,
  CrawlSummary,
  CrawlStages,
  Progress,
} from "./crawler.js";

import { argsToConfig } from "./config.js";

const config = argsToConfig();

const Dashboard: React.FC<{ cfg: CrawlConfig }> = ({ cfg }) => {
  const { exit } = useApp();
  const [phase, setPhase] = useState<"scanning" | "crawling" | "error">(
    "scanning",
  );
  const [scanProgress, setScanProgress] = useState<Partial<ScanProgress>>({
    queued: 0,
    finished: 0,
    url: "",
  });
  const [crawlProgress, setCrawlProgress] = useState<CrawlProgress>({
    totalPages: 0,
    finishedPages: 0,
    url: "",
    deviceIndex: 0,
    stageIndex: CrawlStages.Load,
  });
  const [summary, setSummary] = useState<CrawlSummary | null>(null);
  const startTimeRef = useRef<number>(Date.now());

  useEffect(() => {
    const crawler = new Crawler(cfg);
    const onProgress = (p: Progress) => {
      if (p.phase) setPhase(p.phase);
      if (p.message) {
        switch (p.message.level) {
          case "debug":
            if (cfg.debug) console.debug(p.message.text);
            break;
          case "warning":
            console.log(chalk.yellow(p.message.text));
            break;
          case "error":
            console.log(chalk.red(p.message.text));
            break;
          default: // info
            console.log(p.message.text);
            break;
        }
      }
      if (p.scanProgress) {
        setScanProgress((s) => ({ ...s, ...p.scanProgress }));
      }
      if (p.crawlProgress) {
        setCrawlProgress((s) => ({ ...s, ...p.crawlProgress }));
      }
    };
    crawler.on("progress", onProgress);
    const handleSig = () => {
      crawler.stop();
      process.exit(1);
    };
    process.on("SIGINT", handleSig);
    process.on("SIGTERM", handleSig);
    process.on("exit", () => {
      crawler.stop();
    });
    // Extra cleanup on unhandled rejections
    process.on("unhandledRejection", (r) => {
      setPhase("error");
      handleSig();
    });
    crawler
      .start()
      .then((s: CrawlSummary) => {
        setSummary(s);
        setTimeout(() => {
          exit();
          process.exit(0);
        }, 200); // allow last frame render
      })
      .catch((e: any) => {
        setPhase("error"); // TODO handle error phase
        console.error(chalk.red("Crawl failed: " + e.message + "\n" + e.stack));
        process.exit(1);
      });
    return () => {
      crawler.stop();
      crawler.removeListener("progress", onProgress);
      process.off("SIGINT", handleSig);
      process.off("SIGTERM", handleSig);
      process.off("exit", crawler.stop.bind(crawler));
    };
  }, [cfg, exit]);

  // UI helpers
  const stageTexts: Array<NonNullable<string>> = ["Load", "Cascade"];

  const devices = useMemo(
    () => cfg.deviceWidths.map((w, i) => ({ index: i, width: w })),
    [cfg.deviceWidths],
  );
  const activeDeviceIndex = crawlProgress.deviceIndex;
  const pagesTotal = crawlProgress.totalPages;
  const finishedPages = crawlProgress.finishedPages;
  const currentStageIndex = crawlProgress.stageIndex;
  const elementsProgressPercent =
    (crawlProgress.totalElements || 0) > 0
      ? Math.min(
          100,
          Math.round(
            ((crawlProgress.processedElements ?? 0) /
              (crawlProgress.totalElements || 1)) *
              100,
          ),
        )
      : undefined;

  const ConfigEntry = ({
    name,
    value,
    valueColor,
  }: {
    name: string;
    value: string;
    valueColor?: string;
  }) => (
    <Text>
      {(name + ":").padEnd(16)} <Text color={valueColor}>{value}</Text>
    </Text>
  );

  return (
    <>
      {/* Configs Header */}
      <Box
        flexDirection="column"
        marginBottom={1}
        padding={1}
        paddingTop={0}
        borderStyle="round"
        borderColor="cyan"
      >
        <Text color={"cyan"} bold>
          Configs:
        </Text>

        <ConfigEntry name="Site URL" value={cfg.url} valueColor="green" />
        <ConfigEntry name="Output Dir" value={cfg.outDir} valueColor="yellow" />
        <ConfigEntry name="Browser" value={cfg.browserPath} />
        <ConfigEntry
          name="Breakpoints"
          value={cfg.breakpoints.length ? cfg.breakpoints.join(", ") : "none"}
          valueColor="red"
        />
        <ConfigEntry name="Device widths" value={cfg.deviceWidths.join(", ")} />
        <ConfigEntry name="Device Height" value={String(cfg.screenHeight)} />
        <ConfigEntry name="Scale" value={String(cfg.deviceScaleFactor)} />
        <ConfigEntry
          name="Delay after nav"
          value={String(cfg.delayAfterNavigateMs) + "ms"}
        />
        <Text>
          Other Settings:{" "}
          <Text color={cfg.recursive ? "" : "gray"}>Recursive</Text>{" "}
          <Text color={cfg.browserScan ? "" : "gray"}>BrowserScan</Text>{" "}
          <Text color={cfg.headless ? "" : "gray"}>Headless</Text>{" "}
          <Text color={cfg.overlay ? "" : "gray"}>Overlay</Text>{" "}
          <Text color={cfg.debug ? "" : "gray"}>Debug</Text>
        </Text>
      </Box>

      {/* Progress */}
      {phase === "scanning" && (
        <Box flexDirection="column" marginBottom={1}>
          {scanProgress.url && (
            <Text>
              Scanning: <Text color="magenta">{scanProgress.url}</Text>
            </Text>
          )}
          <Text>
            Queue: {scanProgress.queued ?? 0} | Visited:{" "}
            {scanProgress.finished ?? 0}
          </Text>
        </Box>
      )}

      {phase === "crawling" && (
        <>
          <Box flexDirection="column" marginBottom={1}>
            <Text>
              Page ({finishedPages + 1}/{pagesTotal}):{" "}
              <Text color="magenta">{crawlProgress.url}</Text>
            </Text>
          </Box>
          <Box flexDirection="column" marginBottom={1}>
            <Box rowGap={1}>
              {devices.map((d) => (
                <Text
                  key={d.index}
                  backgroundColor={d.index === activeDeviceIndex ? "cyan" : ""}
                  color={
                    d.index < activeDeviceIndex
                      ? "green"
                      : d.index === activeDeviceIndex
                      ? "black"
                      : "gray"
                  }
                >
                  {` ${d.width}px `}
                </Text>
              ))}
            </Box>
            <Box marginBottom={1}>
              {stageTexts.map((stgText, i) => {
                const isActive = currentStageIndex === i;
                const color = isActive
                  ? ""
                  : (currentStageIndex ?? -1) > i
                  ? "green"
                  : "gray";
                const decoL = isActive ? "▶" : "";
                return (
                  <Box key={stgText} marginRight={2}>
                    <Text>{decoL}</Text>
                    <Text> </Text>
                    <Text color={color}>{stgText}</Text>
                  </Box>
                );
              })}
            </Box>
            {elementsProgressPercent !== undefined &&
              currentStageIndex === CrawlStages.Cascade && (
                <Box paddingLeft={2}>
                  <Text>
                    {stageTexts[currentStageIndex]} |{" "}
                    <Text color="yellow">
                      {elementsProgressPercent}% (
                      {crawlProgress.processedElements}/
                      {crawlProgress.totalElements})
                    </Text>
                  </Text>
                  {/*
                <ProgressBar value={elementsProgress} />
                */}
                </Box>
              )}
          </Box>
        </>
      )}

      {/* Footer / messages */}
      {summary && (
        <Text color="green">
          Crawl completed in{" "}
          <Text color="yellow" bold>
            {Math.round((Date.now() - startTimeRef.current) / 1000)}s
          </Text>
          .{" "}
          <Text color="yellow" bold>
            {summary.succeeded}
          </Text>{" "}
          pages succeeded,{" "}
          <Text color="yellow" bold>
            {summary.failed}
          </Text>{" "}
          pages failed,{" "}
          <Text color="yellow" bold>
            {summary.downloadCount}
          </Text>{" "}
          resources downloaded.{" "}
          <Text color="yellow" bold>
            {summary.fontsCssCount}
          </Text>{" "}
          CSS @font-face rules found.
        </Text>
      )}
    </>
  );
};

render(<Dashboard cfg={config} />);
