import type { Job } from "../../shared/schema";
import { jobId, SELECTORS, text, waitUntil } from "./index";
import { assertNoChallenge, visible } from "./chat";
export function detailUrl(raw: string, expectedId: string): string {
  const url = new URL(raw, "https://www.zhipin.com");
  if (
    url.origin !== "https://www.zhipin.com" ||
    jobId(url.pathname) !== expectedId
  )
    throw new Error("岗位详情链接与目标不一致");
  return url.href;
}
export function matchingInlineDetail(
  job: Pick<Job, "id" | "title">,
): Element | undefined {
  const roots = [...document.querySelectorAll(SELECTORS.detail)].filter(
    visible,
  );
  return roots.find(
    (root) =>
      jobId(
        root.querySelector(SELECTORS.detailLink)?.getAttribute("href") || "",
      ) === job.id && text(root).includes(job.title),
  );
}
export async function readStandaloneDetail(
  job: Job,
  signal: AbortSignal,
): Promise<Job> {
  let reason = "详情标题或职位描述尚未出现";
  return waitUntil(
    () => {
      assertNoChallenge();
      if (jobId(location.pathname) !== job.id)
        throw new Error("独立详情页岗位 ID 不一致");
      const heading = [
        ...document.querySelectorAll(".info-primary .name h1,.name h1,h1"),
      ].filter(visible);
      const title = heading
        .map(text)
        .find(
          (value) =>
            value.replace(/\s+/g, "") === job.title.replace(/\s+/g, ""),
        );
      const desc = [
        ...document.querySelectorAll(".job-sec-text,.job-detail-body .desc"),
      ]
        .filter(visible)
        .map(text)
        .find((s) => s.length >= 40);
      reason = !title
        ? "未找到与列表一致的职位标题"
        : !desc
          ? "未找到职位描述（.job-sec-text / .desc），或内容不足 40 字"
          : "等待详情稳定";
      if (!title || !desc) return undefined;
      const companyLinks = [
        ...document.querySelectorAll(
          ".sider-company .company-info a,.company-info .company-name",
        ),
      ]
        .filter(visible)
        .map(text)
        .filter(Boolean);
      if (
        companyLinks.length &&
        job.company &&
        !companyLinks.some(
          (s) => s.includes(job.company) || job.company.includes(s),
        )
      )
        throw new Error("独立详情页公司与列表不一致");
      return {
        ...job,
        url: detailUrl(location.href, job.id),
        openInDetail: true,
        jd: desc,
        recruiter:
          text(document.querySelector(".boss-info-attr .name")) ||
          job.recruiter,
        communicated:
          job.communicated ||
          [
            ...document.querySelectorAll(
              'a.btn-startchat,a.op-btn-chat,[ka="job_detail_chat"]',
            ),
          ]
            .filter(visible)
            .some((e) => /继续沟通|已沟通/.test(text(e))),
      };
    },
    signal,
    12000,
    true,
    () => `独立详情读取超时：${reason}；尚未点击立即沟通`,
  );
}
