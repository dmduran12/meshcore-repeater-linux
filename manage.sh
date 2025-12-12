#!/bin/bash
# pyMC Repeater Management Script - Deploy, Upgrade, Uninstall

set -e

INSTALL_DIR="/opt/pymc_repeater"
CONFIG_DIR="/etc/pymc_repeater"
LOG_DIR="/var/log/pymc_repeater"
SERVICE_USER="repeater"
SERVICE_NAME="pymc-repeater"
FRONTEND_DIR="/opt/pymc_repeater/frontend"
FRONTEND_SERVICE="pymc-frontend"

# Get the absolute path to the script's directory (works even with symlinks)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Check if we're running in an interactive terminal
if [ ! -t 0 ] || [ -z "$TERM" ]; then
    echo "Error: This script requires an interactive terminal."
    echo "Please run from SSH or a local terminal, not via file manager."
    exit 1
fi

# Check if whiptail is available, fallback to dialog
if command -v whiptail &> /dev/null; then
    DIALOG="whiptail"
elif command -v dialog &> /dev/null; then
    DIALOG="dialog"
else
    echo "TUI interface requires whiptail or dialog."
    if [ "$EUID" -eq 0 ]; then
        echo "Installing whiptail..."
        apt-get update -qq && apt-get install -y whiptail
        DIALOG="whiptail"
    else
        echo ""
        echo "Please install whiptail: sudo apt-get install -y whiptail"
        echo "Then run this script again."
        exit 1
    fi
fi

# Function to show info box
show_info() {
    $DIALOG --backtitle "pyMC Repeater Management" --title "$1" --msgbox "$2" 12 70
}

# Function to show error box
show_error() {
    $DIALOG --backtitle "pyMC Repeater Management" --title "Error" --msgbox "$1" 8 60
}

# Function to ask yes/no question
ask_yes_no() {
    $DIALOG --backtitle "pyMC Repeater Management" --title "$1" --yesno "$2" 10 70
}

# Function to show progress
show_progress() {
    echo "$2" | $DIALOG --backtitle "pyMC Repeater Management" --title "$1" --gauge "$3" 8 70 0
}

# Function to check if service exists
service_exists() {
    systemctl list-unit-files | grep -q "^$SERVICE_NAME.service"
}

# Function to check if service is installed
is_installed() {
    [ -d "$INSTALL_DIR" ] && service_exists
}

# Function to check if service is running
is_running() {
    systemctl is-active "$SERVICE_NAME" >/dev/null 2>&1
}

# Function to get current version
get_version() {
    if [ -f "$INSTALL_DIR/pyproject.toml" ]; then
        grep "^version" "$INSTALL_DIR/pyproject.toml" | cut -d'"' -f2 2>/dev/null || echo "unknown"
    else
        echo "not installed"
    fi
}

# Function to get service status for display
get_status_display() {
    if ! is_installed; then
        echo "Not Installed"
    elif is_running; then
        echo "Running ($(get_version))"
    else
        echo "Installed but Stopped ($(get_version))"
    fi
}

# Main menu
# Check if frontend is installed
frontend_installed() {
    [ -d "$FRONTEND_DIR" ] && [ -f "$FRONTEND_DIR/package.json" ]
}

# Check if frontend service is running
frontend_running() {
    systemctl is-active "$FRONTEND_SERVICE" >/dev/null 2>&1
}

show_main_menu() {
    local status=$(get_status_display)
    local frontend_status="Not Installed"
    if frontend_installed; then
        if frontend_running; then
            frontend_status="Running"
        else
            frontend_status="Installed (Stopped)"
        fi
    fi
    
    CHOICE=$($DIALOG --backtitle "pyMC Repeater Management" --title "pyMC Repeater Management" --menu "\nBackend: $status\nFrontend: $frontend_status\n\nChoose an action:" 20 70 11 \
        "install" "Install pyMC Repeater" \
        "upgrade" "Upgrade existing installation" \
        "frontend" "Install/Update Next.js Frontend" \
        "uninstall" "Remove pyMC Repeater completely" \
        "config" "Configure radio settings" \
        "start" "Start the service" \
        "stop" "Stop the service" \
        "restart" "Restart the service" \
        "logs" "View live logs" \
        "status" "Show detailed status" \
        "exit" "Exit" 3>&1 1>&2 2>&3)
    
    case $CHOICE in
        "install")
            if is_installed; then
                show_error "pyMC Repeater is already installed!\n\nUse 'upgrade' to update or 'uninstall' first."
            else
                install_repeater
            fi
            ;;
        "upgrade")
            if is_installed; then
                upgrade_repeater
            else
                show_error "pyMC Repeater is not installed!\n\nUse 'install' first."
            fi
            ;;
        "frontend")
            install_frontend
            ;;
        "uninstall")
            if is_installed; then
                uninstall_repeater
            else
                show_error "pyMC Repeater is not installed."
            fi
            ;;
        "config")
            configure_radio
            ;;
        "start")
            manage_service "start"
            ;;
        "stop")
            manage_service "stop"
            ;;
        "restart")
            manage_service "restart"
            ;;
        "logs")
            clear
            echo "=== Live Logs (Press Ctrl+C to return) ==="
            echo "Showing logs for both backend and frontend services"
            echo ""
            journalctl -u "$SERVICE_NAME" -u "$FRONTEND_SERVICE" -f
            ;;
        "status")
            show_detailed_status
            ;;
        "exit"|"")
            exit 0
            ;;
    esac
}

# Install function
install_repeater() {
    # Check root
    if [ "$EUID" -ne 0 ]; then
        show_error "Installation requires root privileges.\n\nPlease run: sudo $0"
        return
    fi
    
    # Welcome screen
    $DIALOG --backtitle "pyMC Repeater Management" --title "Welcome" --msgbox "\nWelcome to pyMC Repeater Setup\n\nThis installer will configure your Raspberry Pi as a LoRa mesh network repeater.\n\nPress OK to continue..." 12 70
    
    # SPI Check
    CONFIG_FILE=""
    if [ -f "/boot/firmware/config.txt" ]; then
        CONFIG_FILE="/boot/firmware/config.txt"
    elif [ -f "/boot/config.txt" ]; then
        CONFIG_FILE="/boot/config.txt"
    fi
    
    if [ -n "$CONFIG_FILE" ] && ! grep -q "dtparam=spi=on" "$CONFIG_FILE" 2>/dev/null && ! grep -q "spi_bcm2835" /proc/modules 2>/dev/null; then
        if ask_yes_no "SPI Not Enabled" "\nSPI interface is required but not enabled!\n\nWould you like to enable it now?\n(This will require a reboot)"; then
            echo "dtparam=spi=on" >> "$CONFIG_FILE"
            show_info "SPI Enabled" "\nSPI has been enabled in $CONFIG_FILE\n\nSystem will reboot now. Please run this script again after reboot."
            reboot
        else
            show_error "SPI is required for LoRa radio operation.\n\nPlease enable SPI manually and run this script again."
            return
        fi
    elif [ -z "$CONFIG_FILE" ]; then
        show_error "Could not find config.txt file.\n\nPlease enable SPI manually:\nsudo raspi-config -> Interfacing Options -> SPI -> Enable"
        return
    fi
    
    # Installation progress
    (
    echo "0"; echo "# Creating service user..."
    if ! id "$SERVICE_USER" &>/dev/null; then
        useradd --system --home /var/lib/pymc_repeater --shell /sbin/nologin "$SERVICE_USER"
    fi
    
    echo "5"; echo "# Adding user to hardware groups..."
    usermod -a -G gpio,i2c,spi "$SERVICE_USER" 2>/dev/null || true
    usermod -a -G dialout "$SERVICE_USER" 2>/dev/null || true
    
    echo "10"; echo "# Creating directories..."
    mkdir -p "$INSTALL_DIR" "$CONFIG_DIR" "$LOG_DIR" /var/lib/pymc_repeater "$FRONTEND_DIR"
    
    echo "15"; echo "# Installing system dependencies..."
    apt-get update -qq
    apt-get install -y libffi-dev jq pip python3-rrdtool wget swig build-essential python3-dev curl
    
    # Install mikefarah yq v4 if not already installed
    if ! command -v yq &> /dev/null || [[ "$(yq --version 2>&1)" != *"mikefarah/yq"* ]]; then
        YQ_VERSION="v4.40.5"
        YQ_BINARY="yq_linux_arm64"
        if [[ "$(uname -m)" == "x86_64" ]]; then
            YQ_BINARY="yq_linux_amd64"
        elif [[ "$(uname -m)" == "armv7"* ]]; then
            YQ_BINARY="yq_linux_arm"
        fi
        wget -qO /usr/local/bin/yq "https://github.com/mikefarah/yq/releases/download/${YQ_VERSION}/${YQ_BINARY}" && chmod +x /usr/local/bin/yq
    fi
    
    echo "20"; echo "# Installing backend files..."
    cp -r repeater "$INSTALL_DIR/"
    cp pyproject.toml "$INSTALL_DIR/"
    cp README.md "$INSTALL_DIR/"
    cp setup-radio-config.sh "$INSTALL_DIR/" 2>/dev/null || true
    cp radio-settings.json "$INSTALL_DIR/" 2>/dev/null || true
    
    echo "25"; echo "# Installing configuration..."
    cp config.yaml.example "$CONFIG_DIR/config.yaml.example"
    if [ ! -f "$CONFIG_DIR/config.yaml" ]; then
        cp config.yaml.example "$CONFIG_DIR/config.yaml"
    fi
    
    echo "30"; echo "# Installing backend systemd service..."
    cp pymc-repeater.service /etc/systemd/system/
    
    echo "35"; echo "# Setting permissions..."
    chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR" "$CONFIG_DIR" "$LOG_DIR" /var/lib/pymc_repeater
    chmod 750 "$CONFIG_DIR" "$LOG_DIR" /var/lib/pymc_repeater
    chmod 755 /var/lib/pymc_repeater
    mkdir -p /var/lib/pymc_repeater/.config/pymc_repeater
    chown -R "$SERVICE_USER:$SERVICE_USER" /var/lib/pymc_repeater/.config
    
    echo "40"; echo "# Enabling backend service..."
    systemctl daemon-reload
    systemctl enable "$SERVICE_NAME"
    
    echo "45"; echo "# Backend setup complete..."
    ) | $DIALOG --backtitle "pyMC Repeater Management" --title "Installing Backend" --gauge "Setting up pyMC Repeater backend..." 8 70 0
    
    # Install Python package outside of progress gauge for better error handling
    clear
    echo "=== Installing Python Dependencies ==="
    echo ""
    echo "Installing pymc_repeater and dependencies (including pymc_core from GitHub)..."
    echo "This may take a few minutes..."
    echo ""
    
    cd "$SCRIPT_DIR"
    
    if pip install --break-system-packages --force-reinstall --no-cache-dir --ignore-installed .; then
        echo ""
        echo "✓ Python package installation completed successfully!"
        systemctl start "$SERVICE_NAME"
    else
        echo ""
        echo "✗ Python package installation failed!"
        echo "Please check the error messages above and try again."
        read -p "Press Enter to continue..." || true
    fi
    
    # Radio configuration
    echo ""
    echo "=== Radio Configuration ==="
    RADIO_SCRIPT="$SCRIPT_DIR/setup-radio-config.sh"
    
    if [ -f "$RADIO_SCRIPT" ]; then
        clear
        echo "=== pyMC Repeater Radio Configuration ==="
        echo ""
        
        if bash "$RADIO_SCRIPT" "$CONFIG_DIR"; then
            echo ""
            echo "=== Radio Configuration Complete ==="
            echo "Restarting backend service with new configuration..."
            systemctl restart "$SERVICE_NAME" 2>/dev/null || true
            sleep 2
        else
            echo "⚠ Radio configuration failed, but installation is complete."
            echo "You can run radio configuration later from the main menu."
        fi
    else
        echo "⚠ Radio configuration script not found at $RADIO_SCRIPT"
        echo "Installation complete, but you'll need to configure radio settings manually."
    fi
    
    # === FRONTEND INSTALLATION ===
    echo ""
    echo "=== Installing Next.js Frontend ==="
    echo ""
    
    # Install Node.js if not present
    if ! command -v node &> /dev/null; then
        echo "Installing Node.js 20 LTS..."
        curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
        apt-get install -y nodejs
        echo "✓ Node.js $(node --version) installed"
    else
        echo "✓ Node.js $(node --version) already installed"
    fi
    
    # Find npm and node paths
    NPM_PATH=$(command -v npm || echo "/usr/bin/npm")
    NODE_PATH=$(command -v node || echo "/usr/bin/node")
    echo "Using npm at: $NPM_PATH"
    echo "Using node at: $NODE_PATH"
    
    # Copy frontend files
    echo "Copying frontend files..."
    if [ -d "$SCRIPT_DIR/frontend" ]; then
        cp -r "$SCRIPT_DIR/frontend/"* "$FRONTEND_DIR/"
        
        # Create environment config
        local ip_address=$(hostname -I | awk '{print $1}')
        cat > "$FRONTEND_DIR/.env.local" << EOF
# pyMC Repeater Frontend Configuration
NEXT_PUBLIC_API_URL=http://${ip_address}:8000
EOF
        echo "✓ API configured to connect to http://${ip_address}:8000"
        
        # Enable CORS in backend config for frontend access
        echo "Enabling CORS for frontend access..."
        if [ -f "$CONFIG_DIR/config.yaml" ]; then
            # Check if yq is available
            if command -v yq &> /dev/null; then
                yq -i '.web.cors_enabled = true' "$CONFIG_DIR/config.yaml"
                echo "✓ CORS enabled in backend config"
            else
                # Fallback: append if not present
                if ! grep -q "cors_enabled" "$CONFIG_DIR/config.yaml"; then
                    echo -e "\nweb:\n  cors_enabled: true" >> "$CONFIG_DIR/config.yaml"
                    echo "✓ CORS config added"
                else
                    sed -i 's/cors_enabled:.*/cors_enabled: true/' "$CONFIG_DIR/config.yaml"
                    echo "✓ CORS enabled"
                fi
            fi
            # Restart backend to apply CORS
            systemctl restart "$SERVICE_NAME" 2>/dev/null || true
        fi
        
        # Install npm dependencies
        echo "Installing npm dependencies (this may take a few minutes)..."
        cd "$FRONTEND_DIR"
        $NPM_PATH install --legacy-peer-deps
        
        # Clean any previous build cache to ensure env vars are fresh
        rm -rf "$FRONTEND_DIR/.next" 2>/dev/null || true
        
# Build production bundle (env vars are baked in at build time)
        echo "Building production bundle (standalone) with API_URL=http://${ip_address}:8000..."
        if ! NEXT_PUBLIC_API_URL="http://${ip_address}:8000" $NPM_PATH run build; then
            echo "✗ Frontend build failed. See output above."
            exit 1
        fi
            # Ensure static assets are present alongside the standalone server
            if [ ! -d "$FRONTEND_DIR/.next/standalone/.next/static" ]; then
                echo "Copying static assets into standalone bundle..."
                mkdir -p "$FRONTEND_DIR/.next/standalone/.next"
                cp -r "$FRONTEND_DIR/.next/static" "$FRONTEND_DIR/.next/standalone/.next/" 2>/dev/null || true
            fi
            # Copy public folder (images, icons, etc.) - required for standalone mode
            if [ ! -d "$FRONTEND_DIR/.next/standalone/public" ]; then
                echo "Copying public assets into standalone bundle..."
                cp -r "$FRONTEND_DIR/public" "$FRONTEND_DIR/.next/standalone/" 2>/dev/null || true
            fi
        
        # Create frontend systemd service
        echo "Creating frontend systemd service..."
        cat > /etc/systemd/system/pymc-frontend.service << EOF
[Unit]
Description=pyMC Repeater Next.js Frontend
After=network-online.target pymc-repeater.service
Wants=network-online.target pymc-repeater.service

[Service]
Type=simple
User=${SERVICE_USER}
Group=${SERVICE_USER}
WorkingDirectory=${FRONTEND_DIR}
# Run standalone compiled server
# Pre-flight checks for clarity in logs if something's missing
ExecStartPre=/usr/bin/test -x ${NODE_PATH}
ExecStartPre=/usr/bin/test -f ${FRONTEND_DIR}/.next/standalone/server.js
ExecStartPre=/usr/bin/test -d ${FRONTEND_DIR}/.next/standalone/.next/static
ExecStart=${NODE_PATH} .next/standalone/server.js
Restart=on-failure
RestartSec=5
# Minimal sane PATH for node/next
Environment=PATH=/usr/local/bin:/usr/bin:/bin
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=HOSTNAME=0.0.0.0
Environment=NEXT_PUBLIC_API_URL=http://${ip_address}:8000

[Install]
WantedBy=multi-user.target
EOF
        
        # Set permissions and start frontend
        chown -R "$SERVICE_USER:$SERVICE_USER" "$FRONTEND_DIR"
        systemctl daemon-reload
        systemctl enable "$FRONTEND_SERVICE"
systemctl start "$FRONTEND_SERVICE"
        sleep 2
        if systemctl is-active "$FRONTEND_SERVICE" > /dev/null 2>&1; then
            echo "✓ Frontend service started"
        else
            echo "✗ Frontend service failed to start. Recent logs:"
            journalctl -u "$FRONTEND_SERVICE" -n 60 --no-pager || true
        fi
    else
        echo "⚠ Frontend directory not found at $SCRIPT_DIR/frontend"
        echo "Frontend installation skipped."
    fi
    
    # Show final results
    sleep 3
    local ip_address=$(hostname -I | awk '{print $1}')
    local backend_status="✗ Not running"
    local frontend_status="✗ Not running"
    
    if is_running; then
        backend_status="✓ Running (port 8000)"
    fi
    if frontend_running; then
        frontend_status="✓ Running (port 3000)"
    fi
    
    local msg="\nInstallation completed!\n\nBackend: $backend_status\nFrontend: $frontend_status\n\nWeb Dashboard: http://$ip_address:3000\nAPI Endpoint: http://$ip_address:8000\n\nView logs: Select 'logs' from main menu"
    show_info "Installation Complete" "$msg"
}

# Upgrade function
upgrade_repeater() {
    if [ "$EUID" -ne 0 ]; then
        show_error "Upgrade requires root privileges.\n\nPlease run: sudo $0"
        return
    fi
    
    local current_version=$(get_version)
    
    if ask_yes_no "Confirm Upgrade" "Current version: $current_version\n\nThis will upgrade pyMC Repeater while preserving your configuration.\n\nContinue?"; then
        
        # Show info that upgrade is starting
        show_info "Upgrading" "Starting upgrade process...\n\nThis may take a few minutes.\nProgress will be shown in the terminal."
        
        echo "=== Upgrade Progress ==="
        echo "[1/9] Stopping service..."
        systemctl stop "$SERVICE_NAME" 2>/dev/null || true
        
        echo "[2/9] Backing up configuration..."
        if [ -d "$CONFIG_DIR" ]; then
            cp -r "$CONFIG_DIR" "$CONFIG_DIR.backup.$(date +%Y%m%d_%H%M%S)" 2>/dev/null || true
            echo "    ✓ Configuration backed up"
        fi
        
        echo "[3/9] Updating system dependencies..."
        apt-get update -qq

        apt-get install -y libffi-dev jq pip python3-rrdtool wget swig build-essential python3-dev
        
        # Install mikefarah yq v4 if not already installed
        if ! command -v yq &> /dev/null || [[ "$(yq --version 2>&1)" != *"mikefarah/yq"* ]]; then
            YQ_VERSION="v4.40.5"
            YQ_BINARY="yq_linux_arm64"
            if [[ "$(uname -m)" == "x86_64" ]]; then
                YQ_BINARY="yq_linux_amd64"
            elif [[ "$(uname -m)" == "armv7"* ]]; then
                YQ_BINARY="yq_linux_arm"
            fi
            wget -qO /usr/local/bin/yq "https://github.com/mikefarah/yq/releases/download/${YQ_VERSION}/${YQ_BINARY}" && chmod +x /usr/local/bin/yq
        fi
        echo "    ✓ Dependencies updated"
        
        echo "[4/9] Installing new files..."
        cp -r repeater "$INSTALL_DIR/" 2>/dev/null || true
        cp pyproject.toml "$INSTALL_DIR/" 2>/dev/null || true
        cp README.md "$INSTALL_DIR/" 2>/dev/null || true
        cp pymc-repeater.service /etc/systemd/system/ 2>/dev/null || true
        echo "    ✓ Files updated"
        
        echo "[5/9] Validating and updating configuration..."
        if validate_and_update_config; then
            echo "    ✓ Configuration validated and updated"
        else
            echo "    ⚠ Configuration validation failed, keeping existing config"
        fi
        
        echo "[6/9] Fixing permissions..."
        chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR" "$CONFIG_DIR" "$LOG_DIR" /var/lib/pymc_repeater 2>/dev/null || true
        chmod 750 "$CONFIG_DIR" "$LOG_DIR" 2>/dev/null || true
        chmod 755 /var/lib/pymc_repeater 2>/dev/null || true
        # Pre-create the .config directory that the service will need
        mkdir -p /var/lib/pymc_repeater/.config/pymc_repeater 2>/dev/null || true
        chown -R "$SERVICE_USER:$SERVICE_USER" /var/lib/pymc_repeater/.config 2>/dev/null || true
        echo "    ✓ Permissions updated"
        
        echo "[7/9] Reloading systemd..."
        systemctl daemon-reload
        echo "    ✓ Systemd reloaded"
        
        echo "=== Installing Python Dependencies ==="
        echo ""
        echo "Updating pymc_repeater and dependencies (including pymc_core from GitHub)..."
        echo "This may take a few minutes..."
        echo ""
        
        # Install from source directory to properly resolve Git dependencies
        cd "$SCRIPT_DIR"
        
        if pip install --break-system-packages --force-reinstall --no-cache-dir --ignore-installed .; then
            echo ""
            echo "✓ Python package update completed successfully!"
        else
            echo ""
            echo "⚠ Python package update failed, but continuing..."
        fi
        
        echo "[8/12] Starting backend service..."
        systemctl start "$SERVICE_NAME"
        echo "    ✓ Backend service started"
        
        # Rebuild frontend if it exists
        if [ -d "$FRONTEND_DIR" ] && [ -f "$FRONTEND_DIR/package.json" ]; then
            echo "[9/12] Updating frontend files..."
            cp -r "$SCRIPT_DIR/frontend/"* "$FRONTEND_DIR/" 2>/dev/null || true
            echo "    ✓ Frontend files updated"
            
            echo "[10/12] Stopping frontend service..."
            systemctl stop "$FRONTEND_SERVICE" 2>/dev/null || true
            
            echo "[11/12] Rebuilding frontend (this may take a minute)..."
            cd "$FRONTEND_DIR"
            
            # Find npm and node paths
            NPM_PATH=$(command -v npm || echo "/usr/bin/npm")
            NODE_PATH=$(command -v node || echo "/usr/bin/node")
            echo "    Using npm: $NPM_PATH"
            echo "    Using node: $NODE_PATH"
            
            # Clean previous build
            rm -rf "$FRONTEND_DIR/.next" 2>/dev/null || true
            
            # Get API URL from existing env file or use default
            local ip_address=$(hostname -I | awk '{print $1}')
            local api_url="http://${ip_address}:8000"
            if [ -f "$FRONTEND_DIR/.env.local" ]; then
                local existing_url=$(grep NEXT_PUBLIC_API_URL "$FRONTEND_DIR/.env.local" | cut -d'=' -f2)
                if [ -n "$existing_url" ]; then
                    api_url="$existing_url"
                fi
            fi
            
# Rebuild with existing API URL (standalone)
if ! NEXT_PUBLIC_API_URL="$api_url" $NPM_PATH run build; then
                echo "    ✗ Frontend build failed; aborting upgrade."
                exit 1
            fi
            # Ensure static assets are present alongside the standalone server
            if [ ! -d "$FRONTEND_DIR/.next/standalone/.next/static" ]; then
                echo "    Copying static assets into standalone bundle..."
                mkdir -p "$FRONTEND_DIR/.next/standalone/.next"
                cp -r "$FRONTEND_DIR/.next/static" "$FRONTEND_DIR/.next/standalone/.next/" 2>/dev/null || true
            fi
            # Copy public folder (images, icons, etc.) - required for standalone mode
            if [ ! -d "$FRONTEND_DIR/.next/standalone/public" ]; then
                echo "    Copying public assets into standalone bundle..."
                cp -r "$FRONTEND_DIR/public" "$FRONTEND_DIR/.next/standalone/" 2>/dev/null || true
            fi
            echo "    ✓ Frontend rebuilt (standalone)"
            
            echo "[12/12] Writing frontend service (standalone) and starting..."
            chown -R "$SERVICE_USER:$SERVICE_USER" "$FRONTEND_DIR"
            # Rewrite systemd unit to ensure standalone ExecStart
            cat > /etc/systemd/system/pymc-frontend.service << EOF
[Unit]
Description=pyMC Repeater Next.js Frontend
After=network-online.target pymc-repeater.service
Wants=network-online.target pymc-repeater.service

[Service]
Type=simple
User=${SERVICE_USER}
Group=${SERVICE_USER}
WorkingDirectory=${FRONTEND_DIR}
ExecStart=${NODE_PATH} .next/standalone/server.js
Restart=on-failure
RestartSec=5
Environment=PATH=/usr/local/bin:/usr/bin:/bin
Environment=NODE_ENV=production
Environment=PORT=3000
# Preserve existing API URL if present in .env.local
EnvironmentFile=-${FRONTEND_DIR}/.env.local

[Install]
WantedBy=multi-user.target
EOF
            systemctl daemon-reload
            systemctl enable "$FRONTEND_SERVICE" 2>/dev/null || true
systemctl start "$FRONTEND_SERVICE"
            sleep 2
            if systemctl is-active "$FRONTEND_SERVICE" > /dev/null 2>&1; then
                echo "    ✓ Frontend service started (standalone)"
            else
                echo "    ✗ Frontend service failed to start. Recent logs:"
                journalctl -u "$FRONTEND_SERVICE" -n 60 --no-pager || true
                exit 1
            fi
        else
            echo "[9/12] Frontend not installed, skipping frontend update"
        fi
        
        echo "Verifying installation..."
        sleep 3  # Give services time to start
        
        local new_version=$(get_version)
        local backend_status="✗ Not running"
        local frontend_status="✗ Not running"
        
        if is_running; then
            backend_status="✓ Running"
        fi
        if frontend_running; then
            frontend_status="✓ Running"
        fi
        
        echo "=== Upgrade Complete ==="
        echo "Version: $current_version → $new_version"
        echo "Backend: $backend_status"
        echo "Frontend: $frontend_status"
        echo ""
        
        if is_running; then
            show_info "Upgrade Complete" "Upgrade completed successfully!\n\nVersion: $current_version → $new_version\n\nBackend: $backend_status\nFrontend: $frontend_status\n\n✓ Configuration preserved"
        else
            show_error "Upgrade completed but backend failed to start!\n\nVersion updated: $current_version → $new_version\n\nCheck logs from the main menu for details."
        fi
    fi
}

# Frontend installation function
install_frontend() {
    if [ "$EUID" -ne 0 ]; then
        show_error "Frontend installation requires root privileges.\n\nPlease run: sudo $0"
        return
    fi
    
    # Check if Node.js is installed
    if ! command -v node &> /dev/null; then
        if ask_yes_no "Node.js Required" "\nNode.js is not installed.\n\nWould you like to install Node.js 20 LTS now?"; then
            clear
            echo "=== Installing Node.js 20 LTS ==="
            curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
            apt-get install -y nodejs
            echo "✓ Node.js $(node --version) installed"
        else
            show_error "Node.js is required for the frontend.\n\nPlease install Node.js manually and try again."
            return
        fi
    fi
    
    # Check if frontend source exists
    if [ ! -d "$SCRIPT_DIR/frontend" ]; then
        show_error "Frontend source not found!\n\nExpected: $SCRIPT_DIR/frontend\n\nMake sure you're running from the pyMC_Repeater repository."
        return
    fi
    
    if ask_yes_no "Install Frontend" "\nThis will install the Next.js dashboard frontend.\n\nThe frontend will run on port 3000 and connect to the backend API on port 8000.\n\nContinue?"; then
        clear
        echo "=== Installing Next.js Frontend ==="
        echo ""
        
        # Find npm and node paths
        NPM_PATH=$(command -v npm || echo "/usr/bin/npm")
        NODE_PATH=$(command -v node || echo "/usr/bin/node")
        echo "Using npm at: $NPM_PATH"
        echo "Using node at: $NODE_PATH"
        
        echo "[1/7] Creating frontend directory..."
        mkdir -p "$FRONTEND_DIR"
        
        echo "[2/7] Copying frontend files..."
        cp -r "$SCRIPT_DIR/frontend/"* "$FRONTEND_DIR/"
        
        echo "[3/7] Installing npm dependencies..."
        cd "$FRONTEND_DIR"
        $NPM_PATH install --legacy-peer-deps
        
        echo "[4/7] Creating environment config..."
        local ip_address=$(hostname -I | awk '{print $1}')
        cat > "$FRONTEND_DIR/.env.local" << EOF
# pyMC Repeater Frontend Configuration
# API URL - points to backend on port 8000
NEXT_PUBLIC_API_URL=http://${ip_address}:8000
EOF
        echo "    ✓ API configured to connect to http://${ip_address}:8000"
        
        echo "[5/8] Building production bundle..."
        $NPM_PATH run build
        
        echo "[6/8] Copying assets into standalone bundle..."
        # Next.js standalone requires manual copy of static and public folders
        mkdir -p "$FRONTEND_DIR/.next/standalone/.next"
        cp -r "$FRONTEND_DIR/.next/static" "$FRONTEND_DIR/.next/standalone/.next/" 2>/dev/null || true
        cp -r "$FRONTEND_DIR/public" "$FRONTEND_DIR/.next/standalone/" 2>/dev/null || true
        echo "    ✓ Static and public assets copied"
        
        echo "[7/8] Creating systemd service..."
        cat > /etc/systemd/system/pymc-frontend.service << EOF
[Unit]
Description=pyMC Repeater Next.js Frontend
After=network-online.target pymc-repeater.service
Wants=network-online.target pymc-repeater.service

[Service]
Type=simple
User=${SERVICE_USER}
Group=${SERVICE_USER}
WorkingDirectory=${FRONTEND_DIR}
ExecStartPre=/usr/bin/test -x ${NODE_PATH}
ExecStartPre=/usr/bin/test -f ${FRONTEND_DIR}/.next/standalone/server.js
ExecStartPre=/usr/bin/test -d ${FRONTEND_DIR}/.next/standalone/.next/static
ExecStart=${NODE_PATH} .next/standalone/server.js
Restart=on-failure
RestartSec=5
Environment=PATH=/usr/local/bin:/usr/bin:/bin
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=HOSTNAME=0.0.0.0
Environment=NEXT_PUBLIC_API_URL=http://${ip_address}:8000

[Install]
WantedBy=multi-user.target
EOF
        
        echo "[8/8] Starting frontend service..."
        chown -R "$SERVICE_USER:$SERVICE_USER" "$FRONTEND_DIR"
        systemctl daemon-reload
        systemctl enable "$FRONTEND_SERVICE"
        systemctl start "$FRONTEND_SERVICE"
        
        sleep 3
        
        if frontend_running; then
            echo ""
            echo "✓ Frontend installed and running!"
            show_info "Frontend Installed" "\nNext.js frontend installed successfully!\n\n✓ Frontend running on port 3000\n✓ API connecting to backend on port 8000\n\nDashboard: http://$ip_address:3000\nAPI: http://$ip_address:8000"
        else
            echo ""
            echo "✗ Frontend failed to start"
            show_error "Frontend installed but failed to start!\n\nCheck logs: journalctl -u $FRONTEND_SERVICE -f"
        fi
        
        read -p "Press Enter to continue..." || true
    fi
}

# Radio Configuration function
configure_radio() {
    # Check if config exists
    if [ ! -f "$CONFIG_DIR/config.yaml" ]; then
        show_error "Configuration file not found!\n\nPlease install pyMC Repeater first or ensure $CONFIG_DIR/config.yaml exists."
        return
    fi
    
    # Check if setup script exists
    RADIO_SCRIPT="$SCRIPT_DIR/setup-radio-config.sh"
    
    if [ ! -f "$RADIO_SCRIPT" ]; then
        show_error "Radio configuration script not found!\n\nExpected: $RADIO_SCRIPT"
        return
    fi
    
    # Ask for confirmation
    if ask_yes_no "Configure Radio Settings" "This will update your radio configuration including:\n\n- Repeater name\n- Hardware settings\n- Frequency and LoRa parameters\n\nThe service will be restarted after configuration.\n\nContinue?"; then
        
        # Show info that configuration is starting
        show_info "Radio Configuration" "Starting radio configuration...\n\nThe configuration script will now run in the terminal.\n\nFollow the prompts to configure your radio settings."
        
        # Clear screen and run the configuration script
        clear
        echo "=== pyMC Repeater Radio Configuration ==="
        echo ""
        
        # Run the setup script with the config directory
        if bash "$RADIO_SCRIPT" "$CONFIG_DIR"; then
            echo ""
            echo "=== Configuration Complete ==="
            
            # Restart service if it's installed and running
            if is_installed; then
                echo "Restarting service..."
                if [ "$EUID" -eq 0 ]; then
                    systemctl restart "$SERVICE_NAME" 2>/dev/null || true
                    sleep 2
                    
                    if is_running; then
                        echo "✓ Service restarted successfully"
                        show_info "Configuration Complete" "Radio configuration updated successfully!\n\n✓ Service restarted\n✓ New settings applied\n\nPress OK to return to main menu."
                    else
                        echo "✗ Service failed to restart"
                        show_error "Configuration updated but service failed to restart!\n\nCheck logs from the main menu for details."
                    fi
                else
                    show_info "Configuration Complete" "Radio configuration updated successfully!\n\n⚠ Run as root to restart the service automatically\n\nPress OK to return to main menu."
                fi
            else
                show_info "Configuration Complete" "Radio configuration updated successfully!\n\nPress OK to return to main menu."
            fi
        else
            show_error "Configuration failed!\n\nThe radio configuration script encountered an error.\n\nPress OK to return to main menu."
        fi
        
        # Pause to let user see any messages
        echo ""
        read -p "Press Enter to return to main menu..." || true
    fi
}

# Uninstall function
uninstall_repeater() {
    if [ "$EUID" -ne 0 ]; then
        show_error "Uninstall requires root privileges.\n\nPlease run: sudo $0"
        return
    fi
    
    if ask_yes_no "Confirm Uninstall" "This will completely remove pyMC Repeater including:\n\n- Service and files\n- Configuration (backup will be created)\n- Logs and data\n\nThis action cannot be undone!\n\nContinue?"; then
        (
        echo "0"; echo "# Stopping and disabling service..."
        systemctl stop "$SERVICE_NAME" 2>/dev/null || true
        systemctl disable "$SERVICE_NAME" 2>/dev/null || true
        
        echo "20"; echo "# Backing up configuration..."
        if [ -d "$CONFIG_DIR" ]; then
            cp -r "$CONFIG_DIR" "/tmp/pymc_repeater_config_backup_$(date +%Y%m%d_%H%M%S)" 2>/dev/null || true
        fi
        
        echo "40"; echo "# Removing service files..."
        rm -f /etc/systemd/system/pymc-repeater.service
        systemctl daemon-reload
        
        echo "50"; echo "# Removing frontend..."
        systemctl stop "$FRONTEND_SERVICE" 2>/dev/null || true
        systemctl disable "$FRONTEND_SERVICE" 2>/dev/null || true
        rm -f /etc/systemd/system/pymc-frontend.service
        
        echo "60"; echo "# Removing installation..."
        rm -rf "$INSTALL_DIR"
        rm -rf "$CONFIG_DIR"
        rm -rf "$LOG_DIR"
        rm -rf /var/lib/pymc_repeater
        
        echo "80"; echo "# Removing service user..."
        if id "$SERVICE_USER" &>/dev/null; then
            userdel "$SERVICE_USER" 2>/dev/null || true
        fi
        
        echo "100"; echo "# Uninstall complete!"
        ) | $DIALOG --backtitle "pyMC Repeater Management" --title "Uninstalling" --gauge "Removing pyMC Repeater..." 8 70 0
        
        show_info "Uninstall Complete" "\npyMC Repeater has been completely removed.\n\nConfiguration backup saved to /tmp/\n\nThank you for using pyMC Repeater!"
    fi
}

# Service management
manage_service() {
    local action=$1
    
    if [ "$EUID" -ne 0 ]; then
        show_error "Service management requires root privileges.\n\nPlease run: sudo $0"
        return
    fi
    
    if ! service_exists; then
        show_error "Backend service is not installed."
        return
    fi
    
    case $action in
        "start")
            systemctl start "$SERVICE_NAME"
            systemctl start "$FRONTEND_SERVICE" 2>/dev/null || true
            local backend_status="✗"
            local frontend_status="✗"
            if is_running; then backend_status="✓"; fi
            if frontend_running; then frontend_status="✓"; fi
            show_info "Services Started" "\nBackend: $backend_status\nFrontend: $frontend_status"
            ;;
        "stop")
            systemctl stop "$SERVICE_NAME"
            systemctl stop "$FRONTEND_SERVICE" 2>/dev/null || true
            show_info "Services Stopped" "\n✓ All pyMC Repeater services have been stopped."
            ;;
        "restart")
            systemctl restart "$SERVICE_NAME"
            systemctl restart "$FRONTEND_SERVICE" 2>/dev/null || true
            sleep 2
            local backend_status="✗"
            local frontend_status="✗"
            if is_running; then backend_status="✓"; fi
            if frontend_running; then frontend_status="✓"; fi
            show_info "Services Restarted" "\nBackend: $backend_status\nFrontend: $frontend_status"
            ;;
    esac
}

# Show detailed status
show_detailed_status() {
    local status_info=""
    local version=$(get_version)
    local ip_address=$(hostname -I | awk '{print $1}')
    
    status_info="Installation Status: "
    if is_installed; then
        status_info="${status_info}Installed\n"
        status_info="${status_info}Version: $version\n"
        status_info="${status_info}Install Directory: $INSTALL_DIR\n"
        status_info="${status_info}Config Directory: $CONFIG_DIR\n\n"
        
        status_info="${status_info}Backend Service: "
        if is_running; then
            status_info="${status_info}Running ✓\n"
            status_info="${status_info}API Endpoint: http://$ip_address:8000\n"
        else
            status_info="${status_info}Stopped ✗\n"
        fi
        
        status_info="${status_info}Frontend Service: "
        if frontend_installed; then
            if frontend_running; then
                status_info="${status_info}Running ✓\n"
                status_info="${status_info}Web Dashboard: http://$ip_address:3000\n\n"
            else
                status_info="${status_info}Stopped ✗\n\n"
            fi
        else
            status_info="${status_info}Not Installed\n\n"
        fi
        
        # Add system info
        status_info="${status_info}System Info:\n"
        status_info="${status_info}- SPI: "
        if grep -q "spi_bcm2835" /proc/modules 2>/dev/null; then
            status_info="${status_info}Enabled ✓\n"
        else
            status_info="${status_info}Disabled ✗\n"
        fi
        
        status_info="${status_info}- IP Address: $ip_address\n"
        status_info="${status_info}- Hostname: $(hostname)\n"
        
    else
        status_info="${status_info}Not Installed"
    fi
    
    show_info "System Status" "$status_info"
}

# Function to validate and update configuration
validate_and_update_config() {
    local config_file="$CONFIG_DIR/config.yaml"
    local example_file="config.yaml.example"
    local updated_example="$CONFIG_DIR/config.yaml.example"
    
    # Copy the new example file
    if [ -f "$example_file" ]; then
        cp "$example_file" "$updated_example"
    else
        echo "    ⚠ config.yaml.example not found in source directory"
        return 1
    fi
    
    # Check if user config exists
    if [ ! -f "$config_file" ]; then
        echo "    ⚠ No existing config.yaml found, copying example"
        cp "$updated_example" "$config_file"
        return 0
    fi
    
    # Check if yq is available
    YQ_CMD="/usr/local/bin/yq"
    if ! command -v "$YQ_CMD" &> /dev/null; then
        echo "    ⚠ mikefarah yq not found at $YQ_CMD, skipping config merge"
        return 0
    fi
    
    # Verify it's the correct yq version
    if [[ "$($YQ_CMD --version 2>&1)" != *"mikefarah/yq"* ]]; then
        echo "    ⚠ Wrong yq version detected at $YQ_CMD, skipping config merge"
        return 0
    fi
    
    echo "    Merging configuration..."
    
    # Create backup of user config
    local backup_file="${config_file}.backup.$(date +%Y%m%d_%H%M%S)"
    cp "$config_file" "$backup_file"
    echo "    ✓ Backup created: $backup_file"
    
    # Merge strategy: user config takes precedence, add missing keys from example
    # This uses yq's multiply merge operator (*) which:
    # - Keeps all values from the right operand (user config)
    # - Adds missing keys from the left operand (example config)
    local temp_merged="${config_file}.merged"
    
    if "$YQ_CMD" eval-all '. as $item ireduce ({}; . * $item)' "$updated_example" "$config_file" > "$temp_merged" 2>/dev/null; then
        # Verify the merged file is valid YAML
        if "$YQ_CMD" eval '.' "$temp_merged" > /dev/null 2>&1; then
            mv "$temp_merged" "$config_file"
            echo "    ✓ Configuration merged successfully"
            echo "    ✓ User settings preserved, new options added"
            return 0
        else
            echo "    ✗ Merged config is invalid, restoring backup"
            rm -f "$temp_merged"
            cp "$backup_file" "$config_file"
            return 1
        fi
    else
        echo "    ✗ Config merge failed, keeping original"
        rm -f "$temp_merged"
        return 1
    fi
}

# Main script logic
if [ "$1" = "--help" ] || [ "$1" = "-h" ]; then
    echo "pyMC Repeater Management Script"
    echo ""
    echo "Usage: $0 [action]"
    echo ""
    echo "Actions:"
    echo "  install   - Install pyMC Repeater"
    echo "  upgrade   - Upgrade existing installation"
    echo "  uninstall - Remove pyMC Repeater"
    echo "  config    - Configure radio settings"
    echo "  start     - Start the service"
    echo "  stop      - Stop the service"
    echo "  restart   - Restart the service"
    echo "  status    - Show status"
    echo "  debug     - Show debug information"
    echo ""
    echo "Run without arguments for interactive menu."
    exit 0
fi

# Debug mode
if [ "$1" = "debug" ]; then
    echo "=== Debug Information ==="
    echo "DIALOG: $DIALOG"
    echo "TERM: $TERM"
    echo "TTY: $(tty 2>/dev/null || echo 'not a tty')"
    echo "EUID: $EUID"
    echo "PWD: $PWD"
    echo "Script: $0"
    echo ""
    echo "Testing dialog..."
    $DIALOG --backtitle "pyMC Repeater Management" --title "Test" --msgbox "Dialog test successful!" 8 40
    echo "Dialog test completed."
    exit 0
fi

# Handle command line arguments
case "$1" in
    "install")
        install_repeater
        exit 0
        ;;
    "upgrade")
        upgrade_repeater
        exit 0
        ;;
    "frontend")
        install_frontend
        exit 0
        ;;
    "uninstall")
        uninstall_repeater
        exit 0
        ;;
    "config")
        configure_radio
        exit 0
        ;;
    "start"|"stop"|"restart")
        manage_service "$1"
        exit 0
        ;;
    "status")
        show_detailed_status
        exit 0
        ;;
esac

# Interactive menu loop
while true; do
    show_main_menu
done
