'use client';

import { useStore } from '@/lib/stores/useStore';
import { usePolling } from '@/lib/hooks/usePolling';
import { Circle, Clock } from 'lucide-react';

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (days > 0) {
    return `${days}d ${hours}h ${minutes}m`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

export function Header() {
  const { stats, fetchStats } = useStore();

  // Poll stats every 5 seconds
  usePolling(fetchStats, 5000);

  return (
    <header className="h-14 flex items-center justify-between px-8 border-b border-border-subtle">
      {/* Node info */}
      <div className="flex items-center gap-6">
        {stats && (
          <>
            <div className="flex items-center gap-2">
              <span className="type-body-sm text-text-muted">Node</span>
              <span className="type-body-sm text-text-primary font-medium">{stats.node_name}</span>
            </div>
            {stats.config?.repeater?.mode && (
              <div className="flex items-center gap-2">
                <span className={`type-data-xs tabular-nums ${
                  stats.config.repeater.mode === 'forward' ? 'text-accent-success' : 'text-accent-secondary'
                }`}>
                  {stats.config.repeater.mode.toUpperCase()}
                </span>
              </div>
            )}
          </>
        )}
      </div>

      {/* Status indicators */}
      <div className="flex items-center gap-6">
        {/* Uptime */}
        {stats && stats.uptime_seconds !== undefined && (
          <div className="flex items-center gap-2">
            <Clock className="w-3.5 h-3.5 text-text-muted" />
            <span className="type-data-xs text-text-secondary tabular-nums">{formatUptime(stats.uptime_seconds)}</span>
          </div>
        )}

        {/* Live indicator */}
        <div className="flex items-center gap-2">
          <Circle className="w-2 h-2 fill-accent-success text-accent-success animate-pulse" />
          <span className="type-data-xs text-text-muted">LIVE</span>
        </div>

        {/* Version */}
        {stats && (
          <span className="type-data-xs text-text-muted">
            v{stats.version}
          </span>
        )}
      </div>
    </header>
  );
}
