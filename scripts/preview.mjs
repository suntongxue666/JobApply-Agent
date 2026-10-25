import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { build } from "esbuild";
await build({
  entryPoints: ["tests/browser/bootstrap.ts"],
  outfile: ".preview/bootstrap.js",
  bundle: true,
  format: "esm",
  target: "chrome116",
});
await build({
  entryPoints: ["tests/browser/parser-qa.ts"],
  outfile: ".preview/parser.js",
  bundle: true,
  format: "esm",
  target: "chrome116",
  loader: { ".pdf": "binary", ".docx": "binary", ".txt": "text" },
});
await build({
  entryPoints: ["tests/browser/marker-qa.ts"],
  outfile: ".preview/markers.js",
  bundle: true,
  format: "esm",
  target: "chrome116",
});
const root = resolve("dist");
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".css": "text/css; charset=utf-8",
};
createServer(async (req, res) => {
  try {
    const path = new URL(req.url, "http://localhost").pathname;
    if (path === "/boss-fixture.html") {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      const fixture = await readFile("tests/fixtures/boss-list.html", "utf8");
      res.end(
        `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>职位浮层演示</title><style>body{font:14px sans-serif;background:#f5f7f4;color:#284637;margin:0;padding:25px}.demo{background:#fff0cc;padding:12px;border-radius:8px}.job-card-box{list-style:none;padding:18px;margin:16px 0;background:white;border:1px solid #d5dfcf;border-radius:12px;max-width:500px}.job-title{display:flex;justify-content:space-between}a{color:#2d6045;text-decoration:none}.tag-list{display:flex;gap:25px;color:#819178;font-size:12px}.job-detail-container{display:none}</style><p class="demo">浮层演示 · 合成职位，不连接 BOSS、不发送消息</p>${fixture}<script type="module" src="/markers.js"></script></html>`,
      );
      return;
    }
    if (path === "/markers.js") {
      res.setHeader("Content-Type", "application/javascript");
      res.end(await readFile(".preview/markers.js"));
      return;
    }
    if (path === "/parser-qa.html") {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(
        '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>合成简历解析测试</title><h1>合成文件解析测试 · 无用户数据</h1><main></main><script type="module" src="/parser.js"></script></html>',
      );
      return;
    }
    if (path === "/parser.js") {
      res.setHeader("Content-Type", "application/javascript");
      res.end(await readFile(".preview/parser.js"));
      return;
    }
    if (path === "/bootstrap.js") {
      res.setHeader("Content-Type", types[".js"]);
      res.end(await readFile(".preview/bootstrap.js"));
      return;
    }
    const file = resolve(root, "." + (path === "/" ? "/panel.html" : path));
    if (!file.startsWith(root + sep)) {
      res.writeHead(403);
      res.end();
      return;
    }
    const ext = file.slice(file.lastIndexOf("."));
    let content = await readFile(file);
    if (ext === ".html")
      content = Buffer.from(
        content
          .toString()
          .replace(/src="(?:panel|options)\.js"/, 'src="bootstrap.js"'),
      );
    res.setHeader("Content-Type", types[ext] || "application/octet-stream");
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}).listen(4177, "127.0.0.1", () =>
  console.log(
    "界面 QA（演示数据）：http://127.0.0.1:4177/panel.html 或 /options.html",
  ),
);
