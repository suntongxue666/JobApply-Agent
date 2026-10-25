// @vitest-environment-options {"url":"https://www.zhipin.com/web/geek/jobs?query=产品&city=101010100"}
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { loadMore, readJobs } from "../src/adapters/boss";
import { sameSearchScope } from "../src/shared/search-scope";
const card = (id: string) =>
  `<li class="job-card-box"><a class="job-name" href="/job_detail/${id}.html">产品经理</a><span class="boss-name">示例科技</span></li>`;
beforeEach(() => {
  document.body.innerHTML = `<div class="job-list-container"><ul>${card("job11111")}</ul></div>`;
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
it("滚动直接到容器底部并等待新增职位，不停留在首批10条", async () => {
  vi.mocked(window.scrollTo).mockImplementation(() =>
    document
      .querySelector("ul")!
      .insertAdjacentHTML("beforeend", card("job22222")),
  );
  const result = await loadMore(location.href, new AbortController().signal);
  expect(result).toEqual(
    expect.objectContaining({ action: "scroll", changed: true }),
  );
  expect(readJobs()).toHaveLength(2);
});
it("下一页有链接时返回页面提供的地址，不点击而丢失响应通道", async () => {
  document.body.insertAdjacentHTML(
    "beforeend",
    `<a rel="next" href="${location.pathname + location.search}&page=2">下一页</a>`,
  );
  const click = vi.fn((e: Event) => e.preventDefault());
  document.querySelector("[rel=next]")!.addEventListener("click", click);
  const result = await loadMore(location.href, new AbortController().signal);
  expect(result.action).toBe("navigate");
  expect(new URL(result.url).searchParams.get("page")).toBe("2");
  expect(click).not.toHaveBeenCalled();
});
it("下一页是页面按钮时只点击一次并等待职位替换", async () => {
  document.body.insertAdjacentHTML(
    "beforeend",
    '<button aria-label="下一页">›</button>',
  );
  const click = vi.fn(() => {
    document.querySelector("ul")!.innerHTML = card("job33333");
  });
  document.querySelector("button")!.addEventListener("click", click);
  expect(
    (await loadMore(location.href, new AbortController().signal)).action,
  ).toBe("next_page");
  expect(click).toHaveBeenCalledTimes(1);
});
it("下一页禁用后仍先等待当前页的懒加载，再确认末页", async () => {
  document.body.insertAdjacentHTML(
    "beforeend",
    "<button disabled>下一页</button>",
  );
  vi.useFakeTimers();
  const pending = loadMore(location.href, new AbortController().signal);
  await vi.advanceTimersByTimeAsync(4500);
  expect((await pending).action).toBe("end");
});
it("下一页改变公司/城市/关键词筛选时拒绝跳转", async () => {
  document.body.insertAdjacentHTML(
    "beforeend",
    '<a href="/web/geek/jobs?query=other&page=2">下一页</a>',
  );
  await expect(
    loadMore(location.href, new AbortController().signal),
  ).rejects.toThrow("改变了搜索条件");
});
it("加载等待时可立即取消，不继续翻页", async () => {
  const controller = new AbortController();
  const pending = loadMore(location.href, controller.signal);
  controller.abort();
  await expect(pending).rejects.toThrow("取消");
});
it("搜索范围只忽略页码，保留其他筛选条件", () => {
  expect(
    sameSearchScope(
      "https://www.zhipin.com/web/geek/jobs?query=AI&page=1",
      "https://www.zhipin.com/web/geek/jobs?page=2&query=AI",
    ),
  ).toBe(true);
  expect(
    sameSearchScope(
      "https://www.zhipin.com/web/geek/jobs?query=AI",
      "https://www.zhipin.com/web/geek/jobs?query=Java",
    ),
  ).toBe(false);
});
