# selfrss

セルフホスト型 RSS リーダー。3ペインUI（フィード / 記事一覧 / 記事本文）で、ダークテーマ対応・OPML インポート/エクスポート・全文取得などの機能を備えています。

- サーバー: Node.js + Fastify + better-sqlite3
- 自動更新: 30分ごとに全フィードを取得（node-cron）

<img width="1024" height="558" alt="Image" src="https://github.com/user-attachments/assets/65455046-c7d6-4bbb-93f5-da13eef3fa50" />

## 主な機能

### 記事を読む

- 3ペインUI（フィード / 記事一覧 / 記事本文）
- ダーク / ライトテーマ切替（設定はブラウザに保存）
- 全記事 / 未読 / お気に入りの切り替えと、記事タイトル・概要のキーワード検索
- 既読・未読の切り替え、お気に入り登録、全記事・フィード単位の一括既読
- スクロールでの追加読み込み（インフィニットスクロール）
- スクロールで次の記事へ自動遷移（▼ボタンで ON/OFF 切替）
- 既読記事を非表示（お気に入り記事は常に表示）
- 記事一覧のコンパクト表示、記事一覧の幅調整（70% / 50% / 20%）、サイドバーの開閉・幅切替
- 記事本文に含まれる「関連記事」などのセクションを除去（ボタンで ON/OFF 切替）
- ショートカットキー: `j` / `k`（次の記事 / 前の記事）、`g`（次の記事）、`f`（次の未読記事）、`d`（前の記事）、`r`（全フィード更新）、`/`（検索）

### フィードを管理する

- フィードの追加・削除・手動更新（個別 / 一括）
- Web サイトの URL から RSS / Atom フィードを自動検出
- カテゴリー（フォルダー）による整理・名前変更・削除
- フィード / カテゴリーの右クリックメニュー（カテゴリー変更、**フィード URL のコピー**、削除など）
- OPML インポート / エクスポート（フォルダー構造を保持）
- お気に入り記事のテキスト形式（`.txt`）インポート / エクスポート

### 記事本文の取得

- フィードの配信本文（`content:encoded` / `content` / `description`）を Markdown に変換して表示
- 配信本文が短い場合は元記事のページを取得し、Readability で全文を抽出
- EUC-JP / Shift_JIS / ISO-2022-JP / UTF-8 の文字コードを自動判別

### 運用

- Web UI から GitHub の最新版へアップデート（依存関係の更新とサービス再起動まで自動）
- Web UI からサービス再起動
- サイドバーに表示されるバージョン番号
- Tailscale が利用可能な場合は Tailscale Serve による HTTPS 公開

## インストール

### 必要条件

- Ubuntu / Debian / Fedora / CentOS / Arch などの Linux（systemd 環境）
- root 権限（sudo）
- Node.js 20+（無い場合はインストーラが自動でインストールします）
- git、make、g++、python3（better-sqlite3 のビルドに必要。無い場合は自動でインストールします）

### インストール手順

リポジトリを取得して、インストーラを実行します。

```bash
# リポジトリを取得
git clone https://github.com/hirogura/selfrss.git
cd selfrss

# インストール実行（デフォルト: /opt/selfrss, ポート 3347）
sudo bash install-selfrss1.sh
```

インストール先やポートを変更する場合:

```bash
sudo bash install-selfrss1.sh /opt/selfrss 8080
```

### インストール後の確認

```bash
# サービスの状態を確認
systemctl status selfrss
```

アクセスURL:

- **Tailscale 環境の場合（推奨）**: インストーラが自動で Tailscale Serve を設定し、HTTPS で公開します。
  ```
  https://<hostname>.<tailnet>.ts.net:3347
  例: https://myserver.tail1234.ts.net:3347
  ```
  アプリ本体は `127.0.0.1` のみで待機し、TLS 終端は tailscaled が行います（immich の tailscale serve 版と同じ構成）。

- **Tailscale 無しの場合**: HTTP で公開されます。
  ```bash
  # http://<サーバーのIP>:3347
  # 例: http://192.168.1.100:3347
  ```

Tailscale で HTTPS 化するには事前に以下が必要です:

1. `tailscale up` 済みであること
2. Tailscale 管理コンソールで **MagicDNS** と **HTTPS Certificates** を有効化済みであること
   （https://login.tailscale.com/admin/dns）

手動で設定する場合:

```bash
sudo tailscale serve --bg --https=3347 http://127.0.0.1:3347
tailscale serve status   # 確認
```

データベースと購読フィードは `/opt/selfrss/data/selfrss.db` に保存されます。
バックアップはこのファイルをコピーするだけで OK です。

## アップデート

### Web UI から（推奨）

記事本文ペインのツールバーにある「アップデート」ボタンを押すと、GitHub から最新版を取得し、`package.json` / `package-lock.json` が変更されている場合は依存関係も更新したうえで、サービスを自動で再起動します。同じツールバーの「再起動」ボタンで、アップデートなしに再起動だけを行うこともできます。

### コマンドから

GitHub から最新版を取得して、サービスを再起動します。

```bash
cd /opt/selfrss && git pull
sudo systemctl restart selfrss
```

## アンインストール

同梱のアンインストーラを使います。

```bash
cd /opt/selfrss
sudo bash uninstall-selfrss9.sh
```

実行すると確認があります。

- `y` を選ぶと、**データベースを含む** `/opt/selfrss` を完全に削除します。
- `n` を選ぶと、データ（`/opt/selfrss/data`）だけを残してアプリ本体だけ削除するか、または何も削除しないかを選択できます。

バックアップを残したい場合は、事前に `data/selfrss.db` をコピーしておくか、アンインストーラの指示に従ってデータを退避してください。

## 開発

```bash
git clone https://github.com/hirogura/selfrss.git
cd selfrss
npm install
npm run dev
```

## ライセンス

このプロジェクトは [MIT License](LICENSE) の下で公開されています。

