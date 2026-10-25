import { checkGuard, readJobs, text, waitUntil, SELECTORS } from "./index";
import { visible, assertNoChallenge } from "./chat";
import {
  sameSearchScope,
  type LoadMoreResult,
} from "../../shared/search-scope";
function nextPageControl() {
  const candidates = [
    ...document.querySelectorAll<HTMLElement>('a,button,[role="button"]'),
  ].filter((e) => {
    if (!visible(e)) return false;
    const name = (
      e.getAttribute("aria-label") ||
      e.getAttribute("title") ||
      text(e)
    ).replace(/\s+/g, "");
    const pager = e.closest(
      '.options-pages,.pagination,.page-box,[role="navigation"]',
    );
    return (
      /^(下一页|下页|Next|Nextpage)$/i.test(name) ||
      e.getAttribute("rel") === "next" ||
      e.getAttribute("ka") === "page-next" ||
      (!!pager &&
        (/^(›|»|>)$/.test(name) ||
          e.classList.contains("next") ||
          e.classList.contains("page-next")))
    );
  });
  const unique = candidates.filter(
    (e) => !candidates.some((other) => other !== e && e.contains(other)),
  );
  const enabled = unique.filter(
    (e) =>
      !e.closest('[disabled],[aria-disabled="true"],.disabled,.is-disabled') &&
      getComputedStyle(e).pointerEvents !== "none",
  );
  if (enabled.length > 1)
    throw new Error("找到多个下一页入口，无法确定职位列表分页，已暂停");
  return { next: enabled[0], disabled: unique.length > 0 && !enabled.length };
}
function listFinished(list: Element) {
  return [...list.querySelectorAll("*")].some(
    (e) =>
      visible(e) &&
      /^(没有更多了|没有更多职位|暂无更多职位|已加载全部职位|已经到底了)[。！!]?$/u.test(
        text(e),
      ),
  );
}
export async function loadMore(
  expectedUrl: string,
  signal: AbortSignal,
): Promise<LoadMoreResult> {
  checkGuard(expectedUrl);
  if (signal.aborted) throw new Error("任务已取消");
  const list = document.querySelector(".job-list-container");
  if (!list) throw new Error("未识别职位列表容器，无法加载更多");
  const before = new Set(readJobs().map((job) => job.id));
  let scroll: Element | null = list;
  while (scroll && scroll !== document.body) {
    if (
      scroll.scrollHeight > scroll.clientHeight + 10 &&
      /auto|scroll/.test(getComputedStyle(scroll).overflowY)
    )
      break;
    scroll = scroll.parentElement;
  }
  if (scroll && scroll !== document.body)
    scroll.scrollTop = scroll.scrollHeight;
  else {
    list
      .querySelector(SELECTORS.card + ":last-child")
      ?.scrollIntoView?.({ block: "end" });
    window.scrollTo({
      top: document.documentElement.scrollHeight,
      behavior: "instant",
    });
  }
  const control = nextPageControl();
  if (control.next) {
    const href = control.next.getAttribute("href");
    if (href && !/^(javascript:|#)/i.test(href)) {
      const destination = new URL(href, location.href);
      if (
        destination.origin !== "https://www.zhipin.com" ||
        destination.pathname !== "/web/geek/jobs" ||
        !sameSearchScope(destination.href, expectedUrl) ||
        destination.href === location.href
      )
        throw new Error("下一页链接改变了搜索条件或不是 BOSS 职位列表，未跳转");
      // 由扩展导航到页面提供的链接，避免整页刷新先销毁内容脚本的响应通道。
      return { action: "navigate", changed: false, url: destination.href };
    }
    control.next.click();
  } else if (listFinished(list))
    return {
      action: "end",
      changed: false,
      url: location.href,
      reason: "已到达列表末页",
    };
  try {
    return await waitUntil(
      () => {
        assertNoChallenge();
        if (
          !sameSearchScope(location.href, expectedUrl) ||
          document.querySelector(SELECTORS.conflict)
        )
          throw new Error("加载更多时搜索条件或页面上下文已改变");
        if (readJobs().some((job) => !before.has(job.id)))
          return {
            action: control.next ? ("next_page" as const) : ("scroll" as const),
            changed: true,
            url: location.href,
          };
        return undefined;
      },
      signal,
      control.next ? 8000 : 4500,
    );
  } catch (error) {
    if (signal.aborted) throw new Error("任务已取消");
    if (
      error instanceof Error &&
      error.message === "等待页面数据超时，可能页面结构已变化"
    ) {
      if (control.disabled)
        return {
          action: "end",
          changed: false,
          url: location.href,
          reason: "已到达列表末页",
        };
      if (control.next)
        throw new Error("已点击下一页，但未读取到新的职位；已暂停，未重复点击");
      return {
        action: "scroll",
        changed: false,
        url: location.href,
        reason: "滚动后暂未出现新职位",
      };
    }
    throw error;
  }
}
