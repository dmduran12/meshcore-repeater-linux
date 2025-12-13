'use client';

import { useStore } from '@/lib/stores/useStore';
import { Users, Signal, Clock, Radio, MapPin, Repeat } from 'lucide-react';
import { formatRelativeTime } from '@/lib/format';
import NeighborMapWrapper from '@/components/neighbors/NeighborMapWrapper';
import { HashBadge } from '@/components/ui/HashBadge';

// Get signal color for card badges based on SNR
function getSignalColor(snr?: number): string {
  if (snr === undefined) return 'bg-[var(--signal-unknown)]';
  if (snr >= 5) return 'bg-[var(--signal-excellent)]';
  if (snr >= 0) return 'bg-[var(--signal-good)]';
  if (snr >= -5) return 'bg-[var(--signal-fair)]';
  if (snr >= -10) return 'bg-[var(--signal-poor)]';
  return 'bg-[var(--signal-critical)]';
}

export default function NeighborsPage() {
  const { stats } = useStore();
  const neighbors = stats?.neighbors ?? {};
  const neighborEntries = Object.entries(neighbors);
  
  // Get local node info from config
  const localNode = stats?.config?.repeater ? {
    latitude: stats.config.repeater.latitude,
    longitude: stats.config.repeater.longitude,
    name: stats.config.node_name || 'Local Node'
  } : undefined;
  
  // Count neighbors with location data
  const neighborsWithLocation = neighborEntries.filter(
    ([, n]) => n.latitude && n.longitude && n.latitude !== 0 && n.longitude !== 0
  ).length;

  return (
    <div className="section-gap">
      {/* Header */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-baseline sm:justify-between">
        <h1 className="type-title text-text-primary flex items-center gap-3">
          <Users className="w-6 h-6 text-accent-primary flex-shrink-0" />
          Neighbors
        </h1>
        <div className="flex items-baseline gap-3 sm:gap-4">
          <span className="roster-title tabular-nums">{neighborEntries.length} node{neighborEntries.length !== 1 ? 's' : ''}</span>
          {neighborsWithLocation > 0 && (
            <span className="roster-title flex items-baseline gap-1.5 tabular-nums">
              <MapPin className="w-3.5 h-3.5 relative top-[2px]" />
              {neighborsWithLocation} with location
            </span>
          )}
        </div>
      </div>
      
      {/* Map */}
      <div className="relative">
        <NeighborMapWrapper neighbors={neighbors} localNode={localNode} />
      </div>

      {/* Neighbors List */}
      <div className="chart-container">
        <div className="chart-header">
          <div className="chart-title">
            <Users className="chart-title-icon" />
            Discovered Nodes
          </div>
          <span className="type-data-xs text-text-muted tabular-nums">
            {neighborEntries.length} total
          </span>
        </div>
        
        {neighborEntries.length > 0 ? (
          <div className="roster-list">
            {neighborEntries.map(([hash, neighbor], index) => {
              const hasLocation = neighbor.latitude && neighbor.longitude && 
                                  neighbor.latitude !== 0 && neighbor.longitude !== 0;
              const displayName = neighbor.node_name || neighbor.name || 'Unknown';
              const snr = neighbor.snr ?? 0;
              
              return (
                <div key={hash}>
                  <div className="roster-row">
                    {/* Icon with signal indicator */}
                    <div className="relative">
                      <div className="roster-icon">
                        {neighbor.is_repeater ? (
                          <Repeat className="w-5 h-5 text-accent-primary" />
                        ) : (
                          <Radio className="w-5 h-5 text-text-muted" />
                        )}
                      </div>
                      <div className={`absolute -top-0.5 -right-0.5 w-2.5 h-2.5 rounded-full ${getSignalColor(neighbor.snr)} border-2 border-bg-surface`} />
                    </div>
                    
                    {/* Main content */}
                    <div className="roster-content">
                      <div className="flex items-center gap-2">
                        <span className="roster-title">{displayName}</span>
                        {neighbor.is_repeater && (
                          <span className="pill-tag">RPT</span>
                        )}
                      </div>
                      <HashBadge hash={hash} size="sm" />
                    </div>
                    
                    {/* Metrics row */}
                    <div className="roster-metrics">
                      {neighbor.rssi !== undefined && (
                        <div className="flex items-center gap-1.5">
                          <Signal className="w-3.5 h-3.5" />
                          <span className="type-data-xs tabular-nums">{neighbor.rssi}</span>
                        </div>
                      )}
                      {neighbor.snr !== undefined && (
                        <div className="flex items-center gap-1.5">
                          <span className="type-data-xs tabular-nums">{snr.toFixed(1)} dB</span>
                        </div>
                      )}
                      {hasLocation && (
                        <MapPin className="w-3.5 h-3.5 text-accent-tertiary" />
                      )}
                    </div>
                    
                    {/* Last seen */}
                    <div className="roster-metric">
                      {neighbor.last_seen ? formatRelativeTime(neighbor.last_seen) : '—'}
                    </div>
                  </div>
                  
                  {/* Separator between rows */}
                  {index < neighborEntries.length - 1 && (
                    <div className="roster-separator" />
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="roster-empty">
            <Users className="roster-empty-icon" />
            <div className="roster-empty-title">No Neighbors Discovered</div>
            <div className="roster-empty-text">
              Neighbors will appear here as they advertise on the mesh network.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
