import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

import {
  checkDocumentation,
  convexHost,
  writeHost,
} from "./check-documentation.mjs";

/**
 * Packs the package in dry-run mode and checks what would ship: every required
 * file is present, no Markdown outside the shipped docs set is packed (so no
 * contributor or internal doc), and every `llms.txt` link to a shipped file is
 * relative and resolves inside the tarball. Then installs the real tarball in a
 * temporary consumer, runs the docs contract on it, type-checks the README
 * examples and a consumer of every `exports` entry point against the built
 * package, runs the README test example and imports the runtime entries. Run
 * after `pnpm build` so `dist` exists. The rules for test, spec and `.env`
 * files live in `check-package-contents.sh`.
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
  process.exit(1);
}
console.log(
  `OK    package tarball: ${packed.size} files, ${required.length} required present, ${links.length} llms.txt links checked`,
);

/** @type {{ name: string, version: string, exports: Record<string, unknown> }} */
const metadata = JSON.parse(readFileSync("package.json", "utf8"));

// A strict consumer of every code entry point; `./package.json` is checked at runtime below.
const entryPoints = `import { Consent } from "${metadata.name}";
import config from "${metadata.name}/convex.config";
import configJs from "${metadata.name}/convex.config.js";
import type { ComponentApi } from "${metadata.name}/_generated/component";
import type { ComponentApi as ComponentApiJs } from "${metadata.name}/_generated/component.js";
import { register } from "${metadata.name}/test";
declare const component: ComponentApi;
const componentJs: ComponentApiJs = component;
export const used = [new Consent(componentJs), config, configJs, register] as const;
`;
const uncovered = Object.keys(metadata.exports).filter(
  (key) =>
    key !== "./package.json" &&
    !entryPoints.includes(`"${metadata.name}${key.slice(1)}"`),
);
if (uncovered.length > 0) {
  console.error(
    `FAIL  exports not imported by the entry-point consumer: ${uncovered.join(", ")}`,
  );
  process.exit(1);
}
const root = process.cwd();
const tarball = `${metadata.name.replace("@", "").replace("/", "-")}-${metadata.version}.tgz`;
const temporary = mkdtempSync(join(tmpdir(), "consent-consumer-"));
/** @param {string} command @param {string[]} arguments_ @param {string} [cwd] */
const run = (command, arguments_, cwd = temporary) =>
  execFileSync(command, arguments_, { cwd, stdio: "inherit" });
/** @param {string} module @param {string[]} files */
const typecheck = (module, files) =>
  run("pnpm", [
    "exec",
    "tsc",
    "--noEmit",
    "--strict",
    "--skipLibCheck",
    "--module",
    module,
    "--moduleResolution",
    module === "NodeNext" ? "NodeNext" : "Bundler",
    "--target",
    "ES2022",
    "--types",
    "vite/client,node",
    ...files,
  ]);
try {
  run("pnpm", ["pack", "--pack-destination", temporary], root);
  writeFileSync(
    join(temporary, "package.json"),
    JSON.stringify({
      pnpm: { ignoredBuiltDependencies: ["esbuild"] },
      private: true,
      type: "module",
    }),
  );
  // pnpm 11 reads the build-script policy from the workspace file, pnpm 10 from package.json.
  // No lockfile here: the repo's own release-age gate (minimumReleaseAge and its exclusions),
  // copied from its pnpm-workspace.yaml so the two never drift, keeps floating transitive deps
  // off fresh releases. pnpm 10 and 11 read it from the workspace file, not from package.json.
  writeFileSync(
    join(temporary, "pnpm-workspace.yaml"),
    `${readFileSync(join(root, "pnpm-workspace.yaml"), "utf8")}allowBuilds:\n  esbuild: false\n`,
  );
  // The lowest supported convex, so the docs hold for the whole peer range.
  run("pnpm", [
    "add",
    join(temporary, tarball),
    "convex@1.45.0",
    "typescript@5.9.3",
    "convex-test@0.0.56",
    "vite@8.2.2",
    "@types/node@22.20.2",
    "vitest@5.1.1",
    "@edge-runtime/vm@5.0.0",
  ]);
  // Docs contract on what consumers receive, then the README examples in a stub host.
  const installed = join(temporary, "node_modules", metadata.name);
  const examples = checkDocumentation(installed);
  const hostFiles = writeHost(
    temporary,
    convexHost(installed, examples),
    examples,
  );
  writeFileSync(join(temporary, "entry-points.ts"), entryPoints);
  typecheck("ESNext", [...hostFiles, "entry-points.ts"]);
  typecheck("NodeNext", [...hostFiles, "entry-points.ts"]);
  // The README's own vitest.config.mts runs its test example.
  run("pnpm", ["exec", "vitest", "run"]);
  run("node", [
    "--input-type=module",
    "-e",
    [
      `import { Consent } from "${metadata.name}";`,
      `import config from "${metadata.name}/convex.config";`,
      `import configJs from "${metadata.name}/convex.config.js";`,
      `import manifest from "${metadata.name}/package.json" with { type: "json" };`,
      `if (!Consent || !config) throw Error("missing export");`,
      `if (config !== configJs) throw Error("convex.config and convex.config.js differ");`,
      `if (manifest.name !== "${metadata.name}") throw Error("wrong package.json");`,
    ].join(" "),
  ]);
  console.log(
    `OK    docs contract on the installed tarball: ${examples.length} examples type-checked (Bundler, NodeNext) and run`,
  );
  console.log(
    `OK    entry points: ${Object.keys(metadata.exports).length} exports, code entries type-checked (Bundler, NodeNext), runtime entries and package.json imported`,
  );
} finally {
  rmSync(temporary, { force: true, recursive: true });
}
