'use client';

import { useEffect, useState, memo, useMemo } from 'react';
import { Cpu, HardDrive, MemoryStick, Thermometer, Activity, RefreshCw } from 'lucide-react';
import * as api from '@/lib/api';
import type { HardwareStats } from '@/types/api';
import clsx from 'clsx';
import { POLLING_INTERVALS } from '@/lib/constants';

interface ProgressBarProps {
  value: number;
  max?: number;
  color?: 'primary' | 'secondary' | 'green' | 'red' | 'yellow';
}

const COLOR_CLASSES = {
  primary: 'bg-accent-tertiary',
  secondary: 'bg-accent-secondary',
  green: 'bg-accent-success',
  red: 'bg-accent-danger',
  yellow: 'bg-accent-secondary',
} as const;

/** Memoized progress bar - only re-renders when value changes */
const ProgressBar = memo(function ProgressBar({ value, max = 100, color = 'primary' }: ProgressBarProps) {
  const percentage = Math.min((value / max) * 100, 100);
  const baseColor = COLOR_CLASSES[color];

  // Determine color based on threshold
  const barColor = percentage > 90 ? 'bg-accent-danger' : percentage > 70 ? 'bg-accent-secondary' : baseColor;

  return (
    <div className="h-2.5 bg-white/10 rounded-full overflow-hidden">
      <div 
        className={clsx('h-full rounded-full', barColor)}
        style={{ width: `${percentage}%` }}
      />
    </div>
  );
});

export default function SystemStatsPage() {
  const [stats, setStats] = useState<HardwareStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  async function fetchStats() {
    try {
      const response = await api.getHardwareStats();
      if (response.success && response.data) {
        setStats(response.data);
        setError(null);
      } else {
        setError(response.error || 'Failed to fetch hardware stats');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch hardware stats');
    }
  }

  useEffect(() => {
    let mounted = true;
    const doFetch = async () => {
      if (mounted) {
        await fetchStats();
        if (mounted) setLoading(false);
      }
    };
    void doFetch();
    const interval = setInterval(fetchStats, POLLING_INTERVALS.system);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchStats();
    setRefreshing(false);
  };

  return (
    <div className="section-gap">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="type-title text-text-primary flex items-center gap-3">
          <Cpu className="w-6 h-6 text-accent-primary flex-shrink-0" />
          System Stats
        </h1>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="flex items-center gap-2 px-3 py-1.5 sm:px-4 sm:py-2 bg-bg-subtle hover:bg-bg-elevated rounded-lg transition-colors text-sm text-text-muted hover:text-text-primary self-start sm:self-auto"
        >
          <RefreshCw className={clsx('w-4 h-4', refreshing && 'animate-spin')} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="glass-card p-4 border border-accent-danger/50 bg-accent-danger/10">
          <p className="text-accent-danger">{error}</p>
        </div>
      )}

      {loading ? (
        <div className="glass-card p-12 text-center">
          <div className="animate-pulse text-text-muted">Loading system stats...</div>
        </div>
      ) : stats ? (
        <div className="grid-12">
          {/* CPU Usage - 12 cols mobile, 6 cols md */}
          <div className="col-span-full md:col-span-6 glass-card card-padding">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-lg bg-accent-tertiary/20 flex items-center justify-center">
                <Cpu className="w-6 h-6 text-accent-tertiary" />
              </div>
              <div>
                <h2 className="text-lg font-medium text-text-primary">CPU Usage</h2>
                <p className="text-sm text-text-muted">Processor utilization</p>
              </div>
            </div>
            <div className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-text-muted">Usage</span>
                <span className="text-text-primary font-medium">{stats.cpu_percent.toFixed(1)}%</span>
              </div>
              <ProgressBar value={stats.cpu_percent} />
              {stats.load_average && stats.load_average.length >= 3 && (
                <div className="mt-4 pt-4 border-t border-border-subtle">
                  <p className="text-sm text-text-muted mb-2">Load Average</p>
                  <div className="grid grid-cols-3 gap-4 text-center">
                    <div>
                      <p className="text-lg font-medium text-text-primary">{stats.load_average[0].toFixed(2)}</p>
                      <p className="text-xs text-text-muted">1 min</p>
                    </div>
                    <div>
                      <p className="text-lg font-medium text-text-primary">{stats.load_average[1].toFixed(2)}</p>
                      <p className="text-xs text-text-muted">5 min</p>
                    </div>
                    <div>
                      <p className="text-lg font-medium text-text-primary">{stats.load_average[2].toFixed(2)}</p>
                      <p className="text-xs text-text-muted">15 min</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Memory Usage - 12 cols mobile, 6 cols md */}
          <div className="col-span-full md:col-span-6 glass-card card-padding">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-lg bg-accent-secondary/20 flex items-center justify-center">
                <MemoryStick className="w-6 h-6 text-accent-secondary" />
              </div>
              <div>
                <h2 className="text-lg font-medium text-text-primary">Memory Usage</h2>
                <p className="text-sm text-text-muted">RAM utilization</p>
              </div>
            </div>
            <div className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-text-muted">Usage</span>
                <span className="text-text-primary font-medium">{stats.memory_percent.toFixed(1)}%</span>
              </div>
              <ProgressBar value={stats.memory_percent} color="secondary" />
              <div className="flex justify-between text-sm mt-2">
                <span className="text-text-muted">
                  {stats.memory_used_mb.toFixed(0)} MB used
                </span>
                <span className="text-text-muted">
                  {stats.memory_total_mb.toFixed(0)} MB total
                </span>
              </div>
            </div>
          </div>

          {/* Disk Usage - 12 cols mobile, 6 cols md */}
          <div className="col-span-full md:col-span-6 glass-card card-padding">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-lg bg-accent-success/20 flex items-center justify-center">
                <HardDrive className="w-6 h-6 text-accent-success" />
              </div>
              <div>
                <h2 className="text-lg font-medium text-text-primary">Disk Usage</h2>
                <p className="text-sm text-text-muted">Storage utilization</p>
              </div>
            </div>
            <div className="space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-text-muted">Usage</span>
                <span className="text-text-primary font-medium">{stats.disk_percent.toFixed(1)}%</span>
              </div>
              <ProgressBar value={stats.disk_percent} color="green" />
              <div className="flex justify-between text-sm mt-2">
                <span className="text-text-muted">
                  {stats.disk_used_gb.toFixed(1)} GB used
                </span>
                <span className="text-text-muted">
                  {stats.disk_total_gb.toFixed(1)} GB total
                </span>
              </div>
            </div>
          </div>

          {/* Temperature - 12 cols mobile, 6 cols md */}
          <div className="col-span-full md:col-span-6 glass-card card-padding">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-lg bg-accent-secondary/20 flex items-center justify-center">
                <Thermometer className="w-6 h-6 text-accent-secondary" />
              </div>
              <div>
                <h2 className="text-lg font-medium text-text-primary">Temperature</h2>
                <p className="text-sm text-text-muted">CPU temperature</p>
              </div>
            </div>
            {stats.temperature !== undefined && stats.temperature !== null ? (
              <div className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-text-muted">Current</span>
                  <span className="text-text-primary font-medium">{stats.temperature.toFixed(1)}°C</span>
                </div>
                <ProgressBar value={stats.temperature} max={100} color="yellow" />
                <p className="text-xs text-text-muted mt-2">
                  {stats.temperature < 50 ? 'Normal operating temperature' : 
                   stats.temperature < 70 ? 'Warm - consider cooling' : 
                   'Hot - check cooling system'}
                </p>
              </div>
            ) : (
              <div className="flex items-center justify-center h-24 text-text-muted">
                <Activity className="w-5 h-5 mr-2" />
                Temperature sensor not available
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
