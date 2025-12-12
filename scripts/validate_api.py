#!/usr/bin/env python3
"""
API Validation Script

Tests API endpoints to diagnose data flow issues.
Run with: python scripts/validate_api.py [base_url]

Default base_url: http://localhost:8000
"""

import json
import sys
import time
from urllib.request import urlopen, Request
from urllib.error import URLError, HTTPError


def get_json(url):
    """Fetch JSON from URL"""
    try:
        with urlopen(url, timeout=10) as response:
            return json.loads(response.read().decode('utf-8'))
    except (URLError, HTTPError) as e:
        return {"error": str(e)}


def post_json(url, data):
    """POST JSON to URL"""
    try:
        req = Request(
            url,
            data=json.dumps(data).encode('utf-8'),
            headers={'Content-Type': 'application/json'},
            method='POST'
        )
        with urlopen(req, timeout=10) as response:
            return json.loads(response.read().decode('utf-8'))
    except (URLError, HTTPError) as e:
        return {"error": str(e)}


def print_header(title):
    print(f"\n{'='*60}")
    print(f"  {title}")
    print(f"{'='*60}")


def print_result(name, data, keys_to_show=None):
    """Print result with optional key filtering"""
    if "error" in data:
        print(f"  ❌ {name}: {data['error']}")
        return False
    
    if keys_to_show:
        filtered = {k: data.get(k) for k in keys_to_show if k in data}
        print(f"  ✅ {name}: {json.dumps(filtered, indent=4)}")
    else:
        # Truncate large outputs
        s = json.dumps(data, indent=2)
        if len(s) > 500:
            s = s[:500] + "\n... (truncated)"
        print(f"  ✅ {name}:\n{s}")
    return True


def main():
    base_url = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8000"
    print(f"Testing API at: {base_url}")
    
    # Test 1: Stats endpoint
    print_header("1. Stats Endpoint (/api/stats)")
    stats = get_json(f"{base_url}/api/stats")
    if "error" not in stats:
        print(f"  ✅ Stats retrieved successfully")
        print(f"  - Node name: {stats.get('config', {}).get('node_name', 'N/A')}")
        print(f"  - Mode: {stats.get('config', {}).get('repeater', {}).get('mode', 'N/A')}")
        print(f"  - RX count: {stats.get('rx_count', 0)}")
        print(f"  - TX count: {stats.get('tx_count', 0)}")
        print(f"  - Forwarded: {stats.get('forwarded_count', 0)}")
        print(f"  - Dropped: {stats.get('dropped_count', 0)}")
        print(f"  - Noise floor: {stats.get('noise_floor_dbm', 'N/A')} dBm")
        print(f"  - Neighbors: {len(stats.get('neighbors', {}))}")
    else:
        print(f"  ❌ Error: {stats['error']}")
        return 1
    
    # Test 2: Bucketed stats (Traffic chart data)
    print_header("2. Bucketed Stats (/api/bucketed_stats)")
    bucketed = get_json(f"{base_url}/api/bucketed_stats?minutes=60&buckets=20")
    if bucketed.get("success"):
        data = bucketed.get("data", {})
        rx_total = sum(b.get("count", 0) for b in data.get("received", []))
        tx_total = sum(b.get("count", 0) for b in data.get("transmitted", []))
        fwd_total = sum(b.get("count", 0) for b in data.get("forwarded", []))
        drop_total = sum(b.get("count", 0) for b in data.get("dropped", []))
        
        print(f"  ✅ Bucketed stats retrieved")
        print(f"  - Time range: {data.get('time_range_minutes', 'N/A')} minutes")
        print(f"  - Bucket count: {len(data.get('received', []))}")
        print(f"  - Total received: {rx_total}")
        print(f"  - Total transmitted: {tx_total}")
        print(f"  - Total forwarded: {fwd_total}")
        print(f"  - Total dropped: {drop_total}")
        
        if rx_total == 0 and tx_total == 0:
            print(f"  ⚠️  WARNING: No packet data in last hour!")
    else:
        print(f"  ❌ Error: {bucketed.get('error', 'Unknown error')}")
    
    # Test 3: Noise floor chart data
    print_header("3. Noise Floor Chart (/api/noise_floor_chart_data)")
    noise = get_json(f"{base_url}/api/noise_floor_chart_data?hours=24")
    if noise.get("success"):
        chart_data = noise.get("data", {}).get("chart_data", {})
        timestamps = chart_data.get("timestamps", [])
        series = chart_data.get("series", [])
        
        print(f"  ✅ Noise floor data retrieved")
        print(f"  - Timestamp count: {len(timestamps)}")
        print(f"  - Series count: {len(series)}")
        
        if len(timestamps) == 0:
            print(f"  ⚠️  WARNING: No noise floor measurements!")
            print(f"  - This could indicate the radio is not recording noise floor")
        else:
            first_ts = timestamps[0] if timestamps else 0
            last_ts = timestamps[-1] if timestamps else 0
            print(f"  - Time range: {time.strftime('%H:%M', time.localtime(first_ts))} - {time.strftime('%H:%M', time.localtime(last_ts))}")
            
            if series and series[0].get("data"):
                values = [p[1] for p in series[0]["data"] if p[1] is not None]
                if values:
                    print(f"  - Value range: {min(values):.1f} to {max(values):.1f} dBm")
    else:
        print(f"  ❌ Error: {noise.get('error', 'Unknown error')}")
    
    # Test 4: Mode toggle
    print_header("4. Mode Toggle Test (/api/set_mode)")
    current_mode = stats.get('config', {}).get('repeater', {}).get('mode', 'forward')
    new_mode = 'monitor' if current_mode == 'forward' else 'forward'
    
    print(f"  Current mode: {current_mode}")
    print(f"  Attempting to change to: {new_mode}")
    
    result = post_json(f"{base_url}/api/set_mode", {"mode": new_mode})
    if result.get("success"):
        print(f"  ✅ Mode changed to: {result.get('mode')}")
        print(f"  - Persisted to config: {result.get('persisted', False)}")
        
        # Verify by fetching stats again
        time.sleep(0.5)
        stats2 = get_json(f"{base_url}/api/stats")
        verified_mode = stats2.get('config', {}).get('repeater', {}).get('mode', 'unknown')
        print(f"  - Verified mode from stats: {verified_mode}")
        
        if verified_mode != new_mode:
            print(f"  ⚠️  WARNING: Mode in stats doesn't match! Expected {new_mode}, got {verified_mode}")
        
        # Change back
        post_json(f"{base_url}/api/set_mode", {"mode": current_mode})
        print(f"  - Restored original mode: {current_mode}")
    else:
        print(f"  ❌ Error: {result.get('error', 'Unknown error')}")
    
    # Test 5: Recent packets
    print_header("5. Recent Packets (/api/recent_packets)")
    packets = get_json(f"{base_url}/api/recent_packets?limit=5")
    if packets.get("success"):
        data = packets.get("data", [])
        print(f"  ✅ Recent packets retrieved")
        print(f"  - Packet count: {packets.get('count', len(data))}")
        
        if data:
            origins = {}
            for p in data:
                origin = p.get("packet_origin", "unknown")
                origins[origin] = origins.get(origin, 0) + 1
            print(f"  - Packet origins: {origins}")
            
            # Show first packet
            first = data[0]
            print(f"  - Most recent: type={first.get('type')}, origin={first.get('packet_origin')}, tx={first.get('transmitted')}")
        else:
            print(f"  ⚠️  WARNING: No packets in database!")
    else:
        print(f"  ❌ Error: {packets.get('error', 'Unknown error')}")
    
    # Test 6: Packet type stats
    print_header("6. Packet Type Stats (/api/packet_type_stats)")
    ptype_stats = get_json(f"{base_url}/api/packet_type_stats?hours=24")
    if ptype_stats.get("success"):
        data = ptype_stats.get("data", {})
        print(f"  ✅ Packet type stats retrieved")
        totals = data.get("packet_type_totals", {})
        if totals:
            for ptype, count in sorted(totals.items(), key=lambda x: -x[1])[:5]:
                print(f"  - {ptype}: {count}")
        else:
            print(f"  ⚠️  WARNING: No packet type data!")
    else:
        print(f"  ❌ Error: {ptype_stats.get('error', 'Unknown error')}")
    
    print_header("Summary")
    print("  If charts show no data, check:")
    print("  1. Is the repeater receiving packets? (check rx_count)")
    print("  2. Is noise floor being recorded? (check timestamps count)")
    print("  3. Is the database being written to? (check recent_packets)")
    print("  4. Are there any errors in the repeater logs?")
    print("")
    
    return 0


if __name__ == "__main__":
    sys.exit(main())
