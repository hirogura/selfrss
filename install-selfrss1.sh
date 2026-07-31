#!/bin/bash
# selfrss インストーラ v1 (GitHub版) - セルフホスト型 RSS リーダー
# GitHub (https://github.com/hirogura/selfrss) からソースを取得してインストールします
# デフォルト: /opt/selfrss, ポート 3347
# 使い方: sudo bash install-selfrss1.sh [インストール先] [ポート]
# 非公開リポジトリの場合は GITHUB_TOKEN を指定: GITHUB_TOKEN=xxx sudo bash install-selfrss1.sh

set -e
INSTALL_DIR="${1:-/opt/selfrss}"
PORT="${2:-3347}"
SERVICE_NAME="selfrss"
REPO_URL="https://github.com/hirogura/selfrss.git"
BRANCH="main"

if [ -n "$GITHUB_TOKEN" ]; then
  REPO_URL="https://${GITHUB_TOKEN}@github.com/hirogura/selfrss.git"
fi

echo "=== selfrss インストーラ v1 (GitHub版) ==="
echo "インストール先: $INSTALL_DIR"
echo "ポート: $PORT"
echo "ソース: $REPO_URL"
echo ""

if [ "$EUID" -ne 0 ]; then echo "エラー: sudo で実行してください"; exit 1; fi

if ! command -v node &>/dev/null; then
  echo "--- Node.js をインストール中 ---"
  if command -v apt-get &>/dev/null; then
    apt-get update -qq && apt-get install -y -qq curl
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
    apt-get install -y -qq nodejs
  elif command -v dnf &>/dev/null; then dnf install -y nodejs
  elif command -v yum &>/dev/null; then
    curl -fsSL https://rpm.nodesource.com/setup_22.x | bash -
    yum install -y nodejs
  elif command -v pacman &>/dev/null; then pacman -Sy --noconfirm nodejs npm
  else echo "エラー: Node.js 22+ を手動でインストールしてください"; exit 1; fi
fi
NODE_VER=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VER" -lt 20 ]; then echo "エラー: Node.js 20+ が必要です (v$NODE_VER)"; exit 1; fi
echo "Node.js $(node -v) OK"

echo "--- ビルドツールを確認中 (better-sqlite3 のネイティブビルド用) ---"
if ! command -v make &>/dev/null || ! command -v g++ &>/dev/null || ! command -v python3 &>/dev/null; then
  if command -v apt-get &>/dev/null; then
    apt-get update -qq
    apt-get install -y -qq build-essential python3
  elif command -v dnf &>/dev/null; then dnf install -y make gcc-c++ python3
  elif command -v yum &>/dev/null; then yum groupinstall -y "Development Tools"; yum install -y python3
  elif command -v pacman &>/dev/null; then pacman -Sy --noconfirm base-devel python3
  else echo "警告: make/g++/python3 が見つかりません。better-sqlite3 のビルドに失敗する可能性があります"; fi
fi
echo "ビルドツール OK"

echo "--- git を確認中 ---"
if ! command -v git &>/dev/null; then
  if command -v apt-get &>/dev/null; then apt-get update -qq && apt-get install -y -qq git
  elif command -v dnf &>/dev/null; then dnf install -y git
  elif command -v pacman &>/dev/null; then pacman -Sy --noconfirm git
  else echo "エラー: git を手動でインストールしてください"; exit 1; fi
fi
echo "git $(git --version) OK"

if systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
  echo "--- 既存サービスを停止中 ---"
  systemctl stop "$SERVICE_NAME"
fi

echo "--- GitHub からソースを取得中 ---"
if [ -d "$INSTALL_DIR/.git" ]; then
  echo "既存のリポジトリを最新に更新します"
  cd "$INSTALL_DIR"
  git fetch origin "$BRANCH" 2>/dev/null || git fetch origin
  git reset --hard "origin/$BRANCH"
elif [ -n "$(ls -A "$INSTALL_DIR" 2>/dev/null)" ]; then
  echo "既存のインストールをバックアップして移行します"
  BACKUP_DIR="${INSTALL_DIR}.backup-$(date +%Y%m%d-%H%M%S)"
  mv "$INSTALL_DIR" "$BACKUP_DIR"
  git clone --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
  if [ -d "$BACKUP_DIR/data" ] && [ -n "$(ls -A "$BACKUP_DIR/data" 2>/dev/null)" ]; then
    echo "--- 既存のデータ（購読フィード・記事）を復元中 ---"
    mkdir -p "$INSTALL_DIR/data"
    cp -a "$BACKUP_DIR/data/." "$INSTALL_DIR/data/"
  fi
  echo "旧インストールは $BACKUP_DIR に退避しました（不要なら削除してください）"
else
  git clone --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
fi

echo "--- 依存関係をインストール中 ---"
cd "$INSTALL_DIR"
if [ ! -d "node_modules" ] || [ package.json -nt node_modules/.package-lock.json ]; then
  npm install --production 2>&1
fi

echo "--- systemd サービスを作成中 ---"
cat > /etc/systemd/system/$SERVICE_NAME.service << SVCEOF
[Unit]
Description=selfrss - Self-hosted RSS Reader
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=$INSTALL_DIR
ExecStart=/usr/bin/node server/index.js
Restart=on-failure
RestartSec=5
Environment=PORT=$PORT
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
SVCEOF

systemctl daemon-reload
systemctl enable "$SERVICE_NAME"
systemctl start "$SERVICE_NAME"

TS_IP=$(tailscale ip -4 2>/dev/null || echo "N/A")
TS_HOSTNAME=$(tailscale status --json 2>/dev/null | grep -o '"DNSName":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "")
if [ -z "$TS_HOSTNAME" ]; then TS_HOSTNAME=$(hostname); fi

sleep 2
if systemctl is-active --quiet "$SERVICE_NAME"; then
  echo ""
  echo "=== selfrss のインストールが完了しました ==="
  echo ""
  echo "  Web UI : http://${TS_IP}:${PORT}"
  echo "  Web UI : http://${TS_HOSTNAME%%.*}:${PORT}  (MagicDNS)"
  echo ""
  echo "  インストール先: ${INSTALL_DIR}"
  echo ""
  echo "  コマンド:"
  echo "    systemctl status ${SERVICE_NAME}"
  echo "    systemctl restart ${SERVICE_NAME}"
  echo "    journalctl -u ${SERVICE_NAME} -f"
  echo ""
  echo "  アップデート:"
  echo "    cd ${INSTALL_DIR} && git pull"
  echo "    sudo systemctl restart ${SERVICE_NAME}"
  echo ""
  echo "  機能:"
  echo "    - 3ペインUI（フィード / 記事一覧 / 記事本文）"
  echo "    - ダーク/ライトテーマ切替、サイドバー開閉、コンパクト表示"
  echo "    - 記事一覧の幅調整（70%/50%/20%）と既読非表示トグル"
  echo "    - インフィニットスクロール（スクロールで自動読み込み）"
  echo "    - スクロールで次記事自動遷移（▼ボタンでON/OFF切替、状態保存）"
  echo "    - お気に入り記事は既読非表示でも常に表示"
  echo "    - OPML インポート/エクスポート（属性順序に依存しないパーサ）"
  echo "    - 全文取得（EUC-JP/SJIS/UTF-8 自動判別）"
  echo "    - ショートカットキー: j/k/g/f/d/r/"
else
  echo "エラー: サービスの起動に失敗しました"
  systemctl status "$SERVICE_NAME" --no-pager
  exit 1
fi
