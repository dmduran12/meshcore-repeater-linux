// API Response Types for pyMC Repeater

export interface RadioConfig {
  frequency: number;
  tx_power: number;
  bandwidth: number;
  spreading_factor: number;
  coding_rate: number;
  preamble_length: number;
}

export interface RepeaterConfig {
  mode: string;
  use_score_for_tx: boolean;
  score_threshold: number;
  send_advert_interval_hours: number;
  latitude: number;
  longitude: number;
}

export interface DutyCycleConfig {
  max_airtime_percent: number;
  enforcement_enabled: boolean;
}

export interface DelaysConfig {
  tx_delay_factor: number;
  direct_tx_delay_factor: number;
}

export interface StatsConfig {
  node_name: string;
  radio: RadioConfig;
  repeater: RepeaterConfig;
  duty_cycle: DutyCycleConfig;
  delays: DelaysConfig;
}

export interface NeighborInfo {
  name?: string;
  node_name?: string;  // API may return either
  last_seen: number;
  first_seen?: number;
  rssi?: number;
  snr?: number;
  advert_count?: number;
  latitude?: number;
  longitude?: number;
  is_repeater?: boolean;
  route_type?: number;
  contact_type?: string;
  zero_hop?: boolean;  // True if advert was received directly (not relayed)
}

export interface Stats {
  // Node identification
  node_name: string;
  public_key: string | null;
  local_hash: string;
  
  // Packet counts
  // rx_count: packets received from radio
  // tx_count: packets we originated locally (adverts, trace responses)
  // forwarded_count: received packets that we retransmitted
  // dropped_count: received packets that we did NOT retransmit
  rx_count: number;
  tx_count: number;
  forwarded_count: number;
  dropped_count: number;
  
  // Rate stats
  rx_per_hour: number;
  forwarded_per_hour: number;
  
  // Timing
  uptime_seconds: number;
  
  // Radio
  noise_floor_dbm: number | null;
  
  // Airtime tracking (from AirtimeManager.get_stats())
  airtime_used_ms: number;
  airtime_remaining_ms: number;
  duty_cycle_percent: number;
  current_airtime_ms: number;
  max_airtime_ms: number;
  utilization_percent: number;
  total_airtime_ms: number;
  
  // Cache info
  duplicate_cache_size: number;
  cache_ttl: number;
  
  // Neighbors
  neighbors: Record<string, NeighborInfo>;
  
  // Full config
  config: StatsConfig;
  
  // Version info
  version: string;
  core_version: string;
}

// Duplicate packet entry (compact, stored in SQLite JSON array)
export interface PacketDuplicate {
  timestamp: number;
  rssi?: number;
  snr?: number;
}

export interface Packet {
  // ID may be numeric from DB or undefined for in-memory packets
  id?: number;
  timestamp: number;
  packet_hash: string;
  
  // Payload type - API returns 'type' as int, frontend may use payload_type/payload_type_name
  type?: number;  // From SQLite API
  payload_type?: number;
  payload_type_name?: string;
  
  // Route type - API returns 'route' as int, frontend may use route_type/route_type_name  
  route?: number;  // From SQLite API
  route_type?: number;
  route_type_name?: string;
  
  // Signal info
  rssi: number;
  snr: number;
  
  // Size info
  length?: number;  // From SQLite API
  path_length?: number;
  payload_length?: number;
  
  // Status
  transmitted: boolean;
  drop_reason: string | null;
  is_duplicate: boolean;
  tx_delay_ms?: number;
  
  // Packet origin: 'rx' (received), 'tx_local' (originated here), 'tx_forward' (forwarding)
  packet_origin?: 'rx' | 'tx_local' | 'tx_forward';
  
  // Duplicate tracking (persisted to SQLite, survives restarts)
  duplicates?: PacketDuplicate[];
  
  // Additional fields from API
  src_hash?: string;
  dst_hash?: string;
  path_hash?: string;
  score?: number;
  header?: string;
  payload?: string;
  original_path?: string[];
  forwarded_path?: string[];
  raw_packet?: string;
}

export interface PacketFilters {
  type?: number;
  route?: number;
  start_timestamp?: number;
  end_timestamp?: number;
  limit?: number;
}

export interface LogEntry {
  message: string;
  timestamp: string;
  level: string;
}

export interface NoiseFloorData {
  timestamp: number;
  noise_floor: number;
}

export interface ChartDataPoint {
  timestamp: number;
  value: number;
}

export interface PacketTypeStats {
  [key: string]: number;
}

export interface HardwareStats {
  cpu_percent: number;
  memory_percent: number;
  memory_used_mb: number;
  memory_total_mb: number;
  disk_percent: number;
  disk_used_gb: number;
  disk_total_gb: number;
  temperature?: number;
  load_average: number[];
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  count?: number;
}

export interface GraphDataSeries {
  name: string;
  type: string;
  data: [number, number][];
}

export interface GraphData {
  start_time: number;
  end_time: number;
  step: number;
  timestamps: number[];
  series: GraphDataSeries[];
}

// Packet type constants
export const PAYLOAD_TYPES: Record<number, string> = {
  0: 'REQ',
  1: 'RESPONSE',
  2: 'TXT_MSG',
  3: 'ACK',
  4: 'ADVERT',
  5: 'GRP_TXT',
  6: 'GRP_DATA',
  7: 'ANON_REQ',
  8: 'PATH',
  9: 'TRACE',
  10: 'RAW_CUSTOM',
};

export const ROUTE_TYPES: Record<number, string> = {
  0: 'UNKNOWN',
  1: 'DIRECT',
  2: 'FLOOD',
  3: 'TRANSPORT',
  4: 'T_FLOOD',   // Transport flood
  5: 'T_DIRECT',  // Transport direct
};
