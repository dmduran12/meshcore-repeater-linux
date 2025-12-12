/**
 * Shared constants for pyMC Repeater frontend
 * Consolidated from Dashboard, Statistics, and component files
 */

/**
 * Time range presets for Dashboard (includes 20m for real-time monitoring)
 */
export const DASHBOARD_TIME_RANGES = [
  { label: '20m', minutes: 20, buckets: 40 }, // 30-sec buckets
  { label: '1h', minutes: 60, buckets: 60 }, // 1-min buckets
  { label: '3h', minutes: 180, buckets: 90 }, // 2-min buckets
  { label: '12h', minutes: 720, buckets: 72 }, // 10-min buckets
  { label: '24h', minutes: 1440, buckets: 96 }, // 15-min buckets
  { label: '3d', minutes: 4320, buckets: 72 }, // 1-hr buckets
  { label: '7d', minutes: 10080, buckets: 84 }, // 2-hr buckets
] as const;

/**
 * Time range presets for Statistics (longer ranges, no 20m)
 */
export const STATISTICS_TIME_RANGES = [
  { label: '1h', hours: 1 },
  { label: '3h', hours: 3 },
  { label: '12h', hours: 12 },
  { label: '24h', hours: 24 },
  { label: '3d', hours: 72 },
  { label: '7d', hours: 168 },
] as const;

/**
 * Chart color palette from design system
 * Used for multi-series charts (metrics, noise floor, etc.)
 */
export const CHART_COLORS = [
  '#71F8E5', // --chart-1 Cyan/mint
  '#39D98A', // --chart-2 Green
  '#F9D26F', // --chart-3 Amber
  '#FF5C7A', // --chart-4 Rose
  '#B49DFF', // --chart-5 Lavender
  '#60A5FA', // --chart-6 Blue
  '#F472B6', // --chart-7 Pink
  '#FB923C', // --chart-8 Orange
] as const;

/**
 * Get chart color by index (cycles through palette)
 */
export function getChartColor(index: number): string {
  return CHART_COLORS[index % CHART_COLORS.length];
}

/**
 * Harmonious color palette for packet types visualization
 * Derived from system accents (lavender, cyan, blue)
 */
export const PACKET_TYPE_CHART_COLORS = [
  '#B49DFF', // Lavender (primary system accent)
  '#7C6CB8', // Lavender dark
  '#71F8E5', // Cyan
  '#4FB8A8', // Cyan dark
  '#60A5FA', // Blue
  '#4080C8', // Blue dark
  '#8B7DCC', // Lavender mid
  '#5AA0D0', // Blue-cyan blend
] as const;

/**
 * Get packet type chart color by index
 */
export function getPacketTypeChartColor(index: number): string {
  return PACKET_TYPE_CHART_COLORS[index % PACKET_TYPE_CHART_COLORS.length];
}

/**
 * Metric colors for dashboard cards
 */
export const METRIC_COLORS = {
  received: '#39D98A', // --metric-received (green)
  forwarded: '#60A5FA', // --metric-forwarded (blue)
  transmitted: '#F9D26F', // --metric-transmitted (amber)
  dropped: '#FF5C7A', // --metric-dropped (red)
  neutral: '#B0B0C3', // --metric-neutral (gray)
} as const;

/**
 * Short label mapping for packet types (for compact displays)
 */
export const PACKET_TYPE_SHORT_LABELS: Record<string, string> = {
  advert: 'ADVERT',
  grp_txt: 'GRP_TXT',
  txt_msg: 'TXT_MSG',
  response: 'RESPONSE',
  anon_req: 'ANON_REQ',
  path: 'PATH',
  req: 'REQ',
  ack: 'ACK',
};

/**
 * Get short label for packet type name
 */
export function getPacketTypeShortLabel(name: string): string {
  const lower = name.toLowerCase();
  return PACKET_TYPE_SHORT_LABELS[lower] || name.toUpperCase().slice(0, 8);
}

/**
 * Polling intervals (in milliseconds)
 */
export const POLLING_INTERVALS = {
  stats: 3000, // Global stats refresh (aligned with packets for consistency)
  packets: 3000, // Packet list refresh (near real-time)
  charts: 30000, // Chart data refresh
  logs: 2000, // Logs refresh (near real-time)
  system: 3000, // System stats page (CPU, memory, disk, temp) — faster at ~3s
} as const;

/**
 * Log level styling classes
 */
export const LOG_LEVEL_COLORS: Record<string, string> = {
  DEBUG: 'text-[var(--log-debug)] border-[var(--log-debug)]/30',
  INFO: 'text-[var(--log-info)] border-[var(--log-info)]/30',
  WARNING: 'text-[var(--log-warning)] border-[var(--log-warning)]/30',
  ERROR: 'text-[var(--log-error)] border-[var(--log-error)]/30',
  CRITICAL: 'text-[var(--log-critical)] border-[var(--log-critical)]/50 bg-[var(--log-critical)]/10',
};

/**
 * Get log level color classes
 */
export function getLogLevelColor(level: string): string {
  return LOG_LEVEL_COLORS[level] || 'text-text-muted border-border-subtle';
}
