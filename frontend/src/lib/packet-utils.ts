/**
 * Packet-related utilities for pyMC Repeater frontend
 * Consolidated from packets/page.tsx and RecentPackets.tsx
 */

import { PAYLOAD_TYPES, ROUTE_TYPES } from '@/types/api';

/**
 * Get payload type name from numeric type
 */
export function getPayloadTypeName(type: number | undefined): string {
  if (type === undefined || type === null) return 'UNKNOWN';
  return PAYLOAD_TYPES[type] || `TYPE_${type}`;
}

/**
 * Get route type name from numeric route
 */
export function getRouteTypeName(route: number | undefined): string {
  if (route === undefined || route === null) return 'UNKNOWN';
  return ROUTE_TYPES[route] || `ROUTE_${route}`;
}

/**
 * Get CSS color class for packet type badge
 */
export function getPacketTypeColor(type: string): string {
  const colors: Record<string, string> = {
    ADVERT: 'text-[var(--pkt-advert)]',
    FLOOD: 'text-[var(--pkt-flood)]',
    TXT_MSG: 'text-[var(--pkt-txt-msg)]',
    ACK: 'text-[var(--pkt-ack)]',
    TRACE: 'text-[var(--pkt-trace)]',
    REQ: 'text-[var(--pkt-req)]',
    RESPONSE: 'text-[var(--pkt-response)]',
    GRP_TXT: 'text-[var(--pkt-grp-txt)]',
    GRP_DATA: 'text-[var(--pkt-grp-data)]',
    PATH: 'text-[var(--pkt-path)]',
    ANON_REQ: 'text-[var(--pkt-anon)]',
  };
  return colors[type] || 'text-[var(--pkt-unknown)]';
}

/**
 * Get CSS classes for route type badge (background, text, border)
 */
export function getRouteTypeColor(route: string): string {
  const colors: Record<string, string> = {
    FLOOD: 'bg-[var(--route-flood)]/20 text-[var(--route-flood)] border-[var(--route-flood)]/30',
    DIRECT: 'bg-[var(--route-direct)]/20 text-[var(--route-direct)] border-[var(--route-direct)]/30',
    TRANSPORT:
      'bg-[var(--route-transport)]/20 text-[var(--route-transport)] border-[var(--route-transport)]/30',
    T_FLOOD: 'bg-[var(--route-flood)]/20 text-[var(--route-flood)] border-[var(--route-flood)]/30',
    T_DIRECT:
      'bg-[var(--route-direct)]/20 text-[var(--route-direct)] border-[var(--route-direct)]/30',
  };
  return colors[route] || 'bg-bg-subtle text-text-muted border-border-subtle';
}

/**
 * Handle SQLite boolean (0/1) or JS boolean
 * SQLite returns 0/1 for boolean columns, JS uses true/false
 */
export function isTruthy(val: boolean | number | undefined | null): boolean {
  return val === 1 || val === true;
}

/**
 * Get signal quality color based on SNR
 */
export function getSignalColor(snr?: number): string {
  if (snr === undefined) return 'bg-[var(--signal-unknown)]';
  if (snr >= 5) return 'bg-[var(--signal-excellent)]';
  if (snr >= 0) return 'bg-[var(--signal-good)]';
  if (snr >= -5) return 'bg-[var(--signal-fair)]';
  if (snr >= -10) return 'bg-[var(--signal-poor)]';
  return 'bg-[var(--signal-critical)]';
}
