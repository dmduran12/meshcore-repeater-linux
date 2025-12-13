'use client';

import { useMemo, ReactNode } from 'react';
import clsx from 'clsx';
import type { BucketData } from '@/lib/api';

// Semantic color system for dashboard metrics
export type MetricColor = 'received' | 'forwarded' | 'transmitted' | 'dropped' | 'neutral';

export interface StatsCardProps {
  title: string;
  value: string | number;
  color?: MetricColor;
  subtitle?: string;
  buckets?: BucketData[];
  timeRangeLabel?: string;
  icon?: ReactNode;
}

// Metric colors from design system
const METRIC_COLORS = {
  received: '#39D98A',    // --metric-received
  forwarded: '#60A5FA',   // --metric-forwarded
  transmitted: '#F9D26F', // --metric-transmitted
  dropped: '#FF5C7A',     // --metric-dropped
  neutral: '#B0B0C3',     // --metric-neutral
};

// Base colors for each metric type
const colorConfig: Record<MetricColor, { 
  value: string; 
  barBase: string;
  barGood: string;
  barMid: string;
  barPoor: string;
}> = {
  received: {
    value: 'text-[var(--metric-received)]',
    barBase: METRIC_COLORS.received,
    barGood: METRIC_COLORS.received,
    barMid: '#2EAE70',    // Slightly darker
    barPoor: '#248F5C',   // Darker green
  },
  forwarded: {
    value: 'text-[var(--metric-forwarded)]',
    barBase: METRIC_COLORS.forwarded,
    barGood: METRIC_COLORS.forwarded,
    barMid: '#4B8FE0',    // Slightly darker
    barPoor: '#3B7ACC',   // Darker blue
  },
  transmitted: {
    value: 'text-[var(--metric-transmitted)]',
    barBase: METRIC_COLORS.transmitted,
    barGood: METRIC_COLORS.transmitted,
    barMid: '#E5BD5E',    // Slightly darker
    barPoor: '#CCA84D',   // Darker amber
  },
  dropped: {
    value: 'text-[var(--metric-dropped)]',
    barBase: METRIC_COLORS.dropped,
    barGood: METRIC_COLORS.dropped,
    barMid: '#E54868',    // Slightly darker
    barPoor: '#CC3E5C',   // Darker red
  },
  neutral: {
    value: 'text-text-secondary',
    barBase: METRIC_COLORS.neutral,
    barGood: METRIC_COLORS.neutral,
    barMid: '#9A9AAE',    // Slightly darker
    barPoor: '#85859A',   // Darker gray
  },
};

// Get bar color based on SNR quality
function getBarColor(avgSnr: number, config: typeof colorConfig.received): string {
  // SNR ranges: >10 = excellent, 5-10 = good, 0-5 = fair, <0 = poor
  if (avgSnr >= 8) return config.barGood;
  if (avgSnr >= 3) return config.barMid;
  return config.barPoor;
}

// Target bar count for consistent sizing (matches 1h resolution)
const TARGET_BAR_COUNT = 60;

// Vertical bar chart component
function BarChart({ 
  buckets, 
  colorType,
  height = 64 
}: { 
  buckets: BucketData[]; 
  colorType: MetricColor;
  height?: number;
}) {
  const config = colorConfig[colorType];
  
  const { bars } = useMemo(() => {
    if (!buckets || buckets.length === 0) {
      return { bars: [] };
    }
    
    // Normalize to TARGET_BAR_COUNT bars for consistent sizing
    const normalizedBuckets: BucketData[] = [];
    const ratio = buckets.length / TARGET_BAR_COUNT;
    
    if (ratio <= 1) {
      // Fewer buckets than target - use as-is
      normalizedBuckets.push(...buckets);
    } else {
      // More buckets than target - aggregate
      for (let i = 0; i < TARGET_BAR_COUNT; i++) {
        const startIdx = Math.floor(i * ratio);
        const endIdx = Math.floor((i + 1) * ratio);
        const slice = buckets.slice(startIdx, endIdx);
        const totalCount = slice.reduce((sum, b) => sum + b.count, 0);
        const avgSnr = slice.length > 0 
          ? slice.reduce((sum, b) => sum + b.avg_snr, 0) / slice.length 
          : 0;
        normalizedBuckets.push({
          bucket: i,
          start: slice[0]?.start ?? 0,
          end: slice[slice.length - 1]?.end ?? 0,
          count: totalCount,
          avg_snr: avgSnr,
          avg_rssi: 0,
        });
      }
    }
    
    const max = Math.max(...normalizedBuckets.map(b => b.count), 1);
    
    // For 'dropped' type, always use the base red color
    const useFixedColor = colorType === 'dropped';
    
    return {
      bars: normalizedBuckets.map(bucket => ({
        height: bucket.count > 0 ? Math.max((bucket.count / max) * 100, 8) : 0,
        color: bucket.count > 0 
          ? (useFixedColor ? config.barBase : getBarColor(bucket.avg_snr, config))
          : 'transparent',
        count: bucket.count,
        snr: bucket.avg_snr,
      }))
    };
  }, [buckets, config, colorType]);
  
  if (!buckets || buckets.length === 0) {
    return (
      <div 
        className="w-full flex items-end justify-center gap-[2px] opacity-20"
        style={{ height }}
      >
        <span className="type-data-xs text-text-muted">No data</span>
      </div>
    );
  }
  
  return (
    <div 
      className="w-full flex items-end gap-[1px]"
      style={{ height }}
    >
      {bars.map((bar, i) => (
        <div
          key={i}
          className="flex-1 rounded-t-sm"
          style={{ 
            height: `${bar.height}%`,
            backgroundColor: bar.color,
            opacity: bar.count > 0 ? 0.8 : 0.1,
            minHeight: bar.count > 0 ? '4px' : '2px',
            maxWidth: '4px',
          }}
          title={bar.count > 0 ? `${bar.count} packets, SNR: ${bar.snr?.toFixed(1)}dB` : 'No packets'}
        />
      ))}
    </div>
  );
}

// Icon color mapping - uses CSS variables for theme support
const ICON_COLORS: Record<MetricColor, string> = {
  received: 'text-[var(--metric-received)]',
  forwarded: 'text-[var(--metric-forwarded)]',
  transmitted: 'text-[var(--metric-transmitted)]',
  dropped: 'text-[var(--metric-dropped)]',
  neutral: 'text-[var(--accent-primary)]',
};

export function StatsCard({ 
  title, 
  value, 
  color = 'neutral', 
  subtitle, 
  buckets,
  timeRangeLabel,
  icon,
}: StatsCardProps) {
  const colors = colorConfig[color];

  const displayValue = typeof value === 'string' 
    ? value 
    : value.toLocaleString();

  return (
    <div className="data-card flex flex-col min-h-[180px]">
      {/* Top section: Icon + Title + Pill (left justified) */}
      <div className="flex items-center gap-2 mb-3">
        {icon && (
          <span className={ICON_COLORS[color]}>{icon}</span>
        )}
        <span className="data-card-title">{title}</span>
        {timeRangeLabel && (
          <span className="pill-tag">{timeRangeLabel}</span>
        )}
      </div>
      <div className="data-card-value">
        {displayValue}
      </div>
      
      {/* Middle section: Bar chart */}
      <div className="flex-1 py-2 mt-2">
        {buckets ? (
          <BarChart buckets={buckets} colorType={color} height={64} />
        ) : (
          <div className="w-full h-16 flex items-center justify-center">
            <div 
              className="w-full h-0.5 rounded-full"
              style={{ backgroundColor: colors.barBase, opacity: 0.15 }}
            />
          </div>
        )}
      </div>
      
      {/* Bottom section: Description */}
      <div className="data-card-secondary border-t border-border-subtle pt-3 mt-2">
        {subtitle || `Total ${title.toLowerCase()}`}
      </div>
    </div>
  );
}
