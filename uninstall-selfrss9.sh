#!/bin/bash
# selfrss アンインストーラ
# 使い方: sudo bash uninstall-selfrss9.sh [インストール先]
# デフォルト: /opt/selfrss
set -e
INSTALL_DIR="${1:-/opt/selfrss}"
SERVICE_NAME="selfrss"

if [ "$EUID" -ne 0 ]; then echo "エラー: sudo で実行してください"; exit 1; fi

echo "=== selfrss アンインストーラ ==="
echo "インストール先: $INSTALL_DIR"
echo ""

if systemctl list-unit-files | grep -q "^${SERVICE_NAME}.service"; then
  echo "--- サービスを停止・無効化中 ---"
  systemctl stop "$SERVICE_NAME" 2>/dev/null || true
  systemctl disable "$SERVICE_NAME" 2>/dev/null || true
  rm -f "/etc/systemd/system/${SERVICE_NAME}.service"
  systemctl daemon-reload
  echo "サービスを削除しました"
else
  echo "サービスは見つかりませんでした（スキップ）"
fi

if [ -d "$INSTALL_DIR" ]; then
  read -p "データベースを含む ${INSTALL_DIR} を削除しますか？ [データのバックアップを残す場合は n] (y/N): " confirm
  if [[ "$confirm" =~ ^[Yy]$ ]]; then
    rm -rf "$INSTALL_DIR"
    echo "${INSTALL_DIR} を削除しました"
  else
    read -p "データ(${INSTALL_DIR}/data)だけ残してアプリ本体だけ削除しますか？ (y/N): " confirm2
    if [[ "$confirm2" =~ ^[Yy]$ ]]; then
      BACKUP_DIR="${INSTALL_DIR}-data-backup-$(date +%Y%m%d%H%M%S)"
      mv "${INSTALL_DIR}/data" "$BACKUP_DIR"
      rm -rf "$INSTALL_DIR"
      echo "データを ${BACKUP_DIR} に退避し、アプリ本体を削除しました"
    else
      echo "${INSTALL_DIR} は削除されませんでした"
    fi
  fi
else
  echo "${INSTALL_DIR} は見つかりませんでした（スキップ）"
fi

echo ""
echo "=== アンインストール処理が完了しました ==="
