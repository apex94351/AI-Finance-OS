"use client";

import { useMemo, useState } from "react";
import type { DashboardCashflowSeries } from "@/services/dashboard";

type SeriesKey = "inflows" | "outflows" | "balance";

interface ChartPoint {
  x: number;
  y: number;
  index: number;
}

interface ChartTarget {
  series: SeriesKey | null;
  index: number;
  pointerX: number;
  tooltipLeft: number;
  tooltipTop: number;
}

const width = 720;
const height = 248;
const padding = { top: 18, right: 18, bottom: 38, left: 64 };
const plotWidth = width - padding.left - padding.right;
const plotHeight = height - padding.top - padding.bottom;
const seriesCopy: Record<SeriesKey, { label: string; className: string }> = {
  inflows: { label: "Entrées clients", className: "inflows" },
  outflows: { label: "Dépenses payées", className: "outflows" },
  balance: { label: "Solde calculé", className: "balance" },
};

function formatCurrency(value: number, currency: string) {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency }).format(value);
}

function formatAxis(value: number, currency: string) {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency,
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

function formatDate(value: string, interval: DashboardCashflowSeries["interval"]) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  return new Intl.DateTimeFormat("fr-FR", interval === "month"
    ? { month: "short", year: "2-digit", timeZone: "UTC" }
    : { day: "2-digit", month: "2-digit", timeZone: "UTC" }).format(date);
}

function formatFullDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  return new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function createCurve(values: Array<number | null>, minimum: number, maximum: number) {
  const points: Array<ChartPoint | null> = values.map((value, index) => value === null ? null : ({
    x: padding.left + (values.length <= 1 ? plotWidth / 2 : plotWidth * index / (values.length - 1)),
    y: padding.top + plotHeight * (1 - (value - minimum) / (maximum - minimum || 1)),
    index,
  }));
  const groups: ChartPoint[][] = [];
  let currentGroup: ChartPoint[] | null = null;
  for (const point of points) {
    if (!point) {
      currentGroup = null;
    } else if (currentGroup) {
      currentGroup.push(point);
    } else {
      currentGroup = [point];
      groups.push(currentGroup);
    }
  }
  const sampled: ChartPoint[] = [];
  const paths = groups.map((group) => {
    if (group.length === 1) {
      sampled.push(group[0]!);
      return "";
    }
    let path = `M ${group[0]!.x} ${group[0]!.y}`;
    const tangents = group.map((point, index) => {
      if (index === 0) return (group[1]!.y - point.y) / (group[1]!.x - point.x);
      if (index === group.length - 1) {
        return (point.y - group[index - 1]!.y) / (point.x - group[index - 1]!.x);
      }
      const previous = group[index - 1]!;
      const next = group[index + 1]!;
      const previousSlope = (point.y - previous.y) / (point.x - previous.x);
      const nextSlope = (next.y - point.y) / (next.x - point.x);
      if (previousSlope * nextSlope <= 0) return 0;
      return 2 * previousSlope * nextSlope / (previousSlope + nextSlope);
    });
    for (let index = 0; index < group.length - 1; index += 1) {
      const from = group[index]!;
      const to = group[index + 1]!;
      const segmentWidth = to.x - from.x;
      const firstControl = {
        x: from.x + segmentWidth / 3,
        y: from.y + tangents[index]! * segmentWidth / 3,
      };
      const secondControl = {
        x: to.x - segmentWidth / 3,
        y: to.y - tangents[index + 1]! * segmentWidth / 3,
      };
      const segmentMinimum = Math.min(from.y, to.y);
      const segmentMaximum = Math.max(from.y, to.y);
      firstControl.y = Math.min(segmentMaximum, Math.max(segmentMinimum, firstControl.y));
      secondControl.y = Math.min(segmentMaximum, Math.max(segmentMinimum, secondControl.y));
      path += ` C ${firstControl.x} ${firstControl.y}, ${secondControl.x} ${secondControl.y}, ${to.x} ${to.y}`;
      for (let step = index === 0 ? 0 : 1; step <= 12; step += 1) {
        const t = step / 12;
        const inverse = 1 - t;
        sampled.push({
          x: inverse ** 3 * from.x + 3 * inverse ** 2 * t * firstControl.x
            + 3 * inverse * t ** 2 * secondControl.x + t ** 3 * to.x,
          y: inverse ** 3 * from.y + 3 * inverse ** 2 * t * firstControl.y
            + 3 * inverse * t ** 2 * secondControl.y + t ** 3 * to.y,
          index: from.index + (to.index - from.index) * t,
        });
      }
    }
    return path;
  });
  return { points, paths, sampled };
}

function closestPointOnSegment(x: number, y: number, from: ChartPoint, to: ChartPoint) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0
    ? 0
    : Math.min(1, Math.max(0, ((x - from.x) * dx + (y - from.y) * dy) / lengthSquared));
  return {
    distance: Math.hypot(x - from.x - dx * t, y - from.y - dy * t),
    index: from.index + (to.index - from.index) * t,
  };
}

export function DashboardCashflowChart({
  series,
  hiddenSeries,
}: {
  series: DashboardCashflowSeries;
  hiddenSeries: ReadonlySet<SeriesKey>;
}) {
  const [target, setTarget] = useState<ChartTarget | null>(null);
  const supportsPointerEvents = typeof window !== "undefined" && "PointerEvent" in window;
  const availableKeys = (["inflows", "outflows", "balance"] as const).filter((key) => (
    key !== "balance" || series.buckets.some((bucket) => bucket.balance !== null && bucket.balance !== undefined)
  ));
  const enabledKeys = availableKeys.filter((key) => !hiddenSeries.has(key));
  const visibleValues = enabledKeys.flatMap((key) => series.buckets.flatMap((bucket) => {
    const value = bucket[key];
    return value === null ? [] : [value];
  }));
  const maximum = Math.max(1, ...visibleValues);
  const minimum = Math.min(0, ...visibleValues);
  const curves = useMemo(() => ({
    inflows: createCurve(series.buckets.map(({ inflows }) => inflows), minimum, maximum),
    outflows: createCurve(series.buckets.map(({ outflows }) => outflows), minimum, maximum),
    balance: createCurve(series.buckets.map(({ balance }) => balance ?? null), minimum, maximum),
  }), [maximum, minimum, series.buckets]);
  const visibleTarget = target?.series && hiddenSeries.has(target.series) ? null : target;

  function setPointTarget(svg: SVGSVGElement, key: SeriesKey | null, index: number, x: number, y: number) {
    const bounds = svg.getBoundingClientRect();
    const pixelX = x / width * bounds.width;
    const pixelY = y / height * bounds.height;
    setTarget({
      series: key,
      index,
      pointerX: x,
      tooltipLeft: Math.min(Math.max(8, pixelX), Math.max(8, bounds.width - 248)),
      tooltipTop: pixelY,
    });
  }

  function handlePointerMove(event: {
    currentTarget: SVGSVGElement;
    clientX: number;
    clientY: number;
  }) {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0 || series.buckets.length === 0) return;
    const x = (event.clientX - bounds.left) * width / bounds.width;
    const y = (event.clientY - bounds.top) * height / bounds.height;
    const candidates: Array<{ key: SeriesKey; distance: number; index: number }> = [];
    for (const key of enabledKeys) {
      const samples = curves[key].sampled;
      let closestForSeries: { key: SeriesKey; distance: number; index: number } | null = null;
      if (samples.length === 1) {
        const point = samples[0]!;
        closestForSeries = { key, distance: Math.hypot(x - point.x, y - point.y), index: point.index };
      }
      for (let index = 0; index < samples.length - 1; index += 1) {
        const nearest = closestPointOnSegment(x, y, samples[index]!, samples[index + 1]!);
        if (!closestForSeries || nearest.distance < closestForSeries.distance) {
          closestForSeries = { key, distance: nearest.distance, index: nearest.index };
        }
      }
      if (closestForSeries) candidates.push(closestForSeries);
    }
    candidates.sort((left, right) => left.distance - right.distance);
    const closest = candidates[0];
    const tied = closest ? candidates.filter((candidate) => candidate.distance - closest.distance < 0.75) : [];
    const selected = tied.length > 1
      ? tied.find((candidate) => candidate.key === visibleTarget?.series) ?? closest
      : closest;
    const activeKey = closest && closest.distance <= 24 ? selected?.key ?? null : null;
    const nearestIndex = selected?.index
      ?? ((x - padding.left) / plotWidth * Math.max(0, series.buckets.length - 1));
    const activeIndex = Math.min(series.buckets.length - 1, Math.max(0, Math.round(nearestIndex)));
    setPointTarget(event.currentTarget, activeKey, activeIndex, x, y);
  }

  const activeValue = visibleTarget?.series ? series.buckets[visibleTarget.index]?.[visibleTarget.series] ?? null : null;
  const previousValue = visibleTarget?.series && visibleTarget.index > 0
    ? series.buckets[visibleTarget.index - 1]?.[visibleTarget.series] ?? null
    : null;
  const variation = activeValue !== null && previousValue !== null ? activeValue - previousValue : null;
  const variationPercent = variation !== null && previousValue !== null && previousValue !== 0
    ? variation / previousValue * 100
    : null;

  return (
    <div className="dashboard-chart-canvas">
      <svg
        className="dashboard-cashflow-chart"
        viewBox={`0 0 ${width} ${height}`}
        role="group"
        aria-label={`Graphique interactif des flux en ${series.currency}`}
        onPointerMove={handlePointerMove}
        onPointerDown={handlePointerMove}
        onMouseMove={supportsPointerEvents ? undefined : handlePointerMove}
        onPointerLeave={() => setTarget(null)}
        onMouseLeave={supportsPointerEvents ? undefined : () => setTarget(null)}
      >
        {[0, 0.5, 1].map((fraction) => {
          const y = padding.top + plotHeight * fraction;
          const value = maximum - (maximum - minimum) * fraction;
          return (
            <g key={fraction} aria-hidden="true">
              <line x1={padding.left} x2={width - padding.right} y1={y} y2={y} className="dashboard-chart-gridline" />
              <text x={padding.left - 9} y={y + 4} textAnchor="end" className="dashboard-chart-axis">
                {formatAxis(value, series.currency)}
              </text>
            </g>
          );
        })}
        {series.buckets.map(({ date }, index) => (
          series.buckets.length < 9 || index % Math.ceil(series.buckets.length / 7) === 0 || index === series.buckets.length - 1
            ? <text
              key={date}
              x={padding.left + (series.buckets.length <= 1 ? plotWidth / 2 : plotWidth * index / (series.buckets.length - 1))}
              y={height - 11}
              textAnchor="middle"
              className="dashboard-chart-axis"
            >{formatDate(date, series.interval)}</text>
            : null
        ))}
        {visibleTarget ? (
          <line
            x1={visibleTarget.pointerX}
            x2={visibleTarget.pointerX}
            y1={padding.top}
            y2={padding.top + plotHeight}
            className="dashboard-chart-crosshair"
            aria-hidden="true"
          />
        ) : null}
        {availableKeys.map((key) => {
          const curve = curves[key];
          const descriptor = seriesCopy[key];
          const isActive = visibleTarget?.series === key;
          if (hiddenSeries.has(key)) return null;
          return (
            <g key={key} className={`dashboard-chart-line ${descriptor.className} ${isActive ? "is-active" : ""} ${visibleTarget?.series && !isActive ? "is-muted" : ""}`}>
              {curve.paths.map((path, index) => path ? <path d={path} key={index} /> : null)}
              {curve.points.map((point, index) => point ? (
                <circle
                  key={index}
                  cx={point.x}
                  cy={point.y}
                  r={8}
                  className="dashboard-chart-hit-target"
                  tabIndex={0}
                  role="button"
                  aria-label={`${descriptor.label}, ${formatFullDate(series.buckets[index]!.date)}, ${formatCurrency(series.buckets[index]![key]!, series.currency)}`}
                  onFocus={(event) => setPointTarget(event.currentTarget.ownerSVGElement!, key, index, point.x, point.y)}
                  onBlur={() => setTarget(null)}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                      event.preventDefault();
                      const nextIndex = Math.min(series.buckets.length - 1, Math.max(0, index + (event.key === "ArrowRight" ? 1 : -1)));
                      const nextPoint = curves[key].points[nextIndex];
                      if (nextPoint) setPointTarget(event.currentTarget.ownerSVGElement!, key, nextIndex, nextPoint.x, nextPoint.y);
                    } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
                      event.preventDefault();
                      const nextKey = availableKeys.find((candidate) => candidate !== key && !hiddenSeries.has(candidate));
                      const nextPoint = nextKey ? curves[nextKey].points[index] : null;
                      if (nextKey && nextPoint) {
                        setPointTarget(event.currentTarget.ownerSVGElement!, nextKey, index, nextPoint.x, nextPoint.y);
                      }
                    } else if (event.key === "Escape") {
                      setTarget(null);
                    }
                  }}
                />
              ) : null)}
            </g>
          );
        })}
      </svg>
      {visibleTarget?.series && activeValue !== null ? (
        <div
          className="dashboard-chart-tooltip"
          style={{ left: `${visibleTarget.tooltipLeft}px`, top: `${visibleTarget.tooltipTop}px` }}
          role="status"
          aria-live="polite"
        >
          <strong className={seriesCopy[visibleTarget.series].className}>{seriesCopy[visibleTarget.series].label}</strong>
          <time dateTime={series.buckets[visibleTarget.index]?.date}>{formatFullDate(series.buckets[visibleTarget.index]!.date)}</time>
          <b>{formatCurrency(activeValue, series.currency)}</b>
          {variation !== null ? (
            <small>
              Variation vs période précédente : {variation >= 0 ? "+" : "−"}{formatCurrency(Math.abs(variation), series.currency)}
              {variationPercent !== null
                ? ` (${variationPercent >= 0 ? "+" : ""}${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(variationPercent)} %)`
                : ""}
            </small>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
