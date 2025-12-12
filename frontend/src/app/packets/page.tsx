'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Radio, Filter, RefreshCw, Circle, X } from 'lucide-react';
import clsx from 'clsx';
import { getRecentPackets } from '@/lib/api';
import type { Packet, PacketFilters } from '@/types/api';
import { PAYLOAD_TYPES, ROUTE_TYPES } from '@/types/api';
import { usePolling } from '@/lib/hooks/usePolling';
import { POLLING_INTERVALS } from '@/lib/constants';
import { getPayloadTypeName } from '@/lib/packet-utils';
import { useFlashAdvert } from '@/lib/stores/useStore';
import { PacketRow } from '@/components/packets/PacketRow';
import { PacketDetailModal } from '@/components/packets/PacketDetailModal';

export default function PacketsPage() {
  const [packets, setPackets] = useState<Packet[]>([]);
  const [loading, setLoading] = useState(true);
  const [liveMode, setLiveMode] = useState(true);
  const [selectedPacket, setSelectedPacket] = useState<Packet | null>(null);
  const [filters, setFilters] = useState<PacketFilters>({
    limit: 100,
  });
  const flashAdvert = useFlashAdvert();
  const [flashingAdvertId, setFlashingAdvertId] = useState<string | null>(null);
  const lastHandledFlash = useRef(0);

  const fetchPackets = useCallback(async () => {
    try {
      const response = await getRecentPackets(filters.limit || 100);
      
      if (response.success && response.data) {
        let filteredData = response.data;
        
        // Apply client-side type filter
        if (filters.type !== undefined) {
          const filterTypeName = PAYLOAD_TYPES[filters.type];
          filteredData = filteredData.filter((p) => {
            const packetTypeNum = p.type ?? p.payload_type;
            const packetTypeName = p.payload_type_name;
            return packetTypeNum === filters.type || packetTypeName === filterTypeName;
          });
        }
        
        // Apply client-side route filter
        if (filters.route !== undefined) {
          const filterRouteName = ROUTE_TYPES[filters.route];
          filteredData = filteredData.filter((p) => {
            const packetRouteNum = p.route ?? p.route_type;
            const packetRouteName = p.route_type_name;
            return packetRouteNum === filters.route || packetRouteName === filterRouteName;
          });
        }
        
        setPackets(filteredData);
      }
    } catch {
      // Silently fail - UI shows stale data
    } finally {
      setLoading(false);
    }
  }, [filters]);

  // Fetch immediately when filters change
  useEffect(() => {
    fetchPackets();
  }, [fetchPackets]);

  // Set up polling for live mode (skip initial since useEffect handles it)
  usePolling(fetchPackets, POLLING_INTERVALS.packets, liveMode, true);
  
  // Detect new advert packets when flashAdvert changes (only trigger once per flash)
  useEffect(() => {
    // Only trigger if this is a new flash we haven't handled
    if (flashAdvert > 0 && flashAdvert !== lastHandledFlash.current && packets.length > 0) {
      lastHandledFlash.current = flashAdvert;
      // Find the newest advert packet
      const newestAdvert = packets.find(p => {
        const typeName = p.payload_type_name || getPayloadTypeName(p.payload_type ?? p.type);
        return typeName.toLowerCase().includes('advert');
      });
      if (newestAdvert) {
        const id = String(newestAdvert.id ?? newestAdvert.packet_hash ?? '');
        // Use requestAnimationFrame to avoid synchronous setState in effect
        const raf = requestAnimationFrame(() => setFlashingAdvertId(id));
        const timer = setTimeout(() => setFlashingAdvertId(null), 600);
        return () => {
          cancelAnimationFrame(raf);
          clearTimeout(timer);
        };
      }
    }
  }, [flashAdvert, packets]);

  const handleFilterChange = (key: keyof PacketFilters, value: number | undefined) => {
    setLoading(true);
    setFilters(prev => ({ ...prev, [key]: value }));
  };

  const clearFilters = () => {
    setLoading(true);
    setFilters({ limit: 100 });
  };

  return (
    <div className="section-gap">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="type-title text-text-primary flex items-center gap-3">
          <Radio className="w-6 h-6 text-accent-primary flex-shrink-0" />
          Packet History
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
              'px-3 py-1.5 sm:px-4 sm:py-2 rounded-lg text-sm font-medium transition-all duration-200',
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

      {/* Filters */}
      <div className="glass-card p-4">
        <div className="flex items-center gap-2 mb-4">
          <Filter className="w-5 h-5 text-accent-primary" />
          <span className="text-text-primary font-medium">Filters</span>
          {(filters.type !== undefined || filters.route !== undefined) && (
            <button
              onClick={clearFilters}
              className="ml-auto text-xs text-text-muted hover:text-text-primary flex items-center gap-1"
            >
              <X className="w-3 h-3" /> Clear
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-4">
          {/* Type filter */}
          <div>
            <label className="block text-xs text-text-muted mb-1">Packet Type</label>
            <select
              value={filters.type ?? ''}
              onChange={(e) => handleFilterChange('type', e.target.value ? Number(e.target.value) : undefined)}
              className="bg-bg-subtle border border-border-subtle rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent-primary/50"
            >
              <option value="">All Types</option>
              {Object.entries(PAYLOAD_TYPES).map(([value, name]) => (
                <option key={value} value={value}>{name}</option>
              ))}
            </select>
          </div>

          {/* Route filter */}
          <div>
            <label className="block text-xs text-text-muted mb-1">Route Type</label>
            <select
              value={filters.route ?? ''}
              onChange={(e) => handleFilterChange('route', e.target.value ? Number(e.target.value) : undefined)}
              className="bg-bg-subtle border border-border-subtle rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent-primary/50"
            >
              <option value="">All Routes</option>
              {Object.entries(ROUTE_TYPES).map(([value, name]) => (
                <option key={value} value={value}>{name}</option>
              ))}
            </select>
          </div>

          {/* Limit */}
          <div>
            <label className="block text-xs text-text-muted mb-1">Limit</label>
            <select
              value={filters.limit ?? 100}
              onChange={(e) => handleFilterChange('limit', Number(e.target.value))}
              className="bg-bg-subtle border border-border-subtle rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent-primary/50"
            >
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={200}>200</option>
              <option value={500}>500</option>
            </select>
          </div>
        </div>
      </div>

      {/* Packets Table */}
      <div className="glass-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border-subtle">
                <th className="text-left py-3 px-4 text-xs font-medium text-text-muted uppercase tracking-wider">Time</th>
                <th className="text-left py-3 px-4 text-xs font-medium text-text-muted uppercase tracking-wider">Type</th>
                <th className="text-left py-3 px-4 text-xs font-medium text-text-muted uppercase tracking-wider">Route</th>
                <th className="text-left py-3 px-4 text-xs font-medium text-text-muted uppercase tracking-wider">RSSI</th>
                <th className="text-left py-3 px-4 text-xs font-medium text-text-muted uppercase tracking-wider">SNR</th>
                <th className="text-left py-3 px-4 text-xs font-medium text-text-muted uppercase tracking-wider">Length</th>
                <th className="text-left py-3 px-4 text-xs font-medium text-text-muted uppercase tracking-wider">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle/50">
              {loading && packets.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-text-muted">
                    Loading packets...
                  </td>
                </tr>
              ) : packets.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-text-muted">
                    No packets found
                  </td>
                </tr>
              ) : (
                packets.map((packet, index) => {
                  const packetId = packet.id ?? packet.packet_hash ?? String(index);
                  const typeName = packet.payload_type_name || getPayloadTypeName(packet.payload_type ?? packet.type);
                  const isAdvert = typeName.toLowerCase().includes('advert');
                  return (
                    <PacketRow
                      key={packetId}
                      packet={packet}
                      index={index}
                      onClick={setSelectedPacket}
                      isFlashing={isAdvert && flashingAdvertId === packetId}
                    />
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-3 border-t border-border-subtle text-sm text-text-muted">
          Showing {packets.length} packets
        </div>
      </div>

      {/* Packet Detail Modal */}
      {selectedPacket && (
        <PacketDetailModal
          packet={selectedPacket}
          onClose={() => setSelectedPacket(null)}
        />
      )}
    </div>
  );
}
