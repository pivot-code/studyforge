"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getPdfForSession, savePdfForSession, type StoredPdf } from "@/lib/pdfEvidenceStore";

type Props = {
  sessionId: string;
  source: string;
  expectedPdfName?: string;
};

function normalized(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[\s\p{P}\p{Z}]+/gu, "");
}

export default function PdfEvidenceViewer({ sessionId, source, expectedPdfName }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const documentRef = useRef<import("pdfjs-dist").PDFDocumentProxy | null>(null);
  const renderRef = useRef<import("pdfjs-dist").RenderTask | null>(null);
  const [stored, setStored] = useState<StoredPdf | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [status, setStatus] = useState("正在查找已保存的 PDF...");
  const [error, setError] = useState("");
  const [matchNote, setMatchNote] = useState("");
  const [linking, setLinking] = useState(false);
  const [loadingPdf, setLoadingPdf] = useState(false);

  const loadRecord = useCallback(async () => {
    try {
      const record = await getPdfForSession(sessionId);
      setStored(record ?? null);
      setStatus(record ? "" : "这个会话尚未保存原始 PDF，请重新关联课件文件。");
    } catch {
      setError("无法读取浏览器里的 PDF 记录，请检查存储权限。");
    }
  }, [sessionId]);

  useEffect(() => { void loadRecord(); }, [loadRecord]);

  useEffect(() => {
    if (!stored) return;
    let cancelled = false;
    let task: ReturnType<typeof import("pdfjs-dist")["getDocument"]> | null = null;
    setLoadingPdf(true);
    setError("");
    setMatchNote("");
    setPage(1);
    setTotalPages(0);
    setStatus("正在打开 PDF...");

    async function openPdf() {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        const bytes = new Uint8Array(await stored!.blob.arrayBuffer());
        if (cancelled) return;
        task = pdfjs.getDocument({ data: bytes });
        const doc = await task.promise;
        if (cancelled) return;
        documentRef.current = doc;
        setTotalPages(doc.numPages);
        setStatus("");

        // 仅当提取文本能够完整匹配摘录时自动定位页码，绝不猜测公式位置。
        const needle = normalized(source);
        if (needle.length < 8) {
          setMatchNote("摘录过短，无法可靠定位。请手动选择页面。");
          return;
        }
        setStatus("正在匹配原文页码...");
        let matched: number | null = null;
        for (let number = 1; number <= doc.numPages && !cancelled; number++) {
          const pdfPage = await doc.getPage(number);
          const content = await pdfPage.getTextContent();
          const text = content.items.map(item => "str" in item ? item.str : "").join(" ");
          if (normalized(text).includes(needle)) {
            matched = number;
            break;
          }
        }
        if (cancelled) return;
        if (matched !== null) {
          setPage(matched);
          setMatchNote(`已根据原文文本匹配到第 ${matched} 页。请核对页面内容。`);
        } else {
          setMatchNote("无法可靠自动定位引用页码。当前显示第 1 页，请用页码导航查找；系统没有推测公式位置。");
        }
      } catch (caught) {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "PDF 打开失败");
      } finally {
        if (!cancelled) {
          setLoadingPdf(false);
          setStatus("");
        }
      }
    }
    void openPdf();
    return () => {
      cancelled = true;
      renderRef.current?.cancel();
      documentRef.current = null;
      void task?.destroy();
    };
  }, [stored, source]);

  useEffect(() => {
    if (!totalPages || !documentRef.current || !canvasRef.current) return;
    let cancelled = false;
    const doc = documentRef.current;
    const canvas = canvasRef.current;
    const taskPrevious = renderRef.current;
    taskPrevious?.cancel();
    let currentTask: import("pdfjs-dist").RenderTask | null = null;

    async function draw() {
      try {
        // 等前一个渲染任务终止，再复用同一 canvas。
        try { await taskPrevious?.promise; } catch { /* 渲染取消 */ }
        if (cancelled) return;
        const pdfPage = await doc.getPage(page);
        if (cancelled) return;
        const base = pdfPage.getViewport({ scale: 1 });
        const width = Math.max(260, (areaRef.current?.clientWidth ?? 680) - 24);
        const cssScale = Math.min(2.5, (width / base.width) * zoom);
        const viewport = pdfPage.getViewport({ scale: cssScale });
        const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
        canvas.width = Math.ceil(viewport.width * dpr);
        canvas.height = Math.ceil(viewport.height * dpr);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("无法创建 PDF 画布");
        context.setTransform(1, 0, 0, 1, 0, 0);
        currentTask = pdfPage.render({ canvas, canvasContext: context, viewport, transform: [dpr, 0, 0, dpr, 0, 0] });
        renderRef.current = currentTask;
        await currentTask.promise;
      } catch (caught) {
        if (!cancelled && !(caught instanceof Error && caught.name === "RenderingCancelledException")) {
          setError("PDF 页面渲染失败，请尝试切换页码。");
        }
      }
    }
    void draw();
    return () => { cancelled = true; currentTask?.cancel(); };
  }, [page, totalPages, zoom]);

  async function relink(file?: File) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setError("请选择 PDF 文件。");
      return;
    }
    if (expectedPdfName && file.name !== expectedPdfName) {
      setError(`文件名与会话原始课件不一致（需要 ${expectedPdfName}）。请选取原始文件。`);
      return;
    }
    setLinking(true);
    setError("");
    try {
      await savePdfForSession(sessionId, file);
      await loadRecord();
    } catch {
      setError("保存原始 PDF 失败，可能是浏览器存储空间不足。");
    } finally {
      setLinking(false);
    }
  }

  return (
    <div className="mt-3 rounded-xl border border-indigo-100 bg-white p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-slate-800">PDF 原文页面</p>
          <p className="mt-1 break-all text-xs text-slate-500">{stored?.filename ?? expectedPdfName ?? "未关联原始 PDF"}</p>
        </div>
        <label className="cursor-pointer rounded-lg border border-slate-200 px-3 py-2 text-xs text-indigo-700 hover:bg-indigo-50">
          {linking ? "正在保存…" : stored ? "重新关联 PDF" : "选择原始 PDF"}
          <input type="file" accept=".pdf,application/pdf" className="hidden" disabled={linking} onChange={e => {
            const file = e.target.files?.[0];
            e.target.value = "";
            void relink(file);
          }} />
        </label>
      </div>
      {status && <p className="mt-3 text-xs leading-6 text-slate-500">{status}</p>}
      {error && <p className="mt-3 text-xs leading-6 text-rose-700" role="alert">{error}</p>}
      {stored && totalPages > 0 && (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="rounded-lg border px-3 py-1.5 text-xs disabled:opacity-40">上一页</button>
            <label className="text-xs text-slate-600">第 <input type="number" min={1} max={totalPages} value={page} onChange={e => {
              const n = Number(e.target.value);
              if (Number.isInteger(n) && n >= 1 && n <= totalPages) setPage(n);
            }} className="w-14 rounded-md border px-1 py-1 text-center" /> / {totalPages} 页</label>
            <button type="button" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} className="rounded-lg border px-3 py-1.5 text-xs disabled:opacity-40">下一页</button>
            <div className="ml-auto flex gap-2">
              <button type="button" onClick={() => setZoom(z => Math.max(0.6, +(z - 0.2).toFixed(1)))} className="rounded-lg border px-3 py-1.5 text-xs">−</button>
              <button type="button" onClick={() => setZoom(z => Math.min(2.4, +(z + 0.2).toFixed(1)))} className="rounded-lg border px-3 py-1.5 text-xs">＋</button>
            </div>
          </div>
          {matchNote && <p className="mt-2 text-xs leading-5 text-amber-700">{matchNote}</p>}
        </>
      )}
      <div ref={areaRef} className="mt-3 max-h-[650px] overflow-auto rounded-xl bg-slate-100 p-3">
        <canvas ref={canvasRef} className="mx-auto max-w-none bg-white shadow-sm" aria-label="原始 PDF 页面截图" />
      </div>
      {loadingPdf && <p className="mt-2 text-xs text-slate-500">正在读取原文页面…</p>}
      <p className="mt-3 text-xs leading-5 text-slate-500">页面来自原始 PDF。文字提取出错时，请以页面图像为准；页码匹配失败时需手动定位。</p>
    </div>
  );
}
