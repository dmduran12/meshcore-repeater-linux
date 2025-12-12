'use client';

import { useState, useCallback, useRef } from 'react';
import { Copy, Check } from 'lucide-react';
import clsx from 'clsx';

interface HashBadgeProps {
  hash: string;
  /** Number of characters to show at start (default: 8) */
  prefixLength?: number;
  /** Number of characters to show at end (default: 6) */
  suffixLength?: number;
  /** Show full hash without truncation */
  full?: boolean;
  /** Additional CSS classes */
  className?: string;
  /** Size variant */
  size?: 'sm' | 'md';
}

// Cross-platform clipboard copy with fallback
function copyToClipboard(text: string): boolean {
  // For non-secure contexts (HTTP on local network), go straight to fallback
  const isSecureContext = typeof window !== 'undefined' && 
    (window.isSecureContext || window.location.protocol === 'https:' || window.location.hostname === 'localhost');
  
  // Try modern Clipboard API first (only works in secure contexts)
  if (isSecureContext && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    navigator.clipboard.writeText(text).catch(() => {
      // Silently fall through - we'll try fallback below on next click
    });
    return true;
  }
  
  // Fallback: create temporary input element (more compatible than textarea)
  try {
    const input = document.createElement('input');
    input.setAttribute('type', 'text');
    input.setAttribute('value', text);
    input.style.position = 'fixed';
    input.style.left = '0';
    input.style.top = '0';
    input.style.opacity = '0';
    input.style.pointerEvents = 'none';
    document.body.appendChild(input);
    
    // Focus and select
    input.focus();
    input.select();
    input.setSelectionRange(0, text.length);
    
    // Execute copy
    const success = document.execCommand('copy');
    
    // Clean up
    document.body.removeChild(input);
    
    return success;
  } catch (err) {
    console.error('Copy failed:', err);
    return false;
  }
}

export function HashBadge({ 
  hash, 
  prefixLength = 8, 
  suffixLength = 6,
  full = false,
  className,
  size = 'md'
}: HashBadgeProps) {
  const [copied, setCopied] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleCopy = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    // Clear any existing timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    
    const success = copyToClipboard(hash);
    setCopied(true);
    timeoutRef.current = setTimeout(() => setCopied(false), 2000);
    
    // Log for debugging
    if (!success) {
      console.warn('Copy may have failed for:', hash.slice(0, 16) + '...');
    }
  }, [hash]);

  // Truncate hash for display
  const displayHash = full || hash.length <= prefixLength + suffixLength + 3
    ? hash
    : `${hash.slice(0, prefixLength)}…${hash.slice(-suffixLength)}`;

  const sizeClasses = size === 'sm' 
    ? 'text-[10px] px-1.5 py-0.5 gap-1'
    : 'text-xs px-2 py-1 gap-1.5';

  return (
    <button
      type="button"
      onClick={handleCopy}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={clsx(
        'inline-flex items-center font-mono rounded-md transition-all duration-200',
        'bg-bg-subtle/80 hover:bg-bg-elevated border border-border-subtle hover:border-border-strong',
        'cursor-pointer select-none',
        sizeClasses,
        className
      )}
      title={`Click to copy: ${hash}`}
      aria-label={`Copy hash ${hash}`}
    >
      <span className={clsx(
        'transition-colors duration-200',
        copied ? 'text-accent-success' : 'text-text-secondary'
      )}>
        {displayHash}
      </span>
      
      <span className={clsx(
        'flex items-center justify-center transition-all duration-200',
        size === 'sm' ? 'w-3 h-3' : 'w-3.5 h-3.5'
      )}>
        {copied ? (
          <Check className={clsx(
            'text-accent-success',
            size === 'sm' ? 'w-2.5 h-2.5' : 'w-3 h-3'
          )} />
        ) : (
          <Copy className={clsx(
            'transition-opacity duration-200',
            isHovered ? 'opacity-70' : 'opacity-40',
            size === 'sm' ? 'w-2.5 h-2.5' : 'w-3 h-3'
          )} />
        )}
      </span>
    </button>
  );
}
