'use client';

import { useState, memo, useMemo } from 'react';
import { getPacketTypeShortLabel } from '@/lib/constants';
import { useChartColorArray } from '@/lib/hooks/useThemeColors';

interface PacketTypeData {
  name: string;
  value: number;
}

interface PacketTypesChartProps {
  data: PacketTypeData[];
}

/**
 * Stacked bar chart for packet type distribution
 * Features: hover-linked legend, full-height bar, harmonious color palette
 */
function PacketTypesChartComponent({ data }: PacketTypesChartProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const chartColors = useChartColorArray();

  const { filtered, total } = useMemo(() => {
    const total = data.reduce((sum, e) => sum + e.value, 0);
    const sorted = [...data].sort((a, b) => b.value - a.value);
    const filtered = sorted.filter((e) => total > 0 && (e.value / total) * 100 >= 0.5);
    return { filtered, total };
  }, [data]);

  if (data.length === 0 || total === 0) {
    return (
      <div className="h-56 flex items-center justify-center text-text-muted">
        No packet type data available
      </div>
    );
  }

  return (
    <div className="h-56 flex items-stretch gap-4">
      {/* Stacked bar - full height, maximized width */}
      <div className="flex-1 rounded-lg overflow-hidden flex">
        {filtered.map((entry, i) => {
          const percent = (entry.value / total) * 100;
          return (
            <div
              key={entry.name}
              className="h-full transition-opacity duration-150 cursor-default"
              style={{
                width: `${percent}%`,
                backgroundColor: chartColors[i % chartColors.length],
                opacity: hoveredIndex === null || hoveredIndex === i ? 1 : 0.4,
              }}
              onMouseEnter={() => setHoveredIndex(i)}
              onMouseLeave={() => setHoveredIndex(null)}
            />
          );
        })}
      </div>

      {/* Legend - compact, fixed width to prevent jitter */}
      <div className="flex flex-col justify-center gap-1 flex-shrink-0 w-24">
        {filtered.map((entry, i) => {
          const isHighlighted = hoveredIndex === i;
          return (
            <div
              key={entry.name}
              className="flex items-center gap-2 transition-opacity duration-150 cursor-default"
              style={{ opacity: hoveredIndex === null || isHighlighted ? 1 : 0.4 }}
              onMouseEnter={() => setHoveredIndex(i)}
              onMouseLeave={() => setHoveredIndex(null)}
            >
              <span
                className="w-2 h-2 rounded-sm flex-shrink-0"
                style={{ backgroundColor: chartColors[i % chartColors.length] }}
              />
              <span
                className={`type-data-xs uppercase transition-colors duration-150 ${
                  isHighlighted ? 'text-white' : 'text-white/60'
                }`}
              >
                {getPacketTypeShortLabel(entry.name)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export const PacketTypesChart = memo(PacketTypesChartComponent);
