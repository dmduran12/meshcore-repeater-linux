'use client';

import { memo } from 'react';
import clsx from 'clsx';
import type { Packet } from '@/types/api';
import { formatDateTime } from '@/lib/format';
import {
  getPayloadTypeName,
  getRouteTypeName,
  getPacketTypeColor,
  getRouteTypeColor,
  isTruthy,
} from '@/lib/packet-utils';

interface PacketRowProps {
  packet: Packet;
  index: number;
  onClick: (packet: Packet) => void;
  isFlashing?: boolean;
}

/**
 * Table row component for packet list
 * Memoized to prevent unnecessary re-renders
 */
function PacketRowComponent({ packet, index, onClick, isFlashing = false }: PacketRowProps) {
  // Handle both API formats: {type, route} and {payload_type, route_type}
  const payloadTypeName =
    packet.payload_type_name || getPayloadTypeName(packet.payload_type ?? packet.type);
  const routeTypeName =
    packet.route_type_name || getRouteTypeName(packet.route_type ?? packet.route);
  const payloadLength = packet.payload_length ?? packet.length ?? 0;
  const snr = packet.snr ?? 0;

  return (
    <tr
      onClick={() => onClick(packet)}
      className={clsx(
        'cursor-pointer transition-colors duration-150',
        'hover:bg-bg-subtle',
        isTruthy(packet.transmitted) && 'bg-accent-success/5',
        isTruthy(packet.is_duplicate) && 'opacity-50',
        isFlashing && 'flash-row'
      )}
    >
      <td className="py-3 px-4 text-sm font-mono text-text-secondary">
        {formatDateTime(packet.timestamp)}
      </td>
      <td className="py-3 px-4">
        <span className={clsx('text-sm font-medium', getPacketTypeColor(payloadTypeName))}>
          {payloadTypeName}
        </span>
      </td>
      <td className="py-3 px-4">
        <span className={clsx('px-2 py-0.5 rounded text-xs border', getRouteTypeColor(routeTypeName))}>
          {routeTypeName}
        </span>
      </td>
      <td className="py-3 px-4 text-sm text-text-secondary">{packet.rssi} dBm</td>
      <td className="py-3 px-4 text-sm text-text-secondary">{snr.toFixed(1)} dB</td>
      <td className="py-3 px-4 text-sm text-text-secondary">{payloadLength}B</td>
      <td className="py-3 px-4">
        <PacketStatus packet={packet} />
      </td>
    </tr>
  );
}

/** Packet status badge */
function PacketStatus({ packet }: { packet: Packet }) {
  if (isTruthy(packet.transmitted)) {
    return <span className="text-xs text-accent-success">✓ TX</span>;
  }
  if (isTruthy(packet.is_duplicate)) {
    return <span className="text-xs text-text-muted">Duplicate</span>;
  }
  if (packet.drop_reason === 'No transport keys configured') {
    return <span className="text-xs text-accent-secondary">Monitor Only</span>;
  }
  if (packet.drop_reason) {
    return <span className="text-xs text-accent-danger">{packet.drop_reason}</span>;
  }
  return <span className="text-xs text-text-muted">RX</span>;
}

export const PacketRow = memo(PacketRowComponent);
