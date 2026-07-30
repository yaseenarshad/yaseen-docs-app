/* eslint-disable no-console */

import { createHash } from "node:crypto";
import {
  createReadStream,
  createWriteStream,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(
  readFileSync(join(repositoryRoot, "background-removal-assets.json"), "utf8"),
);
const shouldUpload = process.argv.includes("--upload");
const temporaryDirectory = mkdtempSync(
  join(tmpdir(), "background-removal-assets-"),
);

const hashFile = async (path) => {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
};

const run = (command, args) =>
  new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: repositoryRoot,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolvePromise();
      } else {
        reject(new Error(`${command} exited with code ${code}`));
      }
    });
  });

const runWithRetries = async (command, args, attempts = 3) => {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await run(command, args);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        console.warn(`upload attempt ${attempt} failed; retrying…`);
        await new Promise((resolvePromise) =>
          setTimeout(resolvePromise, attempt * 2_000),
        );
      }
    }
  }
  throw lastError;
};

try {
  const packageJson = JSON.parse(
    readFileSync(
      join(
        repositoryRoot,
        "node_modules/@huggingface/transformers/package.json",
      ),
      "utf8",
    ),
  );
  if (packageJson.version !== manifest.transformersVersion) {
    throw new Error(
      `Expected @huggingface/transformers ${manifest.transformersVersion}, found ${packageJson.version}`,
    );
  }

  for (const [index, asset] of manifest.assets.entries()) {
    let filePath;
    if ("localPath" in asset) {
      filePath = join(repositoryRoot, asset.localPath);
    } else {
      filePath = join(
        temporaryDirectory,
        `${index}-${asset.sourcePath.replaceAll("/", "-")}`,
      );
      const response = await fetch(
        `https://huggingface.co/${manifest.sourceRepository}/resolve/${manifest.sourceRevision}/${asset.sourcePath}`,
        { redirect: "follow" },
      );
      if (!response.ok || !response.body) {
        throw new Error(
          `Could not download ${asset.sourcePath}: HTTP ${response.status}`,
        );
      }
      await pipeline(
        Readable.fromWeb(response.body),
        createWriteStream(filePath),
      );
    }

    const size = statSync(filePath).size;
    const sha256 = await hashFile(filePath);
    if (size !== asset.size || sha256 !== asset.sha256) {
      throw new Error(
        `${asset.path} failed verification (size ${size}, sha256 ${sha256})`,
      );
    }
    console.log(`verified ${asset.path} (${asset.size} bytes)`);

    if (shouldUpload) {
      await runWithRetries("npx", [
        "wrangler",
        "r2",
        "object",
        "put",
        `yaseen-excalidraw-assets/${manifest.r2Prefix}${asset.path}`,
        "--remote",
        "--file",
        filePath,
        "--content-type",
        asset.contentType,
        "--cache-control",
        "public, max-age=31536000, immutable",
      ]);
    }
  }

  console.log(
    shouldUpload
      ? "Verified and uploaded every pinned background-removal asset."
      : "Verified every pinned background-removal asset. Re-run with --upload to provision R2.",
  );
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
