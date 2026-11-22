/** Local, opt-in retrieval from selected browser knowledge-library documents. */
import type { SelectedKnowledgeDocument } from "@/components/KnowledgeReferencePicker";

function tokens(query: string): string[] {
  const normalized = query.toLowerCase();
  const words = normalized.match(/[a-z0-9_]{2,}/g) ?? [];
  const chinese = [...(normalized.match(/[\u3400-\u9fff]+/g) ?? [])].flatMap(text => {
    if (text.length < 2) return [];
    const grams: string[] = [];
    for (let i = 0; i < text.length - 1; i++) grams.push(text.slice(i, i + 2));
    return grams;
  });
  return [...new Set([...words, ...chinese])].slice(0, 60);
}

function relevantExcerpts(text: string, query: string, budget: number): string {
  if (text.length <= budget) return text;
  const chunkSize = 1200;
  const chunks: { index: number; text: string; score: number }[] = [];
  const terms = tokens(query);
  for (let i = 0; i < text.length; i += chunkSize) {
    const content = text.slice(i, i + chunkSize);
    const lower = content.toLowerCase();
    const score = terms.reduce((sum, term) => sum + (lower.includes(term) ? (term.length >= 3 ? 2 : 1) : 0), 0);
    chunks.push({ index: i, text: content, score });
  }
  const maxChunks = Math.max(1, Math.floor(budget / chunkSize));
  const required = new Set<number>([0]);
  // Keep a document overview alongside query-relevant passages.
  if (maxChunks >= 3) { required.add(Math.floor((chunks.length - 1) / 2)); required.add(chunks.length - 1); }
  for (const chunk of [...chunks].sort((a, b) => b.score - a.score)) {
    if (required.size >= maxChunks) break;
    required.add(Math.floor(chunk.index / chunkSize));
  }
  return [...required].sort((a, b) => a - b)
    .map(index => `[原文字符位置 ${chunks[index].index + 1} 起]\n${chunks[index].text}`)
    .join("\n[该文档的其他部分未纳入本次检索]\n").slice(0, budget + 400);
}

/** Source labels are retained; no document is consulted unless explicitly selected. */
export function buildStudyContext(primary: string, selected: SelectedKnowledgeDocument[], query = ""): string {
  if (!selected.length) return primary;
  const primaryBudget = 12000;
  const blocks: string[] = [];
  if (primary.trim()) {
    blocks.push(`[当前会话资料]\n${relevantExcerpts(primary, query, primaryBudget)}`);
  }
  const totalReferenceBudget = primary.trim() ? 22500 : 34000;
  const perDoc = Math.max(2600, Math.min(8500, Math.floor(totalReferenceBudget / selected.length) - 150));
  for (const doc of selected) {
    if (!doc.text.trim()) continue;
    blocks.push(`[知识库：${doc.libraryTitle} | 文件：${doc.name}]\n${relevantExcerpts(doc.text, query, perDoc)}`);
  }
  return blocks.join("\n\n===== 资料来源分隔 =====\n\n");
}
