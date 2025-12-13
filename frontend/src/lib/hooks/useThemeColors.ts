'use client';

import { useState, useEffect } from 'react';

/**
 * Get computed CSS variable value from document
 */
function getCSSVar(name: string): string {
  if (typeof window === 'undefined') return '';
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/**
 * Chart colors from CSS variables
 */
export interface ChartColors {
  chart1: string;
  chart2: string;
  chart3: string;
  chart4: string;
  chart5: string;
  chart6: string;
  chart7: string;
  chart8: string;
}

/**
 * Metric colors from CSS variables
 */
export interface MetricColors {
  received: string;
  forwarded: string;
  transmitted: string;
  dropped: string;
  neutral: string;
}

/**
 * Packet type colors from CSS variables
 */
export interface PacketColors {
  advert: string;
  flood: string;
  txtMsg: string;
  ack: string;
  trace: string;
  req: string;
  response: string;
  grpTxt: string;
  grpData: string;
  path: string;
  anon: string;
  unknown: string;
}

// Default fallback colors (from default theme)
const DEFAULT_CHART_COLORS: ChartColors = {
  chart1: '#71F8E5',
  chart2: '#39D98A',
  chart3: '#F9D26F',
  chart4: '#FF5C7A',
  chart5: '#B49DFF',
  chart6: '#60A5FA',
  chart7: '#F472B6',
  chart8: '#FB923C',
};

const DEFAULT_METRIC_COLORS: MetricColors = {
  received: '#39D98A',
  forwarded: '#60A5FA',
  transmitted: '#F9D26F',
  dropped: '#FF5C7A',
  neutral: '#B0B0C3',
};

const DEFAULT_PACKET_COLORS: PacketColors = {
  advert: '#F9D26F',
  flood: '#71F8E5',
  txtMsg: '#39D98A',
  ack: '#B49DFF',
  trace: '#71F8E5',
  req: '#60A5FA',
  response: '#39D98A',
  grpTxt: '#F472B6',
  grpData: '#FB923C',
  path: '#71F8E5',
  anon: '#F9D26F',
  unknown: '#767688',
};

/**
 * Hook to get theme-aware chart colors
 * Re-reads CSS variables when theme changes
 */
export function useChartColors(): ChartColors {
  const [colors, setColors] = useState<ChartColors>(DEFAULT_CHART_COLORS);

  useEffect(() => {
    const updateColors = () => {
      setColors({
        chart1: getCSSVar('--chart-1') || DEFAULT_CHART_COLORS.chart1,
        chart2: getCSSVar('--chart-2') || DEFAULT_CHART_COLORS.chart2,
        chart3: getCSSVar('--chart-3') || DEFAULT_CHART_COLORS.chart3,
        chart4: getCSSVar('--chart-4') || DEFAULT_CHART_COLORS.chart4,
        chart5: getCSSVar('--chart-5') || DEFAULT_CHART_COLORS.chart5,
        chart6: getCSSVar('--chart-6') || DEFAULT_CHART_COLORS.chart6,
        chart7: getCSSVar('--chart-7') || DEFAULT_CHART_COLORS.chart7,
        chart8: getCSSVar('--chart-8') || DEFAULT_CHART_COLORS.chart8,
      });
    };

    // Initial read
    updateColors();

    // Listen for theme changes
    const handleThemeChange = () => {
      // Small delay to let CSS variables update
      setTimeout(updateColors, 50);
    };

    window.addEventListener('background-change', handleThemeChange);
    return () => window.removeEventListener('background-change', handleThemeChange);
  }, []);

  return colors;
}

/**
 * Hook to get theme-aware metric colors
 */
export function useMetricColors(): MetricColors {
  const [colors, setColors] = useState<MetricColors>(DEFAULT_METRIC_COLORS);

  useEffect(() => {
    const updateColors = () => {
      setColors({
        received: getCSSVar('--metric-received') || DEFAULT_METRIC_COLORS.received,
        forwarded: getCSSVar('--metric-forwarded') || DEFAULT_METRIC_COLORS.forwarded,
        transmitted: getCSSVar('--metric-transmitted') || DEFAULT_METRIC_COLORS.transmitted,
        dropped: getCSSVar('--metric-dropped') || DEFAULT_METRIC_COLORS.dropped,
        neutral: getCSSVar('--metric-neutral') || DEFAULT_METRIC_COLORS.neutral,
      });
    };

    updateColors();

    const handleThemeChange = () => setTimeout(updateColors, 50);
    window.addEventListener('background-change', handleThemeChange);
    return () => window.removeEventListener('background-change', handleThemeChange);
  }, []);

  return colors;
}

/**
 * Hook to get theme-aware packet type colors
 */
export function usePacketColors(): PacketColors {
  const [colors, setColors] = useState<PacketColors>(DEFAULT_PACKET_COLORS);

  useEffect(() => {
    const updateColors = () => {
      setColors({
        advert: getCSSVar('--pkt-advert') || DEFAULT_PACKET_COLORS.advert,
        flood: getCSSVar('--pkt-flood') || DEFAULT_PACKET_COLORS.flood,
        txtMsg: getCSSVar('--pkt-txt-msg') || DEFAULT_PACKET_COLORS.txtMsg,
        ack: getCSSVar('--pkt-ack') || DEFAULT_PACKET_COLORS.ack,
        trace: getCSSVar('--pkt-trace') || DEFAULT_PACKET_COLORS.trace,
        req: getCSSVar('--pkt-req') || DEFAULT_PACKET_COLORS.req,
        response: getCSSVar('--pkt-response') || DEFAULT_PACKET_COLORS.response,
        grpTxt: getCSSVar('--pkt-grp-txt') || DEFAULT_PACKET_COLORS.grpTxt,
        grpData: getCSSVar('--pkt-grp-data') || DEFAULT_PACKET_COLORS.grpData,
        path: getCSSVar('--pkt-path') || DEFAULT_PACKET_COLORS.path,
        anon: getCSSVar('--pkt-anon') || DEFAULT_PACKET_COLORS.anon,
        unknown: getCSSVar('--pkt-unknown') || DEFAULT_PACKET_COLORS.unknown,
      });
    };

    updateColors();

    const handleThemeChange = () => setTimeout(updateColors, 50);
    window.addEventListener('background-change', handleThemeChange);
    return () => window.removeEventListener('background-change', handleThemeChange);
  }, []);

  return colors;
}

/**
 * Get chart color array for indexed access
 */
export function useChartColorArray(): string[] {
  const colors = useChartColors();
  return [
    colors.chart1,
    colors.chart2,
    colors.chart3,
    colors.chart4,
    colors.chart5,
    colors.chart6,
    colors.chart7,
    colors.chart8,
  ];
}
