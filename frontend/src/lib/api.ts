// API Client for pyMC Repeater backend

import type {
  Stats,
  Packet,
  PacketFilters,
  LogEntry,
  ApiResponse,
  GraphData,
  HardwareStats,
} from '@/types/api';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

async function fetchApi<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const url = `${API_BASE}${endpoint}`;
  
  // Only include Content-Type for requests with a body (POST, PUT, etc.)
  // This avoids triggering CORS preflight on GET requests
  const headers: Record<string, string> = {};
  if (options?.headers) {
    const h = options.headers;
    if (h instanceof Headers) {
      h.forEach((v, k) => { headers[k] = v; });
    } else if (Array.isArray(h)) {
      h.forEach(([k, v]) => { headers[k] = v; });
    } else {
      Object.assign(headers, h);
    }
  }
  if (options?.body) {
    headers['Content-Type'] = 'application/json';
  }
  
  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

// Stats endpoints
export async function getStats(): Promise<Stats> {
  return fetchApi<Stats>('/api/stats');
}

// Logs endpoint
export async function getLogs(): Promise<{ logs: LogEntry[] }> {
  return fetchApi<{ logs: LogEntry[] }>('/api/logs');
}

// Packet endpoints
export async function getRecentPackets(limit = 100): Promise<ApiResponse<Packet[]>> {
  return fetchApi<ApiResponse<Packet[]>>(`/api/recent_packets?limit=${limit}`);
}

export async function getFilteredPackets(filters: PacketFilters): Promise<ApiResponse<Packet[]>> {
  const params = new URLSearchParams();
  if (filters.type !== undefined) params.append('type', String(filters.type));
  if (filters.route !== undefined) params.append('route', String(filters.route));
  if (filters.start_timestamp) params.append('start_timestamp', String(filters.start_timestamp));
  if (filters.end_timestamp) params.append('end_timestamp', String(filters.end_timestamp));
  if (filters.limit) params.append('limit', String(filters.limit));

  const url = `/api/filtered_packets?${params.toString()}`;
  console.log('[API] getFilteredPackets URL:', url);
  return fetchApi<ApiResponse<Packet[]>>(url);
}

export async function getPacketByHash(hash: string): Promise<ApiResponse<Packet>> {
  return fetchApi<ApiResponse<Packet>>(`/api/packet_by_hash?packet_hash=${hash}`);
}

// Chart data endpoints
export async function getPacketTypeGraphData(hours = 24): Promise<ApiResponse<GraphData>> {
  return fetchApi<ApiResponse<GraphData>>(`/api/packet_type_graph_data?hours=${hours}`);
}

export async function getMetricsGraphData(hours = 24): Promise<ApiResponse<GraphData>> {
  return fetchApi<ApiResponse<GraphData>>(`/api/metrics_graph_data?hours=${hours}`);
}

export async function getNoiseFloorChartData(hours = 24): Promise<ApiResponse<{ chart_data: GraphData }>> {
  return fetchApi<ApiResponse<{ chart_data: GraphData }>>(`/api/noise_floor_chart_data?hours=${hours}`);
}

// Hardware stats
export async function getHardwareStats(): Promise<ApiResponse<HardwareStats>> {
  return fetchApi<ApiResponse<HardwareStats>>('/api/hardware_stats');
}

// Control endpoints
export async function sendAdvert(): Promise<ApiResponse<string>> {
  return fetchApi<ApiResponse<string>>('/api/send_advert', {
    method: 'POST',
  });
}

export async function setMode(mode: 'forward' | 'monitor'): Promise<{ success: boolean; mode: string }> {
  return fetchApi<{ success: boolean; mode: string }>('/api/set_mode', {
    method: 'POST',
    body: JSON.stringify({ mode }),
  });
}

export async function setDutyCycle(enabled: boolean): Promise<{ success: boolean; enabled: boolean }> {
  return fetchApi<{ success: boolean; enabled: boolean }>('/api/set_duty_cycle', {
    method: 'POST',
    body: JSON.stringify({ enabled }),
  });
}

// Packet stats
export async function getPacketStats(hours = 24): Promise<ApiResponse<Record<string, number>>> {
  return fetchApi<ApiResponse<Record<string, number>>>(`/api/packet_stats?hours=${hours}`);
}

export async function getPacketTypeStats(hours = 24): Promise<ApiResponse<Record<string, number>>> {
  return fetchApi<ApiResponse<Record<string, number>>>(`/api/packet_type_stats?hours=${hours}`);
}

// Bucketed stats for dashboard visualization
export interface BucketData {
  bucket: number;
  start: number;
  end: number;
  count: number;
  avg_snr: number;
  avg_rssi: number;
}

export interface BucketedStats {
  time_range_minutes: number;
  bucket_count: number;
  bucket_duration_seconds: number;
  start_time: number;
  end_time: number;
  received: BucketData[];
  transmitted: BucketData[];
  forwarded: BucketData[];
  dropped: BucketData[];
}

export async function getBucketedStats(minutes = 20, buckets = 20): Promise<ApiResponse<BucketedStats>> {
  return fetchApi<ApiResponse<BucketedStats>>(`/api/bucketed_stats?minutes=${minutes}&buckets=${buckets}`);
}

// Airtime utilization stats
export interface UtilizationBin {
  t: number; // bin start timestamp in ms
  tx_airtime_ms: number;
  rx_airtime_ms: number;
  tx_pkts: number;
  rx_pkts_ok: number;
  tx_util_pct: number;
  rx_util_decoded_pct: number;
  radio_activity_pct: number;
  avg_rx_airtime_ms_per_pkt: number;
  avg_tx_airtime_ms_per_pkt: number;
}

export interface UtilizationStats {
  bins: UtilizationBin[];
  bin_duration_seconds: number;
  hours: number;
  anomaly_counters: {
    missing_airtime_ms: number;
    outlier_bins: number;
  };
}

export async function getUtilizationStats(hours = 24): Promise<ApiResponse<UtilizationStats>> {
  return fetchApi<ApiResponse<UtilizationStats>>(`/api/utilization?hours=${hours}`);
}

// Radio configuration types
export interface RadioPreset {
  title: string;
  description: string;
  frequency: string;
  spreading_factor: string;
  bandwidth: string;
  coding_rate: string;
}

export interface RadioConfigUpdate {
  frequency_mhz?: number;
  bandwidth_khz?: number;
  spreading_factor?: number;
  coding_rate?: number;
  tx_power?: number;
  node_name?: string;
}

export interface RadioConfigResult {
  applied: string[];
  persisted: boolean;
  live_update: boolean;
  warnings?: string[];
}

// Radio configuration endpoints
export async function getRadioPresets(): Promise<ApiResponse<RadioPreset[]>> {
  return fetchApi<ApiResponse<RadioPreset[]>>('/api/radio_presets');
}

export async function updateRadioConfig(config: RadioConfigUpdate): Promise<ApiResponse<RadioConfigResult>> {
  return fetchApi<ApiResponse<RadioConfigResult>>('/api/update_radio_config', {
    method: 'POST',
    body: JSON.stringify(config),
  });
}
