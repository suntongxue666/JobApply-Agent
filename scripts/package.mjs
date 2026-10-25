import { access, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const folder = "release/工作智投-Chrome插件";
const manifest = JSON.parse(await readFile("dist/manifest.json", "utf8"));
const entries = [
  manifest.background.service_worker,
  manifest.side_panel.default_path,
  manifest.options_page,
  ...manifest.content_scripts.flatMap((script) => script.js),
];
for (const file of entries) await access(`dist/${file}`);

await mkdir("release", { recursive: true });
// 仅重新生成此脚本拥有的发布文件夹，清除上次构建的废弃资源。
await rm(folder, { recursive: true, force: true });
await cp("dist", folder, {
  recursive: true,
  filter: (source) => !source.endsWith(".map"),
});
const instructions = `工作智投 Chrome 插件安装说明\n\n1. 打开 Chrome，在地址栏输入 chrome://extensions\n2. 开启右上角“开发者模式”。\n3. 点击“加载已解压的扩展程序”（部分版本显示“加载未打包的扩展程序”）。\n4. 选择本说明旁边的“工作智投-Chrome插件”文件夹。\n   请选文件夹，不选 manifest.json，也不选 ZIP。\n\n完整文件夹路径：\n${resolve(folder)}\n\n加载后，在工具栏打开“工作智投”，设置简历和 AI 服务。\n已打开的 BOSS 页面需要刷新；请先停用其他会操作 BOSS 的自动化扩展。\n当前为 v0.3.10：新任务默认最多处理100个岗位，支持滚动加载和同一搜索条件下的下一页，直到末页或任务上限。每个岗位仅保留一份状态标识。更新后请刷新BOSS页面；点击继续会读取已保存的岗位上限，默认100。旧任务已处理记录保留，其他设置仍沿用原任务配置。点击卡片读取右侧详情；必要时回退本岗独立详情页。按筛选条件生成招呼语后，打开本岗独立详情，点击立即沟通；支持详情内首次沟通弹窗、该 Tab 内跳转聊天或新开子 Tab，核验发送后关闭本次页面并回到列表。AI 分数不决定是否投递。投递间隔默认开启，默认 15-30 秒，可在侧栏选择四档时间范围；发送成功后等待再处理下一岗，暂停/停止可中断等待。请在开始前确认本次外发范围；页面验证、身份不一致或结果不确定时会暂停。当前通用聊天适配已通过合成页面测试，真实 BOSS 聊天仍需在用户正常页面联调。\n\n更新时重新运行 npm run package，然后在 Chrome 扩展管理页点击本插件的“重新加载”。\n安装后请保留该文件夹，不要移动或删除。\n`;
await writeFile("release/安装说明.txt", instructions);
console.log(`已生成可直接加载的扩展文件夹：${resolve(folder)}`);
console.log("在 Chrome 中选择整个文件夹，无需解压或选择任何文件。");
