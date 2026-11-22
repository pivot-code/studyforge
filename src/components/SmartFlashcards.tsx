"use client";

import { useEffect, useMemo, useState } from "react";
import PdfEvidenceViewer from "@/components/PdfEvidenceViewer";

type Card = { front: string; back: string; source: string };
type Mastery = "again" | "hard" | "good";
type Filter = "all" | "again" | "hard" | "review" | "good";
type StoredProgress = { marks: Record<number, Mastery>; current: number; order: number[] };
type Props = {
  data: unknown;
  deckId: string;
  pdfSessionId?: string;
  expectedPdfName?: string;
};

function parseCards(data: unknown): Card[] {
  if (!data || typeof data !== "object" || Array.isArray(data)) return [];
  const object = data as Record<string, unknown>;
  const items = object.cards ?? object.flashcards;
  if (!Array.isArray(items)) return [];
  return items.flatMap((item): Card[] => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const card = item as Record<string, unknown>;
    const front = card.front ?? card.question;
    const back = card.back ?? card.answer;
    if (typeof front !== "string" || !front.trim() || typeof back !== "string" || !back.trim()) return [];
    return [{ front: front.trim(), back: back.trim(), source: typeof card.source === "string" ? card.source : "" }];
  });
}

function shuffled(items: number[]): number[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export default function SmartFlashcards({ data, deckId, pdfSessionId, expectedPdfName }: Props) {
  const cards = useMemo(() => parseCards(data), [data]);
  const storageKey = `studyforge-flashcards-v09-${deckId}`;
  const [progress, setProgress] = useState<StoredProgress>({ marks: {}, current: 0, order: [] });
  const [hydrated, setHydrated] = useState(false);
  const [flipped, setFlipped] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [showSource, setShowSource] = useState(false);
  const [showPdf, setShowPdf] = useState(false);
  const [storageError, setStorageError] = useState(false);

  useEffect(() => {
    setHydrated(false);
    let saved: StoredProgress = { marks: {}, current: 0, order: cards.map((_, index) => index) };
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<StoredProgress>;
        const valid = (value: unknown): value is Mastery => value === "again" || value === "hard" || value === "good";
        const marks: Record<number, Mastery> = {};
        if (parsed.marks && typeof parsed.marks === "object") {
          for (const [key, value] of Object.entries(parsed.marks)) {
            const index = Number(key);
            if (Number.isInteger(index) && index >= 0 && index < cards.length && valid(value)) marks[index] = value;
          }
        }
        const incoming = Array.isArray(parsed.order) ? parsed.order : [];
        const validOrder = incoming.length === cards.length && new Set(incoming).size === cards.length && incoming.every(n => Number.isInteger(n) && n >= 0 && n < cards.length);
        saved = {
          marks,
          order: validOrder ? incoming : cards.map((_, index) => index),
          current: typeof parsed.current === "number" && Number.isInteger(parsed.current) && parsed.current >= 0 && parsed.current < cards.length ? parsed.current : 0,
        };
      }
    } catch { setStorageError(true); }
    setProgress(saved);
    setFlipped(false);
    setFilter("all");
    setShowSource(false);
    setShowPdf(false);
    setHydrated(true);
  }, [storageKey, cards]);

  useEffect(() => {
    if (!hydrated) return;
    try { localStorage.setItem(storageKey, JSON.stringify(progress)); }
    catch { setStorageError(true); }
  }, [hydrated, storageKey, progress]);

  const order = progress.order.length === cards.length ? progress.order : cards.map((_, index) => index);
  const visible = order.filter(index => {
    const rating = progress.marks[index];
    if (filter === "all") return true;
    if (filter === "review") return rating === "again" || rating === "hard";
    return rating === filter;
  });
  const position = visible.includes(progress.current) ? visible.indexOf(progress.current) : 0;
  const currentIndex = visible[position];
  const currentCard = currentIndex === undefined ? null : cards[currentIndex];
  const ratedCount = Object.keys(progress.marks).length;

  function navigate(index: number) {
    setProgress(previous => ({ ...previous, current: index }));
    setFlipped(false);
    setShowSource(false);
    setShowPdf(false);
  }

  function setRating(rating: Mastery) {
    if (currentIndex === undefined) return;
    setProgress(previous => ({ ...previous, marks: { ...previous.marks, [currentIndex]: rating } }));
  }

  function changeFilter(next: Filter) {
    setFilter(next);
    setFlipped(false);
    setShowSource(false);
    setShowPdf(false);
  }

  if (!cards.length) return <p className="text-sm text-slate-500">这组闪卡的数据格式暂不支持新版界面。</p>;

  const optionStyle = "rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:border-indigo-300";

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm text-slate-600">{ratedCount} / {cards.length} 张已标记</span>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={optionStyle} onClick={() => { setProgress(previous => ({ ...previous, order: shuffled(order) })); setFlipped(false); }}>随机排序</button>
          <button type="button" className={optionStyle} onClick={() => { setProgress(previous => ({ ...previous, order: cards.map((_, index) => index), current: 0 })); setFilter("all"); setFlipped(false); }}>恢复顺序</button>
          <button type="button" className={optionStyle} onClick={() => { navigate(0); setFilter("all"); }}>从头复习</button>
        </div>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-indigo-500" style={{ width: `${cards.length ? ratedCount / cards.length * 100 : 0}%` }} /></div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm text-slate-500" htmlFor={`flash-filter-${deckId}`}>显示</label>
        <select id={`flash-filter-${deckId}`} value={filter} onChange={event => changeFilter(event.target.value as Filter)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700">
          <option value="all">全部闪卡</option>
          <option value="review">未掌握 + 需巩固</option>
          <option value="again">未掌握</option>
          <option value="hard">需巩固</option>
          <option value="good">已掌握</option>
        </select>
        <span className="text-xs text-slate-400">当前 {visible.length} 张</span>
      </div>

      {currentCard ? (
        <>
          <button
            type="button"
            onClick={() => { setFlipped(value => !value); setShowSource(false); setShowPdf(false); }}
            className="flex min-h-[230px] w-full flex-col items-center justify-center gap-5 rounded-2xl border border-indigo-100 bg-indigo-50/50 p-6 text-center transition hover:border-indigo-300"
            aria-label={flipped ? "查看闪卡问题" : "查看闪卡答案"}
          >
            <span className="text-xs font-medium tracking-wide text-indigo-500">{flipped ? "答案" : "问题"} · 点击翻转</span>
            <span className="whitespace-pre-wrap break-words text-base font-medium leading-8 text-slate-800 sm:text-lg">{flipped ? currentCard.back : currentCard.front}</span>
            <span className="text-xs text-slate-400">{position + 1} / {visible.length}</span>
          </button>

          {flipped && (
            <div className="space-y-3">
              <div className="flex flex-wrap justify-center gap-2">
                {([
                  ["again", "未掌握"], ["hard", "需巩固"], ["good", "已掌握"],
                ] as const).map(([value, label]) => (
                  <button key={value} type="button" onClick={() => setRating(value)} className={`rounded-xl border px-4 py-2 text-sm ${progress.marks[currentIndex] === value ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-200 bg-white text-slate-700 hover:border-indigo-300"}`}>{label}</button>
                ))}
              </div>
              {(currentCard.source || pdfSessionId) && (
                <div className="rounded-xl border border-slate-100 p-3">
                  <button type="button" onClick={() => { setShowSource(value => !value); setShowPdf(false); }} className="text-sm text-indigo-600 hover:underline">{showSource ? "收起原文依据" : "查看原文依据"}</button>
                  {showSource && (
                    <div className="mt-3 space-y-3">
                      {currentCard.source && <p className="whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-3 text-sm leading-6 text-slate-600">{currentCard.source}</p>}
                      {pdfSessionId && (
                        <>
                          <button type="button" onClick={() => setShowPdf(value => !value)} className="text-sm text-indigo-600 hover:underline">{showPdf ? "关闭 PDF 原页" : "查看 PDF 原页"}</button>
                          {showPdf && <PdfEvidenceViewer sessionId={pdfSessionId} source={currentCard.source} expectedPdfName={expectedPdfName} />}
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="flex items-center justify-between gap-3">
            <button type="button" className={optionStyle} disabled={position === 0} onClick={() => navigate(visible[position - 1])}>上一张</button>
            <span className="text-xs text-slate-400">{position + 1} / {visible.length}</span>
            <button type="button" className={optionStyle} disabled={position >= visible.length - 1} onClick={() => navigate(visible[position + 1])}>下一张</button>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm text-slate-500">
            <label htmlFor={`flash-jump-${deckId}`}>跳转到</label>
            <select id={`flash-jump-${deckId}`} value={position} onChange={event => navigate(visible[Number(event.target.value)])} className="rounded-lg border border-slate-200 px-2 py-1">
              {visible.map((index, i) => <option value={i} key={index}>第 {i + 1} 张</option>)}
            </select>
          </div>
        </>
      ) : <p className="rounded-xl bg-slate-50 p-5 text-sm text-slate-500">当前筛选没有闪卡。你可以切换到「全部闪卡」。</p>}
      {storageError && <p className="text-xs text-amber-700">浏览器未能保存闪卡进度，请检查存储权限。</p>}
    </section>
  );
}
