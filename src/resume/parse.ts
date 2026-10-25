import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import mammoth from "mammoth/mammoth.browser";
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdf.worker.min.mjs",
  location.href,
).href;
export async function parseResume(file: File): Promise<string> {
  if (file.size > 10 * 1024 * 1024) throw new Error("文件不能超过 10MB");
  const ext = file.name.split(".").pop()?.toLowerCase();
  let text = "";
  if (ext === "txt" || ext === "md") text = await file.text();
  else if (ext === "docx")
    text = (
      await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })
    ).value;
  else if (ext === "pdf") {
    const task = pdfjs.getDocument({
      data: new Uint8Array(await file.arrayBuffer()),
      useSystemFonts: true,
      useWasm: false,
      cMapUrl: new URL("cmaps/", location.href).href,
      cMapPacked: true,
      standardFontDataUrl: new URL("standard_fonts/", location.href).href,
    });
    const deadline = setTimeout(() => {
      void task.destroy();
    }, 15000);
    try {
      const doc = await task.promise;
      if (doc.numPages > 30) throw new Error("简历最多支持 30 页");
      for (let p = 1; p <= doc.numPages; p++) {
        const page = await doc.getPage(p),
          content = await page.getTextContent();
        text +=
          content.items
            .map((item) =>
              "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "",
            )
            .join("") + "\n";
      }
    } finally {
      clearTimeout(deadline);
      await task.destroy();
    }
  } else throw new Error("仅支持 PDF、DOCX、TXT 和 Markdown");
  text = text.trim();
  if (text.length < 20)
    throw new Error("未提取到有效文本；扫描 PDF 请手动粘贴简历文字");
  if (text.length > 50000)
    throw new Error("简历文本过长，请精简到 5 万字符以内");
  return text;
}
