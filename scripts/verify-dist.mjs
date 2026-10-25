import { readFile, access, readdir } from "node:fs/promises";
import assert from "node:assert/strict";
const manifest = JSON.parse(await readFile("dist/manifest.json", "utf8"));
assert.equal(manifest.manifest_version, 3);
assert(!manifest.permissions.includes("cookies"));
assert(!manifest.host_permissions.includes("<all_urls>"));
for (const file of [
  manifest.background.service_worker,
  manifest.side_panel.default_path,
  manifest.options_page,
  ...manifest.content_scripts.flatMap((s) => s.js),
  "pdf.worker.min.mjs",
  "styles.css",
])
  await access("dist/" + file);
for (const [size, file] of Object.entries(manifest.icons || {})) {
  const png = await readFile("dist/" + file);
  assert.equal(png.subarray(1, 4).toString(), "PNG");
  assert.equal(png.readUInt32BE(16), Number(size));
  assert.equal(png.readUInt32BE(20), Number(size));
  assert.equal(manifest.action.default_icon[size], file);
}
assert(manifest.permissions.includes("scripting"));
assert.deepEqual(manifest.host_permissions, [
  "https://www.zhipin.com/*",
  "https://api.deepseek.com/*",
]);
for (const file of await readdir("dist")) {
  if (file.endsWith(".html")) {
    const html = await readFile("dist/" + file, "utf8");
    assert(!/<script[^>]*src=["']https?:/i.test(html));
    assert(!/<script(?![^>]*src=)[^>]*>\s*\S/i.test(html));
    for (const match of html.matchAll(/(?:src|href)="([^"#]+\.(?:js|css))"/g))
      await access("dist/" + match[1]);
  }
}
assert(
  (await readFile("dist/content.js", "utf8")).includes("TRUSTED_CONTEXTS") ===
    false,
  "内容脚本不应包含密钥存储逻辑",
);
console.log("扩展产物检查通过：MV3、入口、本地 worker、HTML CSP 与权限边界");
