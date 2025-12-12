'use client';

import { memo } from 'react';
import { X } from 'lucide-react';
import type { Packet } from '@/types/api';
import { formatDateTime } from '@/lib/format';
import { HashBadge } from '@/components/ui/HashBadge';
import {
  getPayloadTypeName,
  getRouteTypeName,
  getPacketTypeColor,
  isTruthy,
} from '@/lib/packet-utils';

interface PacketDetailModalProps {
  packet: Packet;
  onClose: () => void;
}

/**
 * Modal showing full packet details
 */
function PacketDetailModalComponent({ packet, onClose }: PacketDetailModalProps) {
  const payloadTypeName =
    packet.payload_type_name || getPayloadTypeName(packet.payload_type ?? packet.type);
  const routeTypeName =
    packet.route_type_name || getRouteTypeName(packet.route_type ?? packet.route);
  const payloadLength = packet.payload_length ?? packet.length ?? 0;
  const snr = packet.snr ?? 0;
  const txDelay = packet.tx_delay_ms ?? 0;

  // Determine status text and color
  let statusText = 'Received';
  let statusColor = 'text-text-primary';
  if (isTruthy(packet.transmitted)) {
    statusText = 'Transmitted';
    statusColor = 'text-accent-success';
  } else if (isTruthy(packet.is_duplicate)) {
    statusText = 'Duplicate';
    statusColor = 'text-text-muted';
  } else if (packet.drop_reason === 'No transport keys configured') {
    statusText = 'Monitor Only';
    statusColor = 'text-accent-secondary';
  } else if (packet.drop_reason) {
    statusText = packet.drop_reason;
    statusColor = 'text-accent-danger';
  }

  return (
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="glass-card max-w-lg w-full p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-medium text-text-primary">Packet Details</h3>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-primary"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-3 text-sm">
          <DetailRow label="Hash">
            <HashBadge hash={packet.packet_hash} size="sm" />
          </DetailRow>
          <DetailRow label="Timestamp">
            {formatDateTime(packet.timestamp)}
          </DetailRow>
          <DetailRow label="Type">
            <span className={getPacketTypeColor(payloadTypeName)}>{payloadTypeName}</span>
          </DetailRow>
          <DetailRow label="Route">{routeTypeName}</DetailRow>
          <DetailRow label="RSSI">{packet.rssi} dBm</DetailRow>
          <DetailRow label="SNR">{snr.toFixed(2)} dB</DetailRow>

          {packet.src_hash && (
            <DetailRow label="Source">
              <HashBadge hash={packet.src_hash} size="sm" />
            </DetailRow>
          )}
          {packet.dst_hash && (
            <DetailRow label="Destination">
              <HashBadge hash={packet.dst_hash} size="sm" />
            </DetailRow>
          )}
          {packet.path_hash && (
            <DetailRow label="Path">
              <HashBadge hash={packet.path_hash} size="sm" />
            </DetailRow>
          )}

          <DetailRow label="Payload Length">{payloadLength} bytes</DetailRow>

          {packet.score !== undefined && (
            <DetailRow label="Score">{packet.score.toFixed(3)}</DetailRow>
          )}

          <DetailRow label="TX Delay">{txDelay.toFixed(1)} ms</DetailRow>
          <DetailRow label="Status">
            <span className={statusColor}>{statusText}</span>
          </DetailRow>
        </div>
      </div>
    </div>
  );
}

/** Helper component for detail rows */
function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-text-muted">{label}:</span>
      <span className="text-text-primary">{children}</span>
    </div>
  );
}

export const PacketDetailModal = memo(PacketDetailModalComponent);
