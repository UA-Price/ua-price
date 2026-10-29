/*
  一鍵匯入書籤（在 Hobby Station 或 Dorasuta 的網站上按下）
  - 「匯入全部系列」：在你的瀏覽器裡用正常速度逐一讀取每個系列的商品列表
  - 「只匯入這個系列」：只讀目前這個搜尋結果
  讀到的價格會分批送到比價網站。這個檔案會被網站讀進來轉成書籤，__SITE__ 會換成網站網址。
*/
(async () => {
  if (window.__uaImporterRunning) return;
  window.__uaImporterRunning = true;

  const SITE = "__SITE__";
  const SITE_ORIGIN = new URL(SITE).origin;
  const DELAY = 2500; // 每頁之間停 2.5 秒，跟一般人瀏覽的速度差不多
  const host = location.host;
  const shop = host.includes("hobbystation") ? "hs" : host.includes("dorasuta") ? "dora" : null;
  const SHOP_NAME = { hs: "Hobby Station", dora: "Dorasuta" }[shop];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const STAR = /[★☆]/g;
  const KEY_RE = /([A-Z0-9]+)\/([A-Z0-9]+-\d+-(?:AP)?\d+)/;

  /* ---------- 右下角的面板 ---------- */
  const box = document.createElement("div");
  box.style.cssText =
    "position:fixed;z-index:2147483647;right:16px;bottom:16px;width:320px;max-width:calc(100vw - 32px);padding:14px 16px;" +
    "background:#1d1b2e;color:#fff;font:14px/1.6 sans-serif;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.35)";
  const msg = document.createElement("div");
  msg.style.whiteSpace = "pre-line";
  const bar = document.createElement("div");
  bar.style.cssText = "height:6px;border-radius:3px;background:#3a3850;margin:8px 0;overflow:hidden;display:none";
  const fill = document.createElement("div");
  fill.style.cssText = "height:100%;width:0;background:#ef5468;transition:width .3s";
  bar.appendChild(fill);
  const btns = document.createElement("div");
  btns.style.cssText = "display:flex;gap:6px;flex-wrap:wrap;margin-top:8px";
  box.append(msg, bar, btns);
  document.body.appendChild(box);
  const say = (t) => { msg.textContent = t; };
  const progress = (r) => { bar.style.display = "block"; fill.style.width = Math.round(r * 100) + "%"; };
  const button = (label, primary, fn) => {
    const b = document.createElement("button");
    b.textContent = label;
    b.style.cssText =
      "border:0;border-radius:8px;padding:7px 12px;cursor:pointer;font:600 13px sans-serif;" +
      (primary ? "background:#ef5468;color:#fff" : "background:#3a3850;color:#fff");
    b.onclick = fn;
    btns.appendChild(b);
    return b;
  };
  const finish = (ms) => setTimeout(() => { box.remove(); window.__uaImporterRunning = false; }, ms);

  if (!shop) {
    say("請在 Hobby Station 或 Dorasuta 的網站上使用這個書籤。");
    return finish(5000);
  }

  /* ---------- 解析：Hobby Station ---------- */
  function parseHS(doc) {
    const out = [];
    doc.querySelectorAll("ul.searchRsultList > li").forEach((li) => {
      const codeEl = li.querySelector(":scope > div");
      const code = codeEl ? codeEl.textContent.trim() : "";
      // 例：UA-UA57BT-STG-1-029-02 → UA57BT / STG-1-029
      const m = code.match(/^UA-([A-Z0-9]+)-([A-Z0-9]+-\d+-(?:AP)?\d+)(?:-\d+)?$/);
      if (!m) return; // 構築済デッキ等不是單卡
      const nameEl = li.querySelector(".list_product_Name_pc") || li.querySelector("figcaption");
      let name = nameEl ? nameEl.textContent.replace(/\s+/g, " ").trim() : "";
      const stars = (name.match(STAR) || []).length;
      name = name.replace(/[（(][★☆]+[)）]/, "").trim();
      // 價格要從「拿掉卡號與卡名」後的文字找，避免卡號數字黏到價格上
      const clone = li.cloneNode(true);
      clone.querySelectorAll(':scope > div:first-child, [class*="list_product_Name"]').forEach((n) => n.remove());
      const text = " " + clone.textContent.replace(/\s+/g, " ");
      const pm = text.match(/[^\d,]((?:\d{1,3}(?:,\d{3})+)|\d+)\s*円/);
      if (!pm) return;
      const sm = text.match(/在庫数\s*[:：]\s*([◎◯○\d]+)/);
      const stock = sm ? (/^\d+$/.test(sm[1]) ? Math.min(+sm[1], 98) : 99) : 0;
      const a = li.querySelector("figure a[href], a[href]");
      out.push([m[1] + "/" + m[2], stars, name, +pm[1].replace(/,/g, ""), stock, a ? a.href : ""]);
    });
    return { items: out, rows: doc.querySelectorAll("ul.searchRsultList > li").length, first: firstCodeHS(doc) };
  }
  const firstCodeHS = (doc) => {
    const d = doc.querySelector("ul.searchRsultList > li > div");
    return d ? d.textContent.trim() : "";
  };

  /* ---------- 解析：Dorasuta ---------- */
  function parseDora(doc) {
    const out = [];
    doc.querySelectorAll("div.element").forEach((el) => {
      const a = el.querySelector("li.change_hight a");
      if (!a) return;
      const title = a.textContent.replace(/\s+/g, " ").trim();
      if (/プレイ用|シリアル/.test(title)) return; // 跳過有傷的「プレイ用」與序號卡
      const m = title.match(KEY_RE);
      if (!m) return;
      const ps = [...el.querySelectorAll("li.change_hight p")].map((p) => p.textContent.trim());
      const stars = ((ps[0] || "").match(STAR) || []).length;
      const priceLi = [...el.querySelectorAll(".description li")].find(
        (l) => !l.classList.contains("change_hight") && /円/.test(l.textContent)
      );
      if (!priceLi) return;
      const price = +priceLi.textContent.replace(/[^\d]/g, "");
      const cond = el.querySelector(".condition");
      const sold = !!(cond && (cond.classList.contains("soldout") || /SOLD/i.test(cond.textContent)));
      let name = title.replace(/\(.*$/, "").trim();
      if (/^ACTION POINT/i.test(title)) {
        const n = title.match(/【(.+?)】/);
        name = "AP " + (n ? n[1] : "");
      }
      out.push([m[1] + "/" + m[2], stars, name, price, sold ? 0 : 99, a.href]);
    });
    const pm = doc.querySelector('input[name="page_max"]');
    return { items: out, pageMax: Math.min(+(pm && pm.value) || 1, 30) };
  }

  async function fetchDoc(url) {
    const r = await fetch(url, { credentials: "include" });
    const html = await r.text();
    if (/安全な接続を確認中|Just a moment/.test(html.slice(0, 3000))) throw new Error("check");
    return new DOMParser().parseFromString(html, "text/html");
  }

  /* ---------- 系列清單 ---------- */
  async function seriesListHS() {
    const doc = /\/ua\/top/.test(location.pathname) ? document : await fetchDoc(location.origin + "/ua/top");
    const map = new Map();
    for (const a of doc.querySelectorAll("a[href]")) {
      let u;
      try { u = new URL(a.getAttribute("href"), location.origin); } catch (e) { continue; }
      if (u.pathname !== "/ua/product/list") continue;
      const kw = u.searchParams.get("HbstSearchOptions[0][search_keyword]") || "";
      if (!/【[A-Z0-9]+】|プロモーションカード/.test(kw)) continue;
      const label = kw.replace(/\(BANNER\)/g, "").trim();
      if (!map.has(label)) map.set(label, u.href);
    }
    return [...map].map(([label, url]) => ({ label, url }));
  }
  async function seriesListDora() {
    const doc = /series-list/.test(location.pathname) ? document : await fetchDoc(location.origin + "/union-arena/series-list");
    const map = new Map();
    for (const a of doc.querySelectorAll("a[href]")) {
      let u;
      try { u = new URL(a.getAttribute("href"), location.origin); } catch (e) { continue; }
      const sid = u.searchParams.get("sid");
      if (u.pathname !== "/union-arena/product-list" || !sid || map.has(sid)) continue;
      map.set(sid, { label: a.textContent.replace(/\s+/g, " ").trim() || "sid " + sid, url: u.href });
    }
    return [...map.values()];
  }

  /* ---------- 讀取一個系列的所有頁面 ---------- */
  async function readSeriesHS(url, first) {
    const items = [];
    let prevFirst = null;
    for (let p = 1; p <= 20; p++) {
      if (cancelled) break;
      const u = new URL(url);
      if (p > 1) u.searchParams.set("pageno", String(p));
      const doc = p === 1 && first ? first : await fetchDoc(u.href);
      const r = parseHS(doc);
      if (r.first && r.first === prevFirst) break;
      prevFirst = r.first;
      items.push(...r.items);
      if (r.rows < 20) break; // 最後一頁
      const per = +((doc.querySelector('select[name="disp_number"]') || {}).value || 60);
      if (r.rows < per) break;
      await sleep(DELAY);
    }
    return items;
  }
  async function readSeriesDora(url, first) {
    const items = [];
    const doc1 = first || (await fetchDoc(url));
    const r1 = parseDora(doc1);
    items.push(...r1.items);
    for (let p = 2; p <= r1.pageMax; p++) {
      if (cancelled) break;
      await sleep(DELAY);
      const u = new URL(url);
      const sid = (doc1.querySelector('input[name="sid"]') || {}).value;
      if (sid && !u.searchParams.get("sid")) u.searchParams.set("sid", sid);
      u.searchParams.set("form110200_mode", "search");
      u.searchParams.set("form110200_params[0]", "pager");
      u.searchParams.set("form110200_params[1]", String(p));
      u.searchParams.set("page_now", "1");
      u.searchParams.set("page_max", String(r1.pageMax));
      items.push(...parseDora(await fetchDoc(u.href)).items);
    }
    return items;
  }
  const readSeries = shop === "hs" ? readSeriesHS : readSeriesDora;

  /* ---------- 傳送到比價網站 ---------- */
  let win = null;
  let siteReady = false;
  const acks = new Set();
  let syncResult = null;
  window.addEventListener("message", (e) => {
    if (e.origin !== SITE_ORIGIN || !e.data) return;
    if (e.data.type === "ua-ready") siteReady = true;
    if (e.data.type === "ua-done") acks.add(e.data.batch);
    if (e.data.type === "ua-synced") syncResult = e.data;
  });
  async function send(items, label, final) {
    const batch = Math.random().toString(36).slice(2) + Date.now();
    const payload = { type: "ua-import", shop, batch, label, final, items };
    for (let t = 0; t < 30; t++) {
      if (!win || win.closed) return false;
      try { win.postMessage(payload, SITE_ORIGIN); } catch (e) {}
      await sleep(siteReady ? 300 : 700);
      if (acks.has(batch)) return true;
    }
    return false;
  }

  /* ---------- 主流程 ---------- */
  let cancelled = false;
  const all = [];       // 全部讀到的資料（補送用）
  let unsent = [];      // 還沒成功送出的資料

  async function run(mode) {
    btns.textContent = "";
    win = window.open(SITE + "#import", "ua_price_import");
    button("停止", false, () => { cancelled = true; say("停止中…（會把已讀到的先送出）"); });
    let series;
    if (mode === "all") {
      say("讀取系列清單…");
      try {
        series = shop === "hs" ? await seriesListHS() : await seriesListDora();
      } catch (e) {
        series = [];
      }
      if (!series.length) {
        say("找不到系列清單。請先打開網站首頁或任一系列頁面，再按一次書籤。");
        btns.textContent = "";
        return finish(8000);
      }
    } else {
      // 如果目前在第 2 頁以後，改從第 1 頁開始讀
      const u = new URL(location.href);
      const onLaterPage = u.searchParams.has("pageno") || u.searchParams.has("form110200_mode");
      ["pageno", "form110200_mode", "form110200_params[0]", "form110200_params[1]", "page_now", "page_max"].forEach((k) => u.searchParams.delete(k));
      series = [{ label: document.title, url: u.href, here: !onLaterPage }];
    }

    let failedSeries = 0;
    for (let i = 0; i < series.length && !cancelled; i++) {
      const s = series[i];
      say(`${SHOP_NAME}：第 ${i + 1} / ${series.length} 個系列\n${s.label}\n已讀到 ${all.length} 筆`);
      progress(i / series.length);
      let items = [];
      try {
        items = await readSeries(s.url, s.here ? document : null);
      } catch (e) {
        failedSeries++;
        if (e.message === "check") {
          say("網站要求重新確認連線。請重新整理這一頁，等它正常顯示後再按一次書籤。");
          cancelled = true;
          break;
        }
      }
      all.push(...items);
      unsent.push(...items);
      if (unsent.length && (await send(unsent, s.label, false))) unsent = [];
      if (i < series.length - 1) await sleep(DELAY);
    }
    progress(1);

    // 最後一批（附帶「完成」訊號，網站收到後會同步到 GitHub）
    say(`讀取完成，共 ${all.length} 筆，傳送中…`);
    btns.textContent = "";
    const ok = await send(unsent, "完成", true);
    if (!ok) {
      say(`讀到 ${all.length} 筆，但比價網站沒有回應（視窗可能被關掉或被擋）。按下面的按鈕重新傳送。`);
      button("重新傳送", true, async () => {
        btns.textContent = "";
        win = window.open(SITE + "#import", "ua_price_import");
        siteReady = false;
        say("重新傳送中…");
        if (await send(all, "完成", true)) afterSent(failedSeries);
        else say("還是沒有回應。請確認瀏覽器允許這個網站開啟彈出視窗。");
      });
      button("關閉", false, () => finish(0));
      return;
    }
    afterSent(failedSeries);
  }

  async function afterSent(failedSeries) {
    let text = `匯入完成：${all.length} 筆` + (failedSeries ? `（${failedSeries} 個系列讀取失敗）` : "") + (cancelled ? "（中途停止）" : "");
    say(text + "\n等待同步…");
    for (let t = 0; t < 40 && !syncResult; t++) await sleep(500);
    if (syncResult) text += "\n" + syncResult.msg;
    say(text);
    btns.textContent = "";
    button("關閉", false, () => finish(0));
    finish(15000);
  }

  /* ---------- 選擇模式 ---------- */
  const hereCount = (shop === "hs" ? parseHS(document).items : parseDora(document).items).length;
  say(`${SHOP_NAME} 價格匯入` + (hereCount ? `\n這一頁有 ${hereCount} 筆單卡。` : ""));
  button("匯入全部系列", true, () => run("all"));
  if (hereCount) button("只匯入這個系列", false, () => run("here"));
  button("取消", false, () => finish(0));
})();
