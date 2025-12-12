'use client';

import { memo } from 'react';
import { useLogs, useLogsLoading, useLiveMode, useFetchLogs, useSetLiveMode } from '@/lib/stores/useStore';
import { usePolling } from '@/lib/hooks/usePolling';
import { FileText, Circle, RefreshCw } from 'lucide-react';
import clsx from 'clsx';
import { getLogLevelColor, POLLING_INTERVALS } from '@/lib/constants';
import type { LogEntry } from '@/types/api';

/** Memoized log row to prevent re-renders when other logs update */
const LogRow = memo(function LogRow({ log }: { log: LogEntry }) {
  const colorClass = getLogLevelColor(log.level);
  return (
    <div className={clsx('p-3 rounded-lg border bg-bg-subtle', colorClass)}>
      <div className="flex items-start gap-3">
        <span className={clsx('px-2 py-0.5 rounded text-xs font-medium border shrink-0', colorClass)}>
          {log.level}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-text-secondary break-words whitespace-pre-wrap">
            {log.message}
          </p>
          <p className="text-xs text-text-muted mt-1">
            {new Date(log.timestamp).toLocaleString()}
          </p>
        </div>
      </div>
    </div>
  );
});

export default function LogsPage() {
  const logs = useLogs();
  const logsLoading = useLogsLoading();
  const liveMode = useLiveMode();
  const fetchLogs = useFetchLogs();
  const setLiveMode = useSetLiveMode();

  usePolling(fetchLogs, POLLING_INTERVALS.logs, liveMode);

  return (
    <div className="section-gap">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="type-title text-text-primary flex items-center gap-3">
          <FileText className="w-6 h-6 text-accent-primary flex-shrink-0" />
          System Logs
        </h1>
        <div className="flex items-center gap-3 sm:gap-4">
          {liveMode && (
            <div className="flex items-center gap-2 text-sm">
              <Circle className="w-2 h-2 fill-accent-success text-accent-success animate-pulse" />
              <span className="text-text-muted">Live</span>
            </div>
          )}
          <button
            onClick={() => setLiveMode(!liveMode)}
            className={clsx(
              'px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg text-sm font-medium transition-colors',
              'flex items-center gap-2 border',
              liveMode
                ? 'bg-accent-success/20 text-accent-success border-accent-success/30'
                : 'bg-bg-subtle text-text-muted border-border-subtle hover:bg-bg-elevated'
            )}
          >
            <RefreshCw className={clsx('w-4 h-4', liveMode && 'animate-spin')} />
            <span className="hidden xs:inline">{liveMode ? 'Live' : 'Paused'}</span>
          </button>
        </div>
      </div>

      {/* Logs */}
      <div className="glass-card p-4">
        <div className="space-y-2 max-h-[calc(100vh-250px)] overflow-y-auto font-mono text-sm">
          {logsLoading && logs.length === 0 ? (
            <div className="text-center py-12 text-text-muted">
              Loading logs...
            </div>
          ) : logs.length === 0 ? (
            <div className="text-center py-12 text-text-muted">
              No logs available
            </div>
          ) : (
            logs.map((log, index) => (
              <LogRow key={`${log.timestamp}-${index}`} log={log} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
