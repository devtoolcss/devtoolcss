import { build } from "esbuild";

const isProd = process.env.NODE_ENV === "production";

const commonOptions = {
  entryPoints: ["sidebar.js", "iframeCtrl.js"],
  bundle: true,
  outdir: "dist",
  format: "esm",
  external: ["chrome"],
};

build({
  ...commonOptions,
  sourcemap: isProd,
  minify: isProd,
}).catch(() => process.exit(1));
