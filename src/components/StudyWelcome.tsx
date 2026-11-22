
"use client";

type Props = {
  onUpload: () => void;
  onStartTyping: () => void;
};

const features = [
  {
    icon: "◈",
    name: "智能闪卡",
    description: "将复杂知识整理成易于记忆的卡片",
  },
  {
    icon: "✓",
    name: "互动测验",
    description: "练习、纠错，持续巩固薄弱知识",
  },
  {
    icon: "◎",
    name: "知识图谱",
    description: "可视化概念之间的逻辑联系",
  },
  {
    icon: "✦",
    name: "核心词速览",
    description: "快速掌握材料中的关键概念",
  },
];

export default function StudyWelcome({
  onUpload,
  onStartTyping,
}: Props) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col items-center px-2 py-8 text-center sm:py-14">
      <div className="flex h-16 w-16 items-center justify-center rounded-[22px] bg-gradient-to-br from-indigo-500 to-violet-600 text-3xl font-bold text-white shadow-xl shadow-indigo-100">
        S
      </div>

      <p className="mt-7 text-xs font-semibold tracking-[0.2em] text-indigo-500">
        YOUR AI LEARNING COMPANION
      </p>

      <h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-800 sm:text-4xl">
        What will you learn today?
      </h1>

      <p className="mt-4 max-w-md text-sm leading-7 text-slate-500">
        上传课程资料或粘贴学习笔记，
        让 StudyForge 为你创建个性化的互动复习体验。
      </p>

      <div className="mt-9 grid w-full gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={onUpload}
          className="group flex flex-col items-start rounded-2xl border border-slate-200 bg-white p-5 text-left transition hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-lg hover:shadow-indigo-50"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-xl text-slate-700">
            ↑
          </span>

          <span className="mt-4 text-base font-semibold text-slate-800">
            上传学习资料
          </span>

          <span className="mt-2 text-xs leading-6 text-slate-500">
            支持 PDF、DOCX、TXT 文件
          </span>

          <span className="mt-4 text-xs font-semibold text-indigo-600">
            选择文件 →
          </span>
        </button>

        <button
          type="button"
          onClick={onStartTyping}
          className="group flex flex-col items-start rounded-2xl border border-slate-200 bg-white p-5 text-left transition hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-lg hover:shadow-indigo-50"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-xl text-slate-700">
            ✎
          </span>

          <span className="mt-4 text-base font-semibold text-slate-800">
            粘贴学习笔记
          </span>

          <span className="mt-2 text-xs leading-6 text-slate-500">
            将课程内容直接输入聊天框
          </span>

          <span className="mt-4 text-xs font-semibold text-indigo-600">
            开始输入 →
          </span>
        </button>
      </div>

      <div className="mt-12 w-full">
        <p className="mb-4 text-xs font-medium text-slate-400">
          FOUR WAYS TO STUDY SMARTER
        </p>

        <div className="grid grid-cols-2 gap-3">
          {features.map(feature => (
            <div
              key={feature.name}
              className="rounded-2xl border border-slate-100 bg-white p-4 text-left shadow-sm"
            >
              <div className="text-xl text-indigo-500">
                {feature.icon}
              </div>

              <h3 className="mt-3 text-sm font-semibold text-slate-800">
                {feature.name}
              </h3>

              <p className="mt-1 text-xs leading-5 text-slate-500">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </div>

      <p className="mt-10 text-[11px] text-slate-400">
        Powered by AI · Grounded in your study materials
      </p>
    </div>
  );
}
