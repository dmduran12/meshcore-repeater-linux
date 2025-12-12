'use client';

import { memo } from 'react';

interface TooltipPayload {
  name: string;
  value: number;
  color: string;
  dataKey?: string;
  payload?: Record<string, unknown>;
}

interface ChartTooltipProps {
  active?: boolean;
  payload?: TooltipPayload[];
  label?: string;
  /** Format function for values */
  formatValue?: (value: number, name: string) => string;
  /** Custom label from payload */
  labelKey?: string;
}

/**
 * Reusable tooltip component for Recharts
 * Matches the glass-card design system
 */
function ChartTooltipComponent({
  active,
  payload,
  label,
  formatValue,
  labelKey,
}: ChartTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;

  // Get label from payload if labelKey specified
  const displayLabel = labelKey && payload[0]?.payload
    ? (payload[0].payload[labelKey] as string)
    : label;

  return (
    <div className="bg-black/90 backdrop-blur-sm border border-white/10 rounded-lg px-4 py-3 shadow-xl">
      {displayLabel && (
        <p className="type-data-xs text-white/50 mb-2">{displayLabel}</p>
      )}
      <div className="space-y-1.5">
        {payload.map((entry, i) => (
          <div key={i} className="flex items-center gap-3">
            <span
              className="w-2 h-2 rounded-full flex-shrink-0"
              style={{ backgroundColor: entry.color }}
            />
            <span className="type-body-sm text-white/70 capitalize min-w-[60px]">
              {entry.name}
            </span>
            <span className="type-data-sm text-white tabular-nums">
              {formatValue
                ? formatValue(entry.value, entry.name)
                : entry.value.toLocaleString()}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export const ChartTooltip = memo(ChartTooltipComponent);

/**
 * Simple single-value tooltip for hero charts
 */
interface SimpleTooltipPayload {
  value: number;
  payload: Record<string, unknown>;
}

interface SimpleTooltipProps {
  active?: boolean;
  payload?: SimpleTooltipPayload[];
  color: string;
  labelKey: string;
  unit?: string;
}

function SimpleTooltipComponent({
  active,
  payload,
  color,
  labelKey,
  unit = '',
}: SimpleTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;

  const data = payload[0];
  const label = data?.payload?.[labelKey] as string;

  return (
    <div className="bg-black/90 backdrop-blur-sm border border-white/10 rounded-lg px-3 py-2 shadow-xl">
      <p className="type-data-xs text-white/50 mb-1">{label}</p>
      <div className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
        <span className="type-data-sm text-white tabular-nums">
          {data?.value?.toLocaleString()}{unit}
        </span>
      </div>
    </div>
  );
}

export const SimpleTooltip = memo(SimpleTooltipComponent);

/**
 * Custom legend component for multi-series charts
 */
interface LegendPayload {
  value: string;
  color: string;
  dataKey?: string;
}

interface ChartLegendProps {
  payload?: LegendPayload[];
}

function ChartLegendComponent({ payload }: ChartLegendProps) {
  if (!payload || payload.length === 0) return null;

  return (
    <div className="flex items-center justify-center gap-6 mt-4 pt-4 border-t border-white/5">
      {payload.map((entry, i) => (
        <div key={i} className="flex items-center gap-2">
          <span
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: entry.color }}
          />
          <span className="type-body-sm text-white/60 capitalize">
            {entry.value}
          </span>
        </div>
      ))}
    </div>
  );
}

export const ChartLegend = memo(ChartLegendComponent);
