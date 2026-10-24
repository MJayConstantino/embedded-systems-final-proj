import { readFile, writeFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
const root = new URL("../", import.meta.url);
const assets = (await readdir(new URL("dist/assets/", root)))
  .filter((f) => /\.(js|css|woff2)$/.test(f))
  .map((f) => `/assets/${f}`);
const html = await readFile(new URL("dist/index.html", root), "utf8");
const revision = createHash("sha256").update(html).digest("hex").slice(0, 12);
let sw = await readFile(new URL("public/sw.js", root), "utf8");
sw = sw
  .replace(
    "const CACHE='verdant-shell-v1';",
    `const CACHE='verdant-shell-${revision}';`,
  )
  .replace(
    /const SHELL=\[.*?\];/,
    `const SHELL=${JSON.stringify(["/", "/icon.svg", "/icon-192.png", "/icon-512.png", "/manifest.webmanifest", ...assets])};`,
  );
await writeFile(new URL("dist/sw.js", root), sw);
console.log(
  `PWA shell ${revision}: ${assets.length} compiled assets precached.`,
);
