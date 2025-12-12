import json
import logging
import sqlite3
import time
import secrets
import base64
from pathlib import Path
from typing import Optional, Dict, Any, List

logger = logging.getLogger("SQLiteHandler")


class SQLiteHandler:
    def __init__(self, storage_dir: Path, radio_config: Optional[Dict] = None):
        self.storage_dir = storage_dir
        self.sqlite_path = self.storage_dir / "repeater.db"
        self._radio_config = radio_config or {}
        self._init_database()
        self._run_migrations()
        # Recalculate any packets with missing airtime using current radio config
        self._backfill_missing_airtime()

    def _init_database(self):
        try:
            with sqlite3.connect(self.sqlite_path) as conn:
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS packets (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        timestamp REAL NOT NULL,
                        type INTEGER NOT NULL,
                        route INTEGER NOT NULL,
                        length INTEGER NOT NULL,
                        rssi INTEGER,
                        snr REAL,
                        score REAL,
                        transmitted BOOLEAN NOT NULL,
                        is_duplicate BOOLEAN NOT NULL,
                        drop_reason TEXT,
                        src_hash TEXT,
                        dst_hash TEXT,
                        path_hash TEXT,
                        header TEXT,
                        transport_codes TEXT,
                        payload TEXT,
                        payload_length INTEGER,
                        tx_delay_ms REAL,
                        packet_hash TEXT,
                        original_path TEXT,
                        forwarded_path TEXT,
                        raw_packet TEXT
                    )
                """)
                
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS adverts (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        timestamp REAL NOT NULL,
                        pubkey TEXT NOT NULL,
                        node_name TEXT,
                        is_repeater BOOLEAN NOT NULL,
                        route_type INTEGER,
                        contact_type TEXT,
                        latitude REAL,
                        longitude REAL,
                        first_seen REAL NOT NULL,
                        last_seen REAL NOT NULL,
                        rssi INTEGER,
                        snr REAL,
                        advert_count INTEGER NOT NULL DEFAULT 1,
                        is_new_neighbor BOOLEAN NOT NULL,
                        zero_hop BOOLEAN NOT NULL DEFAULT FALSE
                    )
                """)
                
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS noise_floor (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        timestamp REAL NOT NULL,
                        noise_floor_dbm REAL NOT NULL
                    )
                """)
                
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS transport_keys (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        name TEXT NOT NULL UNIQUE,
                        flood_policy TEXT NOT NULL CHECK (flood_policy IN ('allow', 'deny')),
                        transport_key TEXT NOT NULL,
                        last_used REAL,
                        parent_id INTEGER,
                        created_at REAL NOT NULL,
                        updated_at REAL NOT NULL,
                        FOREIGN KEY (parent_id) REFERENCES transport_keys(id)
                    )
                """)
                
                conn.execute("CREATE INDEX IF NOT EXISTS idx_packets_timestamp ON packets(timestamp)")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_packets_type ON packets(type)")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_packets_hash ON packets(packet_hash)")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_packets_transmitted ON packets(transmitted)")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_adverts_timestamp ON adverts(timestamp)")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_adverts_pubkey ON adverts(pubkey)")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_noise_timestamp ON noise_floor(timestamp)")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_transport_keys_name ON transport_keys(name)")
                conn.execute("CREATE INDEX IF NOT EXISTS idx_transport_keys_parent ON transport_keys(parent_id)")
                
                conn.commit()
                logger.info(f"SQLite database initialized: {self.sqlite_path}")
                
        except Exception as e:
            logger.error(f"Failed to initialize SQLite: {e}")

    def _run_migrations(self):
        """Run database migrations"""
        try:
            with sqlite3.connect(self.sqlite_path) as conn:
                # Create migrations table if it doesn't exist
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS migrations (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        migration_name TEXT NOT NULL UNIQUE,
                        applied_at REAL NOT NULL
                    )
                """)
                
                # Migration 1: Add zero_hop column to adverts table
                migration_name = "add_zero_hop_to_adverts"
                existing = conn.execute(
                    "SELECT migration_name FROM migrations WHERE migration_name = ?",
                    (migration_name,)
                ).fetchone()
                
                if not existing:
                    # Check if zero_hop column already exists
                    cursor = conn.execute("PRAGMA table_info(adverts)")
                    columns = [column[1] for column in cursor.fetchall()]
                    
                    if "zero_hop" not in columns:
                        conn.execute("ALTER TABLE adverts ADD COLUMN zero_hop BOOLEAN NOT NULL DEFAULT FALSE")
                        logger.info("Added zero_hop column to adverts table")
                    
                    # Mark migration as applied
                    conn.execute(
                        "INSERT INTO migrations (migration_name, applied_at) VALUES (?, ?)",
                        (migration_name, time.time())
                    )
                    logger.info(f"Migration '{migration_name}' applied successfully")
                
                # Migration 2: Add packet_origin column to packets table
                migration_name = "add_packet_origin_to_packets"
                existing = conn.execute(
                    "SELECT migration_name FROM migrations WHERE migration_name = ?",
                    (migration_name,)
                ).fetchone()
                
                if not existing:
                    # Check if packet_origin column already exists
                    cursor = conn.execute("PRAGMA table_info(packets)")
                    columns = [column[1] for column in cursor.fetchall()]
                    
                    if "packet_origin" not in columns:
                        # Add column with default 'rx' for backward compatibility
                        conn.execute("ALTER TABLE packets ADD COLUMN packet_origin TEXT NOT NULL DEFAULT 'rx'")
                        logger.info("Added packet_origin column to packets table")
                        # Create index for efficient queries
                        conn.execute("CREATE INDEX IF NOT EXISTS idx_packets_origin ON packets(packet_origin)")
                    
                    # Mark migration as applied
                    conn.execute(
                        "INSERT INTO migrations (migration_name, applied_at) VALUES (?, ?)",
                        (migration_name, time.time())
                    )
                    logger.info(f"Migration '{migration_name}' applied successfully")
                
                # Migration 3: Add airtime_ms column to packets table
                migration_name = "add_airtime_ms_to_packets"
                existing = conn.execute(
                    "SELECT migration_name FROM migrations WHERE migration_name = ?",
                    (migration_name,)
                ).fetchone()
                
                if not existing:
                    cursor = conn.execute("PRAGMA table_info(packets)")
                    columns = [column[1] for column in cursor.fetchall()]
                    
                    if "airtime_ms" not in columns:
                        conn.execute("ALTER TABLE packets ADD COLUMN airtime_ms REAL")
                        logger.info("Added airtime_ms column to packets table")
                        
                        # Backfill existing packets with estimated airtime
                        # Using default radio config: SF9, BW=125kHz, CR=5
                        # This is an approximation; new packets will have accurate values
                        from repeater.airtime import calculate_lora_airtime_ms, PAYLOAD_OVERHEAD_BYTES
                        
                        # Get all packets that need airtime calculated
                        rows = conn.execute(
                            "SELECT id, length FROM packets WHERE airtime_ms IS NULL"
                        ).fetchall()
                        
                        for row_id, length in rows:
                            if length is not None:
                                # Use default config for backfill (actual config unknown)
                                airtime = calculate_lora_airtime_ms(
                                    payload_len=length + PAYLOAD_OVERHEAD_BYTES,
                                    spreading_factor=9,
                                    bandwidth_hz=125000,
                                    coding_rate=5,
                                    preamble_length=8,
                                )
                                conn.execute(
                                    "UPDATE packets SET airtime_ms = ? WHERE id = ?",
                                    (airtime, row_id)
                                )
                        
                        logger.info(f"Backfilled airtime_ms for {len(rows)} existing packets")
                    
                    conn.execute(
                        "INSERT INTO migrations (migration_name, applied_at) VALUES (?, ?)",
                        (migration_name, time.time())
                    )
                    logger.info(f"Migration '{migration_name}' applied successfully")
                
                # Migration 4: Add per-packet radio params and radio_config_history table
                migration_name = "add_radio_params_and_history"
                existing = conn.execute(
                    "SELECT migration_name FROM migrations WHERE migration_name = ?",
                    (migration_name,)
                ).fetchone()
                
                if not existing:
                    cursor = conn.execute("PRAGMA table_info(packets)")
                    columns = [column[1] for column in cursor.fetchall()]
                    # Per-packet radio parameters
                    if "radio_sf" not in columns:
                        conn.execute("ALTER TABLE packets ADD COLUMN radio_sf INTEGER")
                    if "radio_bw_hz" not in columns:
                        conn.execute("ALTER TABLE packets ADD COLUMN radio_bw_hz INTEGER")
                    if "radio_cr_den" not in columns:
                        conn.execute("ALTER TABLE packets ADD COLUMN radio_cr_den INTEGER")
                    if "radio_preamble" not in columns:
                        conn.execute("ALTER TABLE packets ADD COLUMN radio_preamble INTEGER")

                    # History table for radio config changes
                    conn.execute(
                        """
                        CREATE TABLE IF NOT EXISTS radio_config_history (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            timestamp REAL NOT NULL,
                            spreading_factor INTEGER NOT NULL,
                            bandwidth_hz INTEGER NOT NULL,
                            coding_rate_den INTEGER NOT NULL,
                            preamble_length INTEGER NOT NULL
                        )
                        """
                    )
                    conn.execute("CREATE INDEX IF NOT EXISTS idx_radio_history_ts ON radio_config_history(timestamp)")

                    conn.execute(
                        "INSERT INTO migrations (migration_name, applied_at) VALUES (?, ?)",
                        (migration_name, time.time())
                    )
                    logger.info(f"Migration '{migration_name}' applied successfully")
                
                conn.commit()
                
        except Exception as e:
            logger.error(f"Failed to run migrations: {e}")

    def store_packet(self, record: dict):
        """Store a packet record to SQLite.
        
        Args:
            record: Packet dictionary with fields:
                - packet_origin: 'rx' (received), 'tx_local' (originated here), 'tx_forward' (forwarding)
                - transmitted: True if packet was sent out, False if dropped
                - Other standard packet fields
        """
        try:
            with sqlite3.connect(self.sqlite_path) as conn:
                orig_path = record.get("original_path")
                fwd_path = record.get("forwarded_path")
                try:
                    orig_path_val = json.dumps(orig_path) if orig_path is not None else None
                except Exception:
                    orig_path_val = str(orig_path)
                try:
                    fwd_path_val = json.dumps(fwd_path) if fwd_path is not None else None
                except Exception:
                    fwd_path_val = str(fwd_path)

                conn.execute("""
                    INSERT INTO packets (
                        timestamp, type, route, length, rssi, snr, score,
                        transmitted, is_duplicate, drop_reason, src_hash, dst_hash, path_hash,
                        header, transport_codes, payload, payload_length, 
                        tx_delay_ms, packet_hash, original_path, forwarded_path, raw_packet,
                        packet_origin, airtime_ms,
                        radio_sf, radio_bw_hz, radio_cr_den, radio_preamble
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    record.get("timestamp", time.time()),
                    record.get("type", 0),
                    record.get("route", 0),
                    record.get("length", 0),
                    record.get("rssi"),
                    record.get("snr"),
                    record.get("score"),
                    int(bool(record.get("transmitted", False))),
                    int(bool(record.get("is_duplicate", False))),
                    record.get("drop_reason"),
                    record.get("src_hash"),
                    record.get("dst_hash"),
                    record.get("path_hash"),
                    record.get("header"),
                    record.get("transport_codes"),
                    record.get("payload"),
                    record.get("payload_length"),
                    record.get("tx_delay_ms"),
                    record.get("packet_hash"),
                    orig_path_val,
                    fwd_path_val,
                    record.get("raw_packet"),
                    record.get("packet_origin", "rx"),  # Default to 'rx' for backward compat
                    record.get("airtime_ms"),  # Pre-calculated airtime
                    record.get("radio_sf"),
                    record.get("radio_bw_hz"),
                    record.get("radio_cr_den"),
                    record.get("radio_preamble"),
                ))
                
        except Exception as e:
            logger.error(f"Failed to store packet in SQLite: {e}")

    def store_advert(self, record: dict):
        try:
            with sqlite3.connect(self.sqlite_path) as conn:
                existing = conn.execute(
                    "SELECT pubkey, first_seen, advert_count FROM adverts WHERE pubkey = ? ORDER BY last_seen DESC LIMIT 1",
                    (record.get("pubkey", ""),)
                ).fetchone()
                
                current_time = record.get("timestamp", time.time())
                
                if existing:
                    conn.execute("""
                        UPDATE adverts 
                        SET timestamp = ?, node_name = ?, is_repeater = ?, route_type = ?,
                            contact_type = ?, latitude = ?, longitude = ?, last_seen = ?,
                            rssi = ?, snr = ?, advert_count = advert_count + 1, is_new_neighbor = 0,
                            zero_hop = ?
                        WHERE pubkey = ?
                    """, (
                        current_time,
                        record.get("node_name"),
                        record.get("is_repeater", False),
                        record.get("route_type"),
                        record.get("contact_type"),
                        record.get("latitude"),
                        record.get("longitude"),
                        current_time,
                        record.get("rssi"),
                        record.get("snr"),
                        record.get("zero_hop", False),
                        record.get("pubkey", "")
                    ))
                else:
                    conn.execute("""
                        INSERT INTO adverts (
                            timestamp, pubkey, node_name, is_repeater, route_type, contact_type, 
                            latitude, longitude, first_seen, last_seen, rssi, snr, advert_count, 
                            is_new_neighbor, zero_hop
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """, (
                        current_time,
                        record.get("pubkey", ""),
                        record.get("node_name"),
                        record.get("is_repeater", False),
                        record.get("route_type"),
                        record.get("contact_type"),
                        record.get("latitude"),
                        record.get("longitude"),
                        current_time,
                        current_time,
                        record.get("rssi"),
                        record.get("snr"),
                        1,
                        True,
                        record.get("zero_hop", False)
                    ))
                
        except Exception as e:
            logger.error(f"Failed to store advert in SQLite: {e}")

    def store_noise_floor(self, record: dict):
        try:
            with sqlite3.connect(self.sqlite_path) as conn:
                conn.execute("""
                    INSERT INTO noise_floor (timestamp, noise_floor_dbm)
                    VALUES (?, ?)
                """, (
                    record.get("timestamp", time.time()),
                    record.get("noise_floor_dbm")
                ))
        except Exception as e:
            logger.error(f"Failed to store noise floor in SQLite: {e}")

    def get_packet_stats(self, hours: int = 24) -> dict:
        try:
            cutoff = time.time() - (hours * 3600)
            
            with sqlite3.connect(self.sqlite_path) as conn:
                conn.row_factory = sqlite3.Row
                
                stats = conn.execute("""
                    SELECT 
                        COUNT(*) as total_packets,
                        SUM(transmitted) as transmitted_packets,
                        SUM(CASE WHEN transmitted = 0 THEN 1 ELSE 0 END) as dropped_packets,
                        AVG(rssi) as avg_rssi,
                        AVG(snr) as avg_snr,
                        AVG(score) as avg_score,
                        AVG(payload_length) as avg_payload_length,
                        AVG(tx_delay_ms) as avg_tx_delay
                    FROM packets 
                    WHERE timestamp > ?
                """, (cutoff,)).fetchone()
                
                types = conn.execute("""
                    SELECT type, COUNT(*) as count
                    FROM packets 
                    WHERE timestamp > ?
                    GROUP BY type
                    ORDER BY count DESC
                """, (cutoff,)).fetchall()
                
                drop_reasons = conn.execute("""
                    SELECT drop_reason, COUNT(*) as count
                    FROM packets 
                    WHERE timestamp > ? AND transmitted = 0 AND drop_reason IS NOT NULL
                    GROUP BY drop_reason
                    ORDER BY count DESC
                """, (cutoff,)).fetchall()
                
                return {
                    "total_packets": stats["total_packets"],
                    "transmitted_packets": stats["transmitted_packets"],
                    "dropped_packets": stats["dropped_packets"],
                    "avg_rssi": round(stats["avg_rssi"] or 0, 1),
                    "avg_snr": round(stats["avg_snr"] or 0, 1),
                    "avg_score": round(stats["avg_score"] or 0, 3),
                    "avg_payload_length": round(stats["avg_payload_length"] or 0, 1),
                    "avg_tx_delay": round(stats["avg_tx_delay"] or 0, 1),
                    "packet_types": [{"type": row["type"], "count": row["count"]} for row in types],
                    "drop_reasons": [{"reason": row["drop_reason"], "count": row["count"]} for row in drop_reasons]
                }
                
        except Exception as e:
            logger.error(f"Failed to get packet stats: {e}")
            return {}

    def get_recent_packets(self, limit: int = 100) -> list:
        try:
            with sqlite3.connect(self.sqlite_path) as conn:
                conn.row_factory = sqlite3.Row
                
                packets = conn.execute("""
                    SELECT 
                        timestamp, type, route, length, rssi, snr, score,
                        transmitted, is_duplicate, drop_reason, src_hash, dst_hash, path_hash,
                        header, transport_codes, payload, payload_length, 
                        tx_delay_ms, packet_hash, original_path, forwarded_path, raw_packet,
                        packet_origin
                    FROM packets 
                    ORDER BY timestamp DESC
                    LIMIT ?
                """, (limit,)).fetchall()
                
                return [dict(row) for row in packets]
                
        except Exception as e:
            logger.error(f"Failed to get recent packets: {e}")
            return []

    def get_filtered_packets(self, 
                           packet_type: Optional[int] = None,
                           route: Optional[int] = None,
                           start_timestamp: Optional[float] = None,
                           end_timestamp: Optional[float] = None,
                           limit: int = 1000) -> list:
        try:
            with sqlite3.connect(self.sqlite_path) as conn:
                conn.row_factory = sqlite3.Row
                
                where_clauses = []
                params = []
                
                if packet_type is not None:
                    where_clauses.append("type = ?")
                    params.append(packet_type)
                
                if route is not None:
                    where_clauses.append("route = ?")
                    params.append(route)
                
                if start_timestamp is not None:
                    where_clauses.append("timestamp >= ?")
                    params.append(start_timestamp)
                
                if end_timestamp is not None:
                    where_clauses.append("timestamp <= ?")
                    params.append(end_timestamp)
                
                base_query = """
                    SELECT 
                        timestamp, type, route, length, rssi, snr, score,
                        transmitted, is_duplicate, drop_reason, src_hash, dst_hash, path_hash,
                        header, transport_codes, payload, payload_length, 
                        tx_delay_ms, packet_hash, original_path, forwarded_path, raw_packet,
                        packet_origin
                    FROM packets
                """
                
                if where_clauses:
                    query = f"{base_query} WHERE {' AND '.join(where_clauses)}"
                else:
                    query = base_query
                
                query += " ORDER BY timestamp DESC LIMIT ?"
                params.append(limit)
                
                packets = conn.execute(query, params).fetchall()
                
                return [dict(row) for row in packets]
                
        except Exception as e:
            logger.error(f"Failed to get filtered packets: {e}")
            return []

    def get_packet_by_hash(self, packet_hash: str) -> Optional[dict]:
        try:
            with sqlite3.connect(self.sqlite_path) as conn:
                conn.row_factory = sqlite3.Row
                
                packet = conn.execute("""
                    SELECT 
                        timestamp, type, route, length, rssi, snr, score,
                        transmitted, is_duplicate, drop_reason, src_hash, dst_hash, path_hash,
                        header, transport_codes, payload, payload_length, 
                        tx_delay_ms, packet_hash, original_path, forwarded_path, raw_packet,
                        packet_origin
                    FROM packets 
                    WHERE packet_hash = ?
                """, (packet_hash,)).fetchone()
                
                return dict(packet) if packet else None
                
        except Exception as e:
            logger.error(f"Failed to get packet by hash: {e}")
            return None

    def get_packet_type_stats(self, hours: int = 24) -> dict:
        try:
            cutoff = time.time() - (hours * 3600)
            
            with sqlite3.connect(self.sqlite_path) as conn:
                conn.row_factory = sqlite3.Row
                
                type_counts = {}
                packet_type_names = {
                    0: 'Request (REQ)', 1: 'Response (RESPONSE)', 
                    2: 'Plain Text Message (TXT_MSG)', 3: 'Acknowledgment (ACK)',
                    4: 'Node Advertisement (ADVERT)', 5: 'Group Text Message (GRP_TXT)',
                    6: 'Group Datagram (GRP_DATA)', 7: 'Anonymous Request (ANON_REQ)',
                    8: 'Returned Path (PATH)', 9: 'Trace (TRACE)',
                    10: 'Multi-part Packet', 11: 'Reserved Type 11',
                    12: 'Reserved Type 12', 13: 'Reserved Type 13',
                    14: 'Reserved Type 14', 15: 'Custom Packet (RAW_CUSTOM)'
                }
                
                for packet_type in range(16):
                    count = conn.execute(
                        "SELECT COUNT(*) FROM packets WHERE type = ? AND timestamp > ?", 
                        (packet_type, cutoff)
                    ).fetchone()[0]
                    
                    type_name = packet_type_names.get(packet_type, f'Type {packet_type}')
                    if count > 0:
                        type_counts[type_name] = count
                
                other_count = conn.execute(
                    "SELECT COUNT(*) FROM packets WHERE type > 15 AND timestamp > ?", 
                    (cutoff,)
                ).fetchone()[0]
                if other_count > 0:
                    type_counts['Other Types (>15)'] = other_count
                
                return {
                    "hours": hours,
                    "packet_type_totals": type_counts,
                    "total_packets": sum(type_counts.values()),
                    "period": f"{hours} hours",
                    "data_source": "sqlite"
                }
                
        except Exception as e:
            logger.error(f"Failed to get packet type stats from SQLite: {e}")
            return {"error": str(e), "data_source": "error"}

    def get_route_stats(self, hours: int = 24) -> dict:

        try:
            cutoff = time.time() - (hours * 3600)
            
            with sqlite3.connect(self.sqlite_path) as conn:
                conn.row_factory = sqlite3.Row
                
                route_counts = {}
                route_names = {
                    0: 'Transport Flood',
                    1: 'Flood', 
                    2: 'Direct',
                    3: 'Transport Direct'
                }

                for route_type in range(4):
                    count = conn.execute(
                        "SELECT COUNT(*) FROM packets WHERE route = ? AND timestamp > ?", 
                        (route_type, cutoff)
                    ).fetchone()[0]
                    
                    route_name = route_names.get(route_type, f'Route {route_type}')
                    if count > 0:
                        route_counts[route_name] = count
                
                # Count any other route types > 3
                other_count = conn.execute(
                    "SELECT COUNT(*) FROM packets WHERE route > 3 AND timestamp > ?", 
                    (cutoff,)
                ).fetchone()[0]
                if other_count > 0:
                    route_counts['Other Routes (>3)'] = other_count
                
                return {
                    "hours": hours,
                    "route_totals": route_counts,
                    "total_packets": sum(route_counts.values()),
                    "period": f"{hours} hours",
                    "data_source": "sqlite"
                }
                
        except Exception as e:
            logger.error(f"Failed to get route stats from SQLite: {e}")
            return {"error": str(e), "data_source": "error"}

    def get_neighbors(self) -> dict:
        try:
            with sqlite3.connect(self.sqlite_path) as conn:
                conn.row_factory = sqlite3.Row
                
                neighbors = conn.execute("""
                    SELECT pubkey, node_name, is_repeater, route_type, contact_type,
                           latitude, longitude, first_seen, last_seen, rssi, snr, advert_count, zero_hop
                    FROM adverts a1
                    WHERE last_seen = (
                        SELECT MAX(last_seen) 
                        FROM adverts a2 
                        WHERE a2.pubkey = a1.pubkey
                    )
                    ORDER BY last_seen DESC
                """).fetchall()
                
                result = {}
                for row in neighbors:
                    result[row["pubkey"]] = {
                        "node_name": row["node_name"],
                        "is_repeater": bool(row["is_repeater"]),
                        "route_type": row["route_type"],
                        "contact_type": row["contact_type"],
                        "latitude": row["latitude"],
                        "longitude": row["longitude"],
                        "first_seen": row["first_seen"],
                        "last_seen": row["last_seen"],
                        "rssi": row["rssi"],
                        "snr": row["snr"],
                        "advert_count": row["advert_count"],
                        "zero_hop": bool(row["zero_hop"]),
                    }
                
                return result
                
        except Exception as e:
            logger.error(f"Failed to get neighbors: {e}")
            return {}

    def get_noise_floor_history(self, hours: int = 24) -> list:
        try:
            cutoff = time.time() - (hours * 3600)
            
            with sqlite3.connect(self.sqlite_path) as conn:
                conn.row_factory = sqlite3.Row
                
                measurements = conn.execute("""
                    SELECT timestamp, noise_floor_dbm
                    FROM noise_floor 
                    WHERE timestamp > ?
                    ORDER BY timestamp ASC
                """, (cutoff,)).fetchall()
                
                return [{"timestamp": row["timestamp"], "noise_floor_dbm": row["noise_floor_dbm"]} 
                        for row in measurements]
                
        except Exception as e:
            logger.error(f"Failed to get noise floor history: {e}")
            return []

    def get_noise_floor_stats(self, hours: int = 24) -> dict:
        try:
            cutoff = time.time() - (hours * 3600)
            
            with sqlite3.connect(self.sqlite_path) as conn:
                conn.row_factory = sqlite3.Row
                
                stats = conn.execute("""
                    SELECT 
                        COUNT(*) as measurement_count,
                        AVG(noise_floor_dbm) as avg_noise_floor,
                        MIN(noise_floor_dbm) as min_noise_floor,
                        MAX(noise_floor_dbm) as max_noise_floor
                    FROM noise_floor 
                    WHERE timestamp > ?
                """, (cutoff,)).fetchone()
                
                return {
                    "measurement_count": stats["measurement_count"],
                    "avg_noise_floor": round(stats["avg_noise_floor"] or 0, 1),
                    "min_noise_floor": round(stats["min_noise_floor"] or 0, 1),
                    "max_noise_floor": round(stats["max_noise_floor"] or 0, 1),
                    "hours": hours
                }
                
        except Exception as e:
            logger.error(f"Failed to get noise floor stats: {e}")
            return {}

    def cleanup_old_data(self, days: int = 7):
        try:
            cutoff = time.time() - (days * 24 * 3600)
            
            with sqlite3.connect(self.sqlite_path) as conn:
                result = conn.execute("DELETE FROM packets WHERE timestamp < ?", (cutoff,))
                packets_deleted = result.rowcount
                
                result = conn.execute("DELETE FROM adverts WHERE timestamp < ?", (cutoff,))
                adverts_deleted = result.rowcount
                
                result = conn.execute("DELETE FROM noise_floor WHERE timestamp < ?", (cutoff,))
                noise_deleted = result.rowcount
                
                conn.commit()
                
                if packets_deleted > 0 or adverts_deleted > 0 or noise_deleted > 0:
                    logger.info(f"Cleaned up {packets_deleted} old packets, {adverts_deleted} old adverts, {noise_deleted} old noise measurements")
                    
        except Exception as e:
            logger.error(f"Failed to cleanup old data: {e}")

    def get_cumulative_counts(self) -> dict:
        try:
            with sqlite3.connect(self.sqlite_path) as conn:
                type_counts = {}
                for i in range(16):
                    count = conn.execute("SELECT COUNT(*) FROM packets WHERE type = ?", (i,)).fetchone()[0]
                    type_counts[f"type_{i}"] = count
                
                other_count = conn.execute("SELECT COUNT(*) FROM packets WHERE type > 15").fetchone()[0]
                type_counts["type_other"] = other_count
                
                rx_total = conn.execute("SELECT COUNT(*) FROM packets").fetchone()[0]
                tx_total = conn.execute("SELECT COUNT(*) FROM packets WHERE transmitted = 1").fetchone()[0] 
                drop_total = conn.execute("SELECT COUNT(*) FROM packets WHERE transmitted = 0").fetchone()[0]
                
                return {
                    "rx_total": rx_total,
                    "tx_total": tx_total,
                    "drop_total": drop_total,
                    "type_counts": type_counts
                }
                
        except Exception as e:
            logger.error(f"Failed to get cumulative counts: {e}")
            return {
                "rx_total": 0,
                "tx_total": 0,
                "drop_total": 0,
                "type_counts": {}
            }

    def get_adverts_by_contact_type(self, contact_type: str, limit: Optional[int] = None, hours: Optional[int] = None) -> List[dict]:
  
        try:
            with sqlite3.connect(self.sqlite_path) as conn:
                conn.row_factory = sqlite3.Row
                
                query = """
                    SELECT id, timestamp, pubkey, node_name, is_repeater, route_type, 
                           contact_type, latitude, longitude, first_seen, last_seen, 
                           rssi, snr, advert_count, is_new_neighbor, zero_hop
                    FROM adverts 
                    WHERE contact_type = ?
                """
                params = [contact_type]
                
                if hours is not None:
                    cutoff = time.time() - (hours * 3600)
                    query += " AND timestamp > ?"
                    params.append(cutoff)
                
                query += " ORDER BY timestamp DESC"
                
                if limit is not None:
                    query += " LIMIT ?"
                    params.append(limit)
                
                rows = conn.execute(query, params).fetchall()
                
                adverts = []
                for row in rows:
                    advert = {
                        "id": row["id"],
                        "timestamp": row["timestamp"],
                        "pubkey": row["pubkey"],
                        "node_name": row["node_name"],
                        "is_repeater": bool(row["is_repeater"]),
                        "route_type": row["route_type"],
                        "contact_type": row["contact_type"],
                        "latitude": row["latitude"],
                        "longitude": row["longitude"],
                        "first_seen": row["first_seen"],
                        "last_seen": row["last_seen"],
                        "rssi": row["rssi"],
                        "snr": row["snr"],
                        "advert_count": row["advert_count"],
                        "is_new_neighbor": bool(row["is_new_neighbor"]),
                        "zero_hop": bool(row["zero_hop"])
                    }
                    adverts.append(advert)
                
                return adverts
                
        except Exception as e:
            logger.error(f"Failed to get adverts by contact_type '{contact_type}': {e}")
            return []

    def generate_transport_key(self, name: str, key_length_bytes: int = 32) -> str:
        """
        Generate a transport key using the proper MeshCore key derivation.
        
        Args:
            name: The key name to derive the key from
            key_length_bytes: Length of the key in bytes (default: 32 bytes = 256 bits)
            
        Returns:
            A base64-encoded transport key derived from the name
        """
        try:
            from pymc_core.protocol.transport_keys import get_auto_key_for
            
            # Use the proper MeshCore key derivation function
            key_bytes = get_auto_key_for(name)
            
            # Encode to base64 for safe storage and transmission
            key = base64.b64encode(key_bytes).decode('utf-8')
            
            logger.debug(f"Generated transport key for '{name}' with {len(key_bytes)} bytes ({len(key)} base64 chars)")
            return key
            
        except Exception as e:
            logger.error(f"Failed to generate transport key using get_auto_key_for: {e}")
            # Fallback to secure random if MeshCore function fails
            try:
                random_bytes = secrets.token_bytes(key_length_bytes)
                key = base64.b64encode(random_bytes).decode('utf-8')
                logger.warning(f"Using fallback random key generation for '{name}'")
                return key
            except Exception as fallback_e:
                logger.error(f"Fallback key generation also failed: {fallback_e}")
                raise

    def create_transport_key(self, name: str, flood_policy: str, transport_key: Optional[str] = None, parent_id: Optional[int] = None, last_used: Optional[float] = None) -> Optional[int]:
        try:
            # Generate key if not provided
            if transport_key is None:
                transport_key = self.generate_transport_key(name)
                
            current_time = time.time()
            with sqlite3.connect(self.sqlite_path) as conn:
                cursor = conn.execute("""
                    INSERT INTO transport_keys (name, flood_policy, transport_key, parent_id, last_used, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                """, (name, flood_policy, transport_key, parent_id, last_used, current_time, current_time))
                return cursor.lastrowid
        except Exception as e:
            logger.error(f"Failed to create transport key: {e}")
            return None

    def get_transport_keys(self) -> List[dict]:
        try:
            with sqlite3.connect(self.sqlite_path) as conn:
                conn.row_factory = sqlite3.Row
                rows = conn.execute("""
                    SELECT id, name, flood_policy, transport_key, parent_id, last_used, created_at, updated_at
                    FROM transport_keys
                    ORDER BY created_at ASC
                """).fetchall()
                
                return [{
                    "id": row["id"],
                    "name": row["name"],
                    "flood_policy": row["flood_policy"],
                    "transport_key": row["transport_key"],
                    "parent_id": row["parent_id"],
                    "last_used": row["last_used"],
                    "created_at": row["created_at"],
                    "updated_at": row["updated_at"]
                } for row in rows]
        except Exception as e:
            logger.error(f"Failed to get transport keys: {e}")
            return []

    def get_transport_key_by_id(self, key_id: int) -> Optional[dict]:
        try:
            with sqlite3.connect(self.sqlite_path) as conn:
                conn.row_factory = sqlite3.Row
                row = conn.execute("""
                    SELECT id, name, flood_policy, transport_key, parent_id, last_used, created_at, updated_at
                    FROM transport_keys WHERE id = ?
                """, (key_id,)).fetchone()
                
                if row:
                    return {
                        "id": row["id"],
                        "name": row["name"],
                        "flood_policy": row["flood_policy"],
                        "transport_key": row["transport_key"],
                        "parent_id": row["parent_id"],
                        "last_used": row["last_used"],
                        "created_at": row["created_at"],
                        "updated_at": row["updated_at"]
                    }
                return None
        except Exception as e:
            logger.error(f"Failed to get transport key by id: {e}")
            return None

    def update_transport_key(self, key_id: int, name: Optional[str] = None, flood_policy: Optional[str] = None, transport_key: Optional[str] = None, parent_id: Optional[int] = None, last_used: Optional[float] = None) -> bool:
        try:
            updates = []
            params = []
            
            if name is not None:
                updates.append("name = ?")
                params.append(name)
            if flood_policy is not None:
                updates.append("flood_policy = ?")
                params.append(flood_policy)
            if transport_key is not None:
                updates.append("transport_key = ?")
                params.append(transport_key)
            if parent_id is not None:
                updates.append("parent_id = ?")
                params.append(parent_id)
            if last_used is not None:
                updates.append("last_used = ?")
                params.append(last_used)
            
            if not updates:
                return False
            
            updates.append("updated_at = ?")
            params.append(time.time())
            params.append(key_id)
            
            with sqlite3.connect(self.sqlite_path) as conn:
                cursor = conn.execute(f"""
                    UPDATE transport_keys SET {', '.join(updates)}
                    WHERE id = ?
                """, params)
                return cursor.rowcount > 0
        except Exception as e:
            logger.error(f"Failed to update transport key: {e}")
            return False

    def delete_transport_key(self, key_id: int) -> bool:
        try:
            with sqlite3.connect(self.sqlite_path) as conn:
                cursor = conn.execute("DELETE FROM transport_keys WHERE id = ?", (key_id,))
                return cursor.rowcount > 0
        except Exception as e:
            logger.error(f"Failed to delete transport key: {e}")
            return False

    def delete_advert(self, advert_id: int) -> bool:
        try:
            with sqlite3.connect(self.sqlite_path) as conn:
                cursor = conn.execute("DELETE FROM adverts WHERE id = ?", (advert_id,))
                return cursor.rowcount > 0
        except Exception as e:
            logger.error(f"Failed to delete advert: {e}")
            return False

    def get_bucketed_packet_stats(self, minutes: int = 20, buckets: int = 20) -> dict:
        """
        Get packet statistics bucketed over time with SNR/RSSI averages.
        
        Uses packet_origin to distinguish between:
        - received: packets that came in from radio (packet_origin='rx')
        - transmitted: all packets we sent out (transmitted=1)
        - forwarded: received packets we retransmitted (packet_origin='rx' AND transmitted=1)
        - dropped: received packets we did NOT retransmit (packet_origin='rx' AND transmitted=0)
        
        Args:
            minutes: Time range in minutes (default: 20)
            buckets: Number of time buckets (default: 20)
            
        Returns:
            Dictionary with bucketed stats for received, transmitted, forwarded, dropped
        """
        try:
            now = time.time()
            start_time = now - (minutes * 60)
            bucket_duration = (minutes * 60) / buckets
            
            with sqlite3.connect(self.sqlite_path) as conn:
                conn.row_factory = sqlite3.Row
                
                # Initialize buckets
                result = {
                    "time_range_minutes": minutes,
                    "bucket_count": buckets,
                    "bucket_duration_seconds": bucket_duration,
                    "start_time": start_time,
                    "end_time": now,
                    "received": [],
                    "transmitted": [],
                    "forwarded": [],
                    "dropped": []
                }
                
                for i in range(buckets):
                    bucket_start = start_time + (i * bucket_duration)
                    bucket_end = bucket_start + bucket_duration
                    
                    # RECEIVED: packets that came in from radio (origin='rx')
                    # Excludes locally originated packets (tx_local)
                    rx_row = conn.execute("""
                        SELECT 
                            COUNT(*) as count,
                            AVG(snr) as avg_snr,
                            AVG(rssi) as avg_rssi
                        FROM packets 
                        WHERE timestamp >= ? AND timestamp < ?
                            AND (packet_origin = 'rx' OR packet_origin IS NULL)
                    """, (bucket_start, bucket_end)).fetchone()
                    
                    # TRANSMITTED: all packets we sent out (includes forwarded + local originations)
                    tx_row = conn.execute("""
                        SELECT 
                            COUNT(*) as count,
                            AVG(snr) as avg_snr,
                            AVG(rssi) as avg_rssi
                        FROM packets 
                        WHERE timestamp >= ? AND timestamp < ? AND transmitted = 1
                    """, (bucket_start, bucket_end)).fetchone()
                    
                    # FORWARDED: received packets that we retransmitted (origin='rx' AND transmitted)
                    fwd_row = conn.execute("""
                        SELECT 
                            COUNT(*) as count,
                            AVG(snr) as avg_snr,
                            AVG(rssi) as avg_rssi
                        FROM packets 
                        WHERE timestamp >= ? AND timestamp < ? 
                            AND transmitted = 1 
                            AND (packet_origin = 'rx' OR packet_origin IS NULL)
                    """, (bucket_start, bucket_end)).fetchone()
                    
                    # DROPPED: received packets we did NOT retransmit (origin='rx' AND NOT transmitted)
                    drop_row = conn.execute("""
                        SELECT 
                            COUNT(*) as count,
                            AVG(snr) as avg_snr,
                            AVG(rssi) as avg_rssi
                        FROM packets 
                        WHERE timestamp >= ? AND timestamp < ? 
                            AND transmitted = 0
                            AND (packet_origin = 'rx' OR packet_origin IS NULL)
                    """, (bucket_start, bucket_end)).fetchone()
                    
                    result["received"].append({
                        "bucket": i,
                        "start": bucket_start,
                        "end": bucket_end,
                        "count": rx_row["count"] or 0,
                        "avg_snr": round(rx_row["avg_snr"] or 0, 1),
                        "avg_rssi": round(rx_row["avg_rssi"] or -120, 0)
                    })
                    
                    result["transmitted"].append({
                        "bucket": i,
                        "start": bucket_start,
                        "end": bucket_end,
                        "count": tx_row["count"] or 0,
                        "avg_snr": round(tx_row["avg_snr"] or 0, 1),
                        "avg_rssi": round(tx_row["avg_rssi"] or -120, 0)
                    })
                    
                    result["forwarded"].append({
                        "bucket": i,
                        "start": bucket_start,
                        "end": bucket_end,
                        "count": fwd_row["count"] or 0,
                        "avg_snr": round(fwd_row["avg_snr"] or 0, 1),
                        "avg_rssi": round(fwd_row["avg_rssi"] or -120, 0)
                    })
                    
                    result["dropped"].append({
                        "bucket": i,
                        "start": bucket_start,
                        "end": bucket_end,
                        "count": drop_row["count"] or 0,
                        "avg_snr": round(drop_row["avg_snr"] or 0, 1),
                        "avg_rssi": round(drop_row["avg_rssi"] or -120, 0)
                    })
                
                return result
                
        except Exception as e:
            logger.error(f"Failed to get bucketed packet stats: {e}")
            return {
                "error": str(e),
                "time_range_minutes": minutes,
                "bucket_count": buckets,
                "received": [],
                "transmitted": [],
                "forwarded": [],
                "dropped": []
            }

    def get_utilization_stats(self, minutes: int = 60, buckets: int = 20) -> dict:
        """
        Get airtime utilization statistics using rolling window occupancy.
        
        Instead of per-bin utilization (which creates spiky impulses), this computes
        rolling window occupancy: sum of airtime in the last N minutes / N minutes.
        This produces the smooth "occupancy" curve operators expect.
        
        Returns per-bin:
            - t: bin start timestamp (ms)
            - tx_airtime_ms: total TX airtime in the rolling window ending at this bin
            - rx_airtime_ms: total RX airtime in the rolling window ending at this bin  
            - tx_util_pct: rolling TX occupancy percentage
            - rx_util_decoded_pct: rolling RX occupancy percentage
            - radio_activity_pct: min(100, tx + rx util)
            - tx_pkts: TX packet count in rolling window
            - rx_pkts_ok: RX packet count in rolling window
            
        Args:
            minutes: Time range in minutes (default: 60)
            buckets: Number of time buckets (default: 20)
            
        Rolling window sizing:
            - ≤1h: 5 minute rolling window
            - ≤6h: 10 minute rolling window  
            - ≤24h: 30 minute rolling window
            - >24h: 60 minute rolling window
        """
        try:
            now = time.time()
            start_time = now - (minutes * 60)
            
            # Dynamic bin sizing based on range (for display resolution)
            if minutes <= 360:  # ≤6h
                bin_sec = 60
            elif minutes <= 2880:  # ≤48h
                bin_sec = 300
            else:
                bin_sec = 900
            
            # Rolling window size for utilization calculation
            # This is the key fix: instead of per-bin airtime/bin_duration,
            # we sum airtime over a longer window for smooth occupancy
            if minutes <= 60:  # ≤1h
                rolling_window_sec = 300  # 5 minutes
            elif minutes <= 360:  # ≤6h
                rolling_window_sec = 600  # 10 minutes
            elif minutes <= 1440:  # ≤24h
                rolling_window_sec = 1800  # 30 minutes
            else:
                rolling_window_sec = 3600  # 60 minutes
            
            rolling_window_ms = rolling_window_sec * 1000
            
            # Calculate actual bucket count based on bin size
            actual_buckets = max(1, int((minutes * 60) / bin_sec))
            
            with sqlite3.connect(self.sqlite_path) as conn:
                conn.row_factory = sqlite3.Row
                
                result = {
                    "time_range_minutes": minutes,
                    "bin_sec": bin_sec,
                    "rolling_window_sec": rolling_window_sec,
                    "bucket_count": actual_buckets,
                    "start_time": start_time,
                    "end_time": now,
                    "bins": [],
                    "anomalies": {
                        "missing_airtime_count": 0,
                        "util_over_100_pre_cap_count": 0,
                    }
                }
                
                for i in range(actual_buckets):
                    bucket_end = start_time + ((i + 1) * bin_sec)
                    # Rolling window: look back rolling_window_sec from bucket_end
                    window_start = bucket_end - rolling_window_sec
                    
                    # TX: all transmitted packets in rolling window
                    tx_row = conn.execute("""
                        SELECT 
                            COUNT(*) as count,
                            COALESCE(SUM(airtime_ms), 0) as total_airtime,
                            COUNT(CASE WHEN airtime_ms IS NULL THEN 1 END) as missing_airtime
                        FROM packets 
                        WHERE timestamp >= ? AND timestamp < ? 
                            AND transmitted = 1
                    """, (window_start, bucket_end)).fetchone()
                    
                    # RX: received packets in rolling window
                    rx_row = conn.execute("""
                        SELECT 
                            COUNT(*) as count,
                            COALESCE(SUM(airtime_ms), 0) as total_airtime,
                            COUNT(CASE WHEN airtime_ms IS NULL THEN 1 END) as missing_airtime
                        FROM packets 
                        WHERE timestamp >= ? AND timestamp < ?
                            AND (packet_origin = 'rx' OR packet_origin IS NULL)
                    """, (window_start, bucket_end)).fetchone()
                    
                    tx_airtime_ms = tx_row["total_airtime"] or 0
                    rx_airtime_ms = rx_row["total_airtime"] or 0
                    tx_pkts = tx_row["count"] or 0
                    rx_pkts_ok = rx_row["count"] or 0
                    
                    # Track anomalies
                    missing = (tx_row["missing_airtime"] or 0) + (rx_row["missing_airtime"] or 0)
                    result["anomalies"]["missing_airtime_count"] += missing
                    
                    # Calculate rolling window occupancy (not per-bin impulse)
                    # util = (sum of airtime in window) / window_duration * 100
                    tx_util_pct = (tx_airtime_ms / rolling_window_ms) * 100 if rolling_window_ms > 0 else 0
                    rx_util_decoded_pct = (rx_airtime_ms / rolling_window_ms) * 100 if rolling_window_ms > 0 else 0
                    
                    # Track if utilization exceeded 100% before capping
                    combined = tx_util_pct + rx_util_decoded_pct
                    if combined > 100:
                        result["anomalies"]["util_over_100_pre_cap_count"] += 1
                    
                    radio_activity_pct = min(100, combined)
                    
                    # Per-packet averages
                    avg_rx_airtime_ms_per_pkt = (rx_airtime_ms / rx_pkts_ok) if rx_pkts_ok > 0 else 0.0
                    avg_tx_airtime_ms_per_pkt = (tx_airtime_ms / tx_pkts) if tx_pkts > 0 else 0.0

                    result["bins"].append({
                        "t": int((bucket_end - bin_sec) * 1000),  # bin start timestamp in ms
                        "tx_airtime_ms": round(tx_airtime_ms, 2),
                        "rx_airtime_ms": round(rx_airtime_ms, 2),
                        "tx_util_pct": round(tx_util_pct, 4),
                        "rx_util_decoded_pct": round(rx_util_decoded_pct, 4),
                        "radio_activity_pct": round(radio_activity_pct, 4),
                        "tx_pkts": tx_pkts,
                        "rx_pkts_ok": rx_pkts_ok,
                        "avg_rx_airtime_ms_per_pkt": round(avg_rx_airtime_ms_per_pkt, 2),
                        "avg_tx_airtime_ms_per_pkt": round(avg_tx_airtime_ms_per_pkt, 2),
                    })
                
                return result
                
        except Exception as e:
            logger.error(f"Failed to get utilization stats: {e}")
            return {
                "error": str(e),
                "time_range_minutes": minutes,
                "bins": []
            }

    def recalculate_missing_airtime(self, default_sf: int = 9, default_bw_hz: int = 125000, 
                                       default_cr: int = 5, default_preamble: int = 8) -> int:
        """
        Recalculate airtime_ms for packets that have NULL values.
        
        Uses per-packet radio params if available, otherwise falls back to defaults.
        This ensures historical data has proper airtime values for utilization charts.
        
        Returns:
            Number of packets updated
        """
        from repeater.airtime import calculate_lora_airtime_ms, PAYLOAD_OVERHEAD_BYTES
        
        try:
            updated = 0
            with sqlite3.connect(self.sqlite_path) as conn:
                conn.row_factory = sqlite3.Row
                
                # Get all packets with NULL airtime
                rows = conn.execute("""
                    SELECT id, length, radio_sf, radio_bw_hz, radio_cr_den, radio_preamble
                    FROM packets 
                    WHERE airtime_ms IS NULL AND length IS NOT NULL
                """).fetchall()
                
                for row in rows:
                    # Use per-packet radio params if available, otherwise defaults
                    sf = row["radio_sf"] if row["radio_sf"] else default_sf
                    bw = row["radio_bw_hz"] if row["radio_bw_hz"] else default_bw_hz
                    cr = row["radio_cr_den"] if row["radio_cr_den"] else default_cr
                    preamble = row["radio_preamble"] if row["radio_preamble"] else default_preamble
                    
                    airtime = calculate_lora_airtime_ms(
                        payload_len=row["length"] + PAYLOAD_OVERHEAD_BYTES,
                        spreading_factor=sf,
                        bandwidth_hz=bw,
                        coding_rate=cr,
                        preamble_length=preamble,
                    )
                    
                    conn.execute(
                        "UPDATE packets SET airtime_ms = ? WHERE id = ?",
                        (airtime, row["id"])
                    )
                    updated += 1
                
                if updated > 0:
                    logger.info(f"Recalculated airtime for {updated} packets with NULL values")
                
                return updated
                
        except Exception as e:
            logger.error(f"Failed to recalculate missing airtime: {e}")
            return 0

    def _backfill_missing_airtime(self):
        """Backfill airtime_ms for packets that have NULL values using radio_config."""
        if not self._radio_config:
            # No radio config provided, use defaults
            sf = 9
            bw = 125000
            cr = 5
            preamble = 8
        else:
            sf = self._radio_config.get("spreading_factor", 9)
            bw = self._radio_config.get("bandwidth", 125000)
            cr = self._radio_config.get("coding_rate", 5)
            preamble = self._radio_config.get("preamble_length", 8)
        
        updated = self.recalculate_missing_airtime(
            default_sf=sf,
            default_bw_hz=bw,
            default_cr=cr,
            default_preamble=preamble,
        )
        if updated > 0:
            logger.info(f"Backfilled {updated} packets with missing airtime on startup")

    def log_radio_config_change(self, sf: int, bw_hz: int, cr_den: int, preamble_len: int, ts: float = None):
        """Record a radio config change event for grooming/visualization.
        cr_den: coding rate denominator (5..8)
        """
        try:
            with sqlite3.connect(self.sqlite_path) as conn:
                conn.execute(
                    "INSERT INTO radio_config_history (timestamp, spreading_factor, bandwidth_hz, coding_rate_den, preamble_length) VALUES (?, ?, ?, ?, ?)",
                    (ts or time.time(), sf, bw_hz, cr_den, preamble_len),
                )
        except Exception as e:
            logger.error(f"Failed to log radio config change: {e}")
