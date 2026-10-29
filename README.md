# UA 比價卡組

Union Arena 日文版卡牌的比價與卡組編輯網站，電腦和手機都能用。

- **遊々亭**：每天清晨 5 點左右自動抓價（GitHub Actions）
- **Hobby Station、Dorasuta**：在電腦上按書籤「UA 匯入價格」→「匯入全部系列」，自動讀完所有系列，並同步到手機
- **卡組**：自動算總價、標出每張卡最便宜的店、規則檢查（50 張／同卡號 4 張／同作品）、匯出清單或圖片、多副卡組

---

## 第一次架設（約 10 分鐘）

### 1. 註冊 GitHub
到 https://github.com 註冊免費帳號。

### 2. 建立專案
1. 登入後按右上角 **＋** → **New repository**
2. Repository name 填 `ua-price`
3. 選 **Public**（GitHub Pages 免費版需要公開）
4. 按 **Create repository**

### 3. 上傳檔案
1. 在新專案頁面點 **uploading an existing file**
2. 把解壓縮後 `ua-price` 資料夾**裡面**的所有檔案和資料夾拖進去
   （`index.html`、`app.js`、`style.css`、`importer.js`、`requirements.txt`、`data`、`scraper`、`.github`…）
3. 按 **Commit changes**

> ⚠ `.github` 資料夾開頭有個點，Windows 有時候會隱藏它。如果上傳後沒看到 `.github`，請在檔案總管的「檢視」勾選「隱藏的項目」再拖一次。

### 4. 允許自動更新存檔
**Settings** → 左側 **Actions** → **General** → 最下面 **Workflow permissions** 選 **Read and write permissions** → **Save**

### 5. 開啟網站
**Settings** → 左側 **Pages** → **Branch** 選 `main`、資料夾 `/ (root)` → **Save**
等 1～2 分鐘，頁面上方會出現網址，例如 `https://你的帳號.github.io/ua-price/`

### 6. 執行第一次抓價
**Actions** 分頁 → 左側 **每日更新遊々亭價格** → 右邊 **Run workflow** → **Run workflow**
大約 10 分鐘跑完（每頁之間會停 3 秒，避免造成對方網站負擔）。跑完後重新整理網站就有價格了。之後每天會自動執行。

### 7. 手機加到主畫面
用手機打開網址：
- iPhone（Safari）：分享按鈕 → 加入主畫面
- Android（Chrome）：右上角 ⋮ → 加到主畫面

---

### 8. 設定 Hobby Station、Dorasuta 匯入（在電腦上做一次）
打開網站的「匯入・設定」分頁：
1. **把「UA 匯入價格」按鈕拖到 Chrome 書籤列**
2. **設定「自動同步到手機」**：照頁面上的步驟建立 GitHub 金鑰並貼上，按「儲存並測試」

## 平常怎麼用
- 打開 Hobby Station 或 Dorasuta（任何一頁）→ 按書籤「UA 匯入價格」→「匯入全部系列」
- 每家大約 10～15 分鐘，分頁開著就好；完成後會自動同步，手機 1～2 分鐘後就看得到
- 建議每週各按一次。超過 14 天沒更新的價格會標示「舊」
- 只想更新某個系列：先打開那個系列的商品列表，再按書籤選「只匯入這個系列」

## 常見問題
- **Actions 顯示紅色失敗**：點進去看記錄。如果寫「只抓到 N 張，太少了」，代表遊々亭當天連不上或改版，舊資料會保留不會被清掉。
- **書籤按了沒反應**：確認瀏覽器沒有擋下彈出視窗（網址列右邊會出現圖示，選「一律允許」）。
- **書籤顯示「網站要求重新確認連線」**：重新整理那一頁，等它正常顯示後再按一次書籤。
- **同步失敗、金鑰過期**：到「匯入・設定」重新建立金鑰貼上，再按「立即同步」。
- **商店改版後抓不到**：把錯誤畫面截圖給 Claude，修改 `scraper/yuyutei.py` 或 `importer.js` 即可。

價格僅供參考，實際以各商店頁面為準。
