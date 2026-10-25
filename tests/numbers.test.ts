import { expect, it } from "vitest";
import { unsupportedNumbers } from "../src/ai/numbers";
it("规范化全角、空格、千位符和百分号，避免数字书写方式误判", () => {
  expect(
    unsupportedNumbers(
      "完成２ 个项目，负责1,000人，增长20％",
      "完成2个项目，负责1000人，增长20%",
    ),
  ).toEqual([]);
});
it("必须匹配完整数值和单位，不能把12年中的2年当证据", () => {
  expect(
    unsupportedNumbers("有2年经验、完成2项工作", "有12年经验，完成2个项目"),
  ).toEqual(["2年", "2项"]);
});
it("中文数量同样校验，不能把虚构数字换写成中文逃过校验", () => {
  expect(unsupportedNumbers("拥有三年经验", "拥有2年经验")).toEqual(["三年"]);
  expect(unsupportedNumbers("拥有两年经验", "拥有2年经验")).toEqual([]);
  expect(unsupportedNumbers("有二点五年经历", "有2.5年经历")).toEqual([]);
  expect(unsupportedNumbers("有五年经历", "有二点五年经历")).toEqual(["五年"]);
});
it("明确引用数字岗位名称可以通过，个人经历的同一数字仍需简历支持", () => {
  const job = { title: "3D产品经理（0-1）", company: "58同城" };
  expect(
    unsupportedNumbers(
      "关注“3D产品经理（0-1）”岗位，希望交流",
      "产品需求经历",
      job,
    ),
  ).toEqual([]);
  expect(
    unsupportedNumbers(
      "关注“3D产品经理（0-1）”岗位，我有3年经验",
      "产品需求经历",
      job,
    ),
  ).toEqual(["3年"]);
  expect(
    unsupportedNumbers("我有3年经验", "产品需求经历", {
      title: "3年经验",
      company: "",
    }),
  ).toEqual(["3年"]);
});
it("JD数字不能充当个人资历，交流次数等礼貌邀请不误判为业绩", () => {
  expect(
    unsupportedNumbers("我有5年经验，期待一次交流", "产品需求经历", {
      title: "要求5年经验",
      company: "",
    }),
  ).toEqual(["5年"]);
});
it("万亿换算仍保留单位，含糊中文数量只允许原文一致", () => {
  expect(unsupportedNumbers("负责1万人", "负责10000人")).toEqual([]);
  expect(unsupportedNumbers("有23年经验", "有两三年经验")).toEqual(["23年"]);
});
