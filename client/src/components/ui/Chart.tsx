'use client';

import { ReportResult } from '@/types';

/**
 * Small dependency-free charts drawn as inline SVG. Every chart reads the same
 * report shape: the first column is the label, and the first numeric column is
 * the value unless one is named explicitly.
 */

const PALETTE = [
  '#4f46e5',
  '#0891b2',
  '#7c3aed',
  '#059669',
  '#ea580c',
  '#db2777',
  '#ca8a04',
  '#475569',
];

interface ChartProps {
  report: ReportResult;
  type: string;
  height?: number;
}

function series(report: ReportResult, valueKey?: string) {
  const labelKey = report.columns[0]?.key;
  const numeric =
    report.columns.find((c) => c.key === valueKey) ??
    report.columns.find((c) => c.type === 'number' || c.type === 'money');

  return report.rows.map((row) => ({
    label: String(row[labelKey] ?? ''),
    value: Number(row[numeric?.key ?? ''] ?? 0),
  }));
}

function formatValue(n: number): string {
  if (Math.abs(n) >= 10_000_000) return `${(n / 10_000_000).toFixed(1)}Cr`;
  if (Math.abs(n) >= 100_000) return `${(n / 100_000).toFixed(1)}L`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(Math.round(n * 10) / 10);
}

function Empty({ height }: { height: number }) {
  return (
    <div
      className="flex items-center justify-center text-sm text-slate-400"
      style={{ height }}
    >
      No data yet
    </div>
  );
}

function BarChart({ report, height = 220 }: ChartProps) {
  const data = series(report);
  if (!data.length) return <Empty height={height} />;

  const max = Math.max(...data.map((d) => d.value), 1);

  return (
    <div className="space-y-2" style={{ minHeight: height }}>
      {data.slice(0, 10).map((d, i) => (
        <div key={d.label + i} className="flex items-center gap-2 text-xs">
          <span className="w-28 shrink-0 truncate text-slate-500" title={d.label}>
            {d.label}
          </span>
          <div className="h-5 flex-1 rounded bg-slate-100">
            <div
              className="h-5 rounded"
              style={{
                width: `${Math.max((d.value / max) * 100, d.value > 0 ? 2 : 0)}%`,
                background: PALETTE[i % PALETTE.length],
              }}
            />
          </div>
          <span className="w-14 shrink-0 text-right font-medium text-slate-600">
            {formatValue(d.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

function FunnelChart({ report, height = 220 }: ChartProps) {
  const data = series(report);
  if (!data.length) return <Empty height={height} />;
  const max = Math.max(...data.map((d) => d.value), 1);

  return (
    <div className="space-y-1" style={{ minHeight: height }}>
      {data.map((d, i) => (
        <div key={d.label + i} className="flex items-center gap-2 text-xs">
          <span className="w-28 shrink-0 truncate text-slate-500">{d.label}</span>
          <div className="flex-1">
            <div
              className="mx-auto h-6 rounded"
              style={{
                width: `${Math.max((d.value / max) * 100, d.value > 0 ? 4 : 1)}%`,
                background: PALETTE[i % PALETTE.length],
                opacity: 0.85,
              }}
            />
          </div>
          <span className="w-14 shrink-0 text-right font-medium text-slate-600">
            {formatValue(d.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

function DonutChart({ report, height = 220 }: ChartProps) {
  const data = series(report).filter((d) => d.value > 0);
  if (!data.length) return <Empty height={height} />;

  const total = data.reduce((sum, d) => sum + d.value, 0);
  const radius = 60;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div className="flex items-center gap-6" style={{ minHeight: height }}>
      <svg viewBox="0 0 160 160" className="h-40 w-40 shrink-0 -rotate-90">
        {data.map((d, i) => {
          const fraction = d.value / total;
          const dash = fraction * circumference;
          const circle = (
            <circle
              key={d.label + i}
              cx="80"
              cy="80"
              r={radius}
              fill="none"
              stroke={PALETTE[i % PALETTE.length]}
              strokeWidth="24"
              strokeDasharray={`${dash} ${circumference - dash}`}
              strokeDashoffset={-offset}
            />
          );
          offset += dash;
          return circle;
        })}
      </svg>
      <ul className="space-y-1 text-xs">
        {data.slice(0, 8).map((d, i) => (
          <li key={d.label + i} className="flex items-center gap-2">
            <span
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ background: PALETTE[i % PALETTE.length] }}
            />
            <span className="text-slate-600">{d.label}</span>
            <span className="font-medium text-slate-700">
              {formatValue(d.value)}
            </span>
            <span className="text-slate-400">
              {Math.round((d.value / total) * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function LineChart({ report, height = 220 }: ChartProps) {
  // A line chart plots every numeric column so trends can be compared.
  const labelKey = report.columns[0]?.key;
  const numericCols = report.columns.filter(
    (c) => c.type === 'number' || c.type === 'money',
  );
  if (!report.rows.length || !numericCols.length) return <Empty height={height} />;

  const width = 560;
  const chartHeight = 180;
  const pad = 24;
  const max = Math.max(
    ...report.rows.flatMap((r) => numericCols.map((c) => Number(r[c.key] ?? 0))),
    1,
  );
  const stepX =
    report.rows.length > 1 ? (width - pad * 2) / (report.rows.length - 1) : 0;

  return (
    <div style={{ minHeight: height }}>
      <svg viewBox={`0 0 ${width} ${chartHeight + 30}`} className="w-full">
        <line
          x1={pad}
          y1={chartHeight}
          x2={width - pad}
          y2={chartHeight}
          stroke="#e2e8f0"
        />
        {numericCols.slice(0, 5).map((col, ci) => {
          const points = report.rows
            .map((row, i) => {
              const value = Number(row[col.key] ?? 0);
              const x = pad + i * stepX;
              const y = chartHeight - (value / max) * (chartHeight - pad);
              return `${x},${y}`;
            })
            .join(' ');
          return (
            <polyline
              key={col.key}
              points={points}
              fill="none"
              stroke={PALETTE[ci % PALETTE.length]}
              strokeWidth="2"
            />
          );
        })}
        {report.rows.map((row, i) =>
          i % Math.ceil(report.rows.length / 7) === 0 ? (
            <text
              key={i}
              x={pad + i * stepX}
              y={chartHeight + 18}
              fontSize="9"
              fill="#94a3b8"
              textAnchor="middle"
            >
              {String(row[labelKey] ?? '').slice(5)}
            </text>
          ) : null,
        )}
      </svg>
      <ul className="mt-1 flex flex-wrap gap-3 text-xs">
        {numericCols.slice(0, 5).map((col, ci) => (
          <li key={col.key} className="flex items-center gap-1">
            <span
              className="inline-block h-2 w-3 rounded-sm"
              style={{ background: PALETTE[ci % PALETTE.length] }}
            />
            <span className="text-slate-500">{col.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TableChart({ report }: ChartProps) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-slate-500">
          <tr>
            {report.columns.map((c) => (
              <th key={c.key} className="whitespace-nowrap px-2 py-1 font-medium">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {report.rows.map((row, i) => (
            <tr key={i}>
              {report.columns.map((c) => (
                <td key={c.key} className="whitespace-nowrap px-2 py-1">
                  {c.type === 'money' || c.type === 'number'
                    ? formatValue(Number(row[c.key] ?? 0))
                    : String(row[c.key] ?? '')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {report.rows.length === 0 && (
        <p className="px-2 py-6 text-center text-sm text-slate-400">No data yet</p>
      )}
    </div>
  );
}

function StatChart({ report }: ChartProps) {
  const stats = report.stats ?? [];
  if (!stats.length) return <TableChart report={report} type="table" />;

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {stats.map((s) => (
        <div key={s.label} className="rounded-lg bg-slate-50 p-3">
          <p className="text-xs uppercase tracking-wide text-slate-400">
            {s.label}
          </p>
          <p className="mt-1 text-xl font-bold">
            {typeof s.value === 'number' ? formatValue(s.value) : s.value}
          </p>
        </div>
      ))}
    </div>
  );
}

export function Chart(props: ChartProps) {
  switch (props.type) {
    case 'funnel':
      return <FunnelChart {...props} />;
    case 'donut':
      return <DonutChart {...props} />;
    case 'line':
      return <LineChart {...props} />;
    case 'table':
      return <TableChart {...props} />;
    case 'stat':
      return <StatChart {...props} />;
    case 'bar':
    default:
      return <BarChart {...props} />;
  }
}
