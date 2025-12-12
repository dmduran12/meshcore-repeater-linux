# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Repository Overview

pyMC_Repeater is a Python-based LoRa mesh network repeater daemon built on top of the pymc_core library. It provides packet forwarding capabilities for mesh networks with real-time monitoring through a web dashboard.

## Key Commands

### Development Setup
```bash
# Install in development mode with all dev tools
pip install -e ".[dev]"

# Setup pre-commit hooks for code quality
pip install pre-commit
pre-commit install

# Run pre-commit checks manually on all files
pre-commit run --all-files
```

### Code Quality
```bash
# Format code with Black
black --line-length=100 repeater/

# Sort imports with isort
isort --profile black --line-length=100 repeater/

# Run linting with flake8
flake8 --max-line-length=100 --extend-ignore=E203,W503 repeater/

# Type checking with mypy (if configured)
mypy repeater/
```

### Service Management
```bash
# Installation and service setup
sudo bash manage.sh

# Reconfigure radio settings
sudo bash setup-radio-config.sh /etc/pymc_repeater
sudo systemctl restart pymc-repeater

# View service logs
sudo journalctl -u pymc-repeater -f

# Service control
sudo systemctl status pymc-repeater
sudo systemctl start pymc-repeater
sudo systemctl stop pymc-repeater
sudo systemctl restart pymc-repeater
```

### Running Locally
```bash
# Run the repeater daemon directly (requires config.yaml)
python -m repeater.main

# Access web dashboard (default port 8000)
http://localhost:8000
```

## Architecture Overview

### Core Components

1. **Main Entry Point** (`repeater/main.py`)
   - `RepeaterDaemon` class orchestrates the entire system
   - Initializes radio hardware, dispatcher, and packet routing
   - Manages background tasks and service lifecycle
   - Creates helper instances for trace, discovery, and advert processing

2. **Packet Processing Engine** (`repeater/engine.py`)
   - `RepeaterHandler` class handles core packet forwarding logic
   - Manages duplicate detection with seen packets cache
   - Implements duty-cycle enforcement via `AirtimeManager`
   - Calculates transmission delays based on packet scoring
   - Tracks statistics for dashboard display

3. **Packet Router** (`repeater/packet_router.py`)
   - Central routing mechanism for all incoming packets
   - Implements async queue processing with `router.enqueue()`
   - Routes packets to appropriate helpers (trace, advert, discovery)
   - Falls back to repeater engine for standard forwarding

4. **Web Interface** (`repeater/web/`)
   - HTTP server using CherryPy (`http_server.py`)
   - RESTful API endpoints (`api_endpoints.py`)
   - Vue.js frontend served from `html/` directory
   - Real-time statistics and monitoring dashboard
   - CAD calibration interface (`cad_calibration_engine.py`)

5. **Data Acquisition** (`repeater/data_acquisition/`)
   - `StorageCollector` manages persistent packet logging
   - SQLite storage backend (`sqlite_handler.py`)
   - RRDtool for time-series metrics (`rrdtool_handler.py`)
   - Optional MQTT publishing (`mqtt_handler.py`)
   - LetsMesh network integration (`letsmesh_handler.py`)

6. **Helper Modules** (`repeater/handler_helpers/`)
   - `TraceHelper`: Processes and responds to trace packets
   - `DiscoveryHelper`: Handles discovery requests/responses
   - `AdvertHelper`: Manages neighbor advertisements

### Configuration System

Configuration is managed through YAML files:
- Example: `config.yaml.example`
- Production: `/etc/pymc_repeater/config.yaml`
- Key sections:
  - `repeater`: Node name, location, identity, behavior settings
  - `radio`: LoRa parameters (frequency, spreading factor, bandwidth)
  - `sx1262`: Hardware GPIO pin mappings
  - `mesh`: Flood control and transport key policies
  - `storage`: Database and MQTT settings
  - `letsmesh`: Network integration settings

### Dependency on pymc_core

This project heavily depends on `pymc_core` for:
- LoRa radio hardware abstraction
- Packet protocol implementation
- Dispatcher and routing infrastructure
- Identity management and cryptography

The dependency is specified as:
```
pymc_core[hardware] @ git+https://github.com/rightup/pyMC_core.git@dev
```

## API Endpoints

The web server exposes these primary endpoints:

### System & Stats
- `GET /api/stats` - System statistics and metrics
- `GET /api/logs` - Recent log entries

### Packet Data
- `GET /api/packet_stats` - Packet statistics over time
- `GET /api/recent_packets` - Recent packet history
- `GET /api/filtered_packets` - Query packets with filters
- `GET /api/packet_by_hash` - Lookup specific packet

### Charts & Metrics
- `GET /api/rrd_data` - Time-series data from RRDtool
- `GET /api/packet_type_graph_data` - Packet type distribution
- `GET /api/noise_floor_chart_data` - Noise floor measurements

### Control
- `POST /api/send_advert` - Trigger advertisement broadcast
- `POST /api/set_mode` - Switch between forward/monitor modes
- `POST /api/set_duty_cycle` - Enable/disable duty cycle limits

## Hardware Support

Out-of-the-box support for:
- Waveshare SX1262 LoRa HAT
- HackerGadgets uConsole
- FrequencyLabs meshadv-mini
- FrequencyLabs meshadv

Hardware configuration is defined in the `sx1262` section of config.yaml with GPIO pin mappings.

## Important Patterns

1. **Async Packet Processing**: All packet handling uses asyncio for non-blocking operation
2. **Packet Hashing**: Duplicate detection uses SHA256 hashing stored in OrderedDict cache
3. **Transmission Delays**: Calculated based on SNR, packet priority, and network conditions
4. **Duty Cycle Management**: Enforces airtime limits to comply with regulations
5. **Statistics Collection**: Real-time metrics stored in SQLite and RRDtool for historical analysis

## Testing Approach

While no formal test suite exists, the codebase includes:
- CAD calibration tools for hardware testing
- Web dashboard for real-time monitoring
- Extensive logging for debugging
- Pre-commit hooks for code quality

For development testing:
- Use monitor mode to observe traffic without forwarding
- Check `/api/stats` endpoint for operational status
- Review logs via `journalctl` for errors
- Use dashboard to verify packet flow