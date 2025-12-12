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

# =============================================================================
# Terminal Output Helpers (portable across all Linux terminals)
# =============================================================================

# Detect color support
if [ -t 1 ] && command -v tput &>/dev/null && [ "$(tput colors 2>/dev/null || echo 0)" -ge 8 ]; then
    C_RESET="\033[0m"
    C_BOLD="\033[1m"
    C_DIM="\033[2m"
    C_GREEN="\033[32m"
    C_YELLOW="\033[33m"
    C_BLUE="\033[34m"
    C_RED="\033[31m"
    C_CYAN="\033[36m"
else
    C_RESET="" C_BOLD="" C_DIM="" C_GREEN="" C_YELLOW="" C_BLUE="" C_RED="" C_CYAN=""
fi

# Print a section header
# Usage: print_header "Section Name"
print_header() {
    local title="$1"
    echo ""
    echo -e "${C_BOLD}${C_BLUE}===${C_RESET} ${C_BOLD}$title${C_RESET} ${C_BLUE}===${C_RESET}"
    echo ""
}

# Print a step with number
# Usage: print_step 1 5 "Doing something"
print_step() {
    local current="$1"
    local total="$2"
    local message="$3"
    echo -e "${C_CYAN}[$current/$total]${C_RESET} $message"
}

# Print a sub-item (indented)
# Usage: print_item "Detail about the step"
print_item() {
    echo -e "        $1"
}

# Print success message (checkmark style like Next.js)
# Usage: print_ok "Something worked"
print_ok() {
    echo -e "        ${C_GREEN}✓${C_RESET} $1"
}

# Print failure message
# Usage: print_fail "Something failed"
print_fail() {
    echo -e "        ${C_RED}✗${C_RESET} $1"
}

# Print warning message
# Usage: print_warn "Warning about something"
print_warn() {
    echo -e "        ${C_YELLOW}!${C_RESET} $1"
}

# Print info message (dimmed)
# Usage: print_info "Additional context"
print_info() {
    echo -e "        ${C_DIM}$1${C_RESET}"
}

# Print a live status line (for filtering long output)
# Usage: print_status "Current action"
print_status() {
    echo -e "        ${C_DIM}$1${C_RESET}"
}

# Filter pip output to show semantic progress
# Usage: pip install ... 2>&1 | filter_pip_output
filter_pip_output() {
    local last_package=""
    local package_count=0
    local cloning_repo=""
    
    while IFS= read -r line; do
        # Track package downloads/installs
        if [[ "$line" =~ ^Collecting\ ([a-zA-Z0-9_-]+) ]]; then
            package="${BASH_REMATCH[1]}"
            if [[ "$package" != "$last_package" ]]; then
                ((package_count++))
                echo -e "        ${C_DIM}Collecting ${package}...${C_RESET}"
                last_package="$package"
            fi
        # Git clone operations
        elif [[ "$line" =~ Cloning.*github.com/([^/]+/[^[:space:]]+) ]]; then
            repo="${BASH_REMATCH[1]}"
            echo -e "        ${C_DIM}Cloning ${repo}...${C_RESET}"
        # Building wheels
        elif [[ "$line" =~ Building\ wheel\ for\ ([a-zA-Z0-9_-]+) ]]; then
            echo -e "        ${C_DIM}Building ${BASH_REMATCH[1]}...${C_RESET}"
        # Successfully built
        elif [[ "$line" =~ ^Successfully\ built ]]; then
            echo -e "        ${C_GREEN}✓${C_RESET} Built wheels"
        # Final success
        elif [[ "$line" =~ ^Successfully\ installed ]]; then
            # Count installed packages
            local pkg_list="${line#Successfully installed }"
            local num_pkgs=$(echo "$pkg_list" | tr ' ' '\n' | wc -l)
            echo -e "        ${C_GREEN}✓${C_RESET} Installed ${num_pkgs} packages"
        # Errors - always show
        elif [[ "$line" =~ ^ERROR ]] || [[ "$line" =~ ^error: ]]; then
            echo -e "        ${C_RED}✗${C_RESET} $line"
        fi
    done
}

# Print a final summary box
# Usage: print_summary "Title" "line1" "line2" ...
print_summary() {
    local title="$1"
    shift
    echo ""
    echo -e "${C_BOLD}--- $title ---${C_RESET}"
    for line in "$@"; do
        echo -e "  $line"
    done
    echo ""
}

# Run a command with status output
# Usage: run_cmd "Description" command arg1 arg2
# Returns the command's exit code
run_cmd() {
    local desc="$1"
    shift
    if "$@" >/dev/null 2>&1; then
        print_ok "$desc"
        return 0
    else
        print_fail "$desc"
        return 1
    fi
}

# Run a command showing output (for builds where output matters)
# Usage: run_cmd_verbose "Description" command arg1 arg2
run_cmd_verbose() {
    local desc="$1"
    shift
    echo -e "        ${C_DIM}Running: $*${C_RESET}"
    if "$@"; then
        print_ok "$desc"
        return 0
    else
        print_fail "$desc"
        return 1
    fi
}

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
    $DIALOG --backtitle "pyMC Repeater Management" --title "Welcome" --msgbox "\nWelcome to pyMC Repeater Setup\n\nThis installer will configure your Linux system as a LoRa mesh network repeater.\n\nPress OK to continue..." 12 70
    
    # SPI Check - platform-specific
    # On Raspberry Pi, check /boot config. On other systems, just check if SPI modules are loaded.
    CONFIG_FILE=""
    if [ -f "/boot/firmware/config.txt" ]; then
        CONFIG_FILE="/boot/firmware/config.txt"
    elif [ -f "/boot/config.txt" ]; then
        CONFIG_FILE="/boot/config.txt"
    fi
    
    # Check if SPI is available (works on any Linux)
    SPI_AVAILABLE=false
    if [ -d "/sys/class/spi_master" ] && [ "$(ls -A /sys/class/spi_master 2>/dev/null)" ]; then
        SPI_AVAILABLE=true
    elif lsmod 2>/dev/null | grep -q "spi"; then
        SPI_AVAILABLE=true
    fi
    
    if [ "$SPI_AVAILABLE" = false ]; then
        # On Raspberry Pi, offer to enable SPI
        if [ -n "$CONFIG_FILE" ]; then
            if ! grep -q "dtparam=spi=on" "$CONFIG_FILE" 2>/dev/null; then
                if ask_yes_no "SPI Not Enabled" "\nSPI interface is required but not enabled!\n\nWould you like to enable it now?\n(This will require a reboot)"; then
                    echo "dtparam=spi=on" >> "$CONFIG_FILE"
                    show_info "SPI Enabled" "\nSPI has been enabled in $CONFIG_FILE\n\nSystem will reboot now. Please run this script again after reboot."
                    reboot
                else
                    show_error "SPI is required for LoRa radio operation.\n\nPlease enable SPI manually and run this script again."
                    return
                fi
            fi
        else
            # Non-Pi Linux - just warn user
            if ! ask_yes_no "SPI Warning" "\nSPI interface does not appear to be enabled.\n\nLoRa radio operation requires SPI. Please ensure your hardware supports SPI and it is enabled.\n\nContinue anyway?"; then
                return
            fi
        fi
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
    apt-get install -y libffi-dev jq python3-pip python3-rrdtool wget swig build-essential python3-dev curl
    
    # Install mikefarah yq v4 if not already installed
    if ! command -v yq &> /dev/null || [[ "$(yq --version 2>&1)" != *"mikefarah/yq"* ]]; then
        YQ_VERSION="v4.40.5"
        ARCH="$(uname -m)"
        case "$ARCH" in
            x86_64)  YQ_BINARY="yq_linux_amd64" ;;
            aarch64) YQ_BINARY="yq_linux_arm64" ;;
            armv7*)  YQ_BINARY="yq_linux_arm" ;;
            armv6*)  YQ_BINARY="yq_linux_arm" ;;
            i386|i686) YQ_BINARY="yq_linux_386" ;;
            *)       YQ_BINARY="yq_linux_amd64" ;; # fallback
        esac
        wget -qO /usr/local/bin/yq "https://github.com/mikefarah/yq/releases/download/${YQ_VERSION}/${YQ_BINARY}" && chmod +x /usr/local/bin/yq
    fi
    
    echo "20"; echo "# Installing backend files..."
    cp -r repeater "$INSTALL_DIR/"
    cp pyproject.toml "$INSTALL_DIR/"
    cp README.md "$INSTALL_DIR/"
    cp setup-radio-config.sh "$INSTALL_DIR/" 2>/dev/null || true
    cp radio-settings.json "$INSTALL_DIR/" 2>/dev/null || true
    cp radio-presets.json "$INSTALL_DIR/" 2>/dev/null || true
    
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
    print_header "Python Dependencies"
    print_step 1 3 "Installing pymc_repeater package"
    print_info "This includes pymc_core from GitHub - may take a few minutes"
    echo ""
    
    cd "$SCRIPT_DIR"
    
    # Ensure Python pip is available
    PIP_CMD=$(command -v pip3 || command -v pip || echo "")
    if [ -z "$PIP_CMD" ]; then
        print_info "Installing python3-pip..."
        apt-get install -y python3-pip
        PIP_CMD=$(command -v pip3 || command -v pip)
    fi

    # Run pip with filtered output for cleaner display
    if $PIP_CMD install --break-system-packages --force-reinstall --no-cache-dir --ignore-installed . 2>&1 | filter_pip_output; then
        # Check actual exit status via pipefail or re-verify
        if python -c "import repeater" 2>/dev/null; then
            print_ok "Python packages installed"
            print_step 2 3 "Starting backend service"
            if systemctl start "$SERVICE_NAME"; then
                print_ok "Backend service started"
            else
                print_fail "Backend service failed to start"
            fi
        else
            print_fail "Python package installation failed"
            print_info "Re-running without Debian-specific flag..."
            $PIP_CMD install --force-reinstall --no-cache-dir --ignore-installed .
            read -p "Press Enter to continue..." || true
        fi
    else
        print_fail "Python package installation failed"
        print_info "Check the error messages above and try again"
        read -p "Press Enter to continue..." || true
    fi
    
    # Radio configuration
    print_step 3 3 "Radio configuration"
    RADIO_SCRIPT="$SCRIPT_DIR/setup-radio-config.sh"
    
    if [ -f "$RADIO_SCRIPT" ]; then
        clear
        print_header "Radio Configuration"
        
        if bash "$RADIO_SCRIPT" "$CONFIG_DIR"; then
            echo ""
            print_ok "Radio configured"
            print_info "Restarting backend with new settings..."
            systemctl restart "$SERVICE_NAME" 2>/dev/null || true
            sleep 2
        else
            print_warn "Radio configuration skipped or failed"
            print_info "You can configure radio later from the main menu"
        fi
    else
        print_warn "Radio config script not found"
        print_info "Configure radio settings manually in $CONFIG_DIR/config.yaml"
    fi
    
    # === FRONTEND INSTALLATION ===
    print_header "Frontend Installation"
    
    # Install Node.js if not present
    print_step 1 6 "Checking Node.js"
    if ! command -v node &> /dev/null; then
        ARCH="$(uname -m)"
        NODE_LINE="20"  # Default to Node 20 LTS
        case "$ARCH" in
            armv7*|armv6*) NODE_LINE="18" ;;  # Better compatibility on 32-bit ARM
        esac
        print_info "Node.js not found - installing v${NODE_LINE} LTS..."
        curl -fsSL "https://deb.nodesource.com/setup_${NODE_LINE}.x" | bash -
        apt-get install -y nodejs
        print_ok "Node.js $(node --version) installed"
    else
        print_ok "Node.js $(node --version) available"
    fi
    
    # Find npm and node paths
    NPM_PATH=$(command -v npm || echo "/usr/bin/npm")
    NODE_PATH=$(command -v node || echo "/usr/bin/node")
    print_info "npm: $NPM_PATH"
    print_info "node: $NODE_PATH"
    
    # Copy frontend files
    print_step 2 6 "Copying frontend files"
    if [ -d "$SCRIPT_DIR/frontend" ]; then
        cp -r "$SCRIPT_DIR/frontend/"* "$FRONTEND_DIR/"
        print_ok "Frontend files copied"
        
        # Create environment config
        # Determine IP address portably
        local ip_address="$(hostname -I 2>/dev/null | awk '{print $1}')"
        if [ -z "$ip_address" ]; then
            ip_address=$(ip -o -4 addr show scope global 2>/dev/null | awk '{split($4,a,"/"); print a[1]; exit}')
        fi
        if [ -z "$ip_address" ]; then ip_address="127.0.0.1"; fi
        cat > "$FRONTEND_DIR/.env.local" << EOF
# pyMC Repeater Frontend Configuration
NEXT_PUBLIC_API_URL=http://${ip_address}:8000
EOF
        print_info "API endpoint: http://${ip_address}:8000"
        
        # Enable CORS in backend config for frontend access
        print_step 3 6 "Configuring CORS"
        if [ -f "$CONFIG_DIR/config.yaml" ]; then
            if command -v yq &> /dev/null; then
                yq -i '.web.cors_enabled = true' "$CONFIG_DIR/config.yaml"
                print_ok "CORS enabled in backend"
            else
                if ! grep -q "cors_enabled" "$CONFIG_DIR/config.yaml"; then
                    echo -e "\nweb:\n  cors_enabled: true" >> "$CONFIG_DIR/config.yaml"
                    print_ok "CORS config added"
                else
                    sed -i 's/cors_enabled:.*/cors_enabled: true/' "$CONFIG_DIR/config.yaml"
                    print_ok "CORS enabled"
                fi
            fi
            systemctl restart "$SERVICE_NAME" 2>/dev/null || true
        fi
        
        # Install npm dependencies
        print_step 4 6 "Installing npm dependencies"
        print_info "This may take a few minutes..."
        cd "$FRONTEND_DIR"
        $NPM_PATH install --legacy-peer-deps
        print_ok "npm dependencies installed"
        
        # Clean any previous build cache
        rm -rf "$FRONTEND_DIR/.next" 2>/dev/null || true
        
        # Build production bundle
        print_step 5 6 "Building production bundle"
        print_info "Compiling Next.js standalone build..."
        if ! NEXT_PUBLIC_API_URL="http://${ip_address}:8000" $NPM_PATH run build; then
            print_fail "Frontend build failed"
            exit 1
        fi
        print_ok "Production build complete"
        
        # Copy static assets
        if [ ! -d "$FRONTEND_DIR/.next/standalone/.next/static" ]; then
            print_info "Copying static assets..."
            mkdir -p "$FRONTEND_DIR/.next/standalone/.next"
            cp -r "$FRONTEND_DIR/.next/static" "$FRONTEND_DIR/.next/standalone/.next/" 2>/dev/null || true
        fi
        if [ ! -d "$FRONTEND_DIR/.next/standalone/public" ]; then
            print_info "Copying public assets..."
            cp -r "$FRONTEND_DIR/public" "$FRONTEND_DIR/.next/standalone/" 2>/dev/null || true
        fi
        
        # Create frontend systemd service
        print_step 6 6 "Creating systemd service"
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
            print_ok "Frontend service started"
        else
            print_fail "Frontend service failed to start"
            print_info "Check logs: journalctl -u $FRONTEND_SERVICE -f"
        fi
    else
        print_warn "Frontend directory not found"
        print_info "Skipping frontend installation"
    fi
    
    # Show final results
    sleep 2
    local ip_address="$(hostname -I 2>/dev/null | awk '{print $1}')"
    if [ -z "$ip_address" ]; then
        ip_address=$(ip -o -4 addr show scope global 2>/dev/null | awk '{split($4,a,"/"); print a[1]; exit}')
    fi
    if [ -z "$ip_address" ]; then ip_address="127.0.0.1"; fi
    
    print_header "Installation Complete"
    
    echo -e "  ${C_BOLD}Service Status${C_RESET}"
    if is_running; then
        echo -e "    ${C_GREEN}*${C_RESET} Backend:  Running (port 8000)"
    else
        echo -e "    ${C_RED}*${C_RESET} Backend:  Not running"
    fi
    if frontend_running; then
        echo -e "    ${C_GREEN}*${C_RESET} Frontend: Running (port 3000)"
    else
        echo -e "    ${C_RED}*${C_RESET} Frontend: Not running"
    fi
    
    echo ""
    echo -e "  ${C_BOLD}Access URLs${C_RESET}"
    echo -e "    Dashboard: ${C_CYAN}http://$ip_address:3000${C_RESET}"
    echo -e "    API:       ${C_CYAN}http://$ip_address:8000${C_RESET}"
    echo ""
    echo -e "  ${C_DIM}Tip: Select 'logs' from main menu to view service output${C_RESET}"
    echo ""
    
    read -p "Press Enter to continue..." || true
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
        
        clear
        print_header "Upgrade: Backend"
        
        print_step 1 7 "Stopping services"
        systemctl stop "$SERVICE_NAME" 2>/dev/null || true
        systemctl stop "$FRONTEND_SERVICE" 2>/dev/null || true
        print_ok "Services stopped"
        
        print_step 2 7 "Backing up configuration"
        if [ -d "$CONFIG_DIR" ]; then
            local backup_name="$CONFIG_DIR.backup.$(date +%Y%m%d_%H%M%S)"
            cp -r "$CONFIG_DIR" "$backup_name" 2>/dev/null || true
            print_ok "Config backed up"
            print_info "Backup: $backup_name"
        fi
        
        print_step 3 7 "Updating system dependencies"
        print_info "Running apt-get update..."
        apt-get update -qq
        apt-get install -y libffi-dev jq python3-pip python3-rrdtool wget swig build-essential python3-dev >/dev/null 2>&1
        
        # Install mikefarah yq v4 if not already installed
        if ! command -v yq &> /dev/null || [[ "$(yq --version 2>&1)" != *"mikefarah/yq"* ]]; then
            print_info "Installing yq..."
            YQ_VERSION="v4.40.5"
            ARCH="$(uname -m)"
            case "$ARCH" in
                x86_64)  YQ_BINARY="yq_linux_amd64" ;;
                aarch64) YQ_BINARY="yq_linux_arm64" ;;
                armv7*)  YQ_BINARY="yq_linux_arm" ;;
                armv6*)  YQ_BINARY="yq_linux_arm" ;;
                i386|i686) YQ_BINARY="yq_linux_386" ;;
                *)       YQ_BINARY="yq_linux_amd64" ;; # fallback
            esac
            wget -qO /usr/local/bin/yq "https://github.com/mikefarah/yq/releases/download/${YQ_VERSION}/${YQ_BINARY}" && chmod +x /usr/local/bin/yq
        fi
        print_ok "System dependencies updated"
        
        print_step 4 7 "Copying new files"
        cp -r repeater "$INSTALL_DIR/" 2>/dev/null || true
        cp pyproject.toml "$INSTALL_DIR/" 2>/dev/null || true
        cp README.md "$INSTALL_DIR/" 2>/dev/null || true
        cp radio-presets.json "$INSTALL_DIR/" 2>/dev/null || true
        cp pymc-repeater.service /etc/systemd/system/ 2>/dev/null || true
        print_ok "Backend files updated"
        
        print_step 5 7 "Validating configuration"
        if validate_and_update_config; then
            print_ok "Config validated and merged"
        else
            print_warn "Config validation failed - keeping existing"
        fi
        
        print_step 6 7 "Setting permissions"
        chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR" "$CONFIG_DIR" "$LOG_DIR" /var/lib/pymc_repeater 2>/dev/null || true
        chmod 750 "$CONFIG_DIR" "$LOG_DIR" 2>/dev/null || true
        chmod 755 /var/lib/pymc_repeater 2>/dev/null || true
        mkdir -p /var/lib/pymc_repeater/.config/pymc_repeater 2>/dev/null || true
        chown -R "$SERVICE_USER:$SERVICE_USER" /var/lib/pymc_repeater/.config 2>/dev/null || true
        print_ok "Permissions set"
        
        print_step 7 7 "Reloading systemd"
        systemctl daemon-reload
        print_ok "Systemd reloaded"
        
        print_header "Upgrade: Python Dependencies"
        print_step 1 2 "Installing Python packages"
        print_info "This includes pymc_core from GitHub - may take a few minutes"
        echo ""
        
        cd "$SCRIPT_DIR"
        
        # Run pip with filtered output for cleaner display
        if pip install --break-system-packages --force-reinstall --no-cache-dir --ignore-installed . 2>&1 | filter_pip_output; then
            # Verify install succeeded
            if python -c "import repeater" 2>/dev/null; then
                print_ok "Python packages updated"
            else
                print_warn "Python package update may have issues"
            fi
        else
            print_warn "Python package update had issues - continuing anyway"
        fi
        
        print_step 2 2 "Starting backend service"
        systemctl start "$SERVICE_NAME"
        print_ok "Backend service started"
        
        # Rebuild frontend if it exists
        if [ -d "$FRONTEND_DIR" ] && [ -f "$FRONTEND_DIR/package.json" ]; then
            print_header "Upgrade: Frontend"
            
            print_step 1 4 "Updating frontend files"
            cp -r "$SCRIPT_DIR/frontend/"* "$FRONTEND_DIR/" 2>/dev/null || true
            print_ok "Frontend files updated"
            
            print_step 2 4 "Rebuilding frontend"
            cd "$FRONTEND_DIR"
            
            NPM_PATH=$(command -v npm || echo "/usr/bin/npm")
            NODE_PATH=$(command -v node || echo "/usr/bin/node")
            print_info "npm: $NPM_PATH"
            print_info "node: $NODE_PATH"
            
            # Clean previous build
            rm -rf "$FRONTEND_DIR/.next" 2>/dev/null || true
            
        # Get API URL from existing env file or use default
            local ip_address="$(hostname -I 2>/dev/null | awk '{print $1}')"
            if [ -z "$ip_address" ]; then
                ip_address=$(ip -o -4 addr show scope global 2>/dev/null | awk '{split($4,a,"/"); print a[1]; exit}')
            fi
            if [ -z "$ip_address" ]; then ip_address="127.0.0.1"; fi
            local api_url="http://${ip_address}:8000"
            if [ -f "$FRONTEND_DIR/.env.local" ]; then
                local existing_url=$(grep NEXT_PUBLIC_API_URL "$FRONTEND_DIR/.env.local" | cut -d'=' -f2)
                if [ -n "$existing_url" ]; then
                    api_url="$existing_url"
                fi
            fi
            
            print_info "Building with API URL: $api_url"
            if ! NEXT_PUBLIC_API_URL="$api_url" $NPM_PATH run build; then
                print_fail "Frontend build failed"
                exit 1
            fi
            print_ok "Production build complete"
            
            # Copy static assets
            if [ ! -d "$FRONTEND_DIR/.next/standalone/.next/static" ]; then
                print_info "Copying static assets..."
                mkdir -p "$FRONTEND_DIR/.next/standalone/.next"
                cp -r "$FRONTEND_DIR/.next/static" "$FRONTEND_DIR/.next/standalone/.next/" 2>/dev/null || true
            fi
            if [ ! -d "$FRONTEND_DIR/.next/standalone/public" ]; then
                print_info "Copying public assets..."
                cp -r "$FRONTEND_DIR/public" "$FRONTEND_DIR/.next/standalone/" 2>/dev/null || true
            fi
            
            print_step 3 4 "Updating systemd service"
            chown -R "$SERVICE_USER:$SERVICE_USER" "$FRONTEND_DIR"
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
EnvironmentFile=-${FRONTEND_DIR}/.env.local

[Install]
WantedBy=multi-user.target
EOF
            systemctl daemon-reload
            systemctl enable "$FRONTEND_SERVICE" 2>/dev/null || true
            print_ok "Service file updated"
            
            print_step 4 4 "Starting frontend service"
            systemctl start "$FRONTEND_SERVICE"
            sleep 2
            if systemctl is-active "$FRONTEND_SERVICE" > /dev/null 2>&1; then
                print_ok "Frontend service started"
            else
                print_fail "Frontend service failed to start"
                print_info "Check logs: journalctl -u $FRONTEND_SERVICE -f"
                exit 1
            fi
        else
            print_info "Frontend not installed - skipping frontend update"
        fi
        
        # Final verification
        sleep 2
        local new_version=$(get_version)
        local ip_address=$(hostname -I | awk '{print $1}')
        
        print_header "Upgrade Complete"
        
        echo -e "  ${C_BOLD}Version${C_RESET}"
        echo -e "    $current_version -> $new_version"
        echo ""
        echo -e "  ${C_BOLD}Service Status${C_RESET}"
        if is_running; then
            echo -e "    ${C_GREEN}*${C_RESET} Backend:  Running (port 8000)"
        else
            echo -e "    ${C_RED}*${C_RESET} Backend:  Not running"
        fi
        if frontend_running; then
            echo -e "    ${C_GREEN}*${C_RESET} Frontend: Running (port 3000)"
        else
            echo -e "    ${C_RED}*${C_RESET} Frontend: Not running"
        fi
        
        echo ""
        echo -e "  ${C_BOLD}Access URLs${C_RESET}"
        echo -e "    Dashboard: ${C_CYAN}http://$ip_address:3000${C_RESET}"
        echo -e "    API:       ${C_CYAN}http://$ip_address:8000${C_RESET}"
        echo ""
        echo -e "  ${C_DIM}Configuration has been preserved${C_RESET}"
        echo ""
        
        read -p "Press Enter to continue..." || true
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
        ARCH="$(uname -m)"
        NODE_LINE="20"
        case "$ARCH" in
            armv7*|armv6*) NODE_LINE="18" ;;
        esac
        if ask_yes_no "Node.js Required" "\nNode.js is not installed.\n\nWould you like to install Node.js ${NODE_LINE} LTS now?"; then
            clear
            echo "=== Installing Node.js ${NODE_LINE} LTS ==="
            curl -fsSL "https://deb.nodesource.com/setup_${NODE_LINE}.x" | bash -
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
        print_header "Frontend Installation"
        
        # Find npm and node paths
        NPM_PATH=$(command -v npm || echo "/usr/bin/npm")
        NODE_PATH=$(command -v node || echo "/usr/bin/node")
        if [ ! -x "$NODE_PATH" ]; then
            print_warn "node not found at $NODE_PATH; attempting to use /usr/local/bin/node"
            NODE_PATH="/usr/local/bin/node"
        fi
        print_info "npm: $NPM_PATH"
        print_info "node: $NODE_PATH"
        
        print_step 1 7 "Creating frontend directory"
        mkdir -p "$FRONTEND_DIR"
        print_ok "Directory created"
        
        print_step 2 7 "Copying frontend files"
        cp -r "$SCRIPT_DIR/frontend/"* "$FRONTEND_DIR/"
        print_ok "Files copied"
        
        print_step 3 7 "Installing npm dependencies"
        print_info "This may take a few minutes..."
        cd "$FRONTEND_DIR"
        $NPM_PATH install --legacy-peer-deps
        print_ok "Dependencies installed"
        
        print_step 4 7 "Creating environment config"
        local ip_address=$(hostname -I | awk '{print $1}')
        cat > "$FRONTEND_DIR/.env.local" << EOF
# pyMC Repeater Frontend Configuration
# API URL - points to backend on port 8000
NEXT_PUBLIC_API_URL=http://${ip_address}:8000
EOF
        print_ok "Config created"
        print_info "API endpoint: http://${ip_address}:8000"
        
        print_step 5 7 "Building production bundle"
        print_info "Compiling Next.js standalone build..."
        $NPM_PATH run build
        print_ok "Build complete"
        
        print_step 6 7 "Copying assets into standalone bundle"
        mkdir -p "$FRONTEND_DIR/.next/standalone/.next"
        cp -r "$FRONTEND_DIR/.next/static" "$FRONTEND_DIR/.next/standalone/.next/" 2>/dev/null || true
        cp -r "$FRONTEND_DIR/public" "$FRONTEND_DIR/.next/standalone/" 2>/dev/null || true
        print_ok "Assets copied"
        
        print_step 7 7 "Creating systemd service"
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
        
        print_ok "Service file created"
        
        chown -R "$SERVICE_USER:$SERVICE_USER" "$FRONTEND_DIR"
        systemctl daemon-reload
        systemctl enable "$FRONTEND_SERVICE"
        systemctl start "$FRONTEND_SERVICE"
        
        sleep 3
        
        print_header "Frontend Installation Complete"
        
        echo -e "  ${C_BOLD}Service Status${C_RESET}"
        if frontend_running; then
            echo -e "    ${C_GREEN}*${C_RESET} Frontend: Running (port 3000)"
        else
            echo -e "    ${C_RED}*${C_RESET} Frontend: Not running"
            print_info "Check logs: journalctl -u $FRONTEND_SERVICE -f"
        fi
        
        echo ""
        echo -e "  ${C_BOLD}Access URLs${C_RESET}"
        echo -e "    Dashboard: ${C_CYAN}http://$ip_address:3000${C_RESET}"
        echo -e "    API:       ${C_CYAN}http://$ip_address:8000${C_RESET}"
        echo ""
        
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
    local ip_address="$(hostname -I 2>/dev/null | awk '{print $1}')"
    if [ -z "$ip_address" ]; then
        ip_address=$(ip -o -4 addr show scope global 2>/dev/null | awk '{split($4,a,"/"); print a[1]; exit}')
    fi
    if [ -z "$ip_address" ]; then ip_address="127.0.0.1"; fi
    
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
        # Check SPI availability (works on any Linux)
        if [ -d "/sys/class/spi_master" ] && [ "$(ls -A /sys/class/spi_master 2>/dev/null)" ]; then
            status_info="${status_info}Enabled ✓\n"
        elif lsmod 2>/dev/null | grep -q "spi"; then
            status_info="${status_info}Enabled ✓\n"
        else
            status_info="${status_info}Not detected ✗\n"
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
