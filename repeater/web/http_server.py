import logging
from collections import deque
from datetime import datetime
from typing import Callable, Optional

import cherrypy
import cherrypy_cors

from .api_endpoints import APIEndpoints

logger = logging.getLogger("HTTPServer")


# In-memory log buffer
class LogBuffer(logging.Handler):

    def __init__(self, max_lines=100):
        super().__init__()
        self.logs = deque(maxlen=max_lines)
        self.setFormatter(logging.Formatter("%(asctime)s - %(name)s - %(levelname)s - %(message)s"))

    def emit(self, record):

        try:
            msg = self.format(record)
            self.logs.append(
                {
                    "message": msg,
                    "timestamp": datetime.fromtimestamp(record.created).isoformat(),
                    "level": record.levelname,
                }
            )
        except Exception:
            self.handleError(record)


# Global log buffer instance
_log_buffer = LogBuffer(max_lines=100)


class APIApp:
    """CherryPy application serving only the API endpoints.
    
    The frontend is served separately by Next.js on port 3000.
    This server provides the backend API on port 8000.
    """

    def __init__(
        self,
        stats_getter: Optional[Callable] = None,
        node_name: str = "Repeater",
        pub_key: str = "",
        send_advert_func: Optional[Callable] = None,
        config: Optional[dict] = None,
        event_loop=None,
        daemon_instance=None,
        config_path=None,
    ):
        self.stats_getter = stats_getter
        self.node_name = node_name
        self.pub_key = pub_key
        self.config = config or {}

        # Create nested API object for routing
        self.api = APIEndpoints(stats_getter, send_advert_func, self.config, event_loop, daemon_instance, config_path)

    @cherrypy.expose
    def index(self):
        """Root endpoint - redirect to API info."""
        cherrypy.response.headers['Content-Type'] = 'application/json'
        return '{"status": "ok", "message": "pyMC Repeater API. Dashboard available on port 3000."}'


class HTTPStatsServer:
    """HTTP server providing the backend API for pyMC Repeater.
    
    This server runs on port 8000 and provides REST API endpoints.
    The frontend dashboard is served separately by Next.js on port 3000.
    """

    def __init__(
        self,
        host: str = "0.0.0.0",
        port: int = 8000,
        stats_getter: Optional[Callable] = None,
        node_name: str = "Repeater",
        pub_key: str = "",
        send_advert_func: Optional[Callable] = None,
        config: Optional[dict] = None,
        event_loop=None,
        daemon_instance=None,
        config_path=None,
    ):
        self.host = host
        self.port = port
        self.config = config or {}
        self.app = APIApp(
            stats_getter, node_name, pub_key, send_advert_func, config, event_loop, daemon_instance, config_path
        )
        
        # Set up CORS at the server level if enabled
        self._cors_enabled = self.config.get("web", {}).get("cors_enabled", False)
        logger.info(f"CORS enabled: {self._cors_enabled}")

    def _setup_server_cors(self):
        """Set up CORS using cherrypy_cors.install()"""
        cherrypy_cors.install()
        logger.info("CORS support enabled")

    def start(self):
        try:
            if self._cors_enabled:
                self._setup_server_cors()

            # Minimal config for API-only server
            config = {
                "/": {
                    "tools.sessions.on": False,
                },
            }

            # Only add CORS config entries if CORS is enabled
            if self._cors_enabled:
                config["/"]["cors.expose.on"] = True

            cherrypy.config.update(
                {
                    "server.socket_host": self.host,
                    "server.socket_port": self.port,
                    "engine.autoreload.on": False,
                    "log.screen": False,
                    "log.access_file": "",
                    "log.error_file": "",
                }
            )

            cherrypy.tree.mount(self.app, "/", config)

            # Completely disable access logging
            cherrypy.log.access_log.propagate = False
            cherrypy.log.error_log.setLevel(logging.ERROR)

            cherrypy.engine.start()
            logger.info(f"API server started on http://{self.host}:{self.port}")

        except Exception as e:
            logger.error(f"Failed to start HTTP server: {e}")
            raise

    def stop(self):
        try:
            cherrypy.engine.exit()
            logger.info("API server stopped")
        except Exception as e:
            logger.warning(f"Error stopping HTTP server: {e}")
