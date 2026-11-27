import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import process from "node:process";

/**
 * Packs the package in dry-run mode and checks what would ship: every required
 * file is present, no Markdown outside the shipped docs set is packed (so no
 * contributor or internal doc), and every `llms.txt` link to a shipped file is
 * relative and resolves inside the tarball. Run after `pnpm build` so `dist`
 * exists. The rules for test, spec and `.env` files live in
 * `check-package-contents.sh`.
 */

const required = [
  "package.json",
  "README.md",
  "LICENSE",
  "CHANGELOG.md",
  "llms.txt",
  "docs/API.md",
  "dist/client/index.js",
  "dist/client/index.d.ts",
  "dist/component/convex.config.js",
  "src/test.ts",
];

const shippedMarkdown = new Set(required.filter((path) => path.endsWith(".md")));

const githubMain =
  /^https:\/\/github\.com\/vllnt\/convex-consent\/(?:blob|raw|tree)\/main\/(.+)$/;

/** @type {unknown} */
const packOutput = JSON.parse(
  execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
    encoding: "utf8",
  }),
);
if (
  !Array.isArray(packOutput) ||
  typeof packOutput[0] !== "object" ||
  packOutput[0] === null ||
  !("files" in packOutput[0]) ||
  !Array.isArray(packOutput[0].files)
) {
  throw new TypeError("unexpected `npm pack --json` output");
}
const packed = new Set(
  packOutput[0].files.map((/** @type {{ path: string }} */ file) => file.path),
);

/** @type {string[]} */
const failures = [];

for (const path of required) {
  if (!packed.has(path)) failures.push(`missing from tarball: ${path}`);
}

for (const path of packed) {
  if (/\.mdx?$/.test(path) && !shippedMarkdown.has(path)) {
    failures.push(`markdown outside the shipped docs set: ${path}`);
  }
}

const links = [
  ...readFileSync("llms.txt", "utf8").matchAll(/\]\(([^)\s]+)\)/g),
].map((match) => match[1]);
for (const link of links) {
  const target = link.split("#")[0];
  const onGithub = githubMain.exec(target);
  if (onGithub) {
    if (packed.has(onGithub[1])) {
      failures.push(
        `llms.txt links shipped file by GitHub URL, use ./${onGithub[1]}: ${link}`,
      );
    }
  } else if (target !== "" && !/^[a-z][a-z\d+.-]*:/i.test(target)) {
    if (!packed.has(target.replace(/^\.\//, ""))) {
      failures.push(`llms.txt link does not resolve inside the tarball: ${link}`);
    }
  }
}

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL  ${failure}`);
  console.error(`FAILED ${failures.length} package content check(s)`);
  process.exitCode = 1;
} else {
  console.log(
    `OK    package tarball: ${packed.size} files, ${required.length} required present, ${links.length} llms.txt links checked`,
  );
}
