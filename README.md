# 時計読み取りシステム — PWAデプロイ手順

## 必要なもの
- GitHubアカウント（無料）: https://github.com
- Vercelアカウント（無料）: https://vercel.com
- Anthropic APIキー: https://console.anthropic.com

---

## 手順

### 1. Node.jsをインストール
https://nodejs.org から LTS版をダウンロードしてインストール

### 2. このフォルダをGitHubにアップロード

```bash
# ターミナル（Macはターミナル、WindowsはCommand Prompt）で
cd clock-reader-pwa
npm install
git init
git add .
git commit -m "initial commit"
```

GitHubで新しいリポジトリを作成（New repository）して、
表示されるコマンドを実行：
```bash
git remote add origin https://github.com/あなたのユーザー名/clock-reader.git
git push -u origin main
```

### 3. Vercelにデプロイ

1. https://vercel.com にアクセスしてGitHubでログイン
2. 「Add New Project」をクリック
3. 作成したGitHubリポジトリを選択
4. 「Environment Variables」に以下を追加：
   - Name: `ANTHROPIC_API_KEY`
   - Value: `sk-ant-api...`（あなたのAPIキー）
5. 「Deploy」をクリック

デプロイ完了後、`https://あなたのプロジェクト名.vercel.app` でアクセスできます。

### 4. スマホにインストール（PWA）

**iPhoneの場合：**
1. Safariでデプロイしたページを開く
2. 下部の共有ボタン（□↑）をタップ
3. 「ホーム画面に追加」をタップ
4. 「追加」をタップ

**Androidの場合：**
1. Chromeでページを開く
2. 「ホーム画面に追加」のバナーが表示されたらタップ
3. または：メニュー（⋮）→「アプリをインストール」

---

## ローカルで動かす（テスト用）

```bash
# .env.local ファイルを作成
echo "ANTHROPIC_API_KEY=sk-ant-api..." > .env.local

# 開発サーバー起動
npm run dev
```

ブラウザで http://localhost:5173 を開く

---

## ファイル構成

```
clock-reader-pwa/
├── src/App.jsx        ← メインのUIコード
├── api/analyze.js     ← APIキーを隠すサーバー関数
├── vite.config.js     ← PWA設定
├── vercel.json        ← Vercelデプロイ設定
└── index.html         ← エントリポイント
```
"# clock-reader" 
