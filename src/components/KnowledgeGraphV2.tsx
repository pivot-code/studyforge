
"use client";

import { useEffect, useRef, useState } from "react";
import type { EChartsType } from "echarts";

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

type Props = {
  nodes: GraphNode[];
  links: GraphLink[];
};

type Selection =
  | { kind: "node"; item: GraphNode }
  | { kind: "edge"; item: GraphLink }
  | null;

const palette = {
  high: "#4f46e5",
  medium: "#818cf8",
  low: "#b4bdf9",
};

function nodeColor(weight: number) {
  if (weight >= 4) return palette.high;
  if (weight >= 3) return palette.medium;
  return palette.low;
}

export default function KnowledgeGraphV2({
  nodes,
  links,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<EChartsType | null>(null);

  const [selected, setSelected] = useState<Selection>(null);
  const [showSource, setShowSource] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [chartError, setChartError] = useState("");

  // Keep the last known, rendered chart size; avoid unnecessary initial resizes.
  const chartSizeRef = useRef({ width: 0, height: 0 });

  function resizeChart() {
    const chart = chartRef.current;
    const element = containerRef.current;
    if (!chart || chart.isDisposed() || !element) return;

    const width = Math.round(element.clientWidth);
    const height = Math.round(element.clientHeight);
    if (width <= 0 || height <= 0) return;

    const previous = chartSizeRef.current;
    if (previous.width === width && previous.height === height) return;

    try {
      chart.resize({ width, height });
      chartSizeRef.current = { width, height };
    } catch (error) {
      // Some ECharts graph layouts may fail during a concurrent resize/update.
      // Stop this resize cycle without repeatedly throwing from ResizeObserver.
      console.error("知识图谱调整尺寸失败", error);
      setChartError("知识图谱显示异常，请尝试退出大图或重新生成图谱。");
    }
  }

  useEffect(() => {
    let disposed = false;
    let instance: EChartsType | null = null;
    let observer: ResizeObserver | null = null;
    let resizeFrame = 0;

    const scheduleResize = () => {
      if (disposed || resizeFrame) return;
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = 0;
        if (!disposed) resizeChart();
      });
    };

    async function initialize() {
      if (!containerRef.current) return;

      try {
        const echarts = await import("echarts");

        if (disposed || !containerRef.current) return;

        const element = containerRef.current;
        const width = Math.max(1, element.clientWidth);
        const height = Math.max(1, element.clientHeight);
        instance = echarts.init(element, undefined, {
          renderer: "canvas",
          width,
          height,
        });

        chartRef.current = instance;
        chartSizeRef.current = { width: Math.round(width), height: Math.round(height) };
        setChartError("");

        // Malformed AI data should never reach the ECharts force layout.
        const validNodes = nodes.filter(
          (node): node is GraphNode =>
            !!node && typeof node.id === "string" && !!node.id.trim() &&
            typeof node.name === "string" && !!node.name.trim()
        );
        const usedIds = new Set<string>();
        const uniqueNodes = validNodes.filter(node => {
          if (usedIds.has(node.id)) return false;
          usedIds.add(node.id);
          return true;
        });
        const ids = new Set(uniqueNodes.map(node => node.id));
        const validLinks = links.filter(
          (link): link is GraphLink =>
            !!link && typeof link.source === "string" &&
            typeof link.target === "string" &&
            ids.has(link.source) && ids.has(link.target) &&
            link.source !== link.target
        );

        instance.setOption({
          animation: false,
          // Force layout and repeated container resizes can conflict while animating.
          tooltip: {
            trigger: "item",
            confine: true,
            backgroundColor: "#ffffff",
            borderColor: "#e2e8f0",
            textStyle: {
              color: "#334155",
              fontSize: 12,
            },
            formatter: (params: {
              dataType?: string;
              data?: unknown;
            }) => {
              if (params.dataType === "edge") {
                const edge = params.data as GraphLink | null;
                return edge?.relation || "概念关系";
              }

              const node = params.data as { name?: string } | null;
              return node?.name || "";
            },
          },
          series: [
            {
              type: "graph",
              layout: "force",
              roam: true,
              draggable: true,
              zoom: 0.95,
              scaleLimit: {
                min: 0.35,
                max: 4,
              },

              force: {
                repulsion: uniqueNodes.length >= 10 ? 420 : 330,
                gravity: 0.08,
                edgeLength: [125, 190],
                friction: 0.55,
                layoutAnimation: false,
              },

              label: {
                show: true,
                position: "right",
                distance: 9,
                color: "#334155",
                fontSize: 12,
                fontWeight: 500,
                rotate: 0,
                formatter: (params: { name?: string }) => {
                  const name = params.name || "";
                  return name.length > 12
                    ? name.slice(0, 11) + "…"
                    : name;
                },
              },

              labelLayout: {
                hideOverlap: true,
              },

              edgeLabel: {
                show: false,
              },

              lineStyle: {
                color: "#a5b4fc",
                width: 1.6,
                opacity: 0.65,
                curveness: 0.1,
              },

              emphasis: {
                focus: "adjacency",
                scale: 1.12,
                lineStyle: {
                  width: 2.5,
                  opacity: 1,
                },
              },

              data: uniqueNodes.map(node => {
                const weight = Math.max(
                  1,
                  Math.min(5, Number(node.weight) || 3)
                );

                return {
                  id: node.id,
                  name: node.name,
                  value: weight,
                  symbol: "circle",
                  symbolSize: 20 + weight * 7,
                  itemStyle: {
                    color: nodeColor(weight),
                    borderColor: "#ffffff",
                    borderWidth: 2.5,
                    shadowBlur: 9,
                    shadowColor: "rgba(99,102,241,0.15)",
                  },
                };
              }),

              links: validLinks.map(link => ({
                source: link.source,
                target: link.target,
                relation: link.relation,
              })),
            },
          ],
        });

        instance.on(
          "click",
          (params: {
            dataType?: string;
            data?: unknown;
          }) => {
            if (params.dataType === "node") {
              const data = params.data as { id?: string } | null;
              const found = uniqueNodes.find(n => n.id === data?.id);

              if (found) {
                setSelected({ kind: "node", item: found });
                setShowSource(false);
              }
            }

            if (params.dataType === "edge") {
              const data = params.data as GraphLink | null;
              const found = validLinks.find(link =>
                link.source === data?.source &&
                link.target === data?.target
              );

              if (found) {
                setSelected({ kind: "edge", item: found });
                setShowSource(false);
              }
            }
          }
        );

        observer = new ResizeObserver(scheduleResize);
        observer.observe(element);
      } catch {
        if (!disposed) {
          setChartError("知识图谱初始化失败，请刷新页面重试。");
        }
      }
    }

    void initialize();

    return () => {
      disposed = true;
      observer?.disconnect();
      if (resizeFrame) cancelAnimationFrame(resizeFrame);
      if (instance && !instance.isDisposed()) instance.dispose();

      if (chartRef.current === instance) {
        chartRef.current = null;
        chartSizeRef.current = { width: 0, height: 0 };
      }
    };
  }, [nodes, links]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      resizeChart();
    });

    return () => cancelAnimationFrame(frame);
  }, [fullscreen]);

  if (nodes.length === 0) {
    return (
      <div className="rounded-xl bg-amber-50 p-5 text-sm text-amber-800">
        当前材料不足以生成知识图谱。
      </div>
    );
  }

  const nodeNames = new Map(nodes.map(n => [n.id, n.name]));

  function resetView() {
    chartRef.current?.dispatchAction({ type: "restore" });
    setSelected(null);
    setShowSource(false);
  }

  function zoomIn() {
    const chart = chartRef.current;
    if (!chart) return;

    const current = chart.getOption();
    const series = current.series as Array<{ zoom?: number }> | undefined;
    const zoom = series?.[0]?.zoom ?? 1;
    if (zoom >= 3.8) return;

    chart.dispatchAction({
      type: "graphRoam",
      seriesIndex: 0,
      zoom: 1.25,
      originX: chart.getWidth() / 2,
      originY: chart.getHeight() / 2,
    });

  }

  function zoomOut() {
    const chart = chartRef.current;
    if (!chart) return;

    chart.dispatchAction({
      type: "graphRoam",
      seriesIndex: 0,
      zoom: 0.8,
      originX: chart.getWidth() / 2,
      originY: chart.getHeight() / 2,
    });
  }

  return (
    <div
      className={
        fullscreen
          ? "fixed inset-0 z-50 flex flex-col overflow-y-auto bg-[#f8f9fc] p-3 sm:p-6"
          : "w-full min-w-0"
      }
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-800">
            知识关系网络
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            {nodes.length} 个概念 · {links.length} 条关系
          </p>
        </div>

        <button
          onClick={() => setFullscreen(!fullscreen)}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600 hover:bg-slate-50"
        >
          {fullscreen ? "退出大图" : "放大查看"}
        </button>
      </div>

      <div
        className={`relative min-w-0 overflow-hidden rounded-2xl border border-indigo-100 bg-gradient-to-br from-white via-[#fbfbff] to-indigo-50 ${
          fullscreen ? "min-h-[320px] flex-1" : ""
        }`}
      >
        <div
          ref={containerRef}
          className={fullscreen
            ? "h-full min-h-[320px] w-full"
            : "h-[390px] w-full sm:h-[500px]"
          }
          style={{ touchAction: "none" }}
        />

        <div className="absolute bottom-3 right-3 flex gap-1.5">
          <button
            onClick={zoomOut}
            title="缩小"
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white/95 text-lg shadow-sm hover:bg-slate-50"
          >
            −
          </button>
          <button
            onClick={zoomIn}
            title="放大"
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white/95 text-lg shadow-sm hover:bg-slate-50"
          >
            +
          </button>
          <button
            onClick={resetView}
            title="重置"
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white/95 text-sm shadow-sm hover:bg-slate-50"
          >
            ↺
          </button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-full bg-[#4f46e5]" />
            重要
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-full bg-[#818cf8]" />
            一般
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-full bg-[#b4bdf9]" />
            补充
          </span>
        </div>
        <span className="text-xs text-slate-400">
          拖动节点 · 点击查看详情
        </span>
      </div>

      {chartError && (
        <p className="mt-3 text-sm text-red-600">{chartError}</p>
      )}

      {selected && (
        <div className="mt-5 rounded-2xl border border-indigo-100 bg-white p-5 shadow-sm">
          {selected.kind === "node" ? (
            <>
              <p className="text-[11px] font-semibold tracking-wide text-indigo-500">
                KNOWLEDGE POINT
              </p>
              <h4 className="mt-2 break-words text-base font-semibold">
                {selected.item.name}
              </h4>
              <p className="mt-2 text-xs text-slate-500">
                重要程度：{selected.item.weight} / 5
              </p>

              <button
                onClick={() => setShowSource(!showSource)}
                className="mt-4 text-xs font-medium text-indigo-600 hover:underline"
              >
                {showSource ? "收起原文依据 ↑" : "查看原文依据 ↓"}
              </button>

              {showSource && (
                <blockquote className="mt-3 whitespace-pre-wrap break-words rounded-xl bg-slate-50 p-3 text-xs leading-6 text-slate-600">
                  {selected.item.source}
                </blockquote>
              )}
            </>
          ) : (
            <>
              <p className="text-[11px] font-semibold tracking-wide text-indigo-500">
                CONCEPT RELATION
              </p>
              <h4 className="mt-2 break-words text-sm font-semibold">
                {nodeNames.get(selected.item.source) ?? selected.item.source}
                {" → "}
                {nodeNames.get(selected.item.target) ?? selected.item.target}
              </h4>
              <p className="mt-3 text-sm leading-7 text-slate-600">
                {selected.item.relation}
              </p>
              <p className="mt-2 text-xs text-slate-400">
                关系描述由 AI 从学习材料中提取，尚未逐条核验。
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
