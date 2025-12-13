'use client';

import { memo, useMemo } from 'react';
import {
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  Radar,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';
import { Compass, Signal } from 'lucide-react';
import clsx from 'clsx';
import type { NeighborInfo } from '@/types/api';
import { useChartColors } from '@/lib/hooks/useThemeColors';

interface NeighborPolarChartProps {
  neighbors: Record<string, NeighborInfo>;
  localLat: number;
  localLon: number;
}

// Direction bins for polar chart
const DIRECTIONS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;
type Direction = typeof DIRECTIONS[number];

// Calculate bearing from local node to neighbor
function calculateBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const lat1Rad = (lat1 * Math.PI) / 180;
  const lat2Rad = (lat2 * Math.PI) / 180;

  const y = Math.sin(dLon) * Math.cos(lat2Rad);
  const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) - Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLon);

  let bearing = (Math.atan2(y, x) * 180) / Math.PI;
  bearing = (bearing + 360) % 360;
  return bearing;
}

// Convert bearing to direction bin
function bearingToDirection(bearing: number): Direction {
  // N: 337.5-22.5, NE: 22.5-67.5, E: 67.5-112.5, etc.
  const index = Math.round(bearing / 45) % 8;
  return DIRECTIONS[index];
}

// Get SNR-based color
function getSnrColor(snr: number): string {
  if (snr >= 5) return '#4CFFB5'; // excellent
  if (snr >= 0) return '#39D98A'; // good
  if (snr >= -5) return '#F9D26F'; // fair
  if (snr >= -10) return '#FF8A5C'; // poor
  return '#FF5C7A'; // critical
}

// Get SNR quality label
function getSnrQuality(snr: number): string {
  if (snr >= 5) return 'Excellent';
  if (snr >= 0) return 'Good';
  if (snr >= -5) return 'Fair';
  if (snr >= -10) return 'Poor';
  return 'Critical';
}

interface DirectionData {
  direction: Direction;
  avgSnr: number;
  count: number;
  neighbors: Array<{ hash: string; name: string; snr: number }>;
}

/**
 * Polar chart showing neighbor link quality by compass direction
 * SNR determines the radius/intensity in each direction
 */
function NeighborPolarChartComponent({
  neighbors,
  localLat,
  localLon,
}: NeighborPolarChartProps) {
  const chartColors = useChartColors();
  // Process neighbors into direction bins
  const { chartData, neighborsByDirection, totalNeighbors } = useMemo(() => {
    const bins: Record<Direction, DirectionData> = {} as Record<Direction, DirectionData>;
    
    // Initialize bins
    for (const dir of DIRECTIONS) {
      bins[dir] = { direction: dir, avgSnr: 0, count: 0, neighbors: [] };
    }

    let total = 0;
    const entries = Object.entries(neighbors);

    for (const [hash, neighbor] of entries) {
      // Skip neighbors without location
      if (!neighbor.latitude || !neighbor.longitude || 
          neighbor.latitude === 0 || neighbor.longitude === 0) {
        continue;
      }

      const bearing = calculateBearing(localLat, localLon, neighbor.latitude, neighbor.longitude);
      const direction = bearingToDirection(bearing);
      const snr = neighbor.snr ?? 0;

      bins[direction].neighbors.push({
        hash: hash.slice(0, 8),
        name: neighbor.node_name || neighbor.name || 'Unknown',
        snr,
      });
      bins[direction].count++;
      total++;
    }

    // Calculate average SNR per direction
    for (const dir of DIRECTIONS) {
      if (bins[dir].count > 0) {
        const totalSnr = bins[dir].neighbors.reduce((sum, n) => sum + n.snr, 0);
        bins[dir].avgSnr = totalSnr / bins[dir].count;
      }
    }

    // Transform for radar chart - normalize SNR to 0-100 range
    // SNR typically ranges from -20 to +15, map to 0-100
    const data = DIRECTIONS.map((dir) => ({
      direction: dir,
      // Normalize: -20 dB -> 0, +10 dB -> 100
      value: bins[dir].count > 0 ? Math.max(0, Math.min(100, (bins[dir].avgSnr + 20) * (100 / 30))) : 0,
      avgSnr: bins[dir].avgSnr,
      count: bins[dir].count,
    }));

    return { chartData: data, neighborsByDirection: bins, totalNeighbors: total };
  }, [neighbors, localLat, localLon]);

  // Check if we have valid local coordinates
  const hasLocalCoords = localLat !== 0 && localLon !== 0;

  if (!hasLocalCoords) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-text-muted">
        <Compass className="w-8 h-8 mb-2 opacity-50" />
        <p>Local node coordinates not configured</p>
        <p className="text-xs mt-1">Set latitude/longitude in config to enable</p>
      </div>
    );
  }

  if (totalNeighbors === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-text-muted">
        <Compass className="w-8 h-8 mb-2 opacity-50" />
        <p>No neighbors with location data</p>
      </div>
    );
  }

  // Custom tooltip
  const CustomTooltip = ({ active, payload }: { active?: boolean; payload?: Array<{ payload: typeof chartData[0] }> }) => {
    if (!active || !payload || !payload[0]) return null;
    const data = payload[0].payload;
    if (data.count === 0) return null;
    
    return (
      <div className="bg-bg-surface/95 backdrop-blur-sm border border-border-subtle rounded-lg px-3 py-2 text-sm">
        <div className="font-medium text-text-primary">{data.direction}</div>
        <div className="text-text-muted">
          {data.count} neighbor{data.count !== 1 ? 's' : ''}
        </div>
        <div className="text-text-secondary">
          Avg SNR: <span className="tabular-nums">{data.avgSnr.toFixed(1)} dB</span>
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full">
      {/* Summary count */}
      <div className="text-xs text-text-muted uppercase tracking-wide mb-2">
        {totalNeighbors} neighbor{totalNeighbors !== 1 ? 's' : ''} with location
      </div>
      
      {/* Polar chart */}
      <div className="h-[280px]">
        <ResponsiveContainer width="100%" height={280}>
          <RadarChart data={chartData} cx="50%" cy="50%" outerRadius="80%">
            <PolarGrid stroke="rgba(255,255,255,0.1)" />
            <PolarAngleAxis
              dataKey="direction"
              tick={{ fill: 'rgba(255,255,255,0.6)', fontSize: 11 }}
            />
            <Radar
              name="Link Quality"
              dataKey="value"
              stroke={chartColors.chart5}
              fill={chartColors.chart5}
              fillOpacity={0.4}
              isAnimationActive={false}
            />
            <Tooltip content={<CustomTooltip />} />
          </RadarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export const NeighborPolarChart = memo(NeighborPolarChartComponent);
