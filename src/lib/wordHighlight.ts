/**
 * Extract author-marked answers from the Word document's actual yellow highlighting.
 * An annotation is emitted only when a numbered question contains four explicitly
 * labelled, distinct options and exactly one option is highlighted.
 * Never infer an answer from general knowledge or the order of unlabeled lines.
 */
import JSZip from "jszip";

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const QUESTION = /^\s*(\d{1,5})\s*[.．、:：)）]\s*/;
const OPTION = /^\s*(?:[（(]\s*([A-D])\s*[）)]\s*|([A-D])(?:\s*[.．、:：)）]\s*|\s+(?=\S)|(?=[^A-Za-z\s])))/i;
const INLINE_OPTION = /(?:^|\s)(?:[（(]\s*([A-D])\s*[）)]|([A-D])\s*[.．、:：)）])\s*/gi;

type Paragraph = { text: string; marks: boolean[] };
type OptionLine = { label: string; marked: boolean; text: string; index: number };

function descendants(element: Element, name: string): Element[] {
  return Array.from(element.getElementsByTagNameNS(W_NS, name));
}
function isYellow(run: Element): boolean {
  const properties = descendants(run, "rPr")[0];
  const highlight = properties && descendants(properties, "highlight")[0];
  if (!highlight) return false;
  const value = highlight.getAttributeNS(W_NS, "val") ?? highlight.getAttribute("w:val") ?? "";
  return value.toLowerCase() === "yellow";
}
function paragraphOf(paragraph: Element): Paragraph {
  const characters: string[] = [];
  const marks: boolean[] = [];
  for (const run of descendants(paragraph, "r")) {
    const marked = isYellow(run);
    for (const child of Array.from(run.childNodes)) {
      if (child.nodeType !== 1) continue;
      const element = child as Element;
      if (element.namespaceURI !== W_NS) continue;
      const value = element.localName === "t" ? element.textContent ?? ""
        : element.localName === "tab" ? "\t"
        : element.localName === "br" || element.localName === "cr" ? " " : "";
      for (const character of value) {
        characters.push(character);
        marks.push(marked);
      }
    }
  }
  const raw = characters.join("");
  const start = raw.length - raw.trimStart().length;
  const end = raw.trimEnd().length;
  return { text: raw.slice(start, end), marks: marks.slice(start, end) };
}
function markedRange(paragraph: Paragraph, start: number, end: number): boolean {
  const flags = paragraph.marks.slice(start, end);
  const count = flags.filter(Boolean).length;
  const length = paragraph.text.slice(start, end).trim().length;
  // A full highlighted option or a highlighted option label is an explicit mark.
  return count >= Math.max(2, Math.ceil(length * 0.35));
}
function asOption(paragraph: Paragraph, index: number): OptionLine | null {
  const match = OPTION.exec(paragraph.text);
  if (!match) return null;
  const label = (match[1] || match[2]).toUpperCase();
  const text = paragraph.text.slice(match[0].length).trim();
  if (!text) return null;
  const prefixMarked = paragraph.marks.slice(0, match[0].length).some(Boolean);
  return { label, text, index, marked: prefixMarked || markedRange(paragraph, match[0].length, paragraph.text.length) };
}
function inlineOptions(paragraph: Paragraph, index: number): OptionLine[] | null {
  const matches = Array.from(paragraph.text.matchAll(INLINE_OPTION));
  if (matches.length !== 4) return null;
  const labels = matches.map(m => (m[1] || m[2]).toUpperCase());
  if (new Set(labels).size !== 4 || !"ABCD".split("").every(x => labels.includes(x))) return null;
  return matches.map((match, i) => {
    const start = (match.index ?? 0) + match[0].length;
    const end = i + 1 < matches.length ? (matches[i + 1].index ?? paragraph.text.length) : paragraph.text.length;
    return {
      label: labels[i], index, text: paragraph.text.slice(start, end).trim(),
      marked: paragraph.marks.slice(match.index ?? 0, start).some(Boolean) || markedRange(paragraph, start, end),
    };
  });
}

export type WordHighlightResult = {
  text: string;
  confirmedGroups: number;
  detectedYellowRuns: number;
};

export async function extractWordYellowHighlight(file: File): Promise<WordHighlightResult | null> {
  if (!file.name.toLowerCase().endsWith(".docx")) return null;
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const documentFile = zip.file("word/document.xml");
  if (!documentFile) return null;
  const doc = new DOMParser().parseFromString(await documentFile.async("string"), "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("Word 文档结构解析失败");
  const body = descendants(doc.documentElement, "body")[0];
  if (!body) return null;
  const paragraphs = descendants(body, "p").map(paragraphOf).filter(p => p.text);
  const detectedYellowRuns = descendants(body, "r").filter(isYellow).length;
  if (!detectedYellowRuns) return null;

  // Mark annotations at the end of each question's option group, after all
  // question boundaries are known. This prevents a highlight from attaching
  // to a different question, or being lost when paragraphs wrap.
  const markers = new Map<number, string>();
  let questionStart = -1;
  let confirmedGroups = 0;

  function finishQuestion(end: number): void {
    if (questionStart < 0) return;
    const options: OptionLine[] = [];
    let scanningOptions = false;
    for (let i = questionStart + 1; i < end; i++) {
      const p = paragraphs[i];
      const inline = inlineOptions(p, i);
      if (inline) {
        if (options.length) return; // Ambiguous duplicate option block.
        options.push(...inline);
        scanningOptions = true;
        continue;
      }
      const opt = asOption(p, i);
      if (opt) {
        if (options.some(o => o.label === opt.label)) return;
        options.push(opt);
        scanningOptions = true;
      } else if (scanningOptions && options.length === 4) {
        // Anything following an already-complete group is not another option.
        break;
      }
    }
    if (options.length !== 4) return;
    if (!"ABCD".split("").every(x => options.some(o => o.label === x))) return;
    const highlighted = options.filter(o => o.marked);
    if (highlighted.length !== 1) return;
    const last = Math.max(...options.map(o => o.index));
    markers.set(last, `【Word黄色高亮答案：${highlighted[0].label}】`);
    confirmedGroups++;
  }

  paragraphs.forEach((p, i) => {
    if (QUESTION.test(p.text)) {
      finishQuestion(i);
      questionStart = i;
    }
  });
  finishQuestion(paragraphs.length);

  const lines: string[] = [];
  paragraphs.forEach((p, i) => {
    lines.push(p.text);
    const marker = markers.get(i);
    if (marker) lines.push(marker);
  });

  return { text: lines.join("\n"), confirmedGroups, detectedYellowRuns };
}
