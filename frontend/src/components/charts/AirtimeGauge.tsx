'use client';

import { memo, useMemo } from 'react';
import { Gauge, Radio } from 'lucide-react';
import clsx from 'clsx';

interface AirtimeGaugeProps {
  utilizationPercent: number;
  maxAirtimePercent: number;
  currentAirtimeMs: number;
  maxAirtimeMs: number;
  enforcementEnabled: boolean;
}

/**
 * Radial gauge showing TX airtime utilization and duty cycle headroom
 * Shows current usage vs max allowed airtime
 */
function AirtimeGaugeComponent({
  utilizationPercent,
  maxAirtimePercent,
  currentAirtimeMs,
  maxAirtimeMs,
  enforcementEnabled,
}: AirtimeGaugeProps) {
  // Calculate gauge values
  const { fillPercent, headroomPercent, statusColor, statusText } = useMemo(() => {
    const fill = Math.min(utilizationPercent, 100);
    const headroom = Math.max(0, 100 - fill);
    
    let color: string;
    let text: string;
    
    if (fill >= 90) {
      color = 'text-accent-danger';
      text = 'Critical';
    } else if (fill >= 70) {
      color = 'text-accent-secondary';
      text = 'Warning';
    } else if (fill >= 50) {
      color = 'text-[#F9D26F]';
      text = 'Moderate';
    } else {
      color = 'text-accent-success';
      text = 'Good';
    }
    
    return { fillPercent: fill, headroomPercent: headroom, statusColor: color, statusText: text };
  }, [utilizationPercent]);

  // SVG gauge parameters
  const size = 160;
  const strokeWidth = 12;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const arcLength = circumference * 0.75; // 270 degree arc
  const offset = arcLength * (1 - fillPercent / 100);

  return (
    <div className="flex flex-col items-center gap-4">
      {/* Gauge */}
      <div className="relative" style={{ width: size, height: size }}>
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          className="transform rotate-[135deg]"
        >
          {/* Background arc */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="rgba(255,255,255,0.1)"
            strokeWidth={strokeWidth}
            strokeDasharray={`${arcLength} ${circumference}`}
            strokeLinecap="round"
          />
          {/* Fill arc */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={fillPercent >= 90 ? '#FF5C7A' : fillPercent >= 70 ? '#F9D26F' : '#39D98A'}
            strokeWidth={strokeWidth}
            strokeDasharray={`${arcLength - offset} ${circumference}`}
            strokeLinecap="round"
            className="transition-all duration-300"
          />
        </svg>
        
        {/* Center content */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={clsx('text-3xl font-bold tabular-nums', statusColor)}>
            {fillPercent.toFixed(1)}%
          </span>
          <span className="text-xs text-text-muted mt-1">TX Utilization</span>
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-4 w-full">
        <div className="text-center">
          <div className="type-data-sm text-text-muted">Headroom</div>
          <div className="type-body font-medium text-accent-success tabular-nums">
            {headroomPercent.toFixed(1)}%
          </div>
        </div>
        <div className="text-center">
          <div className="type-data-sm text-text-muted">Status</div>
          <div className={clsx('type-body font-medium', statusColor)}>
            {statusText}
          </div>
        </div>
        <div className="text-center">
          <div className="type-data-sm text-text-muted">Used</div>
          <div className="type-body font-medium text-text-primary tabular-nums">
            {(currentAirtimeMs / 1000).toFixed(1)}s
          </div>
        </div>
        <div className="text-center">
          <div className="type-data-sm text-text-muted">Max/min</div>
          <div className="type-body font-medium text-text-primary tabular-nums">
            {(maxAirtimeMs / 1000).toFixed(1)}s
          </div>
        </div>
      </div>

      {/* Enforcement status */}
      <div className={clsx(
        'flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium',
        enforcementEnabled 
          ? 'bg-accent-success/15 text-accent-success'
          : 'bg-bg-subtle text-text-muted'
      )}>
        <Gauge className="w-3.5 h-3.5" />
        {enforcementEnabled ? 'Duty Cycle Enforced' : 'Duty Cycle Disabled'}
      </div>
    </div>
  );
}

export const AirtimeGauge = memo(AirtimeGaugeComponent);
