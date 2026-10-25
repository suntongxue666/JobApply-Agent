// @vitest-environment-options {"url":"https://www.zhipin.com/job_detail/job12345.html"}
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { openChat } from "../src/adapters/boss/open-chat";
import {
  inspectChat,
  probeChat,
  sendGreeting,
} from "../src/adapters/boss/chat";
import { clearDialogBinding } from "../src/adapters/boss/dialog-binding";
const target = {
  jobId: "job12345",
  title: "产品经理",
  company: "示例科技",
  recruiter: "招聘者甲",
};
const greeting =
  "您好，关注到产品经理岗位，我有相关产品需求分析与上线经历，希望结合真实项目经验进一步交流。";
let operationId: string;
beforeEach(() => {
  operationId = crypto.randomUUID();
  history.replaceState(null, "", "/job_detail/job12345.html");
  document.body.innerHTML =
    '<h1>产品经理</h1><div class="sider-company">示例科技 · 招聘者甲</div><a class="btn-startchat">立即沟通</a>';
});
afterEach(() => {
  clearDialogBinding();
  vi.useRealTimers();
});
async function open(preset = "") {
  document.querySelector(".btn-startchat")!.addEventListener("click", () => {
    document.body.insertAdjacentHTML(
      "beforeend",
      '<div class="dialog-wrap startchat-dialog"><div class="dialog-container"><h2>打招呼</h2><textarea class="input-area"></textarea><button class="send-message">发送</button><div class="messages"></div></div></div>',
    );
    document.querySelector("textarea")!.value = preset;
  });
  await openChat(
    target,
    location.href,
    new AbortController().signal,
    operationId,
  );
}
it("识别详情内新出现的首次沟通框，无需另一个聊天 URL", async () => {
  await open();
  expect(probeChat(target, operationId)).toEqual(
    expect.objectContaining({
      ready: true,
      mode: "detail_dialog",
      url: location.href,
    }),
  );
  expect(
    await inspectChat(target, new AbortController().signal, operationId),
  ).toEqual(expect.objectContaining({ mode: "detail_dialog" }));
});
it("替换网站新弹窗的默认招呼语，input 事件后授权，再点击发送并核验完整文案", async () => {
  await open("网站默认招呼语");
  const order: string[] = [];
  document
    .querySelector("textarea")!
    .addEventListener("input", () => order.push("input"));
  document.querySelector(".send-message")!.addEventListener("click", () => {
    order.push("click");
    expect(document.querySelector("textarea")!.value).toBe(greeting);
    const msg = document.createElement("p");
    msg.textContent = greeting;
    document.querySelector(".messages")!.append(msg);
    document.querySelector("textarea")!.value = "";
  });
  const result = await sendGreeting(
    target,
    greeting,
    async () => {
      order.push("authorize");
    },
    new AbortController().signal,
    operationId,
  );
  expect(result.verified).toBe(true);
  expect(order).toEqual(["input", "authorize", "click"]);
});
it("本次提交后弹窗关闭且出现新的明确发送成功反馈可核验", async () => {
  await open();
  document.querySelector(".send-message")!.addEventListener("click", () => {
    document.querySelector(".dialog-wrap")!.remove();
    document.body.insertAdjacentHTML(
      "beforeend",
      '<div role="status">发送成功</div>',
    );
  });
  expect(
    (
      await sendGreeting(
        target,
        greeting,
        async () => {},
        new AbortController().signal,
        operationId,
      )
    ).verified,
  ).toBe(true);
});
it("弹窗关闭和之前就存在的成功提示不能冒充本次成功", async () => {
  await open();
  document.body.insertAdjacentHTML(
    "beforeend",
    '<div role="status">发送成功</div>',
  );
  document
    .querySelector(".send-message")!
    .addEventListener("click", () =>
      document.querySelector(".dialog-wrap")!.remove(),
    );
  vi.useFakeTimers();
  const result = sendGreeting(
    target,
    greeting,
    async () => {},
    new AbortController().signal,
    operationId,
  );
  await vi.advanceTimersByTimeAsync(10500);
  expect((await result).verified).toBe(false);
});
it("已存在的草稿弹窗、错误 operationId 和用户改过的内容都不覆盖", async () => {
  await open("默认内容");
  expect(probeChat(target, crypto.randomUUID()).ready).toBe(false);
  document.querySelector("textarea")!.value = "我的私人草稿";
  await expect(
    sendGreeting(
      target,
      greeting,
      vi.fn(),
      new AbortController().signal,
      operationId,
    ),
  ).rejects.toThrow("用户草稿");
  await expect(
    openChat(
      target,
      location.href,
      new AbortController().signal,
      crypto.randomUUID(),
    ),
  ).rejects.toThrow("已有可编辑");
  expect(document.querySelector("textarea")!.value).toBe("我的私人草稿");
});
it("岗位切换或多个可编辑弹窗时停止，不从其他对话框发送", async () => {
  await open();
  expect(probeChat({ ...target, jobId: "other-job" }, operationId).ready).toBe(
    false,
  );
  document.body.insertAdjacentHTML(
    "beforeend",
    '<div class="dialog-container"><textarea></textarea><button>发送</button></div>',
  );
  expect(probeChat(target, operationId).ready).toBe(false);
  history.replaceState(null, "", "/job_detail/other-job.html");
  expect(probeChat(target, operationId).ready).toBe(false);
});
it("授权前取消会恢复网站预填内容，不点击发送", async () => {
  await open("原始默认招呼");
  const click = vi.fn();
  document.querySelector(".send-message")!.addEventListener("click", click);
  const controller = new AbortController();
  await expect(
    sendGreeting(
      target,
      greeting,
      async () => {
        controller.abort();
      },
      controller.signal,
      operationId,
    ),
  ).rejects.toThrow("取消");
  expect(document.querySelector("textarea")!.value).toBe("原始默认招呼");
  expect(click).not.toHaveBeenCalled();
});
