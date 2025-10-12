import fs from "fs";
import path from "path";

const cwd = process.cwd();
const packageJsonPath = path.join(cwd, "package.json");
const manifestJsonPath = path.join(cwd, "manifest.json");

function syncManifestVersion() {
  if (!fs.existsSync(packageJsonPath) || !fs.existsSync(manifestJsonPath)) {
    console.error(
      "package.json or manifest.json not found in current directory.",
    );
    process.exit(1);
  }

  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  if (!packageJson.version) {
    console.error("No version field found in package.json.");
    process.exit(1);
  }

  const manifestText = fs.readFileSync(manifestJsonPath, "utf8");
  // use regex to not disturb formatting
  const updatedManifestText = manifestText.replace(
    /("version"\s*:\s*)"(.*?)"/,
    `$1"${packageJson.version}"`,
  );

  fs.writeFileSync(manifestJsonPath, updatedManifestText, "utf8");
  console.log(`manifest.json version synced to ${packageJson.version}`);
}

syncManifestVersion();
