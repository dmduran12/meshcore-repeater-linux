'use client';

import { memo } from 'react';
import { usePackets, usePacketsLoading, useLiveMode, useFetchPackets } from '@/lib/stores/useStore';
import { usePolling } from '@/lib/hooks/usePolling';
import { Radio, Circle, ArrowRight } from 'lucide-react';
import clsx from 'clsx';
import Link from 'next/link';
import { formatTime } from '@/lib/format';
import { POLLING_INTERVALS } from '@/lib/constants';
import {
  getPayloadTypeName,
  getRouteTypeName,
  getPacketTypeColor,
  isTruthy,
} from '@/lib/packet-utils';
import type { Packet } from '@/types/api';

/** Memoized recent packet row */
const RecentPacketRow = memo(function RecentPacketRow({ packet, index }: { packet: Packet; index: number }) {
  const payloadTypeName = packet.payload_type_name || getPayloadTypeName(packet.payload_type ?? packet.type);
  const routeTypeName = packet.route_type_name || getRouteTypeName(packet.route_type ?? packet.route);
  const payloadLength = packet.payload_length ?? packet.length ?? 0;
  const snr = packet.snr ?? 0;
  
  return (
    <div
      className={clsx(
        'roster-row',
        isTruthy(packet.transmitted) && 'bg-accent-success/5',
        isTruthy(packet.is_duplicate) && 'opacity-50'
      )}
    >
      <div className="roster-icon-sm">
        <Radio className="w-4 h-4 text-text-muted" />
      </div>
      <div className="roster-content">
        <div className="flex items-center gap-2">
          <span className={clsx('pill-tag', getPacketTypeColor(payloadTypeName))}>
            {payloadTypeName}
          </span>
          <span className="pill-tag" style={{ background: 'var(--bg-subtle)' }}>
            {routeTypeName}
          </span>
        </div>
        <div className="flex items-center gap-3 type-data-xs text-text-muted mt-1">
          <span className="tabular-nums">{packet.rssi} dBm</span>
          <span className="tabular-nums">{snr.toFixed(1)} dB</span>
          <span className="tabular-nums">{payloadLength}B</span>
          {isTruthy(packet.transmitted) ? (
            <span className="text-accent-success">✓ TX</span>
          ) : isTruthy(packet.is_duplicate) ? (
            <span>duplicate</span>
          ) : packet.drop_reason === 'No transport keys configured' ? (
            <span className="text-accent-secondary">monitor</span>
          ) : packet.drop_reason ? (
            <span className="text-accent-danger">{packet.drop_reason}</span>
          ) : (
            <span>RX</span>
          )}
        </div>
      </div>
      <div className="roster-metric text-text-muted">
        {formatTime(packet.timestamp)}
      </div>
    </div>
  );
});

export function RecentPackets() {
  const packets = usePackets();
  const packetsLoading = usePacketsLoading();
  const liveMode = useLiveMode();
  const fetchPackets = useFetchPackets();

  // Poll packets when in live mode
  usePolling(
    () => fetchPackets(20),
    POLLING_INTERVALS.packets,
    liveMode
  );

  return (
    <div className="chart-container h-full">
      <div className="chart-header">
        <div className="chart-title">
          <Radio className="chart-title-icon" />
          Recent Packets
        </div>
        <div className="flex items-center gap-3">
          {liveMode && (
            <div className="flex items-center gap-2">
              <Circle className="w-2 h-2 fill-accent-success text-accent-success animate-pulse" />
              <span className="type-data-xs text-text-muted">LIVE</span>
            </div>
          )}
          <Link 
            href="/packets"
            className="pill-subtle"
          >
            View all <ArrowRight className="w-3 h-3" />
          </Link>
        </div>
      </div>

      <div className="roster-list max-h-[400px] overflow-y-auto p-2">
        {packetsLoading && packets.length === 0 ? (
          <div className="roster-empty">
            <div className="roster-empty-text">Loading packets...</div>
          </div>
        ) : packets.length === 0 ? (
          <div className="roster-empty">
            <Radio className="roster-empty-icon" />
            <div className="roster-empty-title">No packets received</div>
            <div className="roster-empty-text">Packets will appear here as they are received</div>
          </div>
        ) : (
          packets.slice(0, 15).map((packet, index) => (
            <RecentPacketRow
              key={packet.id ?? packet.packet_hash ?? index}
              packet={packet}
              index={index}
            />
          ))
        )}
      </div>
    </div>
  );
}
