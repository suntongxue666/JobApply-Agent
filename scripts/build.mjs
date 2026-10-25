import { build, context } from "esbuild";
import { cp, mkdir, writeFile, rm, readFile, readdir } from "node:fs/promises";
await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
await cp("manifest.json", "dist/manifest.json");
await cp("public/icons", "dist/icons", { recursive: true });
await cp(
  "node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs",
  "dist/pdf.worker.min.mjs",
);
await cp("node_modules/pdfjs-dist/cmaps", "dist/cmaps", { recursive: true });
await cp("node_modules/pdfjs-dist/standard_fonts", "dist/standard_fonts", {
  recursive: true,
});
await cp("src/ui/styles.css", "dist/styles.css");
for (const [page, title] of [
  ["panel", "工作智投"],
  ["options", "工作智投 · 设置"],
]) {
  await writeFile(
    `dist/${page}.html`,
    `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><link rel="stylesheet" href="styles.css"></head><body><div id="root"></div><script type="module" src="${page}.js"></script></body></html>`,
  );
}
const configs = [
  {
    entryPoints: {
      background: "src/background/index.ts",
      panel: "src/ui/panel.tsx",
      options: "src/ui/options.tsx",
    },
    format: "esm",
    splitting: true,
  },
  { entryPoints: { content: "src/content/index.ts" }, format: "iife" },
].map((c) => ({
  ...c,
  bundle: true,
  outdir: "dist",
  target: "chrome116",
  sourcemap: true,
  minify: !process.argv.includes("--watch"),
  logLevel: "info",
  metafile: true,
}));
if (process.argv.includes("--watch")) {
  for (const config of configs) await (await context(config)).watch();
  console.log(
    "监听源码中。更新后在 chrome://extensions 重新加载扩展；CSS/manifest 修改需重新启动 dev。",
  );
} else {
  const packages = new Set(["pdfjs-dist"]);
  for (const config of configs) {
    const result = await build(config);
    for (const input of Object.keys(result.metafile.inputs)) {
      if (!input.includes("node_modules/")) continue;
      const path = input.split("node_modules/").at(-1);
      const parts = path.split("/");
      packages.add(
        parts[0].startsWith("@") ? parts.slice(0, 2).join("/") : parts[0],
      );
    }
  }
  let notices = "Bundled third-party software notices\n\n";
  for (const name of [...packages].sort()) {
    const root = "node_modules/" + name;
    const pkg = JSON.parse(await readFile(root + "/package.json", "utf8"));
    notices += `\n===== ${name} ${pkg.version} (${pkg.license || "see source"}) =====\n`;
    for (const file of await readdir(root))
      if (/^(licen[cs]e|notice|copying)(\.|$)/i.test(file))
        notices += (await readFile(root + "/" + file, "utf8")) + "\n";
  }
  await writeFile("dist/THIRD_PARTY_NOTICES.txt", notices);
}
