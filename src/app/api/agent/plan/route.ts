import { NextRequest, NextResponse } from "next/server";

const MODES = ["question_bank", "quiz", "flashcards", "graph", "keywords"] as const;
type Mode = (typeof MODES)[number];
type MaterialType = "question_bank" | "notes" | "mixed" | "unknown";
type Topic = { id: string; title: string; evidence: string };
type Stage = { id: string; title: string; goal: string; topicIds: string[]; recommendedMode: Mode };
type Plan = {
  materialType: MaterialType;
  recommendedMode: Mode;
  title: string;
  reason: string;
  outline: Topic[];
  stages: Stage[];
  caution: string;
  partialMaterial: boolean;
};

type CompletionResult = { content: string; finishReason: string };

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function mode(value: unknown): value is Mode {
  return typeof value === "string" && MODES.some(m => m === value);
}
function str(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
function normalized(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/g, "");
}

function parsePlan(raw: unknown, material: string, partialMaterial: boolean): Plan | null {
  if (!object(raw) || !mode(raw.recommendedMode)) return null;
  const title = str(raw.title, 70);
  const reason = str(raw.reason, 300);
  if (!title || !reason || !Array.isArray(raw.outline) || !Array.isArray(raw.stages)) return null;

  const body = normalized(material);
  const outline: Topic[] = [];
  const usedTitles = new Set<string>();
  const idToValidated = new Map<string, string>();
  const rawOutline = raw.outline.filter(object);

  for (let i = 0; i < rawOutline.length; i++) {
    const candidate = rawOutline[i];
    const topicTitle = str(candidate.title, 90);
    const evidence = str(candidate.evidence, 180);
    const nameKey = normalized(topicTitle);
    if (!topicTitle || !evidence || normalized(evidence).length < 7 ||
        !body.includes(normalized(evidence)) || usedTitles.has(nameKey)) continue;

    const validatedId = `t${outline.length + 1}`;
    outline.push({ id: validatedId, title: topicTitle, evidence });
    usedTitles.add(nameKey);
    if (candidate.id !== undefined) idToValidated.set(String(candidate.id), validatedId);
    idToValidated.set(String(i + 1), validatedId);
    if (outline.length >= 60) break; // Defensive limit, not a desired stage count.
  }
  if (!outline.length) return null;

  const stages: Stage[] = [];
  for (const candidate of raw.stages) {
    if (!object(candidate)) continue;
    const stageTitle = str(candidate.title, 90);
    const goal = str(candidate.goal, 240);
    const ids = Array.isArray(candidate.topicIds)
      ? [...new Set(candidate.topicIds.map(v => idToValidated.get(String(v))).filter((v): v is string => !!v))]
      : [];
    if (!stageTitle || !goal || !ids.length) continue;
    stages.push({
      id: `s${stages.length + 1}`,
      title: stageTitle,
      goal,
      topicIds: ids,
      recommendedMode: mode(candidate.recommendedMode) ? candidate.recommendedMode : raw.recommendedMode,
    });
    if (stages.length >= 60) break;
  }

  const assigned = new Set(stages.flatMap(s => s.topicIds));
  const remaining = outline.filter(t => !assigned.has(t.id)).map(t => t.id);
  if (remaining.length) stages.push({
    id: `s${stages.length + 1}`,
    title: "其他已识别知识点",
    goal: "学习尚未纳入前面阶段的知识点",
    topicIds: remaining,
    recommendedMode: raw.recommendedMode,
  });
  if (!stages.length) return null;

  const type = raw.materialType;
  const materialType: MaterialType =
    type === "question_bank" || type === "notes" || type === "mixed" ? type : "unknown";

  return {
    materialType, recommendedMode: raw.recommendedMode, title, reason, outline, stages,
    caution: str(raw.caution, 240), partialMaterial,
  };
}

function tryJson(text: string): unknown | null {
  try { return JSON.parse(text); } catch { return null; }
}

async function completePlan(
  key: string,
  system: string,
  user: string,
  retry: boolean,
): Promise<CompletionResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90000);
  try {
    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      signal: controller.signal,
      body: JSON.stringify({
        model: "deepseek-flash",
        temperature: retry ? 0.1 : 0.2,
        max_tokens: retry ? 8000 : 7000,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    if (!response.ok) throw new Error(`HTTP_${response.status}`);
    const payload: unknown = await response.json();
    if (!object(payload) || !Array.isArray(payload.choices) || !object(payload.choices[0])) {
      throw new Error("EMPTY_COMPLETION");
    }
    const choice = payload.choices[0];
    const message = choice.message;
    if (!object(message) || typeof message.content !== "string" || !message.content.trim()) {
      throw new Error("EMPTY_COMPLETION");
    }
    return { content: message.content, finishReason: str(choice.finish_reason, 30) };
  } finally {
    clearTimeout(timer);
  }
}

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();
    if (rawBody.length > 135000) return NextResponse.json({ error: "请求内容过大" }, { status: 413 });

    let body: unknown;
    try { body = JSON.parse(rawBody); }
    catch { return NextResponse.json({ error: "请求格式错误" }, { status: 400 }); }
    if (!object(body)) return NextResponse.json({ error: "请求格式错误" }, { status: 400 });

    const material = typeof body.material === "string" ? body.material : "";
    const goal = str(body.goal, 601);
    if (!material.trim() || material.length > 100000 || !goal || goal.length > 600) {
      return NextResponse.json({ error: "请提供有效学习资料和学习目标（目标不超过 600 字）" }, { status: 400 });
    }
    const key = process.env.DEEPSEEK_API_KEY;
    if (!key) return NextResponse.json({ error: "未配置 AI 服务" }, { status: 500 });

    // A 14,584-character handout should not be sampled. Only sample genuinely long text.
    const partial = material.length > 40000;
    const excerpt = partial ? [
      material.slice(0, 14000),
      material.slice(Math.max(0, Math.floor(material.length / 2) - 7000), Math.floor(material.length / 2) + 7000),
      material.slice(-10000),
    ].join("\n[部分原文省略]\n") : material;

    const system = [
      "你是 StudyForge 学习方案规划智能体。理解用户困难，根据给出的资料制定可自由调整的互动学习方案。",
      "可用模式：question_bank=原题导入，quiz=新生成选择题，flashcards=闪卡，graph=知识图谱，keywords=关键词。不可承诺其他尚未实现的功能。",
      "先梳理资料的重要知识模块，再根据知识依赖关系形成学习阶段。阶段数由实际内容决定，不固定为三步，也不能只覆盖前半部分。",
      "outline 中每项为 {id,title,evidence}。evidence 必须是材料中连续出现、原样复制的 7～60 字符片段。不要凭空发明引文或页码。",
      "stages 中每项为 {title,goal,topicIds,recommendedMode}。topicIds 必须使用 outline 中的真实 id。所有 outline 知识点至少要被一个阶段引用。",
      "用户说学不懂、学不进去，优先考虑知识理解；明确记不住可以推荐闪卡；需要做已有题库原题优先 question_bank。",
      "用户可以自由切换阶段和模式；不要强制规划进度，也不要过度追踪用户。",
      "用户界面文案自然简洁。reason 和 goal 各用一两句话；caution 仅在必要时填写。",
      "为了保证 JSON 完整：每个知识点只写简短名称与一处短原文依据；阶段 goal 简短；避免冗长解释或重复知识点。",
      "若只给出部分抽样材料，不得声称覆盖了整份材料。PDF 提取文本中的公式和图片可能不完整。",
      "只返回一个完整、有效的 JSON 对象，不要 Markdown、代码块或任何 JSON 之外的字符。",
      'JSON格式：{"materialType":"notes","recommendedMode":"graph","title":"标题","reason":"理由","outline":[{"id":"1","title":"知识点","evidence":"原文连续片段"}],"stages":[{"title":"阶段名称","goal":"阶段学习目标","topicIds":["1"],"recommendedMode":"graph"}],"caution":""}',
    ].join("\n");

    const user = `学习目标：${goal}\n资料状态：${partial ? "已截取跨段样本，不能保证覆盖整份资料" : "已提供全部提取文本，但公式和图片可能不完整"}\n\n学习资料：\n${excerpt}`;
    let lastReason = "";

    for (let attempt = 0; attempt < 2; attempt++) {
      const retry = attempt === 1;
      let completion: CompletionResult;
      try {
        completion = await completePlan(
          key,
          system + (retry ? "\n上一次生成未获得可用的完整结构。本次务必优先确保 JSON 闭合，缩短描述，不要遗漏主要知识模块。" : ""),
          user,
          retry,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (message === "AbortError") return NextResponse.json({ error: "规划超时，请重试" }, { status: 504 });
        if (message.startsWith("HTTP_")) return NextResponse.json({ error: `学习方案服务暂不可用（HTTP ${message.slice(5)}）` }, { status: 502 });
        lastReason = "AI 未返回有效内容";
        continue;
      }

      const parsed = tryJson(completion.content);
      if (parsed === null) {
        lastReason = completion.finishReason === "length" ? "AI 输出长度不足，计划未能完整返回" : "AI 返回了不完整的 JSON 计划";
        continue;
      }

      const plan = parsePlan(parsed, excerpt, partial);
      if (plan) return NextResponse.json({ data: plan });
      lastReason = "AI 返回的知识点或阶段无法通过原文校验";
    }

    return NextResponse.json({ error: `${lastReason || "学习方案生成失败"}，请重试或使用手动模式` }, { status: 502 });
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    return NextResponse.json({ error: name === "AbortError" ? "规划超时，请重试" : "学习方案生成失败，请重试或手动选择学习模式" }, { status: 500 });
  }
}
