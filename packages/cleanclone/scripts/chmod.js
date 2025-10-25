#!/usr/bin/env node
import fs from "fs";
import path from "path";

function chmod(filePath, mode) {
  try {
    fs.chmodSync(filePath, parseInt(mode, 8));
  } catch (error) {
    console.error(`Error changing permissions: ${error.message}`);
    process.exit(1);
  }
}

const args = process.argv.slice(2);
if (args.length !== 2) {
  console.error("Usage: node chmod.js <file> <mode>");
  process.exit(1);
}
const [file, mode] = args;
chmod(path.resolve(file), mode);
