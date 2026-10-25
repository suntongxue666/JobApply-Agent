// @vitest-environment-options {"url":"https://www.zhipin.com/web/geek/jobs"}
import { beforeEach, it, expect, vi } from "vitest";
import { afterEach } from "vitest";
import { openChat } from "../src/adapters/boss/open-chat";
const preventNavigation = (event: Event) => event.preventDefault();
const target = { jobId: "job12345", title: "产品经理", company: "示例科技" };
afterEach(() => {
  document.removeEventListener("click", preventNavigation);
  history.replaceState(null, "", "/web/geek/jobs");
});
beforeEach(() => {
  document.addEventListener("click", preventNavigation);
  history.replaceState(null, "", "/web/geek/jobs");
  document.body.innerHTML =
    '<div class="job-detail-container">产品经理<div class="job-detail-body"><a class="more-job-btn" href="/job_detail/job12345.html">更多</a></div><a class="start-chat"><span>立即沟通</span></a></div>';
});
it("在匹配的职位详情点击立即沟通且只点击一次", async () => {
  const clicked = vi.fn();
  document.querySelector(".start-chat")!.addEventListener("click", clicked);
  await expect(
    openChat(target, location.href, new AbortController().signal),
  ).resolves.toEqual({ clicked: true });
  expect(clicked).toHaveBeenCalledTimes(1);
});
it("按钮延迟出现时等到可用再点击，而不是直接失败", async () => {
  document.querySelector(".start-chat")!.remove();
  const clicked = vi.fn();
  const task = openChat(target, location.href, new AbortController().signal);
  const button = document.createElement("a");
  button.textContent = "立即 沟通";
  button.addEventListener("click", clicked);
  document.querySelector(".job-detail-container")!.append(button);
  await task;
  expect(clicked).toHaveBeenCalledTimes(1);
});
it("旧岗位、重复按钮和取消均不会点击", async () => {
  const clicked = vi.fn();
  document.querySelector(".start-chat")!.addEventListener("click", clicked);
  await expect(
    openChat(
      { ...target, jobId: "other123" },
      location.href,
      new AbortController().signal,
    ),
  ).rejects.toThrow("目标岗位");
  const controller = new AbortController();
  controller.abort();
  await expect(
    openChat(target, location.href, controller.signal),
  ).rejects.toThrow("取消");
  document
    .querySelector(".job-detail-container")!
    .insertAdjacentHTML("beforeend", "<button>立即沟通</button>");
  await expect(
    openChat(target, location.href, new AbortController().signal),
  ).rejects.toThrow("不唯一");
  expect(clicked).not.toHaveBeenCalled();
});
it("禁用按钮等待期间取消，绝不触发开聊", async () => {
  const button = document.querySelector(".start-chat")!;
  button.setAttribute("aria-disabled", "true");
  const clicked = vi.fn();
  button.addEventListener("click", clicked);
  const controller = new AbortController();
  const task = openChat(target, location.href, controller.signal);
  controller.abort();
  await expect(task).rejects.toThrow("取消");
  expect(clicked).not.toHaveBeenCalled();
});
it("独立详情页支持 btn-startchat，点击真实开聊入口", async () => {
  history.replaceState(null, "", "/job_detail/job12345.html");
  document.body.innerHTML =
    '<div class="info-primary"><div class="name"><h1>产品经理</h1></div></div><a class="btn btn-startchat" ka="job_detail_chat"><span>立即沟通</span></a>';
  const click = vi.fn();
  document.querySelector(".btn-startchat")!.addEventListener("click", click);
  try {
    await openChat(target, location.href, new AbortController().signal);
    expect(click).toHaveBeenCalledTimes(1);
  } finally {
    history.replaceState(null, "", "/web/geek/jobs");
  }
});
