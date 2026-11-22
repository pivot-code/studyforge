import { NextRequest, NextResponse } from "next/server";

type Settings = {
  scope: "comprehensive" | "focused";
  topic: string;
  count: number;
  detail: "concise" | "standard" | "detailed";
};
type Card = { front: string; back: string; source: string };

const MAX_MATERIAL = 100000;
const BATCH = 5;

function normalize(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{Z}]+/gu, "");
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function splitMaterial(material: string, chunks: number): string[] {
  if (chunks <= 1) return [material];
  const size = Math.ceil(material.length / chunks);
  return Array.from({ length: chunks }, (_, i) => material.slice(i * size, (i + 1) * size)).filter(Boolean);
}
function extractCards(value: unknown, material: string): Card[] {
  if (!isRecord(value) || !Array.isArray(value.cards)) return [];
  const normalizedMaterial = normalize(material);
  return value.cards.flatMap((item): Card[] => {
    if (!isRecord(item)) return [];
    const front = item.front;
    const back = item.back;
    const source = item.source;
    if (typeof front !== "string" || !front.trim() || front.length > 500 ||
        typeof back !== "string" || !back.trim() || back.length > 2200 ||
        typeof source !== "string" || source.length > 650) return [];
    // A citation must be an actual extract from the uploaded material. Empty citation is allowed
    // only when matching source extraction failed; the API never invents a quotation.
    if (source.trim()) {
      const needle = normalize(source);
      if (needle.length < 8 || !normalizedMaterial.includes(needle)) return [];
    }
    return [{ front: front.trim(), back: back.trim(), source: source.trim() }];
  });
}

async function runBatch(material: string, settings: Settings, target: number, index: number, total: number): Promise<Card[]> {
  const key = process.env.DEEPSEEK_API_KEY;
  if (!key) throw new Error("未配置 DEEPSEEK_API_KEY");
  const chunks = settings.scope === "comprehensive" ? splitMaterial(material, Math.min(total, 8)) : [material];
  const selected = chunks[index % chunks.length];
  // In focused mode the full material is supplied for the requested topic; other mode chunks
  // provide broader coverage while keeping requests within practical context limits.
  const excerpt = selected.slice(0, 30000);
  const detailInstruction = settings.detail === "concise"
    ? "答案简洁，通常一至两句话。"
    : settings.detail === "detailed"
      ? "答案可以较详细，给出必要的推导思路、背景或补充说明；公式不确定时用语言说明，不虚构推导。"
      : "答案包含核心概念与必要解释，控制冗余。";
  const prompt = [
    `请根据下面的课程材料生成 ${target} 张中文学习闪卡。`,
    settings.scope === "focused" ? `只围绕指定主题「${settings.topic}」生成；材料不支持的内容不要编造。` : "覆盖这段材料内不同的关键知识点，避免重复。",
    detailInstruction,
    '只返回 JSON 对象：{"cards":[{"front":"问题或概念","back":"准确答案","source":"从材料中原样连续摘取的依据"}]}。',
    "source 必须是材料中的连续原文片段，不要改写；引用不可可靠提取时设为空字符串。不得添加材料外的事实。不要生成含义相同的重复卡片。",
    `材料内容：\n${excerpt}`,
  ].join("\n\n");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 90000);
  try {
    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: "deepseek-flash",
        messages: [{ role: "system", content: "你是严谨的学习闪卡生成助手。只输出符合格式的 JSON，严格依据用户材料。" }, { role: "user", content: prompt }],
        response_format: { type: "json_object" },
        max_tokens: 6500,
        temperature: 0.4,
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`DeepSeek 请求失败（HTTP ${response.status}）`);
    const payload: unknown = await response.json();
    if (!isRecord(payload) || !Array.isArray(payload.choices)) throw new Error("模型返回格式错误");
    const choice = payload.choices[0];
    const content = isRecord(choice) && isRecord(choice.message) ? choice.message.content : null;
    if (typeof content !== "string") throw new Error("模型未返回闪卡内容");
    const parsed: unknown = JSON.parse(content);
    return extractCards(parsed, material);
  } finally {
    clearTimeout(timeout);
  }
}

export async function POST(request: NextRequest) {
  try {
    const raw = await request.text();
    if (raw.length > 450000) return NextResponse.json({ error: "请求内容过大" }, { status: 413 });
    const body: unknown = JSON.parse(raw);
    if (!isRecord(body) || typeof body.material !== "string" || !body.material.trim() || body.material.length > MAX_MATERIAL || !isRecord(body.flashcardSettings)) {
      return NextResponse.json({ error: "学习材料或闪卡配置无效" }, { status: 400 });
    }
    const s = body.flashcardSettings;
    if ((s.scope !== "comprehensive" && s.scope !== "focused") ||
      typeof s.topic !== "string" || s.topic.length > 120 ||
      (s.scope === "focused" && !s.topic.trim()) ||
      typeof s.count !== "number" || !Number.isInteger(s.count) || s.count < 5 || s.count > 50 ||
      (s.detail !== "concise" && s.detail !== "standard" && s.detail !== "detailed")) {
      return NextResponse.json({ error: "闪卡配置无效" }, { status: 400 });
    }
    const settings = s as Settings;
    const total = Math.ceil(settings.count / BATCH);
    const cards: Card[] = [];
    const seen = new Set<string>();
    let failure = "";
    for (let offset = 0; offset < total; offset += 2) {
      const indices = [offset, offset + 1].filter(index => index < total);
      const results = await Promise.allSettled(indices.map(index => runBatch(body.material as string, settings, Math.min(BATCH, settings.count - index * BATCH), index, total)));
      for (const result of results) {
        if (result.status === "rejected") {
          failure = result.reason instanceof Error ? result.reason.message : "模型生成失败";
          continue;
        }
        for (const card of result.value) {
          const key = normalize(card.front);
          if (key.length < 4 || seen.has(key)) continue;
          seen.add(key);
          cards.push(card);
          if (cards.length >= settings.count) break;
        }
      }
    }
    if (!cards.length) return NextResponse.json({ error: failure || "本次未生成通过校验的闪卡，请调整范围后重试" }, { status: 422 });
    return NextResponse.json({ data: { title: "智能闪卡", cards: cards.slice(0, settings.count), requestedCount: settings.count, generatedCount: Math.min(cards.length, settings.count) } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "闪卡生成失败";
    return NextResponse.json({ error: message }, { status: error instanceof SyntaxError ? 400 : 500 });
  }
}
