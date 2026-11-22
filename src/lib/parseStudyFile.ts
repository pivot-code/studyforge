export type ParsedStudyFile = {
  text: string;
  name: string;
  kind: "txt" | "pdf" | "docx";
  pages?: number;
};

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_TEXT_LENGTH = 100000;

export async function parseStudyFile(
  file: File
): Promise<ParsedStudyFile> {
  const extension = file.name
    .split(".")
    .pop()
    ?.toLowerCase();

  if (
    extension !== "txt" &&
    extension !== "pdf" &&
    extension !== "docx"
  ) {
    throw new Error("仅支持 TXT、PDF 和 DOCX 文件。");
  }

  if (file.size === 0) {
    throw new Error("文件为空。");
  }

  if (file.size > MAX_FILE_SIZE) {
    throw new Error("文件不能超过 10 MB。");
  }

  let text = "";
  let pages: number | undefined;

  if (extension === "txt") {
    text = await file.text();
  }

  if (extension === "docx") {
    const mammoth = await import("mammoth");

    const buffer = await file.arrayBuffer();

    const result = await mammoth.extractRawText({
      arrayBuffer: buffer,
    });

    text = result.value;
  }

  if (extension === "pdf") {
    const pdfjs = await import("pdfjs-dist");

    pdfjs.GlobalWorkerOptions.workerSrc =
      "/pdf.worker.min.mjs";

    const buffer = await file.arrayBuffer();

    const loadingTask = pdfjs.getDocument({
      data: new Uint8Array(buffer),
    });

    const pdf = await loadingTask.promise;

    try {
      pages = pdf.numPages;

      if (pages > 100) {
        throw new Error(
          "PDF 超过 100 页，请先拆分文件。"
        );
      }

      const pageTexts: string[] = [];
      let totalLength = 0;

      for (let i = 1; i <= pages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();

        const fragments: string[] = [];

        for (const item of content.items) {
          if (!("str" in item)) continue;

          fragments.push(item.str);

          if (item.hasEOL) {
            fragments.push("\n");
          } else {
            fragments.push(" ");
          }
        }

        const pageText =
          `【第 ${i} 页】\n` + fragments.join("");

        totalLength += pageText.length;

        if (totalLength > MAX_TEXT_LENGTH) {
          throw new Error(
            "PDF 提取内容超过 100000 字符，请缩短材料。"
          );
        }

        pageTexts.push(pageText);
      }

      text = pageTexts.join("\n\n");
    } finally {
      await loadingTask.destroy();
    }
  }

  text = text.replace(/\u0000/g, "").trim();

  if (!text || !text.replace(/【第 \d+ 页】/g, "").trim()) {
    throw new Error(
      "未提取到有效文字。扫描版 PDF 暂不支持。"
    );
  }

  if (text.length > MAX_TEXT_LENGTH) {
    throw new Error(
      "材料超过 20000 字符，请分段上传。"
    );
  }

  return {
    text,
    name: file.name,
    kind: extension,
    pages,
  };
}
