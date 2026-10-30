/*
  一鍵匯入書籤（在遊々亭、Hobby Station、Dorasuta 或官方卡表的網站上按下）
  - 在官方卡表按下：匯入每張卡的顏色
  - 「匯入全部系列」：在你的瀏覽器裡用正常速度逐一讀取每個系列的商品列表
  - 「只匯入這個系列」：只讀目前這個搜尋結果
  讀到的價格會分批送到比價網站。這個檔案會被網站讀進來轉成書籤，__SITE__ 會換成網站網址。
*/
(async () => {
  if (window.__uaImporterRunning) return;
  window.__uaImporterRunning = true;

  // 由「查價之境」擴充功能啟動時：自動開始，資料透過擴充功能轉送給網站（不另開視窗）
  const EXT = !!(window.__UA_AUTO && window.__UA_AUTO.ext);
  const SITE = "__SITE__";
  const SITE_ORIGIN = EXT ? location.origin : new URL(SITE).origin;
  const host = location.host;
  const shop = host.includes("yuyu-tei") ? "yuyu" : host.includes("hobbystation") ? "hs" : host.includes("dorasuta") ? "dora"
    : host.includes("unionarena-tcg.com") ? "colors" : null;
  const SHOP_NAME = { yuyu: "遊々亭", hs: "Hobby Station", dora: "Dorasuta", colors: "官方卡表（卡片顏色）" }[shop];
  // 每頁之間的間隔：一般 2.5 秒；Dorasuta 用 Cloudflare，對大量瀏覽比較敏感，放慢到 4 秒；官方卡表每次查詢很小，1.2 秒
  const DELAY = shop === "dora" ? 4000 : shop === "colors" ? 1200 : 2500;
  const COLORS = ["赤", "青", "黄", "緑", "紫"];
  const sets = {}; // 遊々亭的系列代碼 → 系列名稱
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
  const say = (t) => {
    msg.textContent = t;
    if (EXT) window.postMessage({ __ua_progress: t }, location.origin);
  };
  const reportDone = (t, ok) => { if (EXT) window.postMessage({ __ua_progress: t, done: true, ok: !!ok }, location.origin); };
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

  // 擴充功能模式：請轉送程式把資料交給網站，等網站回覆
  function extCall(payload, timeout = 30000) {
    return new Promise((resolve) => {
      const id = "r" + Math.random().toString(36).slice(2) + Date.now();
      const onReply = (e) => {
        if (e.source !== window || !e.data || e.data.__ua_reply !== id) return;
        window.removeEventListener("message", onReply);
        clearTimeout(timer);
        resolve(e.data.resp || null);
      };
      const timer = setTimeout(() => { window.removeEventListener("message", onReply); resolve(null); }, timeout);
      window.addEventListener("message", onReply);
      window.postMessage({ __ua_req: id, payload }, location.origin);
    });
  }

  if (!shop) {
    say("請在遊々亭、Hobby Station、Dorasuta 或官方卡表的網站上使用這個書籤。");
    return finish(5000);
  }

  /* ---------- 解析：遊々亭 ---------- */
  function parseYuyu(doc) {
    const out = [];
    const sections = doc.querySelectorAll("div.cards-list");
    (sections.length ? [...sections] : [doc]).forEach((sec) => {
      const head = sec.querySelector("h3 span");
      const secRar = head ? head.textContent.trim() : "";
      sec.querySelectorAll(".card-product").forEach((c) => {
        const numEl = c.querySelector("span.border");
        const nameEl = c.querySelector("h4");
        const priceEl = c.querySelector("strong");
        const stockEl = c.querySelector(".cart_sell_zaiko");
        const img = c.querySelector("img.card");
        const link = c.querySelector('a[href*="/sell/ua/card/"]');
        let num = numEl ? numEl.textContent.trim() : "";
        let name = nameEl ? nameEl.textContent.replace(/\s+/g, " ").trim() : "";
        let rar = secRar;
        const alt = img ? (img.getAttribute("alt") || "").split(" ") : [];
        if (alt.length >= 2) {
          if (!num) num = alt[0];
          if (alt[0] === num) rar = alt[1];
          if (!name) name = alt.slice(2).join(" ");
        }
        if (!KEY_RE.test(num)) return;
        const price = +((priceEl ? priceEl.textContent : "").replace(/[^\d]/g, ""));
        if (!price) return;
        const st = (stockEl ? stockEl.textContent : "").replace(/\s+/g, "").replace(/^在庫[:：]?/, "");
        let stock = -1;
        if (/[×✕]/.test(st)) stock = 0;
        else if (/\d+/.test(st)) stock = Math.min(+st.match(/\d+/)[0], 98);
        else if (/[◯○◎]/.test(st)) stock = 99;
        const src = (link && link.getAttribute("href")) || (img && img.getAttribute("src")) || "";
        const m = src.match(/\/(?:card|100_140)\/([a-z0-9]+)\/(\d+)/);
        const noImg = img && /noimage/i.test(img.getAttribute("src") || "") ? 1 : 0; // 遊々亭自己也沒有圖
        out.push([num, (rar.match(STAR) || []).length, name, price, stock, link ? link.href : "", rar, m ? m[1] : "", m ? m[2] : "", noImg]);
      });
    });
    return { items: out };
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

  const isCheckPage = (html) => /安全な接続を確認中|Just a moment/.test(String(html).slice(0, 3000));

  // 網站要求「確認連線」時：在隱藏的小視窗裡正常打開那一頁，讓網站自己的確認程式在你的瀏覽器裡跑完
  function loadInFrame(url) {
    return new Promise((resolve, reject) => {
      const f = document.createElement("iframe");
      f.style.cssText = "position:fixed;left:-10000px;top:0;width:1000px;height:800px;border:0;visibility:hidden";
      document.body.appendChild(f);
      const started = Date.now();
      const timer = setInterval(() => {
        let html = "";
        try {
          const d = f.contentDocument;
          if (d && d.readyState !== "loading" && d.body) html = d.documentElement.outerHTML;
        } catch (e) { /* 還在載入 */ }
        if (html && !isCheckPage(html) && html.length > 5000) {
          clearInterval(timer);
          f.remove();
          resolve(new DOMParser().parseFromString(html, "text/html"));
        } else if (Date.now() - started > 45000) {
          clearInterval(timer);
          f.remove();
          reject(new Error("check"));
        }
      }, 800);
      f.src = url;
    });
  }

  async function fetchDoc(url) {
    const r = await fetch(url, { credentials: "include" });
    const html = await r.text();
    if (!isCheckPage(html)) return new DOMParser().parseFromString(html, "text/html");
    say(msg.textContent.split("\n")[0] + "\n網站正在確認連線，請稍候…");
    return loadInFrame(url); // 確認通過後，之後的頁面就能照常讀取
  }

  /* ---------- 系列清單 ---------- */
  function readVers(doc) {
    const list = [];
    doc.querySelectorAll('input[name="vers[]"]').forEach((inp) => {
      const code = (inp.value || "").trim();
      if (!code || sets[code]) return;
      const label = inp.id ? doc.querySelector(`label[for="${CSS.escape(inp.id)}"]`) : null;
      sets[code] = label ? label.textContent.replace(/\s+/g, " ").trim() : code;
      list.push({ label: sets[code], url: location.origin + "/sell/ua/s/" + code, code });
    });
    return list;
  }
  async function seriesListYuyu() {
    let list = readVers(document);
    if (!list.length) list = readVers(await fetchDoc(location.origin + "/sell/ua/s/new"));
    return list;
  }
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

  /* ---------- 官方卡表：每個作品依 5 種顏色各查一次 ---------- */
  async function seriesListColors() {
    let doc = document;
    if (!doc.querySelector('select[name="selectTitle"]')) doc = await fetchDoc(location.origin + "/jp/cardlist/");
    const sel = doc.querySelector('select[name="selectTitle"]');
    if (!sel) return [];
    return [...sel.options].map((o) => o.getAttribute("value") || "").filter(Boolean)
      .filter((v, i, a) => a.indexOf(v) === i).map((title) => ({ label: title, url: title }));
  }
  async function readSeriesColors(title) {
    const items = [];
    for (let i = 0; i < COLORS.length; i++) {
      if (cancelled) break;
      const fd = new FormData();
      fd.append("selectTitle", title);
      fd.append("color[]", COLORS[i]);
      const html = await fetch(location.origin + "/jp/cardlist/index.php?search=true", { method: "POST", body: fd, credentials: "include" }).then((r) => r.text());
      const doc = new DOMParser().parseFromString(html, "text/html");
      const seen = new Set();
      doc.querySelectorAll("img").forEach((img) => {
        const src = img.getAttribute("data-src") || img.getAttribute("src") || "";
        const m = src.match(/cardlist\/card\/([A-Z0-9]+)_([A-Z0-9]+-\d+-(?:AP)?\d+)(?:_p\d+)?\.png/);
        if (!m) return;
        const num = m[1] + "/" + m[2];
        if (seen.has(num)) return;
        seen.add(num);
        items.push([num, COLORS[i]]);
      });
      if (i < COLORS.length - 1) await sleep(DELAY);
    }
    return items;
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
  async function readSeriesYuyu(url, first) {
    return parseYuyu(first || (await fetchDoc(url))).items;
  }
  const readSeries = { yuyu: readSeriesYuyu, hs: readSeriesHS, dora: readSeriesDora, colors: readSeriesColors }[shop];

  /* ---------- 傳送到比價網站 ---------- */
  let win = null;
  let siteReady = false;
  const acks = new Set();
  let syncResult = null;
  window.addEventListener("message", (e) => {
    if (EXT && e.source === window && e.data) {
      if (e.data.__ua_synced) syncResult = e.data.__ua_synced;
      if (e.data.__ua_stop) { cancelled = true; say("停止中…（會把已讀到的先送出）"); }
      return;
    }
    if (e.origin !== SITE_ORIGIN || !e.data) return;
    if (e.data.type === "ua-ready") siteReady = true;
    if (e.data.type === "ua-done") acks.add(e.data.batch);
    if (e.data.type === "ua-synced") syncResult = e.data;
  });
  async function send(items, label, final) {
    const batch = Math.random().toString(36).slice(2) + Date.now();
    const payload = { type: "ua-import", shop, batch, label, final, items, sets: shop === "yuyu" ? sets : undefined };
    if (EXT) {
      for (let t = 0; t < 3; t++) {
        const resp = await extCall(payload);
        if (resp && resp.type === "ua-done") return true;
        await sleep(2000);
      }
      return false;
    }
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
  let stopReason = "";
  const all = [];       // 全部讀到的資料（補送用）
  let unsent = [];      // 還沒成功送出的資料

  async function run(mode) {
    btns.textContent = "";
    if (!EXT) win = window.open(SITE + "#import", "ua_price_import");
    button("停止", false, () => { cancelled = true; say("停止中…（會把已讀到的先送出）"); });
    let series;
    if (mode === "all") {
      say("讀取系列清單…");
      try {
        series = await { yuyu: seriesListYuyu, hs: seriesListHS, dora: seriesListDora, colors: seriesListColors }[shop]();
      } catch (e) {
        series = [];
      }
      if (!series.length) {
        say("找不到系列清單。請先打開網站首頁或任一系列頁面，再按一次書籤。");
        reportDone("找不到系列清單（網站可能改版或還在確認連線）", false);
        btns.textContent = "";
        return finish(8000);
      }
    } else {
      // 如果目前在第 2 頁以後，改從第 1 頁開始讀
      const u = new URL(location.href);
      const onLaterPage = u.searchParams.has("pageno") || u.searchParams.has("form110200_mode");
      ["pageno", "form110200_mode", "form110200_params[0]", "form110200_params[1]", "page_now", "page_max"].forEach((k) => u.searchParams.delete(k));
      if (shop === "yuyu") readVers(document);
      series = [{ label: document.title, url: u.href, here: !onLaterPage }];
    }

    let failedSeries = 0;
    for (let i = 0; i < series.length && !cancelled; i++) {
      const s = series[i];
      say(`${SHOP_NAME}：第 ${i + 1} / ${series.length} 個${shop === "colors" ? "作品" : "系列"}\n${s.label}\n已讀到 ${all.length} 筆`);
      progress(i / series.length);
      let items = [];
      try {
        items = await readSeries(s.url, s.here ? document : null);
      } catch (e) {
        failedSeries++;
        if (e.message === "check") {
          stopReason = "網站一直停在「確認連線」畫面。請重新整理這一頁，等它正常顯示後再按一次書籤。";
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
    if (!ok && EXT) {
      say(`讀到 ${all.length} 筆，但沒辦法送到查價之境網站。請確認網站分頁還開著，再按一次擴充功能的「開始匯入」。`);
      reportDone(`讀到 ${all.length} 筆，但送不到網站`, false);
      return;
    }
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
    if (stopReason) text += "\n⚠ " + stopReason;
    say(text + "\n等待同步…");
    for (let t = 0; t < 40 && !syncResult; t++) await sleep(500);
    if (syncResult) text += "\n" + syncResult.msg;
    say(text);
    reportDone(text, !stopReason && !failedSeries);
    btns.textContent = "";
    button("關閉", false, () => finish(0));
    finish(15000);
  }

  /* ---------- 選擇模式 ---------- */
  if (EXT) {
    run("all"); // 擴充功能模式：直接開始，不用選
    return;
  }
  if (shop === "colors") {
    say("官方卡表：匯入每張卡的顏色\n每個作品依 5 種顏色各查一次，大約 5～6 分鐘。\n卡片顏色不會變，有新作品時再按一次就好。");
    button("匯入卡片顏色", true, () => run("all"));
    button("取消", false, () => finish(0));
    return;
  }
  const hereCount = { yuyu: parseYuyu, hs: parseHS, dora: parseDora }[shop](document).items.length;
  say(`${SHOP_NAME} 價格匯入` + (hereCount ? `\n這一頁有 ${hereCount} 筆單卡。` : ""));
  button("匯入全部系列", true, () => run("all"));
  if (hereCount) button("只匯入這個系列", false, () => run("here"));
  button("取消", false, () => finish(0));
})();
