'use client';

import { memo } from 'react';

interface TimeRange {
  label: string;
  [key: string]: unknown;
}

interface TimeRangeSelectorProps {
  ranges: readonly TimeRange[];
  selectedIndex: number;
  onSelect: (index: number) => void;
}

/**
 * Unified time range selector toggle group
 * Used on Dashboard and Statistics pages - identical styling
 */
function TimeRangeSelectorComponent({
  ranges,
  selectedIndex,
  onSelect,
}: TimeRangeSelectorProps) {
  return (
    <div className="toggle-group flex-shrink-0 overflow-x-auto">
      {ranges.map((range, idx) => (
        <button
          key={range.label}
          onClick={() => onSelect(idx)}
          className={`toggle-group-item ${selectedIndex === idx ? 'active' : ''}`}
        >
          {range.label}
        </button>
      ))}
    </div>
  );
}

export const TimeRangeSelector = memo(TimeRangeSelectorComponent);
