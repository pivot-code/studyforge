
"use client";

import { useRef, useState } from "react";
import KnowledgeGraphV2 from "./KnowledgeGraphV2";
import EnhancedQuiz from "./EnhancedQuiz";

export type Mode =
  | "flashcards"
  | "quiz"
  | "graph"
  | "keywords";

type Card = {
  front: string;
  back: string;
  source: string;
};

type GraphNode = {
  id: string;
  name: string;
  weight: number;
  source: string;
};

type GraphLink = {
  source: string;
  target: string;
  relation: string;
};

type Keyword = {
  term: string;
  definition: string;
  source: string;
};

type StudyData = {
  title?: string;
  cards?: Card[];
  questions?: unknown[];
  nodes?: GraphNode[];
  links?: GraphLink[];
  keywords?: Keyword[];
};

type Props = {
  mode: Mode;
  data: unknown;
};

const buttonStyle =
  "rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium transition hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-40";

function Source({ text }: { text?: string }) {
  const [open, setOpen] = useState(false);

  if (!text) return null;

  return (
    <div className="mt-4 border-t border-slate-100 pt-3">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="text-xs font-medium text-indigo-600 transition hover:text-indigo-800"
      >
        {open ? "收起原文依据 ↑" : "查看原文依据 ↓"}
      </button>

      {open && (
        <blockquote className="mt-3 whitespace-pre-wrap break-words rounded-xl bg-slate-50 p-4 text-xs leading-6 text-slate-600">
          {text}
        </blockquote>
      )}
    </div>
  );
}

function Empty() {
  return (
    <div className="rounded-xl border border-amber-100 bg-amber-50 p-5 text-sm leading-7 text-amber-800">
      当前材料不足以生成这种复习内容，请补充更详细的学习资料。
    </div>
  );
}

function Flashcards({ cards }: { cards: Card[] }) {
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const touchStart = useRef<number | null>(null);

  if (!cards.length) return <Empty />;

  const card = cards[index];

  function changeCard(next: number) {
    if (next < 0 || next >= cards.length) return;

    setIndex(next);
    setFlipped(false);
  }

  function handleTouchStart(
    event: React.TouchEvent<HTMLDivElement>
  ) {
    touchStart.current = event.touches[0].clientX;
  }

  function handleTouchEnd(
    event: React.TouchEvent<HTMLDivElement>
  ) {
    if (touchStart.current === null) return;

    const distance =
      event.changedTouches[0].clientX - touchStart.current;

    touchStart.current = null;

    if (distance < -65) {
      changeCard(index + 1);
    }

    if (distance > 65) {
      changeCard(index - 1);
    }
  }

  return (
    <div className="w-full min-w-0">
      <div className="mb-4 flex items-center justify-between gap-3">
        <span className="text-xs text-slate-500">
          点击卡片翻面
        </span>

        <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-600">
          {index + 1} / {cards.length}
        </span>
      </div>

      <div
        className="w-full touch-pan-y"
        style={{ perspective: "1100px" }}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        <button
          type="button"
          onClick={() => setFlipped(!flipped)}
          aria-label={
            flipped ? "翻回问题" : "翻面查看答案"
          }
          className="block h-64 w-full cursor-pointer text-left sm:h-72"
        >
          <div
            className="relative h-full w-full transition-transform duration-500"
            style={{
              transformStyle: "preserve-3d",
              transform: flipped
                ? "rotateY(180deg)"
                : "rotateY(0deg)",
            }}
          >
            <div
              className="absolute inset-0 flex flex-col items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 via-indigo-600 to-violet-600 p-6 text-center text-white shadow-lg shadow-indigo-100"
              style={{
                backfaceVisibility: "hidden",
              }}
            >
              <span className="absolute left-5 top-4 text-[11px] font-semibold tracking-[0.18em] text-indigo-100">
                QUESTION
              </span>

              <p className="max-h-44 overflow-y-auto break-words text-lg font-medium leading-relaxed">
                {card.front}
              </p>

              <span className="absolute bottom-4 text-xs text-indigo-100">
                点击查看答案
              </span>
            </div>

            <div
              className="absolute inset-0 flex flex-col items-center justify-center rounded-2xl border border-indigo-200 bg-gradient-to-br from-white to-indigo-50 p-6 text-center shadow-lg shadow-indigo-100"
              style={{
                backfaceVisibility: "hidden",
                transform: "rotateY(180deg)",
              }}
            >
              <span className="absolute left-5 top-4 text-[11px] font-semibold tracking-[0.18em] text-indigo-500">
                ANSWER
              </span>

              <p className="max-h-44 overflow-y-auto break-words text-base font-medium leading-relaxed text-slate-800">
                {card.back}
              </p>

              <span className="absolute bottom-4 text-xs text-indigo-500">
                点击返回问题
              </span>
            </div>
          </div>
        </button>
      </div>

      <div className="mt-5 flex items-center justify-between gap-2">
        <button
          type="button"
          className={buttonStyle}
          disabled={index === 0}
          onClick={() => changeCard(index - 1)}
        >
          ← 上一张
        </button>

        <div className="flex max-w-[35%] flex-wrap items-center justify-center gap-1.5">
          {cards.map((_, i) => (
            <button
              type="button"
              key={i}
              aria-label={`切换至第${i + 1}张`}
              onClick={() => changeCard(i)}
              className={`h-2 rounded-full transition-all ${
                i === index
                  ? "w-6 bg-indigo-600"
                  : "w-2 bg-slate-200 hover:bg-indigo-300"
              }`}
            />
          ))}
        </div>

        <button
          type="button"
          className={buttonStyle}
          disabled={index === cards.length - 1}
          onClick={() => changeCard(index + 1)}
        >
          下一张 →
        </button>
      </div>

      <Source key={index} text={card.source} />
    </div>
  );
}

function Keywords({
  keywords,
}: {
  keywords: Keyword[];
}) {
  const [selected, setSelected] = useState<number | null>(
    null
  );

  if (!keywords.length) return <Empty />;

  return (
    <div className="w-full min-w-0">
      <p className="mb-4 text-xs leading-6 text-slate-500">
        点击下方核心词，查看其定义与原文依据。
      </p>

      <div className="flex flex-wrap gap-2.5">
        {keywords.map((item, i) => (
          <button
            type="button"
            key={`${item.term}-${i}`}
            onClick={() =>
              setSelected(selected === i ? null : i)
            }
            className={`rounded-xl border px-4 py-3 text-sm font-medium transition-all ${
              selected === i
                ? "border-indigo-500 bg-indigo-600 text-white shadow-md shadow-indigo-100"
                : "border-indigo-100 bg-indigo-50 text-indigo-700 hover:border-indigo-300 hover:bg-indigo-100"
            }`}
          >
            {item.term}
          </button>
        ))}
      </div>

      {selected !== null && (
        <div className="mt-6 rounded-2xl border border-indigo-100 bg-gradient-to-br from-white to-indigo-50/50 p-5">
          <p className="text-[11px] font-semibold tracking-wider text-indigo-500">
            KEY CONCEPT
          </p>

          <h3 className="mt-2 break-words text-lg font-semibold text-slate-800">
            {keywords[selected].term}
          </h3>

          <p className="mt-4 whitespace-pre-wrap break-words text-sm leading-7 text-slate-700">
            {keywords[selected].definition}
          </p>

          <Source
            key={selected}
            text={keywords[selected].source}
          />
        </div>
      )}

      <div className="mt-5 border-t border-slate-100 pt-3">
        <span className="text-xs text-slate-400">
          共提取 {keywords.length} 个核心知识点
        </span>
      </div>
    </div>
  );
}

export default function StudyWidgets({
  mode,
  data,
}: Props) {
  if (
    !data ||
    typeof data !== "object" ||
    Array.isArray(data)
  ) {
    return <Empty />;
  }

  const result = data as StudyData;

  const cards = Array.isArray(result.cards)
    ? result.cards
    : [];

  const nodes = Array.isArray(result.nodes)
    ? result.nodes
    : [];

  const links = Array.isArray(result.links)
    ? result.links
    : [];

  const keywords = Array.isArray(result.keywords)
    ? result.keywords
    : [];

  return (
    <div className="w-full min-w-0">
      {result.title && (
        <h3 className="mb-5 break-words text-lg font-bold leading-7 text-slate-800">
          {result.title}
        </h3>
      )}

      {mode === "flashcards" && (
        <Flashcards cards={cards} />
      )}

      {mode === "quiz" && (
        <EnhancedQuiz data={result} />
      )}

      {mode === "graph" && (
        <KnowledgeGraphV2
          nodes={nodes}
          links={links}
        />
      )}

      {mode === "keywords" && (
        <Keywords keywords={keywords} />
      )}
    </div>
  );
}
