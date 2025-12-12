'use client';

import dynamic from 'next/dynamic';
import { NeighborInfo } from '@/types/api';

interface LocalNode {
  latitude: number;
  longitude: number;
  name: string;
}

interface NeighborMapWrapperProps {
  neighbors: Record<string, NeighborInfo>;
  localNode?: LocalNode;
}

// Dynamic import with SSR disabled - Leaflet requires window object
const NeighborMap = dynamic(
  () => import('./NeighborMap'),
  { 
    ssr: false,
    loading: () => (
      <div className="glass-card h-[400px] flex items-center justify-center">
        <div className="text-white/50">Loading map...</div>
      </div>
    )
  }
);

export default function NeighborMapWrapper({ neighbors, localNode }: NeighborMapWrapperProps) {
  return <NeighborMap neighbors={neighbors} localNode={localNode} />;
}
