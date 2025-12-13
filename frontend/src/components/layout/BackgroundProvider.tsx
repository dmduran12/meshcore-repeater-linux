'use client';

import { useBackground } from '@/components/shared/BackgroundSelector';

/**
 * Client component that renders the dynamic background image
 * Listens for background-change events and updates accordingly
 */
export function BackgroundProvider() {
  const backgroundSrc = useBackground();

  return (
    <div 
      className="fixed inset-0 -z-10 bg-cover bg-center bg-no-repeat"
      style={{ backgroundImage: `url(${backgroundSrc})` }}
    />
  );
}
