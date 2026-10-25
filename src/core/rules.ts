import type { Filters, Job } from "../shared/schema";
const norm = (v: string) =>
  v.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
export interface Salary {
  min: number;
  max: number;
  unit: "month" | "year" | "day" | "hour";
  payments?: number;
}
export function parseSalary(raw: string): Salary | null {
  const text = norm(raw)
    .replace(/[–—~至]/g, "-")
    .replace(/,/g, "");
  if (/面议|[\ue000-\uf8ff]/.test(text)) return null; // 字体映射未经验证，不猜测平台混淆数字
  const match = text.match(
    /(\d+(?:\.\d+)?)\s*(k|千|万)?\s*(?:-\s*(\d+(?:\.\d+)?)\s*(k|千|万)?)?\s*(?:元)?\s*(?:\/|每)?\s*(月|年|天|日|小时|时)?/,
  );
  if (!match) return null;
  const [, lo, lowScale, hi, highScale, period] = match;
  const scale = (s?: string) =>
    s === "万" ? 10000 : s === "k" || s === "千" ? 1000 : 1;
  if (!lowScale && !highScale && !period) return null;
  const min = Number(lo) * scale(lowScale || highScale);
  const max = Number(hi || lo) * scale(highScale || lowScale);
  if (!Number.isFinite(min) || min > max) return null;
  const unit =
    period === "年"
      ? "year"
      : /天|日/.test(period || "")
        ? "day"
        : /小时|时/.test(period || "")
          ? "hour"
          : "month";
  return {
    min,
    max,
    unit,
    payments: Number(text.match(/[·•]\s*(\d+)薪/)?.[1]) || undefined,
  };
}
export type Verdict = {
  decision: "pass" | "review" | "reject";
  reasons: string[];
};
export function filterJob(
  job: Job,
  filters: Filters,
  blocked: boolean,
): Verdict {
  const reasons: string[] = [];
  const reject = (reason: string): Verdict => ({
    decision: "reject",
    reasons: [reason],
  });
  const titleWord = (
    filters.titleBlockEnabled !== false ? filters.excludeTitles || [] : []
  ).find((k) => norm(k) && norm(job.title).includes(norm(k)));
  if (titleWord) return reject(`职位名称屏蔽词：${titleWord}`);
  if (blocked) return reject("已屏蔽此岗位");
  if (job.communicated) return reject("平台显示已沟通");
  const company = norm(job.company);
  const black = filters.companies
    .filter((c) => norm(c))
    .find((c) =>
      filters.companyMode === "exact"
        ? company === norm(c)
        : company.includes(norm(c)),
    );
  if (black) return reject(`公司黑名单：${black}`);
  if (filters.jobType !== "any") {
    if (job.type === "unknown") reasons.push("岗位性质未明确，需要审核");
    else if (job.type !== filters.jobType) return reject("岗位性质不符合");
  }
  const include = filters.include.filter((k) => norm(k));
  if (
    include.length &&
    !(filters.includeMode === "all"
      ? include.every((k) => norm(job.title).includes(norm(k)))
      : include.some((k) => norm(job.title).includes(norm(k))))
  )
    return reject("标题未匹配包含关键词");
  const haystack = norm(
    filters.excludeScope === "all"
      ? `${job.title}\n${job.company}\n${job.jd}`
      : job[filters.excludeScope],
  );
  for (const keyword of filters.exclude) {
    const k = norm(keyword);
    if (!k) continue;
    let index = haystack.indexOf(k);
    while (index >= 0) {
      const context = haystack.slice(
        Math.max(0, index - 4),
        index + k.length + 8,
      );
      if (
        /(非|不|无|不是|无需|不属于|不涉及)\s*$/.test(
          haystack.slice(Math.max(0, index - 4), index),
        )
      )
        reasons.push(`排除词存在否定上下文，需审核：${context}`);
      else return reject(`排除词「${keyword}」：${context}`);
      index = haystack.indexOf(k, index + k.length);
    }
  }
  if (filters.salaryMin || filters.salaryMax) {
    const salary = parseSalary(job.salary);
    if (!salary || salary.unit !== filters.salaryUnit) {
      if (filters.unknownSalary === "skip")
        return reject("薪资未知或单位不一致，按设置跳过");
      reasons.push("薪资未知或单位不一致，需要审核");
    } else {
      const low = filters.salaryMin,
        high = filters.salaryMax || Infinity;
      const valid =
        filters.salaryMode === "overlap"
          ? salary.max >= low && salary.min <= high
          : salary.min >= low && salary.max <= high;
      if (!valid) return reject("薪资区间不符合");
    }
  }
  if (!job.company) reasons.push("公司信息缺失");
  return { decision: reasons.length ? "review" : "pass", reasons };
}
