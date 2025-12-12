import json
import logging
import os
import time
from datetime import datetime
from typing import Callable, Optional
import cherrypy
from repeater import __version__
from repeater.config import update_global_flood_policy, save_config
from .cad_calibration_engine import CADCalibrationEngine

logger = logging.getLogger("HTTPServer")


# system systems
# GET /api/stats
# GET /api/logs

# # Packets
# GET /api/packet_stats?hours=24
# GET /api/recent_packets?limit=100
# GET /api/filtered_packets?type=4&route=1&start_timestamp=X&end_timestamp=Y&limit=1000
# GET /api/packet_by_hash?packet_hash=abc123
# GET /api/packet_type_stats?hours=24

# Charts & RRD
# GET /api/rrd_data?start_time=X&end_time=Y&resolution=average
# GET /api/packet_type_graph_data?hours=24&resolution=average&types=all
# GET /api/metrics_graph_data?hours=24&resolution=average&metrics=all

# Noise Floor
# GET /api/noise_floor_history?hours=24
# GET /api/noise_floor_stats?hours=24  
# GET /api/noise_floor_chart_data?hours=24

# Repeater Control
# POST /api/send_advert
# POST /api/set_mode {"mode": "forward|monitor"}
# POST /api/set_duty_cycle {"enabled": true|false}

# CAD Calibration
# POST /api/cad_calibration_start {"samples": 8, "delay": 100}
# POST /api/cad_calibration_stop
# POST /api/save_cad_settings {"peak": 127, "min_val": 64}
# GET  /api/cad_calibration_stream (SSE)


# Common Parameters
# hours - Time range (default: 24)
# resolution - 'average', 'max', 'min' (default: 'average')
# limit - Max results (default varies)
# type - Packet type 0-15
# route - Route type 1-3



class APIEndpoints:
    # Required for CherryPy object traversal to /api/* routes
    exposed = True
    
    def __init__(self, stats_getter: Optional[Callable] = None, send_advert_func: Optional[Callable] = None, config: Optional[dict] = None, event_loop=None, daemon_instance=None, config_path=None):
        self.stats_getter = stats_getter
        self.send_advert_func = send_advert_func
        self.config = config or {}
        self.event_loop = event_loop
        self.daemon_instance = daemon_instance
        self._config_path = config_path or '/etc/pymc_repeater/config.yaml'
        self.cad_calibration = CADCalibrationEngine(daemon_instance, event_loop)

    def _is_cors_enabled(self):
        return self.config.get("web", {}).get("cors_enabled", False)

    def _set_cors_headers(self):
        if self._is_cors_enabled():
            cherrypy.response.headers['Access-Control-Allow-Origin'] = '*'
            cherrypy.response.headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS'
            cherrypy.response.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization'

    @cherrypy.expose
    def default(self, *args, **kwargs):
        """Handle default requests"""
        if cherrypy.request.method == "OPTIONS":
            return ""
        
        raise cherrypy.HTTPError(404)

    def _get_storage(self):
        if not self.daemon_instance:
            raise Exception("Daemon not available")
        
        if not hasattr(self.daemon_instance, 'repeater_handler') or not self.daemon_instance.repeater_handler:
            raise Exception("Repeater handler not initialized")
            
        if not hasattr(self.daemon_instance.repeater_handler, 'storage') or not self.daemon_instance.repeater_handler.storage:
            raise Exception("Storage not initialized in repeater handler")
            
        return self.daemon_instance.repeater_handler.storage

    def _success(self, data, **kwargs):
        result = {"success": True, "data": data}
        result.update(kwargs)
        return result

    def _error(self, error):
        return {"success": False, "error": str(error)}

    def _get_params(self, defaults):
        params = cherrypy.request.params
        result = {}
        for key, default in defaults.items():
            value = params.get(key, default)
            if isinstance(default, int):
                result[key] = int(value) if value is not None else None
            elif isinstance(default, float):
                result[key] = float(value) if value is not None else None
            else:
                result[key] = value
        return result

    def _handle_options(self):
        """Handle CORS preflight OPTIONS request. Returns True if this was an OPTIONS request."""
        if cherrypy.request.method == "OPTIONS":
            # Set CORS headers for preflight
            cherrypy.response.headers['Access-Control-Allow-Origin'] = '*'
            cherrypy.response.headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
            cherrypy.response.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization'
            cherrypy.response.headers['Access-Control-Max-Age'] = '86400'  # Cache preflight for 24h
            return True
        return False

    def _require_post(self):
        # Handle OPTIONS preflight first
        if self._handle_options():
            return False  # Signal that we handled OPTIONS, caller should return empty response
        if cherrypy.request.method != "POST":
            cherrypy.response.status = 405  # Method Not Allowed
            cherrypy.response.headers['Allow'] = 'POST, OPTIONS'
            raise cherrypy.HTTPError(405, "Method not allowed. This endpoint requires POST.")
        return True  # Signal to proceed with POST handling

    def _get_time_range(self, hours):
        end_time = int(time.time())
        return end_time - (hours * 3600), end_time

    def _process_counter_data(self, data_points, timestamps_ms):
        rates = []
        prev_value = None
        for value in data_points:
            if value is None:
                rates.append(0)
            elif prev_value is None:
                rates.append(0)
            else:
                rates.append(max(0, value - prev_value))
            prev_value = value
        return [[timestamps_ms[i], rates[i]] for i in range(min(len(rates), len(timestamps_ms)))]

    def _process_gauge_data(self, data_points, timestamps_ms):
        values = [v if v is not None else 0 for v in data_points]
        return [[timestamps_ms[i], values[i]] for i in range(min(len(values), len(timestamps_ms)))]

    @cherrypy.expose
    @cherrypy.tools.json_out()
    def stats(self):
        try:
            stats = self.stats_getter() if self.stats_getter else {}
            stats["version"] = __version__
            try:
                import pymc_core
                stats["core_version"] = pymc_core.__version__
            except ImportError:
                stats["core_version"] = "unknown"
            return stats
        except Exception as e:
            logger.error(f"Error serving stats: {e}")
            return {"error": str(e)}

    @cherrypy.expose
    @cherrypy.tools.json_out()
    def send_advert(self):
        try:
            if not self._require_post():
                return {}  # OPTIONS handled
            if not self.send_advert_func:
                return self._error("Send advert function not configured")
            if self.event_loop is None:
                return self._error("Event loop not available")
            import asyncio
            future = asyncio.run_coroutine_threadsafe(self.send_advert_func(), self.event_loop)
            result = future.result(timeout=10)
            return self._success("Advert sent successfully") if result else self._error("Failed to send advert")
        except cherrypy.HTTPError:
            # Re-raise HTTP errors (like 405 Method Not Allowed) without logging
            raise
        except Exception as e:
            logger.error(f"Error sending advert: {e}", exc_info=True)
            return self._error(e)

    @cherrypy.expose
    @cherrypy.tools.json_out()
    @cherrypy.tools.json_in(force=False)
    def set_mode(self):
        try:
            if not self._require_post():
                return {}  # OPTIONS handled
            data = cherrypy.request.json
            new_mode = data.get("mode", "forward")
            if new_mode not in ["forward", "monitor"]:
                return self._error("Invalid mode. Must be 'forward' or 'monitor'")
            if "repeater" not in self.config:
                self.config["repeater"] = {}
            self.config["repeater"]["mode"] = new_mode
            
            # Persist to config file
            saved = save_config(self.config, self._config_path)
            if not saved:
                logger.warning(f"Mode changed to {new_mode} but failed to persist to config file")
            else:
                logger.info(f"Mode changed to: {new_mode} (persisted to {self._config_path})")
            
            return {"success": True, "mode": new_mode, "persisted": saved}
        except cherrypy.HTTPError:
            # Re-raise HTTP errors (like 405 Method Not Allowed) without logging
            raise
        except Exception as e:
            logger.error(f"Error setting mode: {e}", exc_info=True)
            return self._error(e)

    @cherrypy.expose
    @cherrypy.tools.json_out()
    @cherrypy.tools.json_in(force=False)
    def set_duty_cycle(self):
        try:
            if not self._require_post():
                return {}  # OPTIONS handled
            data = cherrypy.request.json
            enabled = data.get("enabled", True)
            if "duty_cycle" not in self.config:
                self.config["duty_cycle"] = {}
            self.config["duty_cycle"]["enforcement_enabled"] = enabled
            
            # Persist to config file
            saved = save_config(self.config, self._config_path)
            if not saved:
                logger.warning(f"Duty cycle {'enabled' if enabled else 'disabled'} but failed to persist to config file")
            else:
                logger.info(f"Duty cycle enforcement {'enabled' if enabled else 'disabled'} (persisted to {self._config_path})")
            
            return {"success": True, "enabled": enabled, "persisted": saved}
        except cherrypy.HTTPError:
            # Re-raise HTTP errors (like 405 Method Not Allowed) without logging
            raise
        except Exception as e:
            logger.error(f"Error setting duty cycle: {e}", exc_info=True)
            return self._error(e)

    @cherrypy.expose
    @cherrypy.tools.json_out()
    def logs(self):
        from .http_server import _log_buffer
        try:
            logs = list(_log_buffer.logs)
            return {
                "logs": (
                    logs
                    if logs
                    else [
                        {
                            "message": "No logs available",
                            "timestamp": datetime.now().isoformat(),
                            "level": "INFO",
                        }
                    ]
                )
            }
        except Exception as e:
            logger.error(f"Error fetching logs: {e}")
            return {"error": str(e), "logs": []}

    @cherrypy.expose
    @cherrypy.tools.json_out()
    def hardware_stats(self):
        """Get comprehensive hardware statistics"""
        try:
            # Get hardware stats from storage collector
            storage = self._get_storage()
            if storage:
                stats = storage.get_hardware_stats()
                if stats:
                    return self._success(stats)
                else:
                    return self._error("Hardware stats not available (psutil may not be installed)")
            else:
                return self._error("Storage collector not available")
        except Exception as e:
            logger.error(f"Error getting hardware stats: {e}")
            return self._error(e)

    @cherrypy.expose
    @cherrypy.tools.json_out()
    def hardware_processes(self):
        """Get summary of top processes"""
        try:
            # Get process stats from storage collector
            storage = self._get_storage()
            if storage:
                processes = storage.get_hardware_processes()
                if processes:
                    return self._success(processes)
                else:
                    return self._error("Process information not available (psutil may not be installed)")
            else:
                return self._error("Storage collector not available")
        except Exception as e:
            logger.error(f"Error getting process stats: {e}")
            return self._error(e)

    @cherrypy.expose
    @cherrypy.tools.json_out()
    def packet_stats(self, hours=24):
        try:
            hours = int(hours)
            stats = self._get_storage().get_packet_stats(hours=hours)
            return self._success(stats)
        except Exception as e:
            logger.error(f"Error getting packet stats: {e}")
            return self._error(e)

    @cherrypy.expose
    @cherrypy.tools.json_out()
    def route_stats(self, hours=24):
        try:
            hours = int(hours)
            stats = self._get_storage().get_route_stats(hours=hours)
            return self._success(stats)
        except Exception as e:
            logger.error(f"Error getting route stats: {e}")
            return self._error(e)

    @cherrypy.expose
    @cherrypy.tools.json_out()
    def recent_packets(self, limit=100):
        try:
            limit = int(limit)
            packets = self._get_storage().get_recent_packets(limit=limit)
            return self._success(packets, count=len(packets))
        except Exception as e:
            logger.error(f"Error getting recent packets: {e}")
            return self._error(e)

    @cherrypy.expose
    @cherrypy.tools.json_out()
    def filtered_packets(self):
        try:
            params = cherrypy.request.params
            
            # Parse type filter (must be int or None)
            packet_type = None
            if 'type' in params and params['type'] not in (None, '', 'null'):
                packet_type = int(params['type'])
            
            # Parse route filter (must be int or None)
            route = None
            if 'route' in params and params['route'] not in (None, '', 'null'):
                route = int(params['route'])
            
            # Parse timestamps
            start_timestamp = None
            if 'start_timestamp' in params and params['start_timestamp']:
                start_timestamp = float(params['start_timestamp'])
            
            end_timestamp = None
            if 'end_timestamp' in params and params['end_timestamp']:
                end_timestamp = float(params['end_timestamp'])
            
            # Parse limit
            limit = 1000
            if 'limit' in params and params['limit']:
                limit = int(params['limit'])
            
            # Call SQLite handler
            packets = self._get_storage().get_filtered_packets(
                packet_type=packet_type,
                route=route,
                start_timestamp=start_timestamp,
                end_timestamp=end_timestamp,
                limit=limit
            )
            return self._success(packets, count=len(packets), filters={
                'type': packet_type,
                'route': route,
                'start_timestamp': start_timestamp,
                'end_timestamp': end_timestamp,
                'limit': limit
            })
        except ValueError as e:
            return self._error(f"Invalid parameter format: {e}")
        except Exception as e:
            logger.error(f"Error getting filtered packets: {e}")
            return self._error(e)

    @cherrypy.expose
    @cherrypy.tools.json_out()
    def packet_by_hash(self, packet_hash=None):
        try:
            if not packet_hash:
                return self._error("packet_hash parameter required")
            packet = self._get_storage().get_packet_by_hash(packet_hash)
            return self._success(packet) if packet else self._error("Packet not found")
        except Exception as e:
            logger.error(f"Error getting packet by hash: {e}")
            return self._error(e)

    @cherrypy.expose
    @cherrypy.tools.json_out()
    def packet_type_stats(self, hours=24):
        try:
            hours = int(hours)
            stats = self._get_storage().get_packet_type_stats(hours=hours)
            return self._success(stats)
        except Exception as e:
            logger.error(f"Error getting packet type stats: {e}")
            return self._error(e)

    @cherrypy.expose
    @cherrypy.tools.json_out()
    def rrd_data(self):
        try:
            params = self._get_params({
                'start_time': None,
                'end_time': None,
                'resolution': 'average'
            })
            data = self._get_storage().get_rrd_data(**params)
            return self._success(data) if data else self._error("No RRD data available")
        except ValueError as e:
            return self._error(f"Invalid parameter format: {e}")
        except Exception as e:
            logger.error(f"Error getting RRD data: {e}")
            return self._error(e)

    @cherrypy.expose
    @cherrypy.tools.json_out()
    def packet_type_graph_data(self, hours=24, resolution='average', types='all'):
        
        try:
            hours = int(hours)
            start_time, end_time = self._get_time_range(hours)
            
            storage = self._get_storage()
            
            stats = storage.sqlite_handler.get_packet_type_stats(hours)
            if 'error' in stats:
                return self._error(stats['error'])
            
            packet_type_totals = stats.get('packet_type_totals', {})
            
            # Create simple bar chart data format for packet types
            series = []
            for type_name, count in packet_type_totals.items():
                if count > 0:  # Only include types with actual data
                    series.append({
                        "name": type_name,
                        "type": type_name.lower().replace(' ', '_').replace('(', '').replace(')', ''),
                        "data": [[end_time * 1000, count]]  # Single data point with total count
                    })
            
            # Sort series by count (descending)
            series.sort(key=lambda x: x['data'][0][1], reverse=True)
            
            graph_data = {
                "start_time": start_time,
                "end_time": end_time,
                "step": 3600,  # 1 hour step for simple bar chart
                "timestamps": [start_time, end_time],
                "series": series,
                "data_source": "sqlite",
                "chart_type": "bar"  # Indicate this is bar chart data
            }
            
            return self._success(graph_data)
            
        except ValueError as e:
            return self._error(f"Invalid parameter format: {e}")
        except Exception as e:
            logger.error(f"Error getting packet type graph data: {e}")
            return self._error(e)

    @cherrypy.expose
    @cherrypy.tools.json_out()
    def metrics_graph_data(self, hours=24, resolution='average', metrics='all'):
        
        try:
            hours = int(hours)
            start_time, end_time = self._get_time_range(hours)
            
            rrd_data = self._get_storage().get_rrd_data(
                start_time=start_time, end_time=end_time, resolution=resolution
            )
            
            if not rrd_data or 'metrics' not in rrd_data:
                return self._error("No RRD data available")
            
            metric_names = {
                'rx_count': 'Received Packets', 'tx_count': 'Transmitted Packets',
                'drop_count': 'Dropped Packets', 'avg_rssi': 'Average RSSI (dBm)',
                'avg_snr': 'Average SNR (dB)', 'avg_length': 'Average Packet Length',
                'avg_score': 'Average Score', 'neighbor_count': 'Neighbor Count'
            }
            
            counter_metrics = ['rx_count', 'tx_count', 'drop_count']
            
            if metrics != 'all':
                requested_metrics = [m.strip() for m in metrics.split(',')]
            else:
                requested_metrics = list(rrd_data['metrics'].keys())
            
            timestamps_ms = [ts * 1000 for ts in rrd_data['timestamps']]
            series = []
            
            for metric_key in requested_metrics:
                if metric_key in rrd_data['metrics']:
                    if metric_key in counter_metrics:
                        chart_data = self._process_counter_data(rrd_data['metrics'][metric_key], timestamps_ms)
                    else:
                        chart_data = self._process_gauge_data(rrd_data['metrics'][metric_key], timestamps_ms)
                    
                    series.append({
                        "name": metric_names.get(metric_key, metric_key),
                        "type": metric_key,
                        "data": chart_data
                    })
            
            graph_data = {
                "start_time": rrd_data['start_time'],
                "end_time": rrd_data['end_time'],
                "step": rrd_data['step'],
                "timestamps": rrd_data['timestamps'],
                "series": series
            }
            
            return self._success(graph_data)
            
        except ValueError as e:
            return self._error(f"Invalid parameter format: {e}")
        except Exception as e:
            logger.error(f"Error getting metrics graph data: {e}")
            return self._error(e)

    @cherrypy.expose
    @cherrypy.tools.json_out()  
    @cherrypy.tools.json_in()
    def cad_calibration_start(self):
        
        try:
            self._require_post()
            data = cherrypy.request.json or {}
            samples = data.get("samples", 8)
            delay = data.get("delay", 100)
            if self.cad_calibration.start_calibration(samples, delay):
                return self._success("Calibration started")
            else:
                return self._error("Calibration already running")
        except cherrypy.HTTPError:
            # Re-raise HTTP errors (like 405 Method Not Allowed) without logging
            raise
        except Exception as e:
            logger.error(f"Error starting CAD calibration: {e}")
            return self._error(e)
    
    @cherrypy.expose
    @cherrypy.tools.json_out()
    def cad_calibration_stop(self):
        
        try:
            self._require_post()
            self.cad_calibration.stop_calibration()
            return self._success("Calibration stopped")
        except cherrypy.HTTPError:
            # Re-raise HTTP errors (like 405 Method Not Allowed) without logging
            raise
        except Exception as e:
            logger.error(f"Error stopping CAD calibration: {e}")
            return self._error(e)
    
    @cherrypy.expose
    @cherrypy.tools.json_out()
    @cherrypy.tools.json_in()
    def save_cad_settings(self):
        
        try:
            self._require_post()
            data = cherrypy.request.json or {}
            peak = data.get("peak")
            min_val = data.get("min_val")
            detection_rate = data.get("detection_rate", 0)
            
            if peak is None or min_val is None:
                return self._error("Missing peak or min_val parameters")
            
            if self.daemon_instance and hasattr(self.daemon_instance, 'radio') and self.daemon_instance.radio:
                if hasattr(self.daemon_instance.radio, 'set_custom_cad_thresholds'):
                    self.daemon_instance.radio.set_custom_cad_thresholds(peak=peak, min_val=min_val)
                    logger.info(f"Applied CAD settings to radio: peak={peak}, min={min_val}")
            
            if "radio" not in self.config:
                self.config["radio"] = {}
            if "cad" not in self.config["radio"]:
                self.config["radio"]["cad"] = {}
            
            self.config["radio"]["cad"]["peak_threshold"] = peak
            self.config["radio"]["cad"]["min_threshold"] = min_val
            
            config_path = getattr(self, '_config_path', '/etc/pymc_repeater/config.yaml')
            self._save_config_to_file(config_path)
            
            logger.info(f"Saved CAD settings to config: peak={peak}, min={min_val}, rate={detection_rate:.1f}%")
            return {
                "success": True, 
                "message": f"CAD settings saved: peak={peak}, min={min_val}",
                "settings": {"peak": peak, "min_val": min_val, "detection_rate": detection_rate}
            }
        except cherrypy.HTTPError:
            # Re-raise HTTP errors (like 405 Method Not Allowed) without logging
            raise
        except Exception as e:
            logger.error(f"Error saving CAD settings: {e}")
            return self._error(e)

    def _save_config_to_file(self, config_path):
        try:
            import yaml
            import os
            os.makedirs(os.path.dirname(config_path), exist_ok=True)
            with open(config_path, 'w') as f:
                yaml.dump(self.config, f, default_flow_style=False, indent=2)
            logger.info(f"Configuration saved to {config_path}")
        except Exception as e:
            logger.error(f"Failed to save config to {config_path}: {e}")
            raise

    @cherrypy.expose
    @cherrypy.tools.json_out()
    def noise_floor_history(self, hours: int = 24):
        
        try:
            storage = self._get_storage()
            hours = int(hours)
            history = storage.get_noise_floor_history(hours=hours)
            
            return self._success({
                "history": history,
                "hours": hours,
                "count": len(history)
            })
        except Exception as e:
            logger.error(f"Error fetching noise floor history: {e}")
            return self._error(e)
    
    @cherrypy.expose
    @cherrypy.tools.json_out()
    def noise_floor_stats(self, hours: int = 24):
        
        try:
            storage = self._get_storage()
            hours = int(hours)
            stats = storage.get_noise_floor_stats(hours=hours)
            
            return self._success({
                "stats": stats,
                "hours": hours
            })
        except Exception as e:
            logger.error(f"Error fetching noise floor stats: {e}")
            return self._error(e)
    
    @cherrypy.expose
    @cherrypy.tools.json_out()
    def noise_floor_chart_data(self, hours: int = 24):
        
        try:
            storage = self._get_storage()
            hours = int(hours)
            chart_data = storage.get_noise_floor_rrd(hours=hours)
            
            return self._success({
                "chart_data": chart_data,
                "hours": hours
            })
        except Exception as e:
            logger.error(f"Error fetching noise floor chart data: {e}")
            return self._error(e)

    @cherrypy.expose
    def cad_calibration_stream(self):
        cherrypy.response.headers['Content-Type'] = 'text/event-stream'
        cherrypy.response.headers['Cache-Control'] = 'no-cache'
        cherrypy.response.headers['Connection'] = 'keep-alive'
        
        if not hasattr(self.cad_calibration, 'message_queue'):
            self.cad_calibration.message_queue = []
        
        def generate():
            try:
                yield f"data: {json.dumps({'type': 'connected', 'message': 'Connected to CAD calibration stream'})}\n\n"
                
                if self.cad_calibration.running:
                    config = getattr(self.cad_calibration.daemon_instance, 'config', {})
                    radio_config = config.get("radio", {})
                    sf = radio_config.get("spreading_factor", 8)
                    
                    peak_range, min_range = self.cad_calibration.get_test_ranges(sf)
                    total_tests = len(peak_range) * len(min_range)
                    
                    status_message = {
                        "type": "status", 
                        "message": f"Calibration in progress: SF{sf}, {total_tests} tests",
                        "test_ranges": {
                            "peak_min": min(peak_range),
                            "peak_max": max(peak_range),
                            "min_min": min(min_range),
                            "min_max": max(min_range),
                            "spreading_factor": sf,
                            "total_tests": total_tests
                        }
                    }
                    yield f"data: {json.dumps(status_message)}\n\n"
                
                last_message_index = len(self.cad_calibration.message_queue)
                
                while True:
                    current_queue_length = len(self.cad_calibration.message_queue)
                    if current_queue_length > last_message_index:
                        for i in range(last_message_index, current_queue_length):
                            message = self.cad_calibration.message_queue[i]
                            yield f"data: {json.dumps(message)}\n\n"
                        last_message_index = current_queue_length
                    else:
                        yield f"data: {json.dumps({'type': 'keepalive'})}\n\n"
                    
                    time.sleep(0.5)
                    
            except Exception as e:
                logger.error(f"SSE stream error: {e}")
        
        return generate()

    cad_calibration_stream._cp_config = {'response.stream': True}

    @cherrypy.expose
    @cherrypy.tools.json_out()
    def adverts_by_contact_type(self, contact_type=None, limit=None, hours=None):
        
        try:
            if not contact_type:
                return self._error("contact_type parameter is required")
            
            limit_int = int(limit) if limit is not None else None
            hours_int = int(hours) if hours is not None else None
            
            storage = self._get_storage()
            adverts = storage.sqlite_handler.get_adverts_by_contact_type(
                contact_type=contact_type,
                limit=limit_int,
                hours=hours_int
            )
            
            return self._success(adverts, 
                                count=len(adverts),
                                contact_type=contact_type,
                                filters={
                                    "contact_type": contact_type,
                                    "limit": limit_int,
                                    "hours": hours_int
                                })
            
        except ValueError as e:
            return self._error(f"Invalid parameter format: {e}")
        except Exception as e:
            logger.error(f"Error getting adverts by contact type: {e}")
            return self._error(e)

    @cherrypy.expose
    @cherrypy.tools.json_out()
    @cherrypy.tools.json_in()
    def transport_keys(self):
        
        if cherrypy.request.method == "GET":
            try:
                storage = self._get_storage()
                keys = storage.get_transport_keys()
                return self._success(keys, count=len(keys))
            except Exception as e:
                logger.error(f"Error getting transport keys: {e}")
                return self._error(e)
        
        elif cherrypy.request.method == "POST":
            try:
                data = cherrypy.request.json or {}
                name = data.get("name")
                flood_policy = data.get("flood_policy")
                transport_key = data.get("transport_key")  # Optional now
                parent_id = data.get("parent_id")
                last_used = data.get("last_used")
                
                if not name or not flood_policy:
                    return self._error("Missing required fields: name, flood_policy")
                
                if flood_policy not in ["allow", "deny"]:
                    return self._error("flood_policy must be 'allow' or 'deny'")
                
                # Convert ISO timestamp string to float if provided
                if last_used:
                    try:
                        from datetime import datetime
                        dt = datetime.fromisoformat(last_used.replace('Z', '+00:00'))
                        last_used = dt.timestamp()
                    except (ValueError, AttributeError):
                        # If conversion fails, use current time
                        last_used = time.time()
                else:
                    last_used = time.time()
                
                storage = self._get_storage()
                key_id = storage.create_transport_key(name, flood_policy, transport_key, parent_id, last_used)
                
                if key_id:
                    return self._success({"id": key_id}, message="Transport key created successfully")
                else:
                    return self._error("Failed to create transport key")
            except Exception as e:
                logger.error(f"Error creating transport key: {e}")
                return self._error(e)

    @cherrypy.expose
    @cherrypy.tools.json_out()
    @cherrypy.tools.json_in()
    def transport_key(self, key_id):
        
        if cherrypy.request.method == "GET":
            try:
                key_id = int(key_id)
                storage = self._get_storage()
                key = storage.get_transport_key_by_id(key_id)
                if key:
                    return self._success(key)
                else:
                    return self._error("Transport key not found")
            except ValueError:
                return self._error("Invalid key_id format")
            except Exception as e:
                logger.error(f"Error getting transport key: {e}")
                return self._error(e)
        
        elif cherrypy.request.method == "PUT":
            try:
                key_id = int(key_id)
                data = cherrypy.request.json or {}
                
                name = data.get("name")
                flood_policy = data.get("flood_policy")
                transport_key = data.get("transport_key")
                parent_id = data.get("parent_id")
                last_used = data.get("last_used")
                
                if flood_policy and flood_policy not in ["allow", "deny"]:
                    return self._error("flood_policy must be 'allow' or 'deny'")
                
                # Convert ISO timestamp string to float if provided
                if last_used:
                    try:
                        dt = datetime.fromisoformat(last_used.replace('Z', '+00:00'))
                        last_used = dt.timestamp()
                    except (ValueError, AttributeError):
                        # If conversion fails, leave as None to not update
                        last_used = None
                
                storage = self._get_storage()
                success = storage.update_transport_key(key_id, name, flood_policy, transport_key, parent_id, last_used)
                
                if success:
                    return self._success({"id": key_id}, message="Transport key updated successfully")
                else:
                    return self._error("Failed to update transport key or key not found")
            except ValueError:
                return self._error("Invalid key_id format")
            except Exception as e:
                logger.error(f"Error updating transport key: {e}")
                return self._error(e)
        
        elif cherrypy.request.method == "DELETE":
            try:
                key_id = int(key_id)
                storage = self._get_storage()
                success = storage.delete_transport_key(key_id)
                
                if success:
                    return self._success({"id": key_id}, message="Transport key deleted successfully")
                else:
                    return self._error("Failed to delete transport key or key not found")
            except ValueError:
                return self._error("Invalid key_id format")
            except Exception as e:
                logger.error(f"Error deleting transport key: {e}")
                return self._error(e)

    @cherrypy.expose
    @cherrypy.tools.json_out()
    @cherrypy.tools.json_in()
    def global_flood_policy(self):
        
        """
        Update global flood policy configuration
        
        POST /global_flood_policy
        Body: {"global_flood_allow": true/false}
        """
        if cherrypy.request.method == "POST":
            try:
                data = cherrypy.request.json or {}
                global_flood_allow = data.get("global_flood_allow")
                
                if global_flood_allow is None:
                    return self._error("Missing required field: global_flood_allow")
                
                if not isinstance(global_flood_allow, bool):
                    return self._error("global_flood_allow must be a boolean value")
                
                # Update the running configuration first (like CAD settings)
                if "mesh" not in self.config:
                    self.config["mesh"] = {}
                self.config["mesh"]["global_flood_allow"] = global_flood_allow
                
                # Get the actual config path from daemon instance (same as CAD settings)
                config_path = getattr(self, '_config_path', '/etc/pymc_repeater/config.yaml')
                if self.daemon_instance and hasattr(self.daemon_instance, 'config_path'):
                    config_path = self.daemon_instance.config_path
                
                logger.info(f"Using config path for global flood policy: {config_path}")
                
                # Update the configuration file using the same method as CAD
                try:
                    self._save_config_to_file(config_path)
                    logger.info(f"Updated running config and saved global flood policy to file: {'allow' if global_flood_allow else 'deny'}")
                except Exception as e:
                    logger.error(f"Failed to save global flood policy to file: {e}")
                    return self._error(f"Failed to save configuration to file: {e}")
                
                return self._success(
                    {"global_flood_allow": global_flood_allow},
                    message=f"Global flood policy updated to {'allow' if global_flood_allow else 'deny'} (live and saved)"
                )
                    
            except Exception as e:
                logger.error(f"Error updating global flood policy: {e}")
                return self._error(e)
        else:
            return self._error("Method not supported")

    @cherrypy.expose
    @cherrypy.tools.json_out()
    @cherrypy.tools.json_in()
    def advert(self, advert_id):
        # Enable CORS for this endpoint only if configured
        self._set_cors_headers()
        
        if cherrypy.request.method == "OPTIONS":
            return ""
        elif cherrypy.request.method == "DELETE":
            try:
                advert_id = int(advert_id)
                storage = self._get_storage()
                success = storage.delete_advert(advert_id)
                
                if success:
                    return self._success({"id": advert_id}, message="Neighbor deleted successfully")
                else:
                    return self._error("Failed to delete neighbor or neighbor not found")
            except ValueError:
                return self._error("Invalid advert_id format")
            except Exception as e:
                logger.error(f"Error deleting neighbor: {e}")
                return self._error(e)
        else:
            return self._error("Method not supported")

    @cherrypy.expose
    @cherrypy.tools.json_out()
    @cherrypy.tools.json_in()
    def ping_neighbor(self):
        # Enable CORS for this endpoint only if configured
        self._set_cors_headers()
        
        try:
            self._require_post()
            data = cherrypy.request.json or {}
            target_id = data.get("target_id")
            
            if not target_id:
                return self._error("Missing target_id parameter")
            
            # TODO: Implement actual ping functionality when available
            # For now, return success to indicate the endpoint works
            logger.info(f"Ping request for neighbor: {target_id}")
            return self._success({"target_id": target_id}, message="Ping sent successfully")
            
        except cherrypy.HTTPError:
            raise
        except Exception as e:
            logger.error(f"Error pinging neighbor: {e}")
            return self._error(e)

    @cherrypy.expose
    @cherrypy.tools.json_out()
    def bucketed_stats(self, minutes=20, buckets=20):
        """
        Get bucketed packet statistics over time with SNR/RSSI averages.
        
        Query params:
            minutes: Time range in minutes (default: 20)
            buckets: Number of time buckets (default: 20)
            
        Preset ranges:
            20min: minutes=20, buckets=20 (1min per bucket)
            1hr:   minutes=60, buckets=20 (3min per bucket)  
            3hr:   minutes=180, buckets=20 (9min per bucket)
            12hr:  minutes=720, buckets=24 (30min per bucket)
            24hr:  minutes=1440, buckets=24 (1hr per bucket)
            3d:    minutes=4320, buckets=24 (3hr per bucket)
            7d:    minutes=10080, buckets=28 (6hr per bucket)
        """
        try:
            minutes = int(minutes)
            buckets = int(buckets)
            
            storage = self._get_storage()
            stats = storage.sqlite_handler.get_bucketed_packet_stats(
                minutes=minutes,
                buckets=buckets
            )
            return self._success(stats)
        except ValueError as e:
            return self._error(f"Invalid parameter format: {e}")
        except Exception as e:
            logger.error(f"Error getting bucketed stats: {e}")
            return self._error(e)

    @cherrypy.expose
    @cherrypy.tools.json_out()
    def utilization(self, hours=24):
        """
        Get airtime utilization statistics with dynamic bin sizing.
        
        Query params:
            hours: Time range in hours (default: 24)
            
        Returns JSON with:
            - bins: array of time bins
            - bin_duration_seconds: bin size in seconds
            - hours: requested range in hours
            - anomaly_counters: debug counters
            
        Each bin has:
            - t: bin start timestamp (ms)
            - tx_airtime_ms, rx_airtime_ms
            - tx_util_pct, rx_util_decoded_pct, radio_activity_pct
            - tx_pkts, rx_pkts_ok
            - avg_rx_airtime_ms_per_pkt: per-packet average (helps visualize SF/BW step-changes)
        """
        try:
            hours = int(hours)
            minutes = max(1, hours * 60)

            storage = self._get_storage()
            raw = storage.sqlite_handler.get_utilization_stats(minutes=minutes)

            # Shape the payload to a stable contract expected by the frontend
            shaped = {
                "bins": raw.get("bins", []),
                "bin_duration_seconds": raw.get("bin_sec"),
                "hours": hours,
                "anomaly_counters": {
                    "missing_airtime_ms": raw.get("anomalies", {}).get("missing_airtime_count", 0),
                    "outlier_bins": raw.get("anomalies", {}).get("util_over_100_pre_cap_count", 0),
                },
            }
            return self._success(shaped)
        except ValueError as e:
            return self._error(f"Invalid parameter format: {e}")
        except Exception as e:
            logger.error(f"Error getting utilization stats: {e}")
            return self._error(e)

    @cherrypy.expose
    def metrics(self):
        """
        Prometheus metrics endpoint.
        Returns metrics in Prometheus text format for scraping.
        """
        cherrypy.response.headers['Content-Type'] = 'text/plain; charset=utf-8'
        
        try:
            lines = []
            lines.append("# HELP packets_received_total Total packets received")
            lines.append("# TYPE packets_received_total counter")
            lines.append("# HELP packets_forwarded_total Total packets forwarded")
            lines.append("# TYPE packets_forwarded_total counter")
            lines.append("# HELP packets_dropped_total Total packets dropped")
            lines.append("# TYPE packets_dropped_total counter")
            lines.append("# HELP noise_floor_dbm Current noise floor in dBm")
            lines.append("# TYPE noise_floor_dbm gauge")
            lines.append("# HELP rssi_average_dbm Average RSSI in dBm")
            lines.append("# TYPE rssi_average_dbm gauge")
            lines.append("# HELP snr_average_db Average SNR in dB")
            lines.append("# TYPE snr_average_db gauge")
            lines.append("# HELP neighbors_active Number of active neighbors")
            lines.append("# TYPE neighbors_active gauge")
            
            # Get stats from the stats_getter
            stats = {}
            if self.stats_getter:
                stats = self.stats_getter() or {}
            
            # Extract packet counts
            rx_count = stats.get("rx_count", 0)
            tx_count = stats.get("tx_count", 0)
            drop_count = stats.get("drop_count", 0)
            
            lines.append(f"packets_received_total {rx_count}")
            lines.append(f"packets_forwarded_total {tx_count}")
            lines.append(f"packets_dropped_total {drop_count}")
            
            # RF metrics
            noise_floor = stats.get("noise_floor", -120)
            avg_rssi = stats.get("avg_rssi", -120)
            avg_snr = stats.get("avg_snr", 0)
            neighbor_count = stats.get("neighbor_count", 0)
            
            lines.append(f"noise_floor_dbm {noise_floor}")
            lines.append(f"rssi_average_dbm {avg_rssi}")
            lines.append(f"snr_average_db {avg_snr}")
            lines.append(f"neighbors_active {neighbor_count}")
            
            return "\n".join(lines) + "\n"
            
        except Exception as e:
            logger.error(f"Error generating Prometheus metrics: {e}")
            return f"# Error generating metrics: {e}\n"

    @cherrypy.expose
    @cherrypy.tools.json_out()
    def radio_presets(self):
        """
        Get available radio presets from the community-maintained list.
        These are region-specific frequency/SF/BW/CR combinations.
        """
        self._set_cors_headers()
        try:
            import os
            # Try multiple locations for the presets file
            preset_paths = [
                os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'radio-presets.json'),
                '/opt/pymc_repeater/radio-presets.json',
                '/etc/pymc_repeater/radio-presets.json',
            ]
            
            presets_data = None
            for path in preset_paths:
                if os.path.exists(path):
                    with open(path, 'r') as f:
                        presets_data = json.load(f)
                    break
            
            if presets_data is None:
                return self._error("Radio presets file not found")
            
            # Extract just the suggested_radio_settings entries
            entries = presets_data.get('config', {}).get('suggested_radio_settings', {}).get('entries', [])
            return self._success(entries)
            
        except Exception as e:
            logger.error(f"Error loading radio presets: {e}")
            return self._error(e)

    @cherrypy.expose
    @cherrypy.tools.json_out()
    @cherrypy.tools.json_in(force=False)
    def update_radio_config(self):
        """
        Update radio configuration and apply changes live.
        
        POST body (all fields optional, only provided fields are updated):
        {
            "frequency_mhz": 910.525,
            "bandwidth_khz": 62.5,
            "spreading_factor": 7,
            "coding_rate": 5,
            "tx_power": 22,
            "node_name": "my-repeater"
        }
        
        Changes are applied to the running radio immediately and persisted to config.
        """
        self._set_cors_headers()
        try:
            if not self._require_post():
                return {}  # OPTIONS handled
            
            data = cherrypy.request.json or {}
            
            if not data:
                return self._error("No configuration data provided")
            
            # Valid MeshCore bandwidths (in kHz)
            VALID_BANDWIDTHS_KHZ = [62.5, 125, 250, 500]
            # Valid spreading factors
            VALID_SF = [7, 8, 9, 10, 11, 12]
            # Valid coding rates
            VALID_CR = [5, 6, 7, 8]
            
            applied_changes = []
            errors = []
            
            # Get radio instance
            radio = None
            if self.daemon_instance and hasattr(self.daemon_instance, 'radio'):
                radio = self.daemon_instance.radio
            
            # Process frequency
            if 'frequency_mhz' in data:
                freq_mhz = float(data['frequency_mhz'])
                freq_hz = int(freq_mhz * 1_000_000)
                
                # Basic frequency validation (common ISM bands)
                if not (400_000_000 <= freq_hz <= 930_000_000):
                    errors.append(f"Frequency {freq_mhz} MHz out of valid range (400-930 MHz)")
                else:
                    if radio and hasattr(radio, 'set_frequency'):
                        if radio.set_frequency(freq_hz):
                            applied_changes.append(f"frequency={freq_mhz}MHz")
                        else:
                            errors.append("Failed to apply frequency to radio")
                    self.config.setdefault('radio', {})['frequency'] = freq_hz
            
            # Process bandwidth
            if 'bandwidth_khz' in data:
                bw_khz = float(data['bandwidth_khz'])
                if bw_khz not in VALID_BANDWIDTHS_KHZ:
                    errors.append(f"Bandwidth {bw_khz} kHz not valid. Must be one of: {VALID_BANDWIDTHS_KHZ}")
                else:
                    bw_hz = int(bw_khz * 1000)
                    if radio and hasattr(radio, 'set_bandwidth'):
                        if radio.set_bandwidth(bw_hz):
                            applied_changes.append(f"bandwidth={bw_khz}kHz")
                        else:
                            errors.append("Failed to apply bandwidth to radio")
                    self.config.setdefault('radio', {})['bandwidth'] = bw_hz
            
            # Process spreading factor
            if 'spreading_factor' in data:
                sf = int(data['spreading_factor'])
                if sf not in VALID_SF:
                    errors.append(f"Spreading factor {sf} not valid. Must be one of: {VALID_SF}")
                else:
                    if radio and hasattr(radio, 'set_spreading_factor'):
                        if radio.set_spreading_factor(sf):
                            applied_changes.append(f"SF={sf}")
                        else:
                            errors.append("Failed to apply spreading factor to radio")
                    self.config.setdefault('radio', {})['spreading_factor'] = sf
            
            # Process coding rate
            if 'coding_rate' in data:
                cr = int(data['coding_rate'])
                if cr not in VALID_CR:
                    errors.append(f"Coding rate {cr} not valid. Must be one of: {VALID_CR}")
                else:
                    # Note: SX1262 wrapper may not have set_coding_rate, config-only
                    self.config.setdefault('radio', {})['coding_rate'] = cr
                    applied_changes.append(f"CR=4/{cr}")
            
            # Process TX power
            if 'tx_power' in data:
                power = int(data['tx_power'])
                if not (-10 <= power <= 30):
                    errors.append(f"TX power {power} dBm out of range (-10 to 30)")
                else:
                    if radio and hasattr(radio, 'set_tx_power'):
                        if radio.set_tx_power(power):
                            applied_changes.append(f"TX={power}dBm")
                        else:
                            errors.append("Failed to apply TX power to radio")
                    self.config.setdefault('radio', {})['tx_power'] = power
            
            # Process node name
            if 'node_name' in data:
                node_name = str(data['node_name']).strip()
                if len(node_name) > 32:
                    errors.append("Node name too long (max 32 characters)")
                elif len(node_name) < 1:
                    errors.append("Node name cannot be empty")
                else:
                    self.config.setdefault('repeater', {})['node_name'] = node_name
                    applied_changes.append(f"name={node_name}")
            
            # Save config if we have changes
            if applied_changes:
                saved = save_config(self.config, self._config_path)
                if not saved:
                    errors.append("Failed to persist config to file")
            
            # Build response
            if errors and not applied_changes:
                return self._error("; ".join(errors))
            
            result = {
                "applied": applied_changes,
                "persisted": bool(applied_changes) and 'Failed to persist' not in str(errors),
                "live_update": radio is not None,
            }
            if errors:
                result["warnings"] = errors
            
            logger.info(f"Radio config updated: {', '.join(applied_changes)}")
            return self._success(result)
            
        except cherrypy.HTTPError:
            raise
        except Exception as e:
            logger.error(f"Error updating radio config: {e}", exc_info=True)
            return self._error(e)
