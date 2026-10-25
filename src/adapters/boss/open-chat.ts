import type { ChatTarget } from "../../shared/schema";
import { jobId, text, waitUntil } from "./index";
import { beginDialogBinding } from "./dialog-binding";
import { matchingInlineDetail } from "./detail";
import { assertNoChallenge, visible } from "./chat";
export async function openChat(
  target: ChatTarget,
  expectedUrl: string,
  signal: AbortSignal,
  operationId?: string,
) {
  const detailForTarget = () => {
    if (
      jobId(location.pathname) === target.jobId &&
      text(document.querySelector("h1")).replace(/\s+/g, "") ===
        target.title.replace(/\s+/g, "")
    )
      return document.body;
    return matchingInlineDetail({ id: target.jobId, title: target.title });
  };
  const button = await waitUntil(
    () => {
      assertNoChallenge();
      if (signal.aborted) throw new Error("任务已取消");
      if (location.href !== expectedUrl)
        throw new Error("搜索页已改变，未点击立即沟通");
      const detail = detailForTarget();
      if (!detail) throw new Error("详情已不属于目标岗位，未发起沟通");
      const buttons = [
        ...detail.querySelectorAll<HTMLElement>(
          'a,button,[role="button"],.btn-startchat,.op-btn-chat,[ka="job_detail_chat"]',
        ),
      ].filter((e) => visible(e) && text(e).replace(/\s+/g, "") === "立即沟通");
      // role=button 可能套在 anchor 内；只点击最内层唯一的可操作元素。
      const leaves = buttons.filter(
        (e) => !buttons.some((other) => other !== e && e.contains(other)),
      );
      if (leaves.length > 1) throw new Error("立即沟通按钮不唯一，已停止");
      if (!leaves.length) {
        if (
          [...detail.querySelectorAll("a,button")].some(
            (e) => visible(e) && /继续沟通|已沟通/.test(text(e)),
          )
        )
          throw new Error("该岗位已沟通，未重复点击");
        return undefined;
      }
      const candidate = leaves[0];
      if (
        candidate.closest(
          '[disabled],[aria-disabled="true"],.disabled,.btn-disabled',
        )
      )
        return undefined;
      return candidate;
    },
    signal,
    4000,
    false,
    () =>
      "立即沟通按钮等待超时：详情已匹配，但按钮未出现或不可用；未点击、未发送",
  );
  // 最终点击前同步复查，异步授权/等待期间取消不能继续。
  assertNoChallenge();
  if (signal.aborted || location.href !== expectedUrl || !button.isConnected)
    throw new Error("任务或页面已改变，未点击立即沟通");
  const detail = detailForTarget();
  if (!detail || !detail.contains(button))
    throw new Error("点击前岗位已切换，未发起沟通");
  if (operationId) beginDialogBinding(operationId, target);
  button.click();
  return { clicked: true };
}
