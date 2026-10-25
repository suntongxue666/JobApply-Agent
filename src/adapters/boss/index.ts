import type { Job, PageContext } from "../../shared/schema";
import { hash } from "../../core/privacy";
import { detailUrl, matchingInlineDetail } from "./detail";
import { visible } from "./chat";

export const SELECTORS = {
  card: "li.job-card-box",
  title: "a.job-name",
  company: ".boss-name",
  salary: ".job-salary",
  tags: ".tag-list",
  detail: ".job-detail-container",
  jd: ".job-detail-body .desc",
  detailLink: ".job-detail-body a.more-job-btn",
  user: 'a[ka="header-username"]',
  conflict: "#boss-copilot-panel",
};
export function text(element: Element | null): string {
  return element instanceof HTMLElement
    ? (element.innerText ?? element.textContent ?? "").trim()
    : element?.textContent?.trim() || "";
}
export function jobId(url: string): string {
  return url.match(/\/job_detail\/([\w-]+)\.html/)?.[1] || "";
}
export function inferType(title: string, tags: string): Job["type"] {
  const raw = `${title} ${tags}`;
  if (/实习/.test(raw)) return "intern";
  if (/兼职/.test(raw)) return "parttime";
  if (/全职/.test(raw)) return "fulltime";
  return "unknown";
}
export function readJobs(root: ParentNode = document): Job[] {
  const seen = new Set<string>();
  return [...root.querySelectorAll(SELECTORS.card)].flatMap((card) => {
    const link = card.querySelector<HTMLAnchorElement>(SELECTORS.title);
    const id = jobId(link?.getAttribute("href") || "");
    if (!id || seen.has(id) || !text(link)) return [];
    seen.add(id);
    const title = text(link),
      tags = text(card.querySelector(SELECTORS.tags));
    return [
      {
        id,
        url: detailUrl(link!.getAttribute("href")!, id),
        title,
        company: text(card.querySelector(SELECTORS.company)),
        salary: text(card.querySelector(SELECTORS.salary)),
        tags,
        jd: "",
        communicated: /已沟通|继续沟通/.test(text(card)),
        type: inferType(title, tags),
      },
    ];
  });
}
export async function context(): Promise<PageContext> {
  const user = document.querySelector(SELECTORS.user),
    label = text(user);
  const avatar = user?.querySelector("img")?.getAttribute("src") || "";
  const conflict = !!document.querySelector(SELECTORS.conflict);
  const supported =
    location.hostname === "www.zhipin.com" &&
    location.pathname === "/web/geek/jobs" &&
    !!document.querySelector(SELECTORS.card);
  const blocked = /安全验证|请完成验证|访问受限|操作过于频繁/.test(
    document.body.innerText,
  );
  return {
    url: location.href,
    accountLabel: label,
    accountScope:
      label && avatar ? await hash(`${label}|${avatar.split("?")[0]}`) : "",
    supported: supported && !blocked,
    reason: blocked
      ? "页面出现平台验证或访问限制，请自行处理"
      : !label
        ? "未识别登录状态，请先登录 BOSS"
        : !supported
          ? "请打开 BOSS 职位搜索列表（/web/geek/jobs）"
          : "",
    conflict,
    loggedIn: !!label,
  };
}
export function checkGuard(expectedUrl: string) {
  if (location.href !== expectedUrl)
    throw new Error("页面地址已改变，任务暂停");
  if (/安全验证|请完成验证|访问受限|操作过于频繁/.test(document.body.innerText))
    throw new Error("平台验证或访问限制，任务暂停");
  if (document.querySelector(SELECTORS.conflict))
    throw new Error("检测到其他 Boss Agent，请停用该扩展后刷新 BOSS 页面");
}
export async function readDetail(
  job: Job,
  expectedUrl: string,
  signal: AbortSignal,
): Promise<Job> {
  checkGuard(expectedUrl);
  const card = [...document.querySelectorAll(SELECTORS.card)].find(
    (e) =>
      jobId(e.querySelector(SELECTORS.title)?.getAttribute("href") || "") ===
      job.id,
  );
  if (!card) throw new Error("目标岗位已不在当前 DOM，请重新读取列表");
  // 右侧详情由卡片选择触发；不阻止 anchor 默认事件，也不点击可能打开独立页的标题链接。
  (card as HTMLElement).click();
  let reason = "右侧详情未切换到当前岗位";
  return await waitUntil(
    () => {
      checkGuard(expectedUrl);
      const detail = matchingInlineDetail(job);
      const jd =
        [
          ...(detail?.querySelectorAll(
            ".job-detail-body .desc,.job-sec-text",
          ) || []),
        ]
          .filter(visible)
          .map(text)
          .find((s) => s.length >= 40) || "";
      reason = !detail
        ? "右侧详情未关联目标岗位 ID/标题"
        : !jd
          ? "右侧详情没有可读职位描述（.desc / .job-sec-text）"
          : "等待详情稳定";
      if (!detail || !jd) return undefined;
      return {
        ...job,
        url: detailUrl(
          detail.querySelector(SELECTORS.detailLink)!.getAttribute("href")!,
          job.id,
        ),
        openInDetail: true,
        recruiter:
          [...(detail?.querySelector(".job-boss-info .name")?.childNodes || [])]
            .filter((n) => n.nodeType === Node.TEXT_NODE)
            .map((n) => n.textContent)
            .join("")
            .trim() || undefined,
        jd,
        communicated:
          job.communicated ||
          [...(detail?.querySelectorAll("a") || [])].some(
            (a) => text(a) === "继续沟通",
          ),
      };
    },
    signal,
    12000,
    true,
    () => `DETAIL_TIMEOUT: 右侧详情读取超时：${reason}；尚未点击立即沟通`,
  );
}
export function waitUntil<T>(
  read: () => T | undefined,
  signal: AbortSignal,
  timeout = 8000,
  stable = false,
  timeoutMessage: () => string = () => "等待页面数据超时，可能页面结构已变化",
): Promise<T> {
  return new Promise((resolve, reject) => {
    let last = "",
      stableSince = 0,
      done = false;
    const cleanup = () => {
      clearInterval(timer);
      observer.disconnect();
      clearTimeout(deadline);
      signal.removeEventListener("abort", abort);
    };
    const finish = (error?: Error, value?: T) => {
      if (done) return;
      done = true;
      cleanup();
      error ? reject(error) : resolve(value as T);
    };
    const tick = () => {
      try {
        if (signal.aborted) {
          finish(new Error("操作已取消"));
          return;
        }
        const value = read();
        if (value === undefined) {
          stableSince = 0;
          last = "";
          return;
        }
        const serialized = JSON.stringify(value);
        if (!stable) {
          finish(undefined, value);
          return;
        }
        if (serialized !== last) {
          last = serialized;
          stableSince = Date.now();
        }
        if (Date.now() - stableSince >= 600) finish(undefined, value);
      } catch (e) {
        finish(e instanceof Error ? e : new Error("页面读取失败"));
      }
    };
    const abort = () => finish(new Error("操作已取消"));
    const observer = new MutationObserver(tick);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    const timer = setInterval(tick, 150),
      deadline = setTimeout(() => finish(new Error(timeoutMessage())), timeout);
    signal.addEventListener("abort", abort, { once: true });
    tick();
  });
}
export { loadMore } from "./pagination";
