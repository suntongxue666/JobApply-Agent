import { describe, it, expect } from "vitest";
import { filterJob, parseSalary } from "../src/core/rules";
import { defaults, type Job } from "../src/shared/schema";
const job: Job = {
  id: "test123",
  url: "https://www.zhipin.com/job_detail/test123.html",
  title: "AI产品经理",
  company: "示例科技",
  salary: "25-40K·14薪",
  tags: "",
  jd: "负责产品需求分析，非外包岗位",
  communicated: false,
  type: "unknown",
};
describe("薪资解析与单位隔离", () => {
  it.each([
    ["25-40K·14薪", 25000, 40000, "month", 14],
    ["1.5-2万/月", 15000, 20000, "month", undefined],
    ["30-50万/年", 300000, 500000, "year", undefined],
    ["200-300元/天", 200, 300, "day", undefined],
    ["80元/小时", 80, 80, "hour", undefined],
  ])("%s", (raw, min, max, unit, payments) => {
    expect(parseSalary(String(raw))).toEqual({ min, max, unit, payments });
  });
  it.each(["面议", "-K", "", "350", "40-20K"])(
    "未知或无效薪资不能猜测：%s",
    (s) => expect(parseSalary(s)).toBeNull(),
  );
  it("重叠与完全包含不同，闭区间边界通过", () => {
    const filters = { ...defaults.filters, salaryMin: 20000, salaryMax: 35000 };
    expect(filterJob(job, filters, false).decision).toBe("pass");
    expect(
      filterJob(job, { ...filters, salaryMode: "contained" }, false).decision,
    ).toBe("reject");
    expect(
      filterJob({ ...job, salary: "35-40K" }, filters, false).decision,
    ).toBe("pass");
  });
  it("日薪不与月薪直接比较；未知可选择跳过", () => {
    const filters = { ...defaults.filters, salaryMin: 20000 };
    expect(
      filterJob({ ...job, salary: "200-300元/天" }, filters, false).decision,
    ).toBe("review");
    expect(
      filterJob(
        { ...job, salary: "面议" },
        { ...filters, unknownSalary: "skip" },
        false,
      ).decision,
    ).toBe("reject");
  });
});
describe("规则优先级与含义", () => {
  it("公司黑名单、已沟通和单岗屏蔽硬排除", () => {
    expect(
      filterJob(job, { ...defaults.filters, companies: ["示例"] }, false)
        .decision,
    ).toBe("reject");
    expect(
      filterJob({ ...job, communicated: true }, defaults.filters, false)
        .decision,
    ).toBe("reject");
    expect(filterJob(job, defaults.filters, true).decision).toBe("reject");
  });
  it("否定短语待审核，但其他肯定命中仍拒绝", () => {
    const filters = { ...defaults.filters, exclude: ["外包"] };
    expect(filterJob(job, filters, false).decision).toBe("review");
    expect(
      filterJob(
        { ...job, jd: "非外包岗位。需要参与外包业务管理。" },
        filters,
        false,
      ).decision,
    ).toBe("reject");
  });
  it("未知岗位性质不能当全职通过", () =>
    expect(
      filterJob(job, { ...defaults.filters, jobType: "fulltime" }, false)
        .decision,
    ).toBe("review"));
  it("空白词不匹配所有岗位，也不会死循环", () =>
    expect(
      filterJob(
        job,
        {
          ...defaults.filters,
          exclude: ["", " "],
          companies: [""],
          include: [" "],
        },
        false,
      ).decision,
    ).toBe("pass"));
  it("关键词大小写规范化；全部命中与任意命中不同", () => {
    expect(
      filterJob(job, { ...defaults.filters, include: ["ai", "实习"] }, false)
        .decision,
    ).toBe("pass");
    expect(
      filterJob(
        job,
        { ...defaults.filters, include: ["ai", "实习"], includeMode: "all" },
        false,
      ).decision,
    ).toBe("reject");
  });
});
it("职位名称屏蔽关键词只看标题，优先于 JD 和模型", () => {
  const filters = { ...defaults.filters, excludeTitles: ["实习"] };
  expect(
    filterJob({ ...job, title: "AI产品经理实习生" }, filters, false),
  ).toEqual({ decision: "reject", reasons: ["职位名称屏蔽词：实习"] });
  expect(
    filterJob({ ...job, jd: "有实习经验优先" }, filters, false).decision,
  ).toBe("pass");
});
it("标题屏蔽开关关闭时保留词但不排除；开启则任意一个命中即跳过", () => {
  const sample = { ...job, title: "AI产品经理实习生" },
    filters = { ...defaults.filters, excludeTitles: ["兼职", "实习"] };
  expect(
    filterJob(sample, { ...filters, titleBlockEnabled: false }, false).decision,
  ).toBe("pass");
  expect(
    filterJob(sample, { ...filters, titleBlockEnabled: true }, false).decision,
  ).toBe("reject");
});
