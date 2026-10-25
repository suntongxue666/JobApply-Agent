// 仅忽略分页字段；岗位关键词、城市、薪资和其他筛选必须保持一致。
export function searchScopeUrl(raw: string): string {
  const url = new URL(raw);
  if (
    url.origin !== "https://www.zhipin.com" ||
    url.pathname !== "/web/geek/jobs"
  )
    return raw;
  for (const key of ["page", "pageNo", "pageNum"]) url.searchParams.delete(key);
  url.searchParams.sort();
  return url.href;
}
export function sameSearchScope(a: string, b: string): boolean {
  return searchScopeUrl(a) === searchScopeUrl(b);
}
export interface LoadMoreResult {
  action: "scroll" | "next_page" | "navigate" | "end";
  changed: boolean;
  url: string;
  reason?: string;
}
