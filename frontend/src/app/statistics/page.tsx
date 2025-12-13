'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import { useDebounce } from '@/lib/hooks/useDebounce';
import { useStats } from '@/lib/stores/useStore';
import { BarChart3, TrendingUp, PieChart, Radio, Compass } from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import * as api from '@/lib/api';
import type { GraphData } from '@/types/api';
import type { BucketedStats, UtilizationStats } from '@/lib/api';
import { TimeRangeSelector } from '@/components/shared/TimeRangeSelector';
import { usePolling } from '@/lib/hooks/usePolling';
import { ChartTooltip } from '@/components/charts/ChartTooltip';
import { PacketTypesChart } from '@/components/charts/PacketTypesChart';
import { TrafficStackedChart } from '@/components/charts/TrafficStackedChart';
import { NeighborPolarChart } from '@/components/charts/NeighborPolarChart';
import { STATISTICS_TIME_RANGES } from '@/lib/constants';
import { useChartColorArray } from '@/lib/hooks/useThemeColors';

export default function StatisticsPage() {
  const stats = useStats();
  const chartColors = useChartColorArray();
  const [bucketedStats, setBucketedStats] = useState<BucketedStats | null>(null);
  const [utilizationStats, setUtilizationStats] = useState<UtilizationStats | null>(null);
  const [packetTypeData, setPacketTypeData] = useState<GraphData | null>(null);
  const [noiseFloorData, setNoiseFloorData] = useState<GraphData | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
const [selectedRange, setSelectedRange] = useState(1); // Default to 3h

  // Debounce time range changes to prevent rapid API calls when clicking quickly
  const debouncedRange = useDebounce(selectedRange, 150);
  const timeRange = STATISTICS_TIME_RANGES[debouncedRange].hours;
  const timeRangeMinutes = timeRange * 60;

  useEffect(() => {
    async function fetchData() {
      setError(null);
      try {
        // Calculate bucket count based on time range (aim for ~60 buckets)
        const bucketCount = Math.min(120, Math.max(30, Math.floor(timeRangeMinutes / 2)));
        
        const [bucketedRes, utilizationRes, packetTypeRes, noiseFloorRes] = await Promise.all([
          api.getBucketedStats(timeRangeMinutes, bucketCount),
          api.getUtilizationStats(timeRange),
          api.getPacketTypeGraphData(timeRange),
          api.getNoiseFloorChartData(timeRange),
        ]);

        if (bucketedRes.success && bucketedRes.data) {
          setBucketedStats(bucketedRes.data);
        }
        if (utilizationRes.success && utilizationRes.data) {
          setUtilizationStats(utilizationRes.data);
        }
        if (packetTypeRes.success && packetTypeRes.data) {
          setPacketTypeData(packetTypeRes.data);
        }
        if (noiseFloorRes.success && noiseFloorRes.data) {
          setNoiseFloorData(noiseFloorRes.data.chart_data);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load chart data');
      } finally {
        setInitialLoading(false);
      }
    }

    fetchData();
  }, [timeRange, timeRangeMinutes]);

  // Poll utilization only, with intervals by range:
  // default 5m; 3d → 10m; 7d → 30m
  const utilizationPollMs = useMemo(() => {
    switch (timeRange) {
      case 72: // 3d
        return 10 * 60 * 1000;
      case 168: // 7d
        return 30 * 60 * 1000;
      default:
        return 5 * 60 * 1000;
    }
  }, [timeRange]);

  const pollUtilization = useCallback(async () => {
    try {
      const res = await api.getUtilizationStats(timeRange);
      if (res.success && res.data) setUtilizationStats(res.data);
    } catch (_) {
      // ignore polling errors
    }
  }, [timeRange]);

  // Derive common chart polling interval using same cadence
  const chartPollMs = utilizationPollMs;

  // Poll bucketed stats (received/forwarded/dropped/transmitted)
  const pollBucketed = useCallback(async () => {
    try {
      const bucketCount = Math.min(120, Math.max(30, Math.floor(timeRangeMinutes / 2)));
      const res = await api.getBucketedStats(timeRangeMinutes, bucketCount);
      if (res.success && res.data) setBucketedStats(res.data);
    } catch (_) {
      // ignore polling errors
    }
  }, [timeRangeMinutes]);

  // Poll packet type distribution
  const pollPacketTypes = useCallback(async () => {
    try {
      const res = await api.getPacketTypeGraphData(timeRange);
      if (res.success && res.data) setPacketTypeData(res.data);
    } catch (_) {
      // ignore polling errors
    }
  }, [timeRange]);

  // Poll noise floor chart
  const pollNoiseFloor = useCallback(async () => {
    try {
      const res = await api.getNoiseFloorChartData(timeRange);
      if (res.success && res.data) setNoiseFloorData(res.data.chart_data);
    } catch (_) {
      // ignore polling errors
    }
  }, [timeRange]);

  // Start polling (skip initial since initial fetch already happened)
  usePolling(pollUtilization, chartPollMs, true, true);
  usePolling(pollBucketed, chartPollMs, true, true);
  usePolling(pollPacketTypes, chartPollMs, true, true);
  usePolling(pollNoiseFloor, chartPollMs, true, true);

  // Aggregate series data for packet types - memoized
  const packetTypePieData = useMemo(() => {
    if (!packetTypeData || !packetTypeData.series) return [];
    return packetTypeData.series
      .map((s) => ({
        name: s.name,
        value: s.data.reduce((sum, point) => sum + (point[1] ?? 0), 0),
      }))
      .filter((item) => item.value > 0);
  }, [packetTypeData]);

  // Transform noise floor data - memoized
  const noiseFloorChartData = useMemo(() => {
    if (!noiseFloorData || !noiseFloorData.series || noiseFloorData.series.length === 0) return [];
    const { timestamps, series } = noiseFloorData;
    return timestamps.map((ts, i) => {
      const point: Record<string, number | string> = {
        time: new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        timestamp: ts,
      };
      series.forEach((s) => {
        point[s.name] = s.data[i]?.[1] ?? 0;
      });
      return point;
    });
  }, [noiseFloorData]);

  const currentRange = STATISTICS_TIME_RANGES[selectedRange];

  return (
    <div className="section-gap">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="type-title text-text-primary flex items-center gap-3">
          <BarChart3 className="w-6 h-6 text-accent-primary flex-shrink-0" />
          Statistics
        </h1>
        <TimeRangeSelector
          ranges={STATISTICS_TIME_RANGES}
          selectedIndex={selectedRange}
          onSelect={setSelectedRange}
        />
      </div>

      {error && (
        <div className="glass-card p-4 border border-accent-red/50 bg-accent-red/10">
          <p className="text-accent-red">{error}</p>
        </div>
      )}

      {initialLoading ? (
        <div className="glass-card card-padding text-center">
          <div className="animate-pulse text-text-muted">Loading statistics...</div>
        </div>
      ) : (
        <>
          {/* Row: Traffic Flow (2/3) + Link Quality (1/3) */}
          <div className="grid-12">
            {/* Traffic Flow - Stacked Bar Chart with Airtime Overlay */}
            <div className="col-span-full lg:col-span-8 glass-card card-padding">
              <div className="flex items-center gap-2 mb-6">
                <TrendingUp className="w-5 h-5 text-accent-primary" />
                <h2 className="type-subheading text-text-primary">Traffic Flow</h2>
                <span className="pill-tag ml-auto">{currentRange.label}</span>
              </div>
              {bucketedStats?.received && bucketedStats.received.length > 0 ? (
                <TrafficStackedChart
                  received={bucketedStats.received}
                  forwarded={bucketedStats.forwarded}
                  dropped={bucketedStats.dropped}
                  transmitted={bucketedStats.transmitted}
                  utilizationBins={utilizationStats?.bins}
                  txUtilization={stats?.utilization_percent ?? 0}
                  rxUtilization={(stats?.rx_per_hour ?? 0) / 10} // Rough estimate (fallback)
                />
              ) : (
                <div className="h-80 flex items-center justify-center text-text-muted">
                  No traffic data available
                </div>
              )}
            </div>

            {/* Neighbor Link Quality Polar Chart */}
            <div className="col-span-full lg:col-span-4 glass-card card-padding">
              <div className="flex items-center gap-2 mb-4">
                <Compass className="w-5 h-5 text-accent-primary" />
                <h2 className="type-subheading text-text-primary">Link Quality</h2>
              </div>
              <NeighborPolarChart
                neighbors={stats?.neighbors ?? {}}
                localLat={stats?.config?.repeater?.latitude ?? 0}
                localLon={stats?.config?.repeater?.longitude ?? 0}
              />
            </div>
          </div>

          {/* Row: Packet Types + Noise Floor */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-space-6">
            {/* Packet Types - Horizontal Bar Chart */}
            <div className="glass-card card-padding">
              <div className="flex items-center gap-2 mb-6">
                <PieChart className="w-5 h-5 text-accent-primary" />
                <h2 className="type-subheading text-text-primary">Packet Types</h2>
              </div>
              {packetTypePieData.length > 0 ? (
                <PacketTypesChart data={packetTypePieData} />
              ) : (
                <div className="h-56 flex items-center justify-center text-text-muted">
                  No packet type data available
                </div>
              )}
            </div>

            {/* Noise Floor Chart */}
            <div className="glass-card card-padding">
              <div className="flex items-center gap-2 mb-6">
                <Radio className="w-5 h-5 text-accent-primary" />
                <h2 className="type-subheading text-text-primary">RF Noise Floor</h2>
              </div>
              {noiseFloorChartData.length > 0 ? (
                <div className="h-56">
                  <ResponsiveContainer width="100%" height={224}>
                    <LineChart data={noiseFloorChartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
                      <XAxis 
                        dataKey="time" 
                        axisLine={false}
                        tickLine={false}
                        tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }}
                        dy={8}
                      />
                      <YAxis 
                        axisLine={false}
                        tickLine={false}
                        tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }}
                        dx={-8}
                        domain={['auto', 'auto']}
                        tickFormatter={(v) => `${v}`}
                      />
                      <Tooltip content={<ChartTooltip />} />
                      {noiseFloorData?.series?.map((s, i) => (
                        <Line
                          key={s.name}
                          type="monotone"
                          dataKey={s.name}
                          stroke={chartColors[i % chartColors.length]}
                          strokeWidth={2}
                          dot={false}
                          isAnimationActive={false}
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="h-64 flex items-center justify-center text-text-muted">
                  No noise floor data available
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
