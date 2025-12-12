import logging
import math
import time
from typing import Tuple, Dict, Optional

logger = logging.getLogger("AirtimeManager")

# Overhead bytes added to app payload for LoRa packet
# MeshCore header (1) + path (variable, avg 2) + transport codes (optional, 0-4)
# Conservative estimate for airtime calculation when phy_len not available
PAYLOAD_OVERHEAD_BYTES = 4


def calculate_lora_airtime_ms(
    payload_len: int,
    spreading_factor: int = 9,
    bandwidth_hz: int = 125000,
    coding_rate: int = 5,
    preamble_length: int = 8,
    crc_enabled: bool = True,
    implicit_header: bool = False,
    low_data_rate_optimize: Optional[bool] = None,
) -> float:
    """
    Calculate LoRa packet airtime using the standard formula.
    
    Args:
        payload_len: Payload length in bytes (PHY layer, not app layer)
        spreading_factor: SF7-SF12
        bandwidth_hz: Bandwidth in Hz (e.g., 125000, 250000, 500000)
        coding_rate: Either 5-8 (denominator) or 1-4 (CR value)
        preamble_length: Number of preamble symbols (typically 8)
        crc_enabled: Whether CRC is enabled (adds 16 bits)
        implicit_header: Whether implicit header mode is used
        low_data_rate_optimize: DE flag. If None, auto-calculate based on Tsym >= 16ms
        
    Returns:
        Airtime in milliseconds
    """
    # Normalize coding rate: if 5-8, convert to 1-4
    if coding_rate >= 5:
        cr = coding_rate - 4  # 5->1, 6->2, 7->3, 8->4
    elif 1 <= coding_rate <= 4:
        cr = coding_rate
    else:
        logger.warning(f"Unknown coding_rate {coding_rate}, defaulting to CR=1")
        cr = 1
    
    # Symbol time in seconds
    t_sym = (2 ** spreading_factor) / bandwidth_hz
    
    # Low Data Rate Optimize: auto-calculate if not specified
    # DE = 1 when symbol time >= 16ms (required for SF11/SF12 at 125kHz)
    if low_data_rate_optimize is None:
        de = 1 if t_sym >= 0.016 else 0
    else:
        de = 1 if low_data_rate_optimize else 0
    
    # CRC presence (16 bits = 2 bytes overhead in formula)
    crc = 1 if crc_enabled else 0
    
    # Implicit header (IH=1 means no header, saves 20 bits)
    ih = 1 if implicit_header else 0
    
    # Preamble time
    t_preamble = (preamble_length + 4.25) * t_sym
    
    # Payload symbol calculation (standard LoRa formula)
    # payloadSymbNb = 8 + max(ceil((8*PL - 4*SF + 28 + 16*CRC - 20*IH) / (4*(SF-2*DE))) * (CR+4), 0)
    sf = spreading_factor
    pl = payload_len
    
    numerator = 8 * pl - 4 * sf + 28 + 16 * crc - 20 * ih
    denominator = 4 * (sf - 2 * de)
    
    if denominator <= 0:
        # Edge case: very low SF with DE enabled (shouldn't happen in practice)
        payload_symb_nb = 8
    else:
        payload_symb_nb = 8 + max(math.ceil(numerator / denominator) * (cr + 4), 0)
    
    # Payload time
    t_payload = payload_symb_nb * t_sym
    
    # Total airtime in milliseconds
    airtime_ms = (t_preamble + t_payload) * 1000
    
    return airtime_ms


def calculate_airtime_from_config(
    payload_len: int,
    radio_config: Dict,
    add_overhead: bool = True,
) -> float:
    """
    Calculate airtime using radio config dict.
    
    Args:
        payload_len: App-layer payload length in bytes
        radio_config: Dict with spreading_factor, bandwidth, coding_rate, preamble_length
        add_overhead: If True, add PAYLOAD_OVERHEAD_BYTES to account for headers
        
    Returns:
        Airtime in milliseconds
    """
    # Add overhead if we only have app payload length
    phy_len = payload_len + PAYLOAD_OVERHEAD_BYTES if add_overhead else payload_len
    
    return calculate_lora_airtime_ms(
        payload_len=phy_len,
        spreading_factor=radio_config.get("spreading_factor", 9),
        bandwidth_hz=radio_config.get("bandwidth", 125000),
        coding_rate=radio_config.get("coding_rate", 5),
        preamble_length=radio_config.get("preamble_length", 8),
        crc_enabled=radio_config.get("crc_enabled", True),
        implicit_header=radio_config.get("implicit_header", False),
    )


class AirtimeManager:
    def __init__(self, config: dict):
        self.config = config
        self.max_airtime_per_minute = config.get("duty_cycle", {}).get(
            "max_airtime_per_minute", 3600
        )

        # Track airtime in rolling window
        self.tx_history = []  # [(timestamp, airtime_ms), ...]
        self.window_size = 60  # seconds
        self.total_airtime_ms = 0

    def calculate_airtime(
        self,
        payload_len: int,
        spreading_factor: int = 7,
        bandwidth_hz: int = 125000,
    ) -> float:

        bw_khz = bandwidth_hz / 1000
        symbol_time = (2**spreading_factor) / bw_khz
        preamble_time = 8 * symbol_time
        payload_symbols = (payload_len + 4.25) * 8
        payload_time = payload_symbols * symbol_time

        total_ms = preamble_time + payload_time
        return total_ms

    def can_transmit(self, airtime_ms: float) -> Tuple[bool, float]:
        enforcement_enabled = self.config.get("duty_cycle", {}).get("enforcement_enabled", True)
        if not enforcement_enabled:
            # Duty cycle enforcement disabled - always allow
            return True, 0.0

        now = time.time()

        # Remove old entries outside window
        self.tx_history = [(ts, at) for ts, at in self.tx_history if now - ts < self.window_size]

        # Calculate current airtime in window
        current_airtime = sum(at for _, at in self.tx_history)

        if current_airtime + airtime_ms <= self.max_airtime_per_minute:
            return True, 0.0

        # Calculate wait time until oldest entry expires
        if self.tx_history:
            oldest_ts, oldest_at = self.tx_history[0]
            wait_time = (oldest_ts + self.window_size) - now
            return False, max(0, wait_time)

        return False, 1.0

    def record_tx(self, airtime_ms: float):
        self.tx_history.append((time.time(), airtime_ms))
        self.total_airtime_ms += airtime_ms
        logger.debug(f"TX recorded: {airtime_ms: .1f}ms (total: {self.total_airtime_ms: .0f}ms)")

    def get_stats(self) -> dict:
        now = time.time()
        self.tx_history = [(ts, at) for ts, at in self.tx_history if now - ts < self.window_size]

        current_airtime = sum(at for _, at in self.tx_history)
        utilization = (current_airtime / self.max_airtime_per_minute) * 100

        return {
            "current_airtime_ms": current_airtime,
            "max_airtime_ms": self.max_airtime_per_minute,
            "utilization_percent": utilization,
            "total_airtime_ms": self.total_airtime_ms,
        }
