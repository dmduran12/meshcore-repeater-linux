"""
Hardware statistics collection - platform agnostic.
Supports psutil if available, falls back to /proc filesystem on Linux.
"""

import os
import time
import logging
from typing import Optional, Dict, Any, List

logger = logging.getLogger("HardwareStats")

# Try to import psutil but don't fail if not available
try:
    import psutil
    PSUTIL_AVAILABLE = True
except ImportError:
    PSUTIL_AVAILABLE = False
    psutil = None


class HardwareStatsCollector:
    """Collects hardware statistics using psutil or /proc fallback."""
    
    def __init__(self):
        self.start_time = time.time()
        self._last_cpu_times: Optional[Dict[str, float]] = None
        self._last_cpu_time: float = 0
    
    def get_stats(self) -> Dict[str, Any]:
        """
        Get hardware stats in flat format expected by frontend:
        {
            cpu_percent: float,
            memory_percent: float,
            memory_used_mb: float,
            memory_total_mb: float,
            disk_percent: float,
            disk_used_gb: float,
            disk_total_gb: float,
            temperature: Optional[float],
            load_average: [float, float, float]
        }
        """
        if PSUTIL_AVAILABLE:
            return self._get_stats_psutil()
        else:
            return self._get_stats_proc()
    
    def _get_stats_psutil(self) -> Dict[str, Any]:
        """Get stats using psutil library."""
        try:
            # CPU
            cpu_percent = psutil.cpu_percent(interval=0.1)
            
            # Memory
            memory = psutil.virtual_memory()
            memory_percent = memory.percent
            memory_used_mb = memory.used / (1024 * 1024)
            memory_total_mb = memory.total / (1024 * 1024)
            
            # Disk
            disk = psutil.disk_usage('/')
            disk_percent = disk.percent
            disk_used_gb = disk.used / (1024 * 1024 * 1024)
            disk_total_gb = disk.total / (1024 * 1024 * 1024)
            
            # Load average
            try:
                load_avg = list(psutil.getloadavg())
            except (AttributeError, OSError):
                load_avg = [0.0, 0.0, 0.0]
            
            # Temperature (best effort)
            temperature = self._get_temperature_psutil()
            
            return {
                "cpu_percent": round(cpu_percent, 1),
                "memory_percent": round(memory_percent, 1),
                "memory_used_mb": round(memory_used_mb, 1),
                "memory_total_mb": round(memory_total_mb, 1),
                "disk_percent": round(disk_percent, 1),
                "disk_used_gb": round(disk_used_gb, 2),
                "disk_total_gb": round(disk_total_gb, 2),
                "temperature": round(temperature, 1) if temperature is not None else None,
                "load_average": [round(x, 2) for x in load_avg],
            }
        except Exception as e:
            logger.error(f"Error collecting hardware stats via psutil: {e}")
            return self._get_stats_proc()  # Fallback to /proc
    
    def _get_temperature_psutil(self) -> Optional[float]:
        """Get CPU temperature using psutil."""
        try:
            temps = psutil.sensors_temperatures()
            # Try common sensor names
            for name in ['coretemp', 'cpu_thermal', 'cpu-thermal', 'k10temp', 'acpitz']:
                if name in temps and temps[name]:
                    return temps[name][0].current
            # Return first available
            for entries in temps.values():
                if entries:
                    return entries[0].current
        except (AttributeError, OSError, Exception):
            pass
        return self._get_temperature_proc()  # Fallback
    
    def _get_stats_proc(self) -> Dict[str, Any]:
        """Get stats from /proc filesystem (Linux only)."""
        stats = {
            "cpu_percent": 0.0,
            "memory_percent": 0.0,
            "memory_used_mb": 0.0,
            "memory_total_mb": 0.0,
            "disk_percent": 0.0,
            "disk_used_gb": 0.0,
            "disk_total_gb": 0.0,
            "temperature": None,
            "load_average": [0.0, 0.0, 0.0],
        }
        
        try:
            # CPU usage from /proc/stat
            stats["cpu_percent"] = self._get_cpu_percent_proc()
            
            # Memory from /proc/meminfo
            meminfo = self._parse_meminfo()
            if meminfo:
                total = meminfo.get('MemTotal', 0)
                available = meminfo.get('MemAvailable', meminfo.get('MemFree', 0))
                used = total - available
                stats["memory_total_mb"] = round(total / 1024, 1)  # KB to MB
                stats["memory_used_mb"] = round(used / 1024, 1)
                if total > 0:
                    stats["memory_percent"] = round((used / total) * 100, 1)
            
            # Disk from os.statvfs
            try:
                st = os.statvfs('/')
                total = st.f_blocks * st.f_frsize
                free = st.f_bavail * st.f_frsize
                used = total - free
                stats["disk_total_gb"] = round(total / (1024**3), 2)
                stats["disk_used_gb"] = round(used / (1024**3), 2)
                if total > 0:
                    stats["disk_percent"] = round((used / total) * 100, 1)
            except OSError:
                pass
            
            # Load average from /proc/loadavg
            try:
                with open('/proc/loadavg', 'r') as f:
                    parts = f.read().strip().split()
                    if len(parts) >= 3:
                        stats["load_average"] = [
                            round(float(parts[0]), 2),
                            round(float(parts[1]), 2),
                            round(float(parts[2]), 2),
                        ]
            except (OSError, IOError, ValueError):
                pass
            
            # Temperature
            temp = self._get_temperature_proc()
            if temp is not None:
                stats["temperature"] = round(temp, 1)
            
        except Exception as e:
            logger.error(f"Error collecting hardware stats via /proc: {e}")
        
        return stats
    
    def _get_cpu_percent_proc(self) -> float:
        """Calculate CPU percentage from /proc/stat."""
        try:
            with open('/proc/stat', 'r') as f:
                line = f.readline()
            
            if not line.startswith('cpu '):
                return 0.0
            
            parts = line.split()[1:]
            values = [float(x) for x in parts[:7]]
            
            # user, nice, system, idle, iowait, irq, softirq
            idle = values[3] + values[4]  # idle + iowait
            total = sum(values)
            
            now = time.time()
            
            if self._last_cpu_times is not None:
                idle_delta = idle - self._last_cpu_times['idle']
                total_delta = total - self._last_cpu_times['total']
                
                if total_delta > 0:
                    cpu_percent = ((total_delta - idle_delta) / total_delta) * 100
                    self._last_cpu_times = {'idle': idle, 'total': total}
                    self._last_cpu_time = now
                    return round(max(0, min(100, cpu_percent)), 1)
            
            # First call - store values and return 0
            self._last_cpu_times = {'idle': idle, 'total': total}
            self._last_cpu_time = now
            return 0.0
            
        except (OSError, IOError, ValueError) as e:
            logger.debug(f"Could not read /proc/stat: {e}")
            return 0.0
    
    def _parse_meminfo(self) -> Dict[str, int]:
        """Parse /proc/meminfo and return values in KB."""
        result = {}
        try:
            with open('/proc/meminfo', 'r') as f:
                for line in f:
                    parts = line.split()
                    if len(parts) >= 2:
                        key = parts[0].rstrip(':')
                        value = int(parts[1])  # Value in KB
                        result[key] = value
        except (OSError, IOError, ValueError) as e:
            logger.debug(f"Could not read /proc/meminfo: {e}")
        return result
    
    def _get_temperature_proc(self) -> Optional[float]:
        """Get CPU temperature from /sys/class/thermal or hwmon."""
        # Common temperature file locations
        temp_files = [
            '/sys/class/thermal/thermal_zone0/temp',
            '/sys/class/thermal/thermal_zone1/temp',
            '/sys/devices/platform/coretemp.0/hwmon/hwmon0/temp1_input',
            '/sys/devices/platform/coretemp.0/hwmon/hwmon1/temp1_input',
            '/sys/class/hwmon/hwmon0/temp1_input',
            '/sys/class/hwmon/hwmon1/temp1_input',
        ]
        
        # Also check dynamic hwmon paths
        try:
            hwmon_base = '/sys/class/hwmon'
            if os.path.isdir(hwmon_base):
                for hwmon in os.listdir(hwmon_base):
                    temp_file = os.path.join(hwmon_base, hwmon, 'temp1_input')
                    if os.path.isfile(temp_file):
                        temp_files.append(temp_file)
        except OSError:
            pass
        
        for path in temp_files:
            try:
                with open(path, 'r') as f:
                    temp = int(f.read().strip())
                    # Temperature is usually in millidegrees
                    if temp > 1000:
                        temp = temp / 1000.0
                    return temp
            except (OSError, IOError, ValueError):
                continue
        
        return None
    
    def get_processes_summary(self, limit=10):
        """
        Get top processes by CPU and memory usage.
        Returns a dictionary with process information in the format expected by the UI.
        """
        if not PSUTIL_AVAILABLE:
            logger.error("psutil not available - cannot collect process stats")
            return {
                "processes": [],
                "total_processes": 0,
                "error": "psutil library not available - cannot collect process statistics"
            }
        
        try:
            processes = []
            
            # Get all processes
            for proc in psutil.process_iter(['pid', 'name', 'cpu_percent', 'memory_percent', 'memory_info']):
                try:
                    pinfo = proc.info
                    # Calculate memory in MB
                    memory_mb = 0
                    if pinfo['memory_info']:
                        memory_mb = pinfo['memory_info'].rss / 1024 / 1024  # RSS in MB
                    
                    process_data = {
                        "pid": pinfo['pid'],
                        "name": pinfo['name'] or 'Unknown',
                        "cpu_percent": pinfo['cpu_percent'] or 0.0,
                        "memory_percent": pinfo['memory_percent'] or 0.0,
                        "memory_mb": round(memory_mb, 1)
                    }
                    processes.append(process_data)
                except (psutil.NoSuchProcess, psutil.AccessDenied):
                    pass
            
            # Sort by CPU usage and get top processes
            top_processes = sorted(processes, key=lambda x: x['cpu_percent'], reverse=True)[:limit]
            
            return {
                "processes": top_processes,
                "total_processes": len(processes)
            }
            
        except Exception as e:
            logger.error(f"Error collecting process stats: {e}")
            return {
                "processes": [],
                "total_processes": 0,
                "error": str(e)
            }