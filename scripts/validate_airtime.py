#!/usr/bin/env python3
"""
Airtime sanity-check script for LoRa ToA calculations.

- Computes airtime for several payload/SF/BW/CR combinations
- Prints SF and BW scaling tables to visually confirm step-changes
- Intended to be compared against Semtech's official LoRa calculator

Usage:
  python3 scripts/validate_airtime.py
"""

from repeater.airtime import calculate_lora_airtime_ms, PAYLOAD_OVERHEAD_BYTES

COMBOS = [
    # (payload, SF, BW Hz, CR denom (5..8), preamble, label)
    (20, 11, 125000, 8, 8, "SF11/125k/CR4/8 20B"),
    (50, 11, 125000, 8, 8, "SF11/125k/CR4/8 50B"),
    (100, 11, 125000, 8, 8, "SF11/125k/CR4/8 100B"),
    (20, 7, 125000, 5, 8, "SF7/125k/CR4/5 20B"),
    (50, 7, 125000, 5, 8, "SF7/125k/CR4/5 50B"),
    (20, 12, 125000, 8, 8, "SF12/125k/CR4/8 20B"),
    (50, 12, 125000, 8, 8, "SF12/125k/CR4/8 50B"),
    (50, 9, 250000, 5, 8, "SF9/250k/CR4/5 50B"),
    (50, 9, 500000, 5, 8, "SF9/500k/CR4/5 50B"),
]


def toa(payload_len: int, sf: int, bw: int, cr: int, preamble: int) -> float:
    total = payload_len + PAYLOAD_OVERHEAD_BYTES
    return calculate_lora_airtime_ms(
        payload_len=total,
        spreading_factor=sf,
        bandwidth_hz=bw,
        coding_rate=cr,
        preamble_length=preamble,
        crc_enabled=True,
        implicit_header=False,
    )


def main():
    print("=" * 80)
    print("LoRa Airtime Calculation Validation")
    print(f"Protocol overhead: {PAYLOAD_OVERHEAD_BYTES} bytes added to payload")
    print("=" * 80)
    print()

    for payload, sf, bw, cr, preamble, label in COMBOS:
        air = toa(payload, sf, bw, cr, preamble)
        tsym_ms = (2**sf) / bw * 1000
        de = 1 if tsym_ms >= 16 else 0
        print(f"{label:30s} -> {air:8.2f} ms  (Tsym={tsym_ms:.3f}ms, DE={de})")

    print()
    print("=" * 80)
    print("SF Scaling Check (50B payload, BW125k, CR4/8)")
    print("=" * 80)
    for sf in [7, 8, 9, 10, 11, 12]:
        air = toa(50, sf, 125000, 8, 8)
        tsym_ms = (2**sf) / 125000 * 1000
        print(f"SF{sf:2d}: {air:8.2f} ms  (Tsym={tsym_ms:.4f}ms)")

    print()
    print("=" * 80)
    print("BW Scaling Check (SF11, 50B payload, CR4/8)")
    print("=" * 80)
    for bw in [125000, 250000, 500000]:
        air = toa(50, 11, bw, 8, 8)
        print(f"BW {bw//1000:3d}kHz: {air:8.2f} ms")


if __name__ == "__main__":
    main()
