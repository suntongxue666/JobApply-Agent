// @vitest-environment-options {"url":"https://www.zhipin.com/web/geek/jobs"}
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { readDetail, readJobs } from "../src/adapters/boss";
import { readStandaloneDetail } from "../src/adapters/boss/detail";
const fixture = readFileSync("tests/fixtures/boss-list.html", "utf8");
beforeEach(() => {
  history.replaceState(null, "", "/web/geek/jobs");
  document.body.innerHTML = fixture;
});
afterEach(() => vi.useRealTimers());
it("选择卡片更新右侧详情，不拦截标题链接的默认事件", async () => {
  const job = readJobs()[1];
  const click = vi.fn(() => {
    document
      .querySelector(".more-job-btn")!
      .setAttribute(
        "href",
        "/job_detail/" + job.id + ".html?securityId=fixture-only",
      );
    document.querySelector(".job-detail-header")!.textContent = job.title;
  });
  document
    .querySelectorAll(".job-card-box")[1]
    .addEventListener("click", click);
  const titleClick = vi.fn();
  document
    .querySelectorAll(".job-name")[1]
    .addEventListener("click", titleClick);
  const result = await readDetail(
    job,
    location.href,
    new AbortController().signal,
  );
  expect(result.openInDetail).toBe(true);
  expect(result.url).toContain("securityId=fixture-only");
  expect(click).toHaveBeenCalledTimes(1);
  expect(titleClick).not.toHaveBeenCalled();
});
it("忽略隐藏旧详情，并支持 job-sec-text 的职位描述", async () => {
  const job = readJobs()[0];
  const old = document.querySelector(".job-detail-container")!;
  const current = old.cloneNode(true) as HTMLElement;
  (old as HTMLElement).style.display = "none";
  old
    .querySelector(".more-job-btn")!
    .setAttribute("href", "/job_detail/old-job.html");
  current.querySelector(".desc")!.className = "job-sec-text";
  document.body.append(current);
  expect(
    (await readDetail(job, location.href, new AbortController().signal)).jd,
  ).toContain("需求分析");
});
it("缺少详情时明确标记读取步骤和未点击，不能误导成按钮权限不足", async () => {
  vi.useFakeTimers();
  const job = readJobs()[0];
  document.querySelector(".job-detail-container")!.remove();
  const pending = expect(
    readDetail(job, location.href, new AbortController().signal),
  ).rejects.toThrow("DETAIL_TIMEOUT: 右侧详情读取超时");
  await vi.advanceTimersByTimeAsync(12000);
  await pending;
});
it("读取独立详情页时核对岗位 ID/标题和正文", async () => {
  const job = readJobs()[0];
  history.replaceState(null, "", "/job_detail/testjob001.html");
  document.body.innerHTML =
    '<div class="info-primary"><div class="name"><h1>AI 产品经理</h1></div></div><div class="job-sec-text">负责产品调研、需求分析、原型设计、开发协同与上线验证，结合用户反馈持续改进产品体验并参与产品评估。</div><a class="btn-startchat">立即沟通</a>';
  const clicked = vi.fn();
  document.querySelector("a")!.addEventListener("click", clicked);
  expect(
    (await readStandaloneDetail(job, new AbortController().signal))
      .openInDetail,
  ).toBe(true);
  expect(clicked).not.toHaveBeenCalled();
  history.replaceState(null, "", "/job_detail/other-job.html");
  await expect(
    readStandaloneDetail(job, new AbortController().signal),
  ).rejects.toThrow("ID 不一致");
});
