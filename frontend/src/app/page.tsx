'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useStats, useStatsError, useFlashReceived } from '@/lib/stores/useStore';
import { useDebounce } from '@/lib/hooks/useDebounce';
import { StatsCard } from '@/components/stats/StatsCard';
import { RecentPackets } from '@/components/packets/RecentPackets';
import { TimeRangeSelector } from '@/components/shared/TimeRangeSelector';
import { SimpleTooltip } from '@/components/charts/ChartTooltip';
import { formatUptime } from '@/lib/format';
import { DASHBOARD_TIME_RANGES, METRIC_COLORS, POLLING_INTERVALS } from '@/lib/constants';
import { getBucketedStats, type BucketedStats, type BucketData } from '@/lib/api';
import { Home, Radio, TrendingUp, ArrowUpRight, Send, XCircle, Clock } from 'lucide-react';
import { HashBadge } from '@/components/ui/HashBadge';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

/** Transform bucket data for AreaChart */
function transformBucketsForChart(buckets: BucketData[] | undefined): { time: string; received: number }[] {
  if (!buckets || buckets.length === 0) return [];
  
  return buckets.map((bucket) => {
    const date = new Date(bucket.start * 1000);
    return {
      time: date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      received: bucket.count,
    };
  });
}

export default function Dashboard() {
  const stats = useStats();
  const statsError = useStatsError();
  const flashReceived = useFlashReceived();
  const [selectedRange, setSelectedRange] = useState(0); // Default to 20m
  const [bucketedStats, setBucketedStats] = useState<BucketedStats | null>(null);
  const [isFlashing, setIsFlashing] = useState(false);
  
  // Debounce time range changes to prevent rapid API calls
  const debouncedRange = useDebounce(selectedRange, 150);
  
  // Transform received buckets for the hero chart (must be before early return)
  const receivedChartData = useMemo(
    () => transformBucketsForChart(bucketedStats?.received),
    [bucketedStats?.received]
  );
  
  // Fetch bucketed stats
  const fetchBucketedStats = useCallback(async () => {
    try {
      const range = DASHBOARD_TIME_RANGES[debouncedRange];
      const response = await getBucketedStats(range.minutes, range.buckets);
      if (response.success && response.data) {
        setBucketedStats(response.data);
      }
    } catch {
      // Silently fail - stats will show stale data
    }
  }, [debouncedRange]);
  
  // Fetch on mount and when range changes
  useEffect(() => {
    const controller = new AbortController();
    const doFetch = async () => {
      await fetchBucketedStats();
    };
    void doFetch();
    const interval = setInterval(() => void doFetch(), POLLING_INTERVALS.charts);
    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, [fetchBucketedStats]);
  
  // Flash effect when new packet received
  useEffect(() => {
    if (flashReceived > 0) {
      // Use requestAnimationFrame to avoid synchronous setState in effect
      const raf = requestAnimationFrame(() => setIsFlashing(true));
      const timer = setTimeout(() => setIsFlashing(false), 600);
      return () => {
        cancelAnimationFrame(raf);
        clearTimeout(timer);
      };
    }
  }, [flashReceived]);

  // Derived values
  const uptime = stats?.uptime_seconds ? formatUptime(stats.uptime_seconds) : '0m';
  const rxPerHour = stats?.rx_per_hour ?? 0;
  const fwdPerHour = stats?.forwarded_per_hour ?? 0;
  const currentRange = DASHBOARD_TIME_RANGES[selectedRange];
  const nodeName = stats?.node_name || stats?.config?.node_name || 'Unknown Node';

  if (statsError) {
    return (
      <div className="glass-card p-8 text-center">
        <p className="type-subheading text-accent-red mb-2">Failed to connect to backend</p>
        <p className="type-body text-white/50">{statsError}</p>
        <p className="type-data-sm text-white/40 mt-4">
          Make sure the Python backend is running on port 8000
        </p>
      </div>
    );
  }

  return (
    <div className="section-gap">
      {/* Page Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="type-title text-text-primary flex items-center gap-3">
          <Home className="w-6 h-6 text-accent-primary flex-shrink-0" />
          <span className="truncate">{nodeName}</span>
        </h1>
        {/* Time Range Selector */}
        <TimeRangeSelector
          ranges={DASHBOARD_TIME_RANGES}
          selectedIndex={selectedRange}
          onSelect={setSelectedRange}
        />
      </div>
      
      {/* Hero Received Card - Full Width */}
      <div className="glass-card card-padding">
        {isFlashing && <div className="flash-overlay" />}
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="w-5 h-5 text-accent-success" />
              <span className="type-label text-text-muted">RECEIVED</span>
              <span className="pill-tag">{currentRange.label}</span>
            </div>
            <div className="type-hero" style={{ color: METRIC_COLORS.received }}>
              {(stats?.rx_count ?? 0).toLocaleString()}
            </div>
            <div className="type-body-sm text-text-muted mt-1">
              {rxPerHour}/hr average
            </div>
          </div>
        </div>
        
        {/* Area Chart */}
        {receivedChartData.length > 0 ? (
          <div className="h-48 mt-4">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={receivedChartData}>
                <defs>
                  <linearGradient id="gradient-received" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={METRIC_COLORS.received} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={METRIC_COLORS.received} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
                <XAxis 
                  dataKey="time" 
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }}
                  dy={8}
                  interval="preserveStartEnd"
                />
                <YAxis 
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }}
                  dx={-8}
                  width={40}
                />
                <Tooltip
                  content={
                    <SimpleTooltip
                      color={METRIC_COLORS.received}
                      labelKey="time"
                      unit=" packets"
                    />
                  }
                  position={{ y: -60 }}
                />
                <Area
                  type="stepAfter"
                  dataKey="received"
                  stroke={METRIC_COLORS.received}
                  fill="url(#gradient-received)"
                  strokeWidth={1}
                  dot={false}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="h-48 flex items-center justify-center text-text-muted">
            No data available for this time range
          </div>
        )}
      </div>

      {/* Stats Grid - Secondary Row (4 cards) */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard
          title="FORWARDED"
          value={stats?.forwarded_count ?? 0}
          subtitle={`${fwdPerHour}/hr average`}
          color="forwarded"
          buckets={bucketedStats?.forwarded}
          timeRangeLabel={currentRange.label}
          icon={<ArrowUpRight className="w-4 h-4" />}
        />
        <StatsCard
          title="TRANSMITTED"
          value={stats?.tx_count ?? 0}
          subtitle="Packets sent to air"
          color="transmitted"
          buckets={bucketedStats?.transmitted}
          timeRangeLabel={currentRange.label}
          icon={<Send className="w-4 h-4" />}
        />
        <StatsCard
          title="DROPPED"
          value={stats?.dropped_count ?? 0}
          subtitle="Filtered or duplicate"
          color="dropped"
          buckets={bucketedStats?.dropped}
          timeRangeLabel={currentRange.label}
          icon={<XCircle className="w-4 h-4" />}
        />
        <StatsCard
          title="UPTIME"
          value={uptime}
          subtitle="Since last restart"
          color="neutral"
          icon={<Clock className="w-4 h-4" />}
        />
      </div>

      {/* Recent Packets - full width now that controls moved to sidebar */}
      <RecentPackets />

      {/* Node Info */}
      {stats && (
        <div className="glass-card card-padding">
          <h3 className="type-subheading text-text-primary mb-4 flex items-center gap-2">
            <Radio className="w-5 h-5 text-accent-primary" />
            Node Information
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <span className="type-label text-text-muted">Node Name</span>
              <p className="type-body text-text-primary mt-1">{nodeName}</p>
            </div>
            <div>
              <span className="type-label text-text-muted">Version</span>
              <p className="type-data text-text-primary mt-1">v{stats.version}</p>
            </div>
            <div>
              <span className="type-label text-text-muted">Core Version</span>
              <p className="type-data text-text-primary mt-1">v{stats.core_version}</p>
            </div>
            <div>
              <span className="type-label text-text-muted">Local Hash</span>
              <div className="mt-1">
                {stats.local_hash ? (
                  <HashBadge hash={stats.local_hash} size="sm" />
                ) : (
                  <span className="type-data-sm text-text-muted">N/A</span>
                )}
              </div>
            </div>
          </div>
          {/* Public Key - full width row */}
          {stats.public_key && (
            <div className="mt-4 pt-4 border-t border-border-subtle">
              <span className="type-label text-text-muted">Public Key</span>
              <div className="mt-1">
                <HashBadge hash={stats.public_key} prefixLength={12} suffixLength={8} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
