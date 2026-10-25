import { readFileSync } from "node:fs";
import { beforeEach, it, expect } from "vitest";
import {
  context,
  inferType,
  jobId,
  readDetail,
  readJobs,
} from "../src/adapters/boss";
const fixture = readFileSync("tests/fixtures/boss-list.html", "utf8");
beforeEach(() => {
  document.body.innerHTML = fixture;
  history.replaceState(null, "", "/web/geek/jobs");
});
it("真实观察结构的脱敏 fixture 可以读取，重复 ID 只保留一次", () => {
  const clone = document.querySelector(".job-card-box")!.cloneNode(true);
  document.querySelector(".rec-job-list")!.append(clone);
  const jobs = readJobs();
  expect(jobs).toHaveLength(2);
  expect(jobs[0].company).toBe("示例科技");
  expect(jobs[1].type).toBe("intern");
});
it("从稳定 href 提取 ID，而非列表序号", () =>
  expect(jobId("/job_detail/abc_123.html?securityId=unrecorded")).toBe(
    "abc_123",
  ));
it("未知性质不推断全职", () =>
  expect(inferType("产品经理", "本科")).toBe("unknown"));
it("详情必须对应相同岗位 ID 与标题", async () => {
  const [job] = readJobs();
  const result = await readDetail(
    job,
    location.href,
    new AbortController().signal,
  );
  expect(result.jd).toContain("需求分析");
});
it("取消立即中止等待读取，不把旧详情当新岗位", async () => {
  const job = readJobs()[1],
    controller = new AbortController();
  const pending = readDetail(job, location.href, controller.signal);
  controller.abort();
  await expect(pending).rejects.toThrow("取消");
});
it("页面发生导航时不继续读取", async () => {
  await expect(
    readDetail(
      readJobs()[0],
      location.href + "?query=changed",
      new AbortController().signal,
    ),
  ).rejects.toThrow("地址已改变");
});
it("其他扩展冲突时不点击岗位", async () => {
  const panel = document.createElement("div");
  panel.id = "boss-copilot-panel";
  document.body.append(panel);
  await expect(
    readDetail(readJobs()[0], location.href, new AbortController().signal),
  ).rejects.toThrow("其他 Boss Agent");
  expect((await context()).conflict).toBe(true);
});
