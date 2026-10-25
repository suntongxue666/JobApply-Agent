import { parseResume } from "../../src/resume/parse";
import pdf from "../fixtures/resume.pdf";
import docx from "../fixtures/resume.docx";
import txt from "../fixtures/resume.txt";
const cases: [string, BlobPart][] = [
  ["resume.pdf", new Uint8Array(pdf).buffer],
  ["resume.docx", new Uint8Array(docx).buffer],
  ["resume.txt", txt],
  ["resume.md", txt],
];
const list = document.querySelector("main")!;
for (const [name, content] of cases) {
  const result = document.createElement("pre");
  list.append(result);
  try {
    const text = await parseResume(new File([content], name));
    if (!text.includes("Product manager")) throw new Error("未能提取预期文本");
    result.textContent = `PASS ${name}\n${text}`;
  } catch (e) {
    result.textContent = `FAIL ${name}: ${e instanceof Error ? e.message : "解析错误"}`;
  }
}
