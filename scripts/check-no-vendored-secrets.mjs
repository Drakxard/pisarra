import { execFileSync } from "node:child_process";

const forbiddenPatterns = [
  { label: "Google API key", pattern: "AIza[0-9A-Za-z_-]{20,}" },
  { label: "Excalidraw Firebase config", pattern: "VITE_APP_FIREBASE_CONFIG" },
  { label: "Generic apiKey literal", pattern: '"apiKey"\\s*:' },
];

const searchGlobs = [
  "vendor-excalidraw/**",
  "public/excalidraw/**/*.js",
  "public/excalidraw/**/*.json",
  "public/excalidraw/**/*.css",
];

const runRipgrep = (pattern, glob) => {
  try {
    return execFileSync(
      "rg",
      ["-n", "--pcre2", "--glob", glob, pattern, "."],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch (error) {
    if (typeof error.status === "number" && error.status === 1) {
      return "";
    }

    const stderr = typeof error.stderr === "string" ? error.stderr.trim() : "";
    throw new Error(stderr || `rg failed while scanning ${glob}`);
  }
};

const findings = [];

for (const { label, pattern } of forbiddenPatterns) {
  for (const glob of searchGlobs) {
    const output = runRipgrep(pattern, glob).trim();
    if (!output) {
      continue;
    }

    for (const line of output.split("\n")) {
      findings.push(`${label}: ${line}`);
    }
  }
}

if (findings.length > 0) {
  console.error("Forbidden vendored Excalidraw or secret-like content detected:");
  for (const finding of findings) {
    console.error(`- ${finding}`);
  }
  process.exit(1);
}

console.log("No forbidden vendored Excalidraw or secret-like content detected.");
