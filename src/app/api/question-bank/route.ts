import { NextRequest, NextResponse } from "next/server";

type Obj = Record<string, unknown>;
type Item = {
  question: string;
  options: string[];
  answerIndex: number | null;
  answerEvidence: string;
  source: string;
  originalNumber?: number;
};
const MAX_INPUT = 100000;
const CHUNK_SIZE = 12000;
const MAX_CHUNKS = 8;
const MAX_QUESTIONS = 80;

function obj(v: unknown): v is Obj { return !!v && typeof v === "object" && !Array.isArray(v); }
function normalized(s: string) { return s.normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{Z}]+/gu, ""); }
function within(fragment: string, text: string) { const n = normalized(fragment); return n.length >= 2 && normalized(text).includes(n); }
function chunksOf(text: string): string[] {
  const lines = text.split(/(?<=\n)/u);
  const chunks: string[] = [];
  let buffer = "";
  for (const line of lines) {
    if (buffer.length + line.length > CHUNK_SIZE && buffer) { chunks.push(buffer); buffer = ""; }
    if (line.length > CHUNK_SIZE) {
      for (let i = 0; i < line.length; i += CHUNK_SIZE) chunks.push(line.slice(i, i + CHUNK_SIZE));
    } else buffer += line;
  }
  if (buffer) chunks.push(buffer);
  return chunks;
}
function validate(raw: unknown, material: string): Item[] {
  if (!obj(raw) || !Array.isArray(raw.questions)) return [];
  const results: Item[] = [];
  for (const candidate of raw.questions) {
    if (!obj(candidate) || typeof candidate.question !== "string" || !Array.isArray(candidate.options)) continue;
    const question = candidate.question.trim();
    const opts = candidate.options;
    if (question.length < 3 || question.length > 1200 || opts.length !== 4 || !opts.every(x => typeof x === "string" && x.trim().length > 0 && x.length < 800)) continue;
    if (!within(question, material) || !opts.every(x => within(String(x), material))) continue;
    const source = typeof candidate.source === "string" && candidate.source.length <= 800 && within(candidate.source, material) ? candidate.source.trim() : question;
    const evidence = typeof candidate.answerEvidence === "string" && candidate.answerEvidence.length < 240 && within(candidate.answerEvidence, material) ? candidate.answerEvidence.trim() : "";
    const match = evidence.match(/(?:参考答案|正确答案|答案|answer|key)\s*[:：=]?\s*([A-D])(?=$|[^A-Z])/iu);
    // An identical highlight annotation can occur after many questions.
    // Search after this question, rather than using the first occurrence in the document.
    const wordHighlight = evidence.includes("Word黄色高亮答案：");
    const qPos = material.indexOf(question);
    let evidenceIsLocal = true;
    if (wordHighlight) {
      const optionsEnd = opts.reduce((last: number, opt: string) => {
        const pos = material.indexOf(opt, last);
        return pos < 0 ? -1 : pos + opt.length;
      }, qPos >= 0 ? qPos + question.length : -1);
      const evidencePos = optionsEnd >= 0 ? material.indexOf(evidence, optionsEnd) : -1;
      evidenceIsLocal = qPos >= 0 && optionsEnd >= 0 &&
        evidencePos >= optionsEnd && evidencePos - optionsEnd < 500;
    }
    const explicitIndex = match ? match[1].toUpperCase().charCodeAt(0) - 65 : null;
    const answerIndex = explicitIndex !== null && candidate.answerIndex === explicitIndex && evidenceIsLocal ? explicitIndex : null;
    results.push({ question, options: opts.map(x => String(x).trim()), answerIndex, answerEvidence: answerIndex === null ? "" : evidence, source });
  }
  return results;
}
/**
 * A Word upload already supplies verifiable highlight markers immediately after
 * each complete option group. Parse that structure directly rather than asking
 * an AI to reconstruct or truncate the question bank.
 */
function extractAnnotatedWordBank(material: string): { questions: Item[]; skipped: number; detectedNumbers: number[]; missingNumbers: number[] } {
  const questionStart = /^\s*(\d{1,5})\s*[.．、:：)）]\s*(.*)$/;
  const optionStart = /^\s*(?:[（(]\s*([A-D])\s*[）)]\s*|([A-D])(?:\s*[.．、:：)）]\s*|\s+(?=\S)|(?=[^A-Za-z\s])))/i;
  const answerMarker = /^【Word黄色高亮答案：([A-D])】$/;
  const result: Item[] = [];
  const seen = new Set<string>();
  let startedQuestions = 0;
  const detectedNumbers: number[] = [];
  let question = "";
  let number = "";
  let options = new Map<string, string>();
  let lastOption: string | null = null;
  let answer: string | null = null;

  function finish() {
    if (!number) return;
    const labels = ["A", "B", "C", "D"];
    const full = labels.every(label => (options.get(label) ?? "").trim().length > 0);
    const key = normalized(question);
    if (full && question.trim().length >= 3 && !seen.has(key)) {
      seen.add(key);
      const answerIndex = answer ? labels.indexOf(answer) : -1;
      result.push({
        question: question.trim(),
        options: labels.map(label => (options.get(label) ?? "").trim()),
        answerIndex: answerIndex >= 0 ? answerIndex : null,
        answerEvidence: answerIndex >= 0 ? `【Word黄色高亮答案：${answer}】` : "",
        source: question.trim().slice(0, 500),
        originalNumber: Number(number),
      });
    }
    question = "";
    number = "";
    options = new Map();
    lastOption = null;
    answer = null;
  }

  for (const rawLine of material.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const start = questionStart.exec(line);
    if (start) {
      finish();
      startedQuestions++;
      detectedNumbers.push(Number(start[1]));
      number = start[1];
      question = start[2];
      continue;
    }
    if (!number) continue;

    const marker = answerMarker.exec(line);
    if (marker) {
      // The marker is produced only after a validated group in the Word
      // parser; never infer the key from a nearby unrelated question.
      if (["A", "B", "C", "D"].every(label => options.has(label))) {
        answer = marker[1];
      }
      continue;
    }

    const option = optionStart.exec(line);
    if (option) {
      const label = (option[1] || option[2]).toUpperCase();
      if (!options.has(label)) {
        options.set(label, line.slice(option[0].length).trim());
        lastOption = label;
      } else {
        // Duplicate labels are ambiguous: do not silently overwrite them.
        lastOption = null;
      }
      continue;
    }
    if (lastOption) {
      options.set(lastOption, `${options.get(lastOption) ?? ""} ${line}`.trim());
    } else if (!options.size) {
      question = `${question} ${line}`.trim();
    }
  }
  finish();
  const includedNumbers = new Set(result.map(q => q.originalNumber));
  return { questions: result, skipped: Math.max(0, startedQuestions - result.length), detectedNumbers,
    missingNumbers: [...new Set(detectedNumbers)].filter(n => !includedNumbers.has(n)).sort((a, b) => a - b) };
}

async function analyzeChunk(material: string) {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) throw new Error("服务器未配置 DEEPSEEK_API_KEY");
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 90000);
  try {
    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: "deepseek-flash",
        response_format: { type: "json_object" },
        temperature: 0,
        max_tokens: 7800,
        messages: [
          { role: "system", content: "你是严格的题库结构化提取程序。只提取原文中实际出现的四选项单选题。不得出题、补写、改写或猜答案。只输出 JSON。" },
          { role: "user", content: [
            '请分类这段学习资料：question_bank / notes / mixed / unknown；只提取其中完整的四选项单选题，最多 15 道。',
            'JSON 结构：{"type":"question_bank","questions":[{"question":"原文题干（不带序号，保持字面原样）","options":["原文 A 选项文本","原文 B 选项文本","原文 C 选项文本","原文 D 选项文本"],"answerIndex":1,"answerEvidence":"原文中明确写出的答案标记，如 答案：B","source":"原文中连续摘取的题干片段"}]}。',
            'question、每个 option、source 必须是原文的连续字符片段，原样复制，不能加 A. 或题号（除非原文本身就含）。如原文选项包含 A.，可按原样保留。',
            '只有原文明示正确选项，才允许填写 answerIndex 和 answerEvidence。材料中的【Word黄色高亮答案：B】是从 Word 原始黄色荧光标记提取的格式证据，表示紧邻前一组完整 A/B/C/D 选项的正确选项为 B。请原样复制这一标记到 answerEvidence，答案序号从 0 开始。标记缺失或与题目对应不清时，answerIndex=null，answerEvidence=""。不要根据知识猜答案。',
            '缺少选项或非单选题跳过。页眉、正文介绍不算题干。无题时返回 questions: []。',
            `原始资料：\n${material}`,
          ].join('\n\n') },
        ],
      }), signal: abort.signal,
    });
    if (!response.ok) throw new Error(`题库提取服务返回 HTTP ${response.status}`);
    const output: unknown = await response.json();
    const content = obj(output) && Array.isArray(output.choices) && obj(output.choices[0]) && obj(output.choices[0].message) ? output.choices[0].message.content : undefined;
    if (typeof content !== "string") throw new Error("题库提取结果格式异常");
    const data: unknown = JSON.parse(content);
    return { type: obj(data) && typeof data.type === "string" ? data.type : "unknown", questions: validate(data, material) };
  } finally { clearTimeout(timer); }
}
export async function POST(request: NextRequest) {
  try {
    const text = await request.text();
    if (text.length > 450000) return NextResponse.json({ error: "请求过大" }, { status: 413 });
    const body: unknown = JSON.parse(text);
    if (!obj(body) || typeof body.material !== "string" || !body.material.trim() || body.material.length > MAX_INPUT) return NextResponse.json({ error: "学习材料无效或超出 100000 字符" }, { status: 400 });
    // A genuine Word-highlighted bank is structured data. Preserve every
    // complete source question, including those beyond the AI extraction cap.
    if (body.material.includes("【Word黄色高亮答案：")) {
      const direct = extractAnnotatedWordBank(body.material);
      if (direct.questions.length > 0) {
        const total = chunksOf(body.material).length;
        return NextResponse.json({ data: {
          type: "question_bank",
          questions: direct.questions,
          extractedCount: direct.questions.length,
          withSourceAnswerCount: direct.questions.filter(q => q.answerIndex !== null).length,
          totalDetectedQuestions: direct.detectedNumbers.length,
          missingNumbers: direct.missingNumbers,
          analyzedChunks: total,
          totalChunks: total,
          partial: direct.skipped > 0,
          warning: direct.skipped > 0
            ? `${direct.skipped} 道题的选项结构不完整或重复，未自动导入；请检查原文件并手动核对。`
            : "",
        } });
      }
    }
    const allChunks = chunksOf(body.material);
    const selected = allChunks.slice(0, MAX_CHUNKS);
    const found: Item[] = [];
    const seen = new Set<string>();
    const types: string[] = [];
    const errors: string[] = [];
    let analyzedChunks = 0;
    for (let i = 0; i < selected.length && found.length < MAX_QUESTIONS; i += 2) {
      analyzedChunks += Math.min(2, selected.length - i);
      const responses = await Promise.allSettled(selected.slice(i, i + 2).map(analyzeChunk));
      for (const response of responses) {
        if (response.status === "rejected") { errors.push(response.reason instanceof Error ? response.reason.message : "部分内容提取失败"); continue; }
        types.push(response.value.type);
        for (const item of response.value.questions) {
          const key = normalized(item.question);
          if (key.length < 4 || seen.has(key)) continue;
          seen.add(key);
          found.push(item);
          if (found.length >= MAX_QUESTIONS) break;
        }
      }
    }
    if (!types.length) return NextResponse.json({ error: errors[0] ?? "题库识别失败" }, { status: 502 });
    const type = found.length ? (types.includes("notes") || types.includes("mixed") ? "mixed" : "question_bank") : types.includes("question_bank") || types.includes("mixed") ? "mixed" : types.includes("notes") ? "notes" : "unknown";
    return NextResponse.json({ data: {
      type, questions: found, extractedCount: found.length,
      withSourceAnswerCount: found.filter(x => x.answerIndex !== null).length,
      analyzedChunks,
      totalChunks: allChunks.length,
      partial: analyzedChunks < allChunks.length || found.length >= MAX_QUESTIONS || errors.length > 0,
      warning: errors.length ? `部分内容处理失败（${errors.length} 段），结果可能不完整。` : "",
    } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "题库识别失败" }, { status: 500 });
  }
}
