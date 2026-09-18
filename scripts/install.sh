#!/usr/bin/env bash
# Cài đặt / gỡ cài đặt RouteX như một systemd service.
#
#   Cài từ xa:  curl -fsSL https://raw.githubusercontent.com/techshield-tech/RouteX/main/scripts/install.sh | sudo bash
#   Gỡ cài đặt: sudo ./install.sh --uninstall
set -euo pipefail

REPO="${ROUTEX_REPO:-techshield-tech/RouteX}"
INSTALL_DIR="/opt/routex"
DATA_DIR="/var/lib/routex"
ENV_DIR="/etc/routex"
ENV_FILE="${ENV_DIR}/routex.env"
UNIT_FILE="/etc/systemd/system/routex.service"
SERVICE_USER="routex"
PORT="${ROUTEX_PORT:-8090}"

log()  { echo "[routex] $*"; }
err()  { echo "[routex] Lỗi: $*" >&2; }

require_root() {
  if [ "${EUID:-$(id -u)}" -ne 0 ]; then
    err "cần quyền root. Vui lòng chạy lại với sudo, ví dụ: sudo bash $0"
    exit 1
  fi
}

has_systemd() {
  command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]
}

detect_arch() {
  local m
  m="$(uname -m)"
  case "$m" in
    x86_64) echo "x86_64" ;;
    aarch64|arm64) echo "aarch64" ;;
    *)
      err "kiến trúc CPU '$m' không được hỗ trợ (chỉ hỗ trợ x86_64 và aarch64)."
      exit 1
      ;;
  esac
}

# ---------------------------------------------------------------------------
# Gỡ cài đặt
# ---------------------------------------------------------------------------
uninstall() {
  log "Đang gỡ cài đặt RouteX..."

  if has_systemd; then
    systemctl stop routex 2>/dev/null || true
    systemctl disable routex 2>/dev/null || true
  fi
  rm -f "$UNIT_FILE"
  if has_systemd; then
    systemctl daemon-reload || true
  fi

  rm -rf "$INSTALL_DIR"

  log "Đã gỡ cài đặt xong."
  log "Thư mục dữ liệu ${DATA_DIR} được GIỮ NGUYÊN, không bị xoá."
  exit 0
}

if [ "${1:-}" = "--uninstall" ]; then
  require_root
  uninstall
fi

require_root

# ---------------------------------------------------------------------------
# Xác định nguồn cài đặt: local (đã giải nén sẵn) hay tải từ GitHub Releases
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TMP_DIR=""

cleanup() {
  if [ -n "$TMP_DIR" ] && [ -d "$TMP_DIR" ]; then
    rm -rf "$TMP_DIR"
  fi
}
trap cleanup EXIT

if [ -x "${SCRIPT_DIR}/bin/routex" ]; then
  log "Phát hiện bản đã giải nén sẵn tại ${SCRIPT_DIR}, cài trực tiếp từ đó."
  SRC_DIR="$SCRIPT_DIR"
else
  ARCH="$(detect_arch)"

  if [ -n "${ROUTEX_VERSION:-}" ]; then
    TAG="$ROUTEX_VERSION"
  else
    log "Đang tìm bản phát hành mới nhất của ${REPO}..."
    API_URL="https://api.github.com/repos/${REPO}/releases/latest"
    RELEASE_JSON="$(curl -fsSL "$API_URL")" || {
      err "không lấy được thông tin bản phát hành mới nhất từ GitHub."
      exit 1
    }
    TAG="$(echo "$RELEASE_JSON" | grep '"tag_name"' | head -n1 | sed -E 's/.*"tag_name": *"([^"]+)".*/\1/')"
    if [ -z "$TAG" ]; then
      err "không đọc được tag_name từ phản hồi của GitHub API."
      exit 1
    fi
  fi

  # Tên file build luôn dùng version KHÔNG có tiền tố "v" (khớp với job build.yml).
  VERSION="${TAG#v}"
  ASSET="routex-${VERSION}-linux-${ARCH}.tar.gz"
  BASE_URL="https://github.com/${REPO}/releases/download/${TAG}"

  TMP_DIR="$(mktemp -d)"
  log "Đang tải ${ASSET} (${TAG})..."
  curl -fsSL -o "${TMP_DIR}/${ASSET}" "${BASE_URL}/${ASSET}" || {
    err "không tải được ${ASSET} từ ${BASE_URL}."
    exit 1
  }
  curl -fsSL -o "${TMP_DIR}/${ASSET}.sha256" "${BASE_URL}/${ASSET}.sha256" || {
    err "không tải được file checksum ${ASSET}.sha256."
    exit 1
  }

  log "Đang kiểm tra checksum..."
  (cd "$TMP_DIR" && sha256sum -c "${ASSET}.sha256") || {
    err "checksum không khớp, file tải về có thể bị hỏng hoặc bị can thiệp."
    exit 1
  }

  log "Đang giải nén..."
  tar xzf "${TMP_DIR}/${ASSET}" -C "$TMP_DIR"
  SRC_DIR="$(find "$TMP_DIR" -maxdepth 1 -mindepth 1 -type d | head -n1)"
  if [ -z "$SRC_DIR" ] || [ ! -x "${SRC_DIR}/bin/routex" ]; then
    err "gói tải về không đúng định dạng (thiếu bin/routex)."
    exit 1
  fi
fi

# ---------------------------------------------------------------------------
# Tạo user hệ thống
# ---------------------------------------------------------------------------
if ! id -u "$SERVICE_USER" >/dev/null 2>&1; then
  log "Đang tạo user hệ thống '${SERVICE_USER}'..."
  useradd --system --no-create-home --shell /usr/sbin/nologin "$SERVICE_USER"
fi

# ---------------------------------------------------------------------------
# Dừng service trước khi ghi đè file (tránh lỗi "text file busy")
# ---------------------------------------------------------------------------
if has_systemd; then
  systemctl stop routex 2>/dev/null || true
fi

# ---------------------------------------------------------------------------
# Cài đặt file chương trình
# ---------------------------------------------------------------------------
log "Đang cài đặt vào ${INSTALL_DIR}..."
mkdir -p "$INSTALL_DIR"
rm -rf "${INSTALL_DIR}/bin" "${INSTALL_DIR}/ui"
mkdir -p "${INSTALL_DIR}/bin"
cp "${SRC_DIR}/bin/routex" "${INSTALL_DIR}/bin/routex"
chmod 755 "${INSTALL_DIR}/bin/routex"
if [ -d "${SRC_DIR}/ui" ]; then
  cp -r "${SRC_DIR}/ui" "${INSTALL_DIR}/ui"
fi
if [ -f "${SRC_DIR}/LICENSE" ]; then
  cp "${SRC_DIR}/LICENSE" "${INSTALL_DIR}/LICENSE"
fi

# ---------------------------------------------------------------------------
# Thư mục dữ liệu — không bao giờ xoá khi cài lại
# ---------------------------------------------------------------------------
mkdir -p "$DATA_DIR"
chown -R "${SERVICE_USER}:${SERVICE_USER}" "$DATA_DIR"

# ---------------------------------------------------------------------------
# File môi trường — chỉ tạo nếu chưa có, không ghi đè cấu hình cũ
# ---------------------------------------------------------------------------
mkdir -p "$ENV_DIR"
if [ ! -f "$ENV_FILE" ]; then
  log "Đang tạo file cấu hình ${ENV_FILE}..."
  cat > "$ENV_FILE" <<EOF
ROUTEX_API_ADDR=0.0.0.0:${PORT}
ROUTEX_DB=${DATA_DIR}/routex.db
ROUTEX_UI_DIR=${INSTALL_DIR}/ui
RUST_LOG=info
EOF
else
  log "File cấu hình ${ENV_FILE} đã tồn tại, giữ nguyên."
fi

# ---------------------------------------------------------------------------
# systemd unit
# ---------------------------------------------------------------------------
log "Đang ghi systemd unit ${UNIT_FILE}..."
cat > "$UNIT_FILE" <<'EOF'
[Unit]
Description=RouteX gateway
After=network.target

[Service]
Type=simple
User=routex
EnvironmentFile=/etc/routex/routex.env
ExecStart=/opt/routex/bin/routex
WorkingDirectory=/var/lib/routex
Restart=on-failure
AmbientCapabilities=CAP_NET_BIND_SERVICE
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/var/lib/routex
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

# ---------------------------------------------------------------------------
# Khởi động service
# ---------------------------------------------------------------------------
if has_systemd; then
  log "Đang khởi động service..."
  systemctl daemon-reload
  systemctl enable routex
  systemctl restart routex
else
  log "Không tìm thấy systemd, bỏ qua bước quản lý service."
  log "Chạy thủ công bằng lệnh:"
  log "  sudo -u ${SERVICE_USER} bash -c 'set -a; source ${ENV_FILE}; set +a; exec ${INSTALL_DIR}/bin/routex'"
fi

HOST_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
if [ -z "$HOST_IP" ]; then
  HOST_IP="127.0.0.1"
fi

log "Cài đặt hoàn tất."
log "Truy cập RouteX tại: http://${HOST_IP}:${PORT}"
