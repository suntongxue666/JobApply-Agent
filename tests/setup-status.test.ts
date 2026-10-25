import { it, expect } from "vitest";
import { setupReady, setupStatus } from "../src/core/setup";
import { defaults, type Profile } from "../src/shared/schema";
const profile: Profile = {
  id: "main",
  confirmed: true,
  version: "1",
  text: "负责产品需求分析、原型设计及产品上线，有相关项目经验。",
  facts: [{ id: "1", text: "产品经验" }],
};
it("默认模板不等于已设置，三项全部完成才允许开始", () => {
  const status = setupStatus(defaults, profile, undefined);
  expect(status).toEqual({ resume: true, greeting: false, model: false });
  expect(setupReady(status)).toBe(false);
  const complete = setupStatus(
    {
      ...defaults,
      greetingConfirmed: true,
      consentOrigin: "https://api.deepseek.com",
    },
    profile,
    { origin: "https://api.deepseek.com", value: "test" },
  );
  expect(setupReady(complete)).toBe(true);
});
it("其他服务的旧 Key 不会算作 DeepSeek 已配置；未确认简历不能算完成", () => {
  const status = setupStatus(
    {
      ...defaults,
      greetingConfirmed: true,
      consentOrigin: "https://api.deepseek.com",
    },
    { ...profile, confirmed: false },
    { origin: "https://other.example", value: "secret" },
  );
  expect(status.resume).toBe(false);
  expect(status.model).toBe(false);
});
