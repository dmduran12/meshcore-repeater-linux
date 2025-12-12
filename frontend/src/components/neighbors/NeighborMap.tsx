'use client';

import { useEffect, useMemo, useRef } from 'react';
import { MapContainer, TileLayer, CircleMarker, Polyline, Popup, useMap } from 'react-leaflet';
import { NeighborInfo } from '@/types/api';
import { formatRelativeTime } from '@/lib/format';
import { HashBadge } from '@/components/ui/HashBadge';

interface LocalNode {
  latitude: number;
  longitude: number;
  name: string;
}

interface NeighborMapProps {
  neighbors: Record<string, NeighborInfo>;
  localNode?: LocalNode;
}

// Signal color constants from CSS variables (computed for map use)
const SIGNAL_COLORS = {
  excellent: '#4CFFB5',  // --signal-excellent
  good: '#39D98A',       // --signal-good
  fair: '#F9D26F',       // --signal-fair
  poor: '#FF8A5C',       // --signal-poor
  critical: '#FF5C7A',   // --signal-critical
  unknown: '#767688',    // --signal-unknown
  localNode: '#60A5FA',  // --map-local-node
};

// Calculate distance between two points in km (Haversine formula)
function getDistanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Line color for connections
const LINE_COLOR = '#5D6570';

// Get color based on signal strength (SNR is more reliable than RSSI for LoRa)
function getSignalColor(snr?: number, rssi?: number): string {
  // Use SNR as primary indicator (-20 to +10 typical range)
  if (snr !== undefined) {
    if (snr >= 5) return SIGNAL_COLORS.excellent;
    if (snr >= 0) return SIGNAL_COLORS.good;
    if (snr >= -5) return SIGNAL_COLORS.fair;
    if (snr >= -10) return SIGNAL_COLORS.poor;
    return SIGNAL_COLORS.critical;
  }
  
  // Fallback to RSSI if no SNR (-120 to -50 typical range)
  if (rssi !== undefined) {
    if (rssi >= -70) return SIGNAL_COLORS.excellent;
    if (rssi >= -85) return SIGNAL_COLORS.good;
    if (rssi >= -100) return SIGNAL_COLORS.fair;
    if (rssi >= -110) return SIGNAL_COLORS.poor;
    return SIGNAL_COLORS.critical;
  }
  
  return SIGNAL_COLORS.unknown;
}

// Component to fit bounds only on initial load (not when user navigates)
function FitBoundsOnce({ positions }: { positions: [number, number][] }) {
  const map = useMap();
  const hasFitted = useRef(false);
  
  useEffect(() => {
    // Only fit bounds once on initial load
    if (positions.length > 0 && !hasFitted.current) {
      hasFitted.current = true;
      if (positions.length === 1) {
        map.setView(positions[0], 12);
      } else {
        // Tighter padding for better initial framing of the mesh
        map.fitBounds(positions, { 
          padding: [30, 30],
          maxZoom: 14 
        });
      }
    }
  }, [map, positions]);
  
  return null;
}

export default function NeighborMap({ neighbors, localNode }: NeighborMapProps) {
  // Filter neighbors with valid coordinates
  const neighborsWithLocation = useMemo(() => {
    return Object.entries(neighbors).filter(([, neighbor]) => {
      const lat = neighbor.latitude;
      const lng = neighbor.longitude;
      return lat !== undefined && lng !== undefined && lat !== 0 && lng !== 0;
    });
  }, [neighbors]);
  
  // Collect all positions for bounds fitting
  const allPositions = useMemo(() => {
    const positions: [number, number][] = [];
    
    if (localNode && localNode.latitude && localNode.longitude) {
      positions.push([localNode.latitude, localNode.longitude]);
    }
    
    neighborsWithLocation.forEach(([, neighbor]) => {
      if (neighbor.latitude && neighbor.longitude) {
        positions.push([neighbor.latitude, neighbor.longitude]);
      }
    });
    
    return positions;
  }, [neighborsWithLocation, localNode]);
  
  // Default center (will be overridden by FitBounds)
  const defaultCenter: [number, number] = localNode && localNode.latitude && localNode.longitude
    ? [localNode.latitude, localNode.longitude]
    : allPositions.length > 0 
      ? allPositions[0] 
      : [51.505, -0.09]; // London as fallback
  
  // No locations available
  if (allPositions.length === 0) {
    return (
      <div className="glass-card h-[400px] flex items-center justify-center">
        <div className="text-center text-white/50">
          <p className="text-lg mb-2">No Location Data Available</p>
          <p className="text-sm">
            Neighbors will appear on the map once they advertise their coordinates.
          </p>
        </div>
      </div>
    );
  }
  
  return (
    <div className="relative rounded-[1.125rem] overflow-hidden" style={{ height: '400px' }}>
      {/* Map container with glass card styling */}
      <div className="glass-card h-full relative">
        {/* Glass overlay effect on top of map */}
        <div 
          className="absolute inset-0 z-[500] pointer-events-none"
          style={{
            background: 'linear-gradient(180deg, rgba(140, 170, 220, 0.06) 0%, transparent 20%)',
            boxShadow: 'inset 4px 4px 7px -4px rgba(160, 180, 220, 0.12), inset -4px -4px 7px -4px rgba(100, 140, 180, 0.08)',
            borderRadius: 'inherit',
          }}
        />
        {/* Directional border overlay */}
        <div 
          className="absolute inset-0 z-[501] pointer-events-none"
          style={{
            borderRadius: 'inherit',
            border: '1px solid transparent',
            borderTopColor: 'rgba(140, 160, 200, 0.38)',
            borderLeftColor: 'rgba(140, 160, 200, 0.28)',
            borderRightColor: 'rgba(100, 140, 180, 0.15)',
            borderBottomColor: 'rgba(100, 140, 180, 0.18)',
          }}
        />
        <MapContainer
          center={defaultCenter}
          zoom={8}
          style={{ height: '100%', width: '100%', background: '#0d1520' }}
          attributionControl={true}
          className="map-blue-water"
        >
        {/* CARTO Dark Matter tiles with blue water tint applied via CSS */}
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          className="map-tiles-blue-tint"
        />
        
        <FitBoundsOnce positions={allPositions} />
        
        {/* Draw straight lines to neighbors */}
        {localNode && localNode.latitude && localNode.longitude && neighborsWithLocation.map(([hash, neighbor]) => {
          if (!neighbor.latitude || !neighbor.longitude) return null;
          
          return (
            <Polyline
              key={`line-${hash}`}
              positions={[
                [localNode.latitude, localNode.longitude],
                [neighbor.latitude, neighbor.longitude]
              ]}
              color={LINE_COLOR}
              weight={1.2}
              opacity={0.55}
            />
          );
        })}
        
        {/* Local node marker */}
        {localNode && localNode.latitude && localNode.longitude && (
          <CircleMarker
            center={[localNode.latitude, localNode.longitude]}
            radius={5}
            fillColor={SIGNAL_COLORS.localNode}
            color="transparent"
            weight={0}
            opacity={1}
            fillOpacity={0.9}
          >
            <Popup>
              <div className="text-gray-900 text-sm">
                <strong className="text-base">{localNode.name}</strong>
                <br />
                <span className="text-cyan-600 font-medium">This Node (Local)</span>
                <br />
                <span className="text-xs text-gray-500">
                  {localNode.latitude.toFixed(5)}, {localNode.longitude.toFixed(5)}
                </span>
              </div>
            </Popup>
          </CircleMarker>
        )}
        
        {/* Neighbor markers - colored by signal strength */}
        {neighborsWithLocation.map(([hash, neighbor]) => {
          if (!neighbor.latitude || !neighbor.longitude) return null;
          
          const color = getSignalColor(neighbor.snr, neighbor.rssi);
          const name = neighbor.node_name || neighbor.name || 'Unknown';
          
          return (
            <CircleMarker
              key={hash}
              center={[neighbor.latitude, neighbor.longitude]}
              radius={4}
              fillColor={color}
              color="transparent"
              weight={0}
              opacity={1}
              fillOpacity={0.9}
            >
              <Popup>
                <div className="text-gray-900 text-sm min-w-[150px]">
                  <strong className="text-base">{name}</strong>
                  <div className="mt-1">
                    <HashBadge hash={hash} size="sm" className="!bg-gray-100 !border-gray-200 !text-gray-700" />
                  </div>
                  <hr className="my-2 border-gray-200" />
                  {neighbor.rssi !== undefined && (
                    <div>RSSI: <strong>{neighbor.rssi} dBm</strong></div>
                  )}
                  {neighbor.snr !== undefined && (
                    <div>SNR: <strong>{neighbor.snr.toFixed(1)} dB</strong></div>
                  )}
                  {neighbor.advert_count !== undefined && (
                    <div>Adverts: <strong>{neighbor.advert_count}</strong></div>
                  )}
                  <div className="text-xs text-gray-500 mt-1">
                    Last seen: {formatRelativeTime(neighbor.last_seen)}
                  </div>
                  <div className="text-xs text-gray-400">
                    {neighbor.latitude?.toFixed(5)}, {neighbor.longitude?.toFixed(5)}
                  </div>
                </div>
              </Popup>
            </CircleMarker>
          );
        })}
        </MapContainer>
        
        {/* Legend - inside the map card, bottom-left corner */}
        <div 
          className="absolute bottom-4 left-4 z-[600] text-xs"
          style={{
            background: 'rgba(20, 20, 22, 0.85)',
            backdropFilter: 'blur(12px)',
            WebkitBackdropFilter: 'blur(12px)',
            borderRadius: '0.75rem',
            padding: '0.625rem',
            border: '1px solid rgba(140, 160, 200, 0.2)',
            maxWidth: '100px',
          }}
        >
          <div className="text-text-secondary font-medium mb-1.5">Signal</div>
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: SIGNAL_COLORS.excellent }}></div>
              <span className="text-text-muted">≥5 dB</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: SIGNAL_COLORS.good }}></div>
              <span className="text-text-muted">0–5</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: SIGNAL_COLORS.fair }}></div>
              <span className="text-text-muted">-5–0</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: SIGNAL_COLORS.poor }}></div>
              <span className="text-text-muted">-10–-5</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: SIGNAL_COLORS.critical }}></div>
              <span className="text-text-muted">&lt;-10</span>
            </div>
            <div className="flex items-center gap-1.5 mt-1 pt-1 border-t border-white/10">
              <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: SIGNAL_COLORS.localNode }}></div>
              <span className="text-text-muted">Local</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
