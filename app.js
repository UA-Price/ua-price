/* 查價之境 — 網站主程式 */
(() => {
  "use strict";

  /* ======================= 基本設定 ======================= */
  const SHOPS = {
    yuyu: { name: "遊々亭", short: "遊々亭" },
    hs: { name: "Hobby Station", short: "ホビステ" },
    dora: { name: "Dorasuta", short: "ドラスタ" },
  };
  const SHOP_BASE = {
    yuyu: "https://yuyu-tei.jp",
    hs: "https://www.hobbystation-single.jp",
    dora: "https://dorasuta.jp",
  };
  const IMPORT_SHOPS = ["yuyu", "hs", "dora"];
  const DATA_KEYS = [...IMPORT_SHOPS, "colors"]; // 匯入資料的種類：三家價格 + 官方卡表的卡片顏色
  const SOURCE_NAME = (k) => (k === "colors" ? "官方卡表（卡片顏色）" : SHOPS[k].name);
  const COLOR_LIST = [
    { key: "赤", label: "紅", hex: "#ff4d5e" },
    { key: "青", label: "藍", hex: "#3f8cff" },
    { key: "黄", label: "黃", hex: "#ffd23f" },
    { key: "緑", label: "綠", hex: "#3ed07a" },
    { key: "紫", label: "紫", hex: "#a86bff" },
  ];
  const COLOR_INFO = Object.fromEntries(COLOR_LIST.map((c) => [c.key, c]));
  const SHOP_ORIGINS = {
    "https://yuyu-tei.jp": "yuyu",
    "https://www.hobbystation-single.jp": "hs",
    "https://dorasuta.jp": "dora",
    "https://www.unionarena-tcg.com": "colors",
  };
  const OLD_DAYS = 14;          // 匯入超過 14 天的價格標示為「舊」
  const PAGE_SIZE = 50;
  const DECK_SIZE = 50;
  const MAX_COPIES = 4;
  const LS = { decks: "ua.decks", current: "ua.current", imports: "ua.imports", gh: "ua.gh" };

  const $ = (s) => document.querySelector(s);
  const el = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? "" : v);
    }
    for (const k of kids.flat()) if (k != null && k !== false) n.append(k instanceof Node ? k : String(k));
    return n;
  };
  const yen = (n) => "¥" + Math.round(n).toLocaleString("ja-JP");
  const imgUrl = (c) => (c.set && c.id && !c.noimg ? `https://card.yuyu-tei.jp/ua/100_140/${c.set}/${c.id}.jpg` : "");
  /* ---------- 卡圖：全部用官方卡表 ----------
     官方的平行卡依序編成 _p1、_p2…，跟星星數不一定一致（例如 ★、★★★ 兩種平行卡會是 _p1、_p2），
     所以先看「同一張卡總共有哪幾種星數」，用排第幾個來對應；對不到時再往下找，最後才用遊々亭的小圖。 */
  const OFFICIAL_IMG = "https://www.unionarena-tcg.com/jp/images/cardlist/card/";
  const NUM_RE = /^[A-Z0-9]+\/[A-Z0-9]+-\d+-(AP)?\d+$/;
  let VARIANTS = new Map(); // 卡號 → 這張卡有哪些星數（由小到大）
  function officialList(c) {
    if (!NUM_RE.test(c.num)) return [];
    const file = OFFICIAL_IMG + c.num.replace("/", "_");
    const stars = VARIANTS.get(c.num) || [c.stars || 0];
    const rank = Math.max(0, stars.indexOf(c.stars || 0));
    const order = [rank];
    for (let k = Math.min(Math.max(c.stars || 0, rank), 6); k >= 0; k--) if (!order.includes(k)) order.push(k);
    return order.slice(0, 4).map((k) => file + (k ? `_p${k}` : "") + ".png");
  }
  // 列表用的小圖：透過免費縮圖服務縮小（官網原圖每張約 200KB，手機會很吃流量）
  const thumbOf = (url, w) => `https://wsrv.nl/?url=${encodeURIComponent(url)}&w=${w}&output=webp&q=82`;
  let proxyBroken = false; // 縮圖服務掛掉時改直接用官網原圖
  function imgCandidates(c, size) {
    const off = officialList(c);
    const list = [];
    if (size && !proxyBroken) off.forEach((u) => list.push({ src: thumbOf(u, size), proxied: true, orig: u }));
    off.forEach((u) => list.push({ src: u }));
    const y = imgUrl(c);
    if (y) list.push({ src: y });
    return list;
  }
  // 依序嘗試，直到有一張載入成功
  function setImgChain(img, list, onFail) {
    let i = 0;
    const failed = new Set();
    const tryNext = () => {
      while (i < list.length && proxyBroken && list[i].proxied) i++;
      if (i >= list.length) return onFail();
      img.src = list[i].src;
    };
    img.addEventListener("error", () => { if (list[i] && list[i].proxied) failed.add(list[i].orig); i++; tryNext(); });
    img.addEventListener("load", () => {
      const cur = list[i];
      if (cur && !cur.proxied && failed.has(cur.src)) proxyBroken = true; // 原圖可以、縮圖不行 → 縮圖服務有問題
    });
    tryNext();
  }
  const yuyuUrl = (c) => `https://yuyu-tei.jp/sell/ua/card/${c.set}/${c.id}`;
  const starsOf = (s) => (String(s || "").match(/[★☆]/g) || []).length;
  const baseOf = (num) => String(num).split("/").pop();
  const titleOf = (num) => baseOf(num).split("-")[0];
  const isAP = (num) => /-AP\d+$/i.test(baseOf(num));
  const keyOf = (num, stars) => `${num}|${stars}`;

  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set(k, v) {
      try { localStorage.setItem(k, JSON.stringify(v)); return true; }
      catch (e) { toast("瀏覽器儲存空間已滿，請先清除部分匯入資料"); return false; }
    },
  };

  // 匯入的價格資料量大，存在 IndexedDB（容量比 localStorage 大很多）
  const idb = {
    db: null,
    open() {
      return this.db || (this.db = new Promise((res, rej) => {
        const r = indexedDB.open("ua-price", 1);
        r.onupgradeneeded = () => r.result.createObjectStore("kv");
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      }));
    },
    async get(k) {
      try {
        const db = await this.open();
        return await new Promise((res) => {
          const q = db.transaction("kv").objectStore("kv").get(k);
          q.onsuccess = () => res(q.result);
          q.onerror = () => res(undefined);
        });
      } catch (e) { return undefined; }
    },
    async set(k, v) {
      try {
        const db = await this.open();
        return await new Promise((res) => {
          const tx = db.transaction("kv", "readwrite");
          tx.objectStore("kv").put(v, k);
          tx.oncomplete = () => res(true);
          tx.onerror = () => res(false);
        });
      } catch (e) { return false; }
    },
  };
  // 每家分開存（imp:yuyu、imp:hs、imp:dora），三家同時匯入時才不會互相蓋掉
  async function readLocalImports() {
    const v = {};
    for (const shop of DATA_KEYS) {
      const x = await idb.get("imp:" + shop);
      if (x && x.items) v[shop] = x;
    }
    return v;
  }
  async function loadLocalImports() {
    let v = await readLocalImports();
    const legacy = await idb.get("imports"); // 前一版整包存在一起
    if (legacy && typeof legacy === "object") {
      v = mergeImportSets(v, legacy);
      for (const shop of DATA_KEYS) if (v[shop]) await idb.set("imp:" + shop, v[shop]);
      await idb.set("imports", null);
    }
    const old = store.get(LS.imports, null); // 舊版存在 localStorage，搬過來
    if (old) {
      v = mergeImportSets(v || {}, old);
      for (const shop of DATA_KEYS) if (v[shop]) await idb.set("imp:" + shop, v[shop]);
      try { localStorage.removeItem(LS.imports); } catch (e) {}
    }
    imports = v || {};
  }
  // 通知同一台電腦上其他開著的網站分頁：匯入資料變了
  const channel = "BroadcastChannel" in window ? new BroadcastChannel("ua-price") : null;
  async function saveImports(only) {
    const shops = only ? [only] : DATA_KEYS;
    let ok = true;
    for (const shop of shops) ok = (await idb.set("imp:" + shop, imports[shop] || null)) && ok;
    if (!ok) toast("價格資料儲存失敗");
    else if (channel) channel.postMessage({ type: "imports-changed", shops, cleared: shops.filter((x) => !imports[x]) });
    return ok;
  }

  let toastTimer;
  function toast(msg, ms = 2600) {
    const t = $("#toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), ms);
  }

  function ask(title, value = "") {
    return new Promise((resolve) => {
      const d = $("#dialog"), inp = $("#dialogInput");
      $("#dialogTitle").textContent = title;
      inp.value = value;
      d.hidden = false;
      setTimeout(() => inp.focus(), 30);
      const done = (v) => { d.hidden = true; ok.onclick = cancel.onclick = null; resolve(v); };
      const ok = $("#dialogOk"), cancel = $("#dialogCancel");
      ok.onclick = () => done(inp.value.trim());
      cancel.onclick = () => done(null);
    });
  }
  function confirmBox(title) {
    return new Promise((resolve) => {
      const d = $("#dialog"), inp = $("#dialogInput");
      $("#dialogTitle").textContent = title;
      inp.style.display = "none";
      d.hidden = false;
      const ok = $("#dialogOk"), cancel = $("#dialogCancel");
      const done = (v) => { d.hidden = true; inp.style.display = ""; ok.onclick = cancel.onclick = null; resolve(v); };
      ok.onclick = () => done(true);
      cancel.onclick = () => done(false);
    });
  }

  /* ======================= 資料 ======================= */
  let DATA = { updated: null, sets: {}, cards: [] };
  let CARDS = [];          // 合併後的卡片
  let BYKEY = new Map();
  let imports = {};                           // 這台裝置自己匯入的（啟動時從 IndexedDB 載入）
  let remoteImports = {};                     // GitHub 上共用的（data/imports.json）

  // 合併兩份匯入資料：每筆以時間較新的為準；replaceShop 指定的店直接用 b 的
  function mergeImportSets(a, b, replaceShop) {
    const out = {};
    for (const shop of DATA_KEYS) {
      if (replaceShop === shop) { if (b[shop]) out[shop] = b[shop]; continue; }
      const x = (a && a[shop]) || null, y = (b && b[shop]) || null;
      if (!x && !y) continue;
      const ti = shop === "colors" ? 1 : 4; // 每筆資料記錄時間的位置
      const items = { ...((x && x.items) || {}) };
      for (const [k, it] of Object.entries((y && y.items) || {})) {
        if (!items[k] || (it[ti] || 0) >= (items[k][ti] || 0)) items[k] = it;
      }
      out[shop] = { items, t: Math.max((x && x.t) || 0, (y && y.t) || 0) };
      const sets = { ...((x && x.sets) || {}), ...((y && y.sets) || {}) };
      if (Object.keys(sets).length) out[shop].sets = sets;
    }
    return out;
  }
  const effImports = () => mergeImportSets(remoteImports, imports);

  function offerFrom(item, shop) {
    // item: [價格, 庫存, 網址路徑, 卡名, 時間, (遊々亭) 稀有度, 系列代碼, 商品編號]
    let url = item[2] || "";
    if (url && !/^https?:/.test(url)) url = SHOP_BASE[shop] + url;
    if (!url && shop === "yuyu" && item[6] && item[7]) url = `https://yuyu-tei.jp/sell/ua/card/${item[6]}/${item[7]}`;
    return { shop, p: item[0], s: item[1], url, t: item[4] || 0 };
  }
  const allSets = () => ({ ...(DATA.sets || {}), ...((effImports().yuyu || {}).sets || {}) });

  function buildCards() {
    BYKEY = new Map();
    CARDS = [];
    for (const r of DATA.cards || []) {
      const [num, rar, name, price, stock, set, id] = r;
      const stars = starsOf(rar);
      const k = keyOf(num, stars);
      const offer = { shop: "yuyu", p: price, s: stock, url: set && id ? `https://yuyu-tei.jp/sell/ua/card/${set}/${id}` : "", t: 0 };
      let c = BYKEY.get(k);
      if (c) {
        // 同一卡號同版本出現兩次：保留有庫存且較便宜的
        const cur = c.offers.yuyu;
        const better = (offer.s !== 0 && cur.s === 0) || ((offer.s !== 0) === (cur.s !== 0) && offer.p < cur.p);
        if (better) { c.offers.yuyu = offer; c.set = set; c.id = id; }
        continue;
      }
      c = { k, num, base: baseOf(num), title: titleOf(num), rar, stars, name, set, id, offers: { yuyu: offer } };
      BYKEY.set(k, c);
      CARDS.push(c);
    }
    const eff = effImports();
    for (const shop of IMPORT_SHOPS) {
      const items = (eff[shop] && eff[shop].items) || {};
      for (const [k, item] of Object.entries(items)) {
        let c = BYKEY.get(k);
        if (shop === "yuyu") {
          // 遊々亭匯入的資料帶有稀有度、卡圖，當作卡片清單的主要來源
          const [num, st] = k.split("|");
          if (!c) {
            c = { k, num, base: baseOf(num), title: titleOf(num), rar: item[5] || "", stars: +st || 0, name: item[3] || num, set: item[6] || "", id: item[7] || "", noimg: !!item[8], offers: {} };
            BYKEY.set(k, c);
            CARDS.push(c);
          } else {
            if (item[5]) c.rar = item[5];
            if (item[3]) c.name = item[3];
            if (item[6] && item[7]) { c.set = item[6]; c.id = item[7]; c.noimg = !!item[8]; }
          }
          const prev = c.offers.yuyu;
          if (!prev || (item[4] || 0) >= (prev.t || 0)) c.offers.yuyu = offerFrom(item, "yuyu");
          continue;
        }
        if (!c) {
          const [num, st] = k.split("|");
          const stars = +st;
          c = {
            k, num, base: baseOf(num), title: titleOf(num), rar: stars ? "★".repeat(stars) : "",
            stars, name: item[3] || num, set: "", id: "", offers: {},
          };
          BYKEY.set(k, c);
          CARDS.push(c);
        }
        c.offers[shop] = offerFrom(item, shop);
      }
    }
    VARIANTS = new Map();
    const colorItems = (eff.colors && eff.colors.items) || {};
    for (const c of CARDS) {
      const ci = colorItems[c.num];
      c.color = ci && COLOR_INFO[ci[0]] ? ci[0] : "";
      c.search = (c.name + " " + c.num + " " + c.rar).toLowerCase();
      c.best = bestOffer(c);
      const v = VARIANTS.get(c.num) || [];
      if (!v.includes(c.stars || 0)) v.push(c.stars || 0);
      VARIANTS.set(c.num, v);
    }
    for (const v of VARIANTS.values()) v.sort((a, b) => a - b);
  }

  function bestOffer(c) {
    const all = Object.values(c.offers).filter((o) => o && o.p > 0);
    if (!all.length) return null;
    const inStock = all.filter((o) => o.s !== 0);
    const pool = inStock.length ? inStock : all;
    return pool.reduce((a, b) => (b.p < a.p ? b : a));
  }

  const numCmp = (a, b) => {
    const pa = a.base.split("-"), pb = b.base.split("-");
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const x = pa[i] || "", y = pb[i] || "";
      if (x === y) continue;
      const nx = parseInt(x.replace(/\D/g, ""), 10), ny = parseInt(y.replace(/\D/g, ""), 10);
      if (/^AP/.test(x) !== /^AP/.test(y)) return /^AP/.test(x) ? 1 : -1;
      if (!isNaN(nx) && !isNaN(ny) && nx !== ny) return nx - ny;
      return x < y ? -1 : 1;
    }
    return a.stars - b.stars || (a.num < b.num ? -1 : a.num > b.num ? 1 : 0);
  };

  /* ======================= 卡組 ======================= */
  let decks = store.get(LS.decks, []);
  let currentId = store.get(LS.current, null);
  if (!decks.length) decks = [newDeck("我的卡組")];
  if (!decks.find((d) => d.id === currentId)) currentId = decks[0].id;

  function newDeck(name) {
    return { id: "d" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, cards: {}, meta: {}, t: Date.now() };
  }
  const deck = () => decks.find((d) => d.id === currentId);
  function saveDecks() {
    deck().t = Date.now();
    store.set(LS.decks, decks);
    store.set(LS.current, currentId);
  }
  function cardFor(k) {
    const c = BYKEY.get(k);
    if (c) return c;
    const m = deck().meta[k] || [];
    const [num, st] = k.split("|");
    return {
      k, num, base: baseOf(num), title: titleOf(num), rar: m[1] || "", stars: +st || 0,
      name: m[2] || num, set: m[3] || "", id: m[4] || "", offers: {}, best: null, missing: true,
    };
  }
  function setQty(k, q) {
    const d = deck();
    const c = BYKEY.get(k);
    if (q <= 0) { delete d.cards[k]; delete d.meta[k]; }
    else {
      d.cards[k] = q;
      if (c) d.meta[k] = [c.num, c.rar, c.name, c.set, c.id];
    }
    saveDecks();
    renderDeck();
    renderResultsCounts();
    renderModal();
  }
  const copiesOfBase = (base) => {
    let n = 0;
    for (const [k, q] of Object.entries(deck().cards)) if (baseOf(k.split("|")[0]) === base) n += q;
    return n;
  };

  /* ======================= 找卡 ======================= */
  let filtered = [];
  const selectedColors = new Set();
  function renderColorChips() {
    const box = $("#fColors");
    box.textContent = "";
    const has = CARDS.some((c) => c.color);
    box.append(el("span", { class: "cc-label", text: "顏色" }));
    for (const c of COLOR_LIST) {
      box.append(el("button", {
        class: "cc" + (selectedColors.has(c.key) ? " on" : ""), style: `--cc: ${c.hex}`, type: "button",
        "aria-pressed": selectedColors.has(c.key) ? "true" : "false", disabled: !has || null,
        title: has ? `只看${c.label}色（可以多選）` : "還沒匯入卡片顏色",
        onclick: () => {
          selectedColors.has(c.key) ? selectedColors.delete(c.key) : selectedColors.add(c.key);
          renderColorChips();
          runSearch();
        },
      }, c.label));
    }
    if (!has) box.append(el("span", { class: "cc-hint", text: "（要先到「匯入・設定」匯入卡片顏色）" }));
    else if (selectedColors.size) box.append(el("button", { class: "cc-clear", type: "button", onclick: () => { selectedColors.clear(); renderColorChips(); runSearch(); } }, "清除"));
  }
  const colorDot = (c) => (c.color ? el("span", { class: "cdot", style: `--cc: ${COLOR_INFO[c.color].hex}`, title: COLOR_INFO[c.color].label + "色" }) : null);
  let SETNAMES = {};
  let shown = 0;

  function fillFilters() {
    const fSet = $("#fSet");
    fSet.length = 1;
    for (const [code, name] of Object.entries(allSets())) fSet.append(el("option", { value: code, text: name }));
    const rars = [...new Set(CARDS.map((c) => c.rar).filter(Boolean))].sort((a, b) =>
      a.replace(/[★☆]/g, "") === b.replace(/[★☆]/g, "") ? starsOf(a) - starsOf(b) : a < b ? -1 : 1);
    const fRar = $("#fRar");
    fRar.length = 1;
    for (const r of rars) fRar.append(el("option", { value: r, text: r }));
  }

  function runSearch() {
    SETNAMES = allSets();
    const q = $("#q").value.trim().toLowerCase();
    const terms = q.split(/\s+/).filter(Boolean);
    const set = $("#fSet").value, rar = $("#fRar").value, onlyStock = $("#fStock").checked, sort = $("#fSort").value;
    const colors = selectedColors;
    filtered = CARDS.filter((c) => {
      if (set && c.set !== set) return false;
      if (rar && c.rar !== rar) return false;
      if (onlyStock && !(c.best && c.best.s !== 0)) return false;
      if (colors.size && !colors.has(c.color)) return false;
      for (const t of terms) if (!c.search.includes(t)) return false;
      return true;
    });
    const price = (c) => (c.best ? c.best.p : Infinity);
    if (sort === "low") filtered.sort((a, b) => price(a) - price(b) || numCmp(a, b));
    else if (sort === "high") filtered.sort((a, b) => (b.best ? b.best.p : -1) - (a.best ? a.best.p : -1) || numCmp(a, b));
    else filtered.sort(numCmp);
    shown = 0;
    $("#results").textContent = "";
    $("#resultInfo").textContent = CARDS.length
      ? `找到 ${filtered.length.toLocaleString()} 張` + (filtered.length > PAGE_SIZE ? `，先顯示 ${PAGE_SIZE} 張` : "")
      : "";
    showMore();
  }

  function showMore() {
    const ul = $("#results");
    const next = filtered.slice(shown, shown + PAGE_SIZE);
    for (const c of next) ul.append(cardRow(c));
    shown += next.length;
    $("#more").hidden = shown >= filtered.length;
  }

  function thumbEl(c, cls = "thumb") {
    const list = imgCandidates(c, 160);
    if (!list.length) return el("div", { class: cls + " none", text: "無圖" });
    const img = el("img", { class: cls, alt: "", loading: "lazy", referrerpolicy: "no-referrer", decoding: "async" });
    setImgChain(img, list, () => img.replaceWith(el("div", { class: cls + " none", text: "無圖" })));
    return img;
  }

  /* ---------- 放大視窗 ---------- */
  const SEARCH_URL = {
    yuyu: (q) => `https://yuyu-tei.jp/sell/ua/s/search?search_word=${encodeURIComponent(q)}`,
    hs: (q) => `https://www.hobbystation-single.jp/ua/product/list?match_type=1&search_word=${encodeURIComponent(q)}`,
    dora: (q) => `https://dorasuta.jp/union-arena/product-list?kw=${encodeURIComponent(q)}`,
  };
  let modalKey = null;
  function openCard(k) {
    const c = BYKEY.get(k) || cardFor(k);
    if (!c) return;
    const wasOpen = !!modalKey;
    modalKey = k;
    renderModal();
    $("#cardModal").hidden = false;
    document.body.classList.add("modal-open");
    if (!wasOpen) { try { history.pushState({ uaModal: 1 }, ""); } catch (e) {} }
    setTimeout(() => $("#cmClose").focus(), 30);
  }
  function closeCard(fromHistory) {
    if (!modalKey) return;
    modalKey = null;
    $("#cardModal").hidden = true;
    document.body.classList.remove("modal-open");
    if (!fromHistory && history.state && history.state.uaModal) { try { history.back(); } catch (e) {} }
  }
  function renderModal() {
    if (!modalKey) return;
    const c = BYKEY.get(modalKey) || cardFor(modalKey);
    // 圖
    const box = $("#cmImage");
    box.textContent = "";
    const list = imgCandidates(c, 0);
    if (list.length) {
      const img = el("img", { alt: c.name, referrerpolicy: "no-referrer", decoding: "async" });
      setImgChain(img, list, () => img.replaceWith(el("div", { class: "cm-noimg", text: "無圖" })));
      box.append(img);
    } else box.append(el("div", { class: "cm-noimg", text: "無圖" }));
    // 名稱
    $("#cmName").textContent = c.name;
    const meta = $("#cmMeta");
    meta.textContent = "";
    meta.append(
      c.color ? el("span", { class: "cm-color", style: `--cc: ${COLOR_INFO[c.color].hex}`, text: COLOR_INFO[c.color].label + "色" }) : "",
      c.rar ? el("span", { class: "rar", text: c.rar }) : "", c.num, SETNAMES[c.set] ? el("span", { class: "cm-set", text: SETNAMES[c.set] }) : "");
    // 三家價格（由上到下）
    const shops = $("#cmShops");
    shops.textContent = "";
    for (const shop of Object.keys(SHOPS)) {
      const o = c.offers[shop];
      const isBest = o && c.best === o && o.s !== 0;
      const stockTxt = !o ? "" : o.s === 0 ? "售完" : o.s > 0 && o.s < 99 ? `剩 ${o.s} 張` : o.s === 99 ? "有庫存" : "";
      const when = o && o.t ? `${new Date(o.t).toLocaleDateString()} 匯入` + (ageText(o.t) ? "・舊" : "") : "";
      const link = o && o.url
        ? el("a", { class: "btn small cm-go", href: o.url, target: "_blank", rel: "noopener" }, `前往${SHOPS[shop].short} ↗`)
        : el("a", { class: "btn small ghost cm-go", href: SEARCH_URL[shop](c.base), target: "_blank", rel: "noopener" }, `在${SHOPS[shop].short}搜尋 ↗`);
      shops.append(el("div", { class: `cm-shop ${shop}${isBest ? " best" : ""}${o && o.s === 0 ? " sold" : ""}${o ? "" : " none"}` },
        el("div", { class: "cm-shop-head" },
          el("span", { class: "cm-shop-name", text: SHOPS[shop].name }),
          isBest ? el("span", { class: "cm-best", text: "最便宜" }) : null),
        el("div", { class: "cm-price", text: o ? yen(o.p) : "沒有資料" }),
        el("div", { class: "cm-stock" }, stockTxt, stockTxt && when ? " ・ " : "", when),
        link));
    }
    // 卡組
    const q = deck().cards[c.k] || 0;
    const full = !isAP(c.num) && copiesOfBase(c.base) >= MAX_COPIES;
    const dk = $("#cmDeck");
    dk.textContent = "";
    dk.append(
      el("span", { class: "cm-deck-label", text: `「${deck().name}」裡有` }),
      el("div", { class: "qty" },
        el("button", { class: "icon-btn", "aria-label": "減少", disabled: !q || null, onclick: () => setQty(c.k, q - 1) }, "−"),
        el("span", { text: q }),
        el("button", { class: "icon-btn add", "aria-label": "增加", disabled: full || null, title: full ? `同卡號最多 ${MAX_COPIES} 張` : "", onclick: () => setQty(c.k, q + 1) }, "＋")));
  }

  function ageText(t) {
    if (!t) return "";
    const d = Math.floor((Date.now() - t) / 86400000);
    return d >= OLD_DAYS ? `${d}天前` : "";
  }

  function offersEl(c) {
    const wrap = el("div", { class: "offers" });
    for (const shop of Object.keys(SHOPS)) {
      const o = c.offers[shop];
      if (!o) continue;
      const isBest = c.best && c.best === o && o.s !== 0;
      const old = ageText(o.t);
      const stockTxt = o.s === 0 ? "售完" : o.s > 0 && o.s < 99 ? `剩${o.s}` : "";
      wrap.append(el("a", {
        class: `offer ${shop}${isBest ? " best" : ""}${o.s === 0 ? " sold" : ""}`,
        href: o.url || "#", target: "_blank", rel: "noopener",
        title: `${SHOPS[shop].name}${o.t ? "（匯入於 " + new Date(o.t).toLocaleDateString() + "）" : ""}`,
      }, SHOPS[shop].short, " ", el("b", { text: yen(o.p) }), stockTxt ? " " + stockTxt : "", old ? el("span", { class: "old", text: " 舊" }) : null));
    }
    if (!wrap.childNodes.length) wrap.append(el("span", { class: "c-meta", text: "目前沒有價格" }));
    return wrap;
  }

  function cardRow(c) {
    const inDeck = deck().cards[c.k] || 0;
    const full = copiesOfBase(c.base) >= MAX_COPIES && !isAP(c.num);
    return el("li", { class: "card-row", "data-k": c.k, tabindex: "0", title: "點一下看大圖和三家價格" },
      thumbEl(c),
      el("div", {},
        el("div", { class: "c-name", text: c.name }),
        el("div", { class: "c-meta" }, colorDot(c), c.rar ? el("span", { class: "rar", text: c.rar }) : null, c.num, SETNAMES[c.set] ? " · " + SETNAMES[c.set] : ""),
        offersEl(c)),
      el("div", { class: "add-col" },
        el("button", {
          class: "icon-btn add", "aria-label": "加入卡組", disabled: full || null,
          title: full ? `同卡號最多 ${MAX_COPIES} 張` : "加入卡組",
          onclick: () => setQty(c.k, (deck().cards[c.k] || 0) + 1),
        }, "＋"),
        el("span", { class: "in-deck", text: inDeck ? `×${inDeck}` : "" })));
  }

  function renderResultsCounts() {
    document.querySelectorAll("#results .card-row").forEach((row) => {
      const k = row.dataset.k;
      const c = BYKEY.get(k);
      if (!c) return;
      const q = deck().cards[k] || 0;
      row.querySelector(".in-deck").textContent = q ? `×${q}` : "";
      const full = copiesOfBase(c.base) >= MAX_COPIES && !isAP(c.num);
      row.querySelector(".icon-btn.add").disabled = full;
    });
  }

  /* ======================= 卡組畫面 ======================= */
  function deckEntries() {
    return Object.entries(deck().cards).map(([k, q]) => ({ c: cardFor(k), q })).sort((a, b) => {
      const ap = isAP(a.c.num) - isAP(b.c.num);
      return ap || numCmp(a.c, b.c);
    });
  }

  function analyze(entries) {
    let main = 0, ap = 0;
    const perBase = {}, titles = new Set();
    for (const { c, q } of entries) {
      if (isAP(c.num)) { ap += q; continue; }
      main += q;
      perBase[c.base] = (perBase[c.base] || 0) + q;
      titles.add(c.title);
    }
    const over = Object.entries(perBase).filter(([, n]) => n > MAX_COPIES);
    let best = 0, noPrice = 0, short = 0;
    const shopTotals = {};
    for (const s of Object.keys(SHOPS)) shopTotals[s] = { sum: 0, miss: 0 };
    for (const { c, q } of entries) {
      if (c.best) {
        best += c.best.p * q;
        if (c.best.s === 0 || (c.best.s > 0 && c.best.s < 99 && c.best.s < q)) short++;
      } else noPrice++;
      for (const s of Object.keys(SHOPS)) {
        const o = c.offers[s];
        if (o && o.s !== 0) shopTotals[s].sum += o.p * q;
        else shopTotals[s].miss += 1;
      }
    }
    return { main, ap, over, titles: [...titles], best, noPrice, short, shopTotals };
  }

  function renderDeck() {
    const sel = $("#deckSelect");
    sel.textContent = "";
    for (const d of decks) sel.append(el("option", { value: d.id, text: d.name, selected: d.id === currentId || null }));

    const entries = deckEntries();
    const a = analyze(entries);
    $("#deckBadge").textContent = a.main + a.ap;

    // 規則檢查
    const rules = $("#rules");
    rules.textContent = "";
    const rule = (cls, big, label, small) => rules.append(el("div", { class: "rule " + cls }, el("b", { text: big }), label, small ? el("small", { text: small }) : null));
    rule(a.main === DECK_SIZE ? "ok" : a.main > DECK_SIZE ? "bad" : "warn", `${a.main} / ${DECK_SIZE}`, "主卡組張數",
      a.main === DECK_SIZE ? "剛好 50 張" : a.main > DECK_SIZE ? `多了 ${a.main - DECK_SIZE} 張` : `還差 ${DECK_SIZE - a.main} 張`);
    rule(a.over.length ? "bad" : "ok", a.over.length ? `${a.over.length} 個超過` : "OK", `同卡號最多 ${MAX_COPIES} 張`,
      a.over.length ? a.over.map(([b, n]) => `${b}×${n}`).join("、") : "");
    rule(a.titles.length > 1 ? "bad" : "ok", a.titles.length > 1 ? a.titles.join(" + ") : a.titles[0] || "—", "作品",
      a.titles.length > 1 ? "卡組只能用同一個作品的卡" : "");
    rule("", String(a.ap), "AP 卡", "不算在 50 張內");

    // 價格
    const tot = $("#totals");
    tot.textContent = "";
    tot.append(
      el("div", { class: "lbl", text: "每張挑最便宜的店，湊齊整副約" }),
      el("div", { class: "big", text: yen(a.best) }),
      el("div", { class: "shops" }, Object.entries(SHOPS).map(([s, info]) =>
        el("div", { class: "shop" }, info.short,
          el("b", { text: a.shopTotals[s].sum ? yen(a.shopTotals[s].sum) : "—" }),
          a.shopTotals[s].miss && entries.length ? el("span", { class: "miss", text: `缺 ${a.shopTotals[s].miss} 種` }) : "整副買得到"))),
    );
    const warns = [];
    if (a.noPrice) warns.push(`${a.noPrice} 種卡目前沒有任何價格`);
    if (a.short) warns.push(`${a.short} 種卡最便宜的那家售完或庫存不足`);
    if (warns.length) tot.append(el("div", { class: "warnline", text: "⚠ " + warns.join("；") }));
    tot.hidden = !entries.length;

    // 清單
    const ul = $("#deckList");
    ul.textContent = "";
    let lastGroup = null;
    for (const { c, q } of entries) {
      const g = isAP(c.num) ? "AP 卡" : "主卡組";
      if (g !== lastGroup && entries.some((e) => isAP(e.c.num))) { ul.append(el("li", { class: "group-title", text: g })); lastGroup = g; }
      const b = c.best;
      const stockShort = b && (b.s === 0 || (b.s > 0 && b.s < 99 && b.s < q));
      ul.append(el("li", { class: "card-row", "data-k": c.k, tabindex: "0" },
        thumbEl(c),
        el("div", {},
          el("div", { class: "c-name", text: c.name }),
          el("div", { class: "c-meta" }, colorDot(c), c.rar ? el("span", { class: "rar", text: c.rar }) : null, c.num),
          el("div", { class: "sub" },
            b ? [`最便宜：${SHOPS[b.shop].short} ${yen(b.p)} × ${q} = `, el("b", { text: yen(b.p * q) })] : "目前沒有價格",
            stockShort ? el("span", { class: "short", text: b.s === 0 ? "（售完）" : `（只剩 ${b.s} 張）` }) : null),
          offersEl(c)),
        el("div", { class: "qty" },
          el("button", { class: "icon-btn", "aria-label": "減少", onclick: () => setQty(c.k, q - 1) }, "−"),
          el("span", { text: q }),
          el("button", {
            class: "icon-btn", "aria-label": "增加",
            disabled: (!isAP(c.num) && copiesOfBase(c.base) >= MAX_COPIES) || null,
            onclick: () => setQty(c.k, q + 1),
          }, "＋"))));
    }
    $("#deckEmpty").hidden = entries.length > 0;
  }

  /* 全部換成最便宜版本（同卡號不同稀有度中挑最便宜且有庫存的） */
  function swapToCheapest() {
    const d = deck();
    const byBase = {};
    for (const c of CARDS) if (c.best) (byBase[c.base] = byBase[c.base] || []).push(c);
    let changed = 0;
    const next = {};
    for (const [k, q] of Object.entries(d.cards)) {
      const c = cardFor(k);
      const cands = (byBase[c.base] || []).filter((x) => isAP(x.num) === isAP(c.num));
      const stocked = cands.filter((x) => x.best.s !== 0);
      const pool = stocked.length ? stocked : cands;
      const cheapest = pool.reduce((a, b) => (!a || b.best.p < a.best.p ? b : a), null);
      const target = cheapest && (!c.best || cheapest.best.p < c.best.p) ? cheapest : c;
      if (target.k !== k) changed++;
      next[target.k] = (next[target.k] || 0) + q;
      if (BYKEY.get(target.k)) d.meta[target.k] = [target.num, target.rar, target.name, target.set, target.id];
    }
    d.cards = next;
    for (const k of Object.keys(d.meta)) if (!next[k]) delete d.meta[k];
    saveDecks();
    renderDeck();
    renderResultsCounts();
    toast(changed ? `已換掉 ${changed} 種卡` : "已經是最便宜的版本了");
  }

  /* ======================= 匯出 ======================= */
  function deckText() {
    const entries = deckEntries();
    const a = analyze(entries);
    const lines = [`【${deck().name}】主卡組 ${a.main} 張${a.ap ? `／AP ${a.ap} 張` : ""}`];
    for (const { c, q } of entries) {
      const b = c.best;
      lines.push(`${c.num} ${c.name}${c.rar ? " " + c.rar : ""} ×${q}` + (b ? `　${SHOPS[b.shop].short} ${yen(b.p)}` : "　無價格"));
    }
    lines.push(`合計（每張挑最便宜）：${yen(a.best)}`);
    return lines.join("\n");
  }

  async function copyText(text, okMsg) {
    try { await navigator.clipboard.writeText(text); toast(okMsg); }
    catch (e) { await ask("請手動複製下面的內容：", text); }
  }

  function encodeDeck() {
    const d = deck();
    const json = JSON.stringify({ n: d.name, c: Object.entries(d.cards) });
    return "UA1:" + btoa(unescape(encodeURIComponent(json))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function decodeDeck(code) {
    const m = code.trim().match(/UA1:([A-Za-z0-9_-]+)/);
    if (!m) throw new Error("bad");
    let b64 = m[1].replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    const obj = JSON.parse(decodeURIComponent(escape(atob(b64))));
    if (!obj || !Array.isArray(obj.c)) throw new Error("bad");
    return obj;
  }

  function loadImage(src) {
    return new Promise((resolve) => {
      if (!src) return resolve(null);
      const img = new Image();
      img.crossOrigin = "anonymous";
      const timer = setTimeout(() => resolve(null), 8000);
      img.onload = () => { clearTimeout(timer); resolve(img); };
      img.onerror = () => { clearTimeout(timer); resolve(null); };
      img.src = src;
    });
  }

  // 新分頁裡顯示的頁面（標題、圖片、下載按鈕）
  const escHtml = (t) => String(t).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
  function imagePageHtml(title, body) {
    return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escHtml(title)}</title><style>
html,body{margin:0;min-height:100%;background:#050822;color:#b9c4ec;font:14px/1.6 system-ui,-apple-system,"PingFang TC","Microsoft JhengHei",sans-serif}
main{min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:16px;box-sizing:border-box}
img{display:block;max-width:100%;max-height:calc(100vh - 110px);height:auto;border-radius:10px;box-shadow:0 0 0 1px #7fb3e8,0 0 30px rgba(91,108,242,.45)}
a{display:inline-block;padding:9px 18px;border-radius:10px;background:linear-gradient(160deg,#ff7a3d,#e5262c);color:#fff;font-weight:700;text-decoration:none}
p{margin:0;font-size:12px;color:#8593c7}
</style></head><body><main>${body}</main></body></html>`;
  }

  async function exportImage() {
    const entries = deckEntries();
    if (!entries.length) return toast("卡組是空的");
    // 先開好新分頁（要在按下的當下開，瀏覽器才不會擋），圖片產生好再放進去
    let win = null;
    try { win = window.open("", "_blank"); } catch (e) { win = null; }
    if (win) {
      try {
        win.document.open();
        win.document.write(imagePageHtml(deck().name, "<p>產生圖片中…</p>"));
        win.document.close();
      } catch (e) { win = null; }
    }
    toast("產生圖片中…", 8000);
    const a = analyze(entries);
    // 手機螢幕窄，一排 5 張圖才不會太小；電腦一排最多 10 張
    const maxCols = window.innerWidth < 700 ? 5 : 10;
    const cols = Math.min(maxCols, Math.max(Math.min(5, maxCols), entries.length));
    const W = 100, H = 140, G = 8, PAD = 20, HEAD = 70, FOOT = 50;
    const rows = Math.ceil(entries.length / cols);
    const cw = PAD * 2 + cols * W + (cols - 1) * G;
    const ch = HEAD + rows * (H + G) - G + FOOT + PAD;
    // 縮圖服務允許跨網站讀取，畫進圖片裡才不會出錯
    const loadFirst = async (c) => {
      for (const u of officialList(c)) { const im = await loadImage(thumbOf(u, 300)); if (im) return im; }
      return null;
    };
    const imgs = await Promise.all(entries.map((e) => loadFirst(e.c)));

    const draw = (withImages) => {
      const cv = document.createElement("canvas");
      cv.width = cw * 2; cv.height = ch * 2;
      const g = cv.getContext("2d");
      g.scale(2, 2);
      g.fillStyle = "#0a1036"; g.fillRect(0, 0, cw, ch);
      g.strokeStyle = "#7fb3e8"; g.lineWidth = 4; g.strokeRect(2, 2, cw - 4, ch - 4);
      g.fillStyle = "#ffffff"; g.font = "bold 22px sans-serif"; g.textBaseline = "top";
      g.fillText(deck().name, PAD, 18);
      g.fillStyle = "#b9c4ec"; g.font = "14px sans-serif";
      g.fillText(`主卡組 ${a.main} 張${a.ap ? `　AP ${a.ap} 張` : ""}`, PAD, 46);
      entries.forEach((e, i) => {
        const x = PAD + (i % cols) * (W + G), y = HEAD + Math.floor(i / cols) * (H + G);
        const im = withImages ? imgs[i] : null;
        if (im) g.drawImage(im, x, y, W, H);
        else {
          g.fillStyle = "#142060"; g.fillRect(x, y, W, H);
          g.fillStyle = "#ecebf1"; g.font = "bold 12px sans-serif";
          wrapText(g, e.c.name, x + 6, y + 8, W - 12, 15, 5);
          g.fillStyle = "#a9a6b4"; g.font = "10px sans-serif";
          g.fillText(e.c.base, x + 6, y + H - 30);
          g.fillText(e.c.rar || "", x + 6, y + H - 17);
        }
        g.fillStyle = "#f04b26";
        g.beginPath(); g.arc(x + W - 14, y + H - 14, 13, 0, Math.PI * 2); g.fill();
        g.fillStyle = "#fff"; g.font = "bold 14px sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
        g.fillText(String(e.q), x + W - 14, y + H - 13);
        g.textAlign = "left"; g.textBaseline = "top";
      });
      g.fillStyle = "#ffffff"; g.font = "bold 18px sans-serif";
      g.fillText(`合計約 ${yen(a.best)}（每張挑最便宜的店）`, PAD, ch - FOOT);
      g.fillStyle = "#7f7c8a"; g.font = "12px sans-serif";
      g.fillText(new Date().toLocaleDateString(), PAD, ch - FOOT + 26);
      return cv;
    };

    let cv = draw(true);
    let blob;
    try { blob = await new Promise((r) => cv.toBlob(r, "image/png")); }
    catch (e) { cv = draw(false); blob = await new Promise((r) => cv.toBlob(r, "image/png")); }
    if (!blob) {
      if (win) win.close();
      return toast("圖片產生失敗");
    }
    const fileName = `${deck().name}.png`;
    // 新分頁：整頁只顯示這張圖，下面附下載按鈕
    if (win && !win.closed) {
      const dataUrl = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
      try {
        win.document.open();
        win.document.write(imagePageHtml(deck().name,
          `<img src="${dataUrl}" alt="${escHtml(deck().name)}"><a href="${dataUrl}" download="${escHtml(fileName)}">下載圖片</a><p>手機可以直接長按圖片儲存</p>`));
        win.document.close();
        toast("已在新分頁開啟圖片");
        return;
      } catch (e) { /* 寫不進去就改成直接下載 */ }
    }
    // 瀏覽器擋了新分頁：改成直接下載
    const url = URL.createObjectURL(blob);
    const link = el("a", { href: url, download: fileName });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    toast("瀏覽器擋了新分頁，已改成直接下載");
  }
  function wrapText(g, text, x, y, maxW, lh, maxLines) {
    let line = "", n = 0;
    for (const ch of text) {
      if (g.measureText(line + ch).width > maxW) {
        g.fillText(line, x, y + n * lh); line = ch; n++;
        if (n >= maxLines) return;
      } else line += ch;
    }
    if (line) g.fillText(line, x, y + n * lh);
  }

  /* ======================= 匯入（書籤） ======================= */
  function mergeColors(items) {
    const now = Date.now();
    const box = (imports.colors = imports.colors || { items: {} });
    let count = 0;
    for (const it of items) {
      if (!Array.isArray(it) || !NUM_RE.test(String(it[0])) || !COLOR_INFO[it[1]]) continue;
      box.items[it[0]] = [it[1], now];
      count++;
    }
    box.t = now;
    saveImports("colors");
    return count;
  }
  function mergeImport(shop, items, sets) {
    if (shop === "colors") return mergeColors(items);
    const now = Date.now();
    const box = (imports[shop] = imports[shop] || { items: {} });
    if (shop === "yuyu" && sets && typeof sets === "object") {
      box.sets = box.sets || {};
      for (const [code, name] of Object.entries(sets)) {
        if (/^[a-z0-9]{2,12}$/.test(code)) box.sets[code] = String(name).slice(0, 60);
      }
    }
    let count = 0;
    for (const it of items) {
      if (!Array.isArray(it) || it.length < 5) continue;
      const [num, stars, name, price, stock, url] = it;
      if (!/^[A-Z0-9]+\/[A-Z0-9]+-\d+-(AP)?\d+$/.test(String(num)) || !(price > 0)) continue;
      const k = keyOf(num, +stars || 0);
      const prev = box.items[k];
      // 同一批資料裡同版本出現多次時，保留有庫存且較便宜的
      if (prev && prev[4] === now) {
        const better = (stock !== 0 && prev[1] === 0) || ((stock !== 0) === (prev[1] !== 0) && price < prev[0]);
        if (!better) continue;
      }
      // 網址只存路徑部分（省空間），而且只接受該店自己的網址
      let path = "";
      try {
        const u = new URL(url);
        if (u.origin === SHOP_BASE[shop]) path = u.pathname + u.search;
      } catch (e) {}
      const row = [price, stock, path, String(name || "").slice(0, 80), now];
      if (shop === "yuyu") {
        const [, , , , , , rar, set, id] = it; // it[9]：遊々亭沒有圖
        const okSet = /^[a-z0-9]{2,12}$/.test(set || "") && /^\d{1,8}$/.test(id || "");
        if (okSet && path === `/sell/ua/card/${set}/${id}`) row[2] = ""; // 可以從系列代碼和編號還原
        row.push(String(rar || "").slice(0, 12), okSet ? set : "", okSet ? id : "", it[9] ? 1 : 0);
      }
      box.items[k] = row;
      count++;
    }
    box.t = now;
    saveImports(shop);
    return count;
  }

  /* 書籤送來的資料：一律接收（不管網址有沒有 #import），分批確認、最後一批完成後同步到 GitHub */
  const seenBatches = new Set();
  const importCounts = {}; // 每家這一輪匯入了幾筆（三家可以同時進行）
  let refreshTimer, overlayTimer;
  function showImportOverlay(text, spinning = true) {
    $("#importOverlay").hidden = false;
    $("#importOverlay .spinner").style.visibility = spinning ? "visible" : "hidden";
    $("#importMsg").textContent = text;
    clearTimeout(overlayTimer);
  }
  function hideImportOverlay(ms) {
    clearTimeout(overlayTimer);
    overlayTimer = setTimeout(() => { $("#importOverlay").hidden = true; }, ms);
  }
  function clearHash() {
    if (location.hash) history.replaceState(null, "", location.pathname + location.search);
  }

  async function onImportMessage(e) {
    const shop = SHOP_ORIGINS[e.origin];
    const d = e.data;
    if (!shop || !d || d.type !== "ua-import" || d.shop !== shop || typeof d.batch !== "string") return;
    const reply = (m) => { try { e.source && e.source.postMessage(m, e.origin); } catch (err) {} };
    await importsReady; // 確保先載入舊資料再合併
    if (seenBatches.has(d.batch)) return reply({ type: "ua-done", batch: d.batch });
    seenBatches.add(d.batch);
    const n = mergeImport(shop, Array.isArray(d.items) ? d.items : [], d.sets);
    importCounts[shop] = (importCounts[shop] || 0) + n;
    reply({ type: "ua-done", batch: d.batch, count: n });
    clearHash();

    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refreshAll, 400);

    if (!d.final) {
      const lines = Object.entries(importCounts).map(([s, c]) => `${SOURCE_NAME(s)}：已匯入 ${c.toLocaleString()} 筆`);
      showImportOverlay(`正在接收資料…\n${lines.join("\n")}`);
      return;
    }
    const total = importCounts[shop] || 0;
    delete importCounts[shop];
    switchView("settings");
    let msg = `已從 ${SOURCE_NAME(shop)} 匯入 ${total.toLocaleString()} 筆${shop === "colors" ? "卡片顏色" : "價格"}`;
    if (gh && gh.token) {
      showImportOverlay(msg + "\n同步到 GitHub 中…");
      const r = await syncToGitHub();
      msg += "\n" + r.msg;
      reply({ type: "ua-synced", ok: r.ok, msg: r.msg });
    } else {
      msg += "\n（尚未設定 GitHub 同步，資料只存在這台電腦）";
      reply({ type: "ua-synced", ok: false, msg: "尚未設定 GitHub 同步，資料只存在這台電腦" });
    }
    showImportOverlay(msg, false);
    hideImportOverlay(4000);
    renderSettings();
  }

  function announceReady() {
    if (!window.opener) return;
    for (const o of Object.keys(SHOP_ORIGINS)) { try { window.opener.postMessage({ type: "ua-ready" }, o); } catch (e) {} }
  }
  function startImportMode() {
    showImportOverlay("等待匯入資料…");
    announceReady();
    overlayTimer = setTimeout(() => {
      if ($("#importMsg").textContent.startsWith("等待")) { $("#importOverlay").hidden = true; clearHash(); }
    }, 30000);
  }

  /* ======================= GitHub 同步 ======================= */
  let gh = store.get(LS.gh, null); // { owner, repo, branch, token }

  function guessRepo() {
    const m = location.hostname.match(/^([^.]+)\.github\.io$/i);
    if (!m) return { owner: "", repo: "" };
    const first = location.pathname.split("/").filter(Boolean)[0];
    return { owner: m[1], repo: first && !/\.html?$/.test(first) ? first : `${m[1]}.github.io` };
  }

  async function ghFetch(cfg, path, opts = {}) {
    return fetch(`https://api.github.com/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}${path}`, {
      ...opts,
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(opts.headers || {}),
      },
    });
  }

  function toBase64(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }

  async function testGitHub(cfg) {
    const r = await ghFetch(cfg, "");
    if (r.status === 401) throw new Error("金鑰無效或已過期");
    if (r.status === 404) throw new Error("找不到這個專案，請確認帳號和專案名稱，以及金鑰有選到這個專案");
    if (!r.ok) throw new Error(`GitHub 回應錯誤（${r.status}）`);
    const info = await r.json();
    if (info.permissions && !info.permissions.push) throw new Error("金鑰沒有寫入權限（Contents 要選 Read and write）");
    return info.default_branch || "main";
  }

  // 同步排隊進行：三家同時完成時，一家一家依序同步，不會跳過
  let syncRunning = null;
  async function syncToGitHub(replaceShop) {
    while (syncRunning) { try { await syncRunning; } catch (e) {} }
    syncRunning = doSync(replaceShop);
    try { return await syncRunning; } finally { syncRunning = null; }
  }
  async function doSync(replaceShop) {
    if (!gh || !gh.token) return { ok: false, msg: "尚未設定 GitHub 同步" };
    try {
      // 把同一台電腦其他分頁剛存的資料也一起帶上
      imports = mergeImportSets(imports, await readLocalImports());
      for (let attempt = 1; attempt <= 3; attempt++) {
        // 1. 取得 GitHub 上目前的檔案（sha 用來避免覆蓋別人剛寫入的內容）
        let sha = null, remote = {};
        const ls = await ghFetch(gh, `/contents/data?ref=${encodeURIComponent(gh.branch)}`, { cache: "no-store" });
        if (ls.status === 401) return { ok: false, msg: "GitHub 金鑰無效或已過期，請到「匯入・設定」重新設定" };
        if (ls.ok) {
          const f = (await ls.json()).find((x) => x.name === "imports.json");
          if (f) {
            sha = f.sha;
            const raw = await ghFetch(gh, `/contents/data/imports.json?ref=${encodeURIComponent(gh.branch)}`,
              { headers: { Accept: "application/vnd.github.raw+json" }, cache: "no-store" });
            if (raw.ok) { try { remote = await raw.json(); } catch (e) { remote = {}; } }
          }
        }
        // 2. 合併後寫回
        const merged = mergeImportSets(remote, imports, replaceShop);
        const body = {
          message: `同步匯入價格 ${new Date().toLocaleString("zh-TW", { hour12: false })}`,
          content: toBase64(JSON.stringify(merged)),
          branch: gh.branch,
        };
        if (sha) body.sha = sha;
        const put = await ghFetch(gh, "/contents/data/imports.json", { method: "PUT", body: JSON.stringify(body) });
        if (put.ok) {
          remoteImports = merged;
          return { ok: true, msg: "已同步到 GitHub，手機約 1～2 分鐘後就看得到" };
        }
        if (put.status === 409 || put.status === 422) continue; // 剛好有人同時寫入，重試
        if (put.status === 401) return { ok: false, msg: "GitHub 金鑰無效或已過期，請重新設定" };
        if (put.status === 403 || put.status === 404) return { ok: false, msg: "金鑰沒有這個專案的寫入權限" };
        return { ok: false, msg: `同步失敗（GitHub 回應 ${put.status}）` };
      }
      return { ok: false, msg: "同步失敗，請稍後在「匯入・設定」按「立即同步」" };
    } catch (e) {
      return { ok: false, msg: "連不到 GitHub，請確認網路後按「立即同步」" };
    }
  }

  function renderGitHub() {
    const g = gh || {};
    const guess = guessRepo();
    const editing = ["ghOwner", "ghRepo", "ghToken"].includes(document.activeElement && document.activeElement.id);
    if (!editing) {
      $("#ghOwner").value = g.owner || guess.owner;
      $("#ghRepo").value = g.repo || guess.repo;
    }
    $("#ghToken").placeholder = g.token ? "已儲存（要更換才需要重新貼上）" : "github_pat_ 開頭的金鑰";
    $("#ghState").textContent = g.token ? `✅ 已設定：${g.owner}/${g.repo}（${g.branch}）` : "尚未設定";
    $("#ghSync").hidden = !g.token;
    $("#ghRemove").hidden = !g.token;
  }

  async function saveGitHub() {
    const owner = $("#ghOwner").value.trim(), repo = $("#ghRepo").value.trim();
    const token = $("#ghToken").value.trim() || (gh && gh.token) || "";
    if (!owner || !repo || !token) return toast("請填好帳號、專案名稱和金鑰");
    $("#ghState").textContent = "測試連線中…";
    try {
      const branch = await testGitHub({ owner, repo, token });
      gh = { owner, repo, branch, token };
      store.set(LS.gh, gh);
      $("#ghToken").value = "";
      renderGitHub();
      toast("連線成功，開始同步…");
      const r = await syncToGitHub();
      toast(r.msg, 4000);
    } catch (e) {
      $("#ghState").textContent = "❌ " + e.message;
    }
  }

  async function loadRemoteImports() {
    try {
      const r = await fetch("data/imports.json", { cache: "no-cache" });
      if (r.ok) remoteImports = await r.json();
    } catch (e) { /* 還沒有共用資料 */ }
  }

  /* ======================= 設定畫面 ======================= */
  function renderSettings() {
    const box = $("#shopStatus");
    box.textContent = "";
    const eff = effImports();
    for (const shop of DATA_KEYS) {
      const inf = eff[shop];
      const n = inf ? Object.keys(inf.items || {}).length : 0;
      const canClear = n && (imports[shop] || (gh && gh.token));
      box.append(el("div", { class: "shop-line" + (shop === "colors" ? " colors" : ""), style: `--c: var(--${shop})` },
        el("div", {}, el("span", { class: "nm", text: SOURCE_NAME(shop) }),
          el("small", { text: n ? `${n.toLocaleString()} 筆・最後匯入 ${new Date(inf.t).toLocaleString()}` : "還沒有匯入" })),
        canClear ? el("button", {
          class: "btn small ghost danger", text: "清除",
          onclick: async () => {
            const both = gh && gh.token;
            if (!(await confirmBox(`確定清除 ${SOURCE_NAME(shop)} 的匯入資料？${both ? "（GitHub 上的共用資料也會一起清除）" : ""}`))) return;
            delete imports[shop];
            await saveImports(shop);
            if (both) {
              const r = await syncToGitHub(shop);
              toast(r.ok ? "已清除，手機稍後也會更新" : r.msg, 4000);
            }
            refreshAll();
          },
        }) : el("span")));
    }
    renderGitHub();
  }

  async function setupBookmarklet() {
    const a = $("#bookmarklet");
    try {
      const src = await fetch("importer.js", { cache: "no-cache" }).then((r) => r.text());
      const site = location.origin + location.pathname.replace(/index\.html$/, "");
      a.href = "javascript:" + encodeURIComponent(src.split("__SITE__").join(site));
      a.addEventListener("click", (e) => { e.preventDefault(); toast("請把這個按鈕「拖曳」到書籤列，不要直接點"); });
    } catch (e) {
      a.removeAttribute("href");
      a.textContent = "書籤載入失敗，請重新整理頁面";
    }
  }

  function backup() {
    const data = { app: "ua-price", v: 1, at: new Date().toISOString(), decks, current: currentId, imports };
    const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = el("a", { href: url, download: `UA比價備份_${new Date().toISOString().slice(0, 10)}.json` });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  async function restore(file) {
    try {
      const data = JSON.parse(await file.text());
      if (data.app !== "ua-price") throw new Error("bad");
      if (!(await confirmBox("還原會用備份檔的內容合併目前的卡組與匯入價格，確定嗎？"))) return;
      // 卡組：同 id 以較新的為準
      const map = new Map(decks.map((d) => [d.id, d]));
      for (const d of data.decks || []) {
        const cur = map.get(d.id);
        if (!cur || (d.t || 0) > (cur.t || 0)) map.set(d.id, d);
      }
      decks = [...map.values()];
      // 匯入價格：每筆以較新的為準
      for (const shop of DATA_KEYS) {
        const src = data.imports && data.imports[shop];
        if (!src) continue;
        const ti = shop === "colors" ? 1 : 4;
        const dst = (imports[shop] = imports[shop] || { items: {} });
        for (const [k, it] of Object.entries(src.items || {})) {
          if (!dst.items[k] || (it[ti] || 0) > (dst.items[k][ti] || 0)) dst.items[k] = it;
        }
        dst.t = Math.max(dst.t || 0, src.t || 0);
        if (src.sets) dst.sets = { ...(dst.sets || {}), ...src.sets };
      }
      store.set(LS.decks, decks);
      await saveImports();
      if (!decks.find((d) => d.id === currentId)) currentId = decks[0].id;
      refreshAll();
      toast("還原完成");
    } catch (e) {
      toast("這不是有效的備份檔");
    }
  }

  /* ======================= 畫面切換與事件 ======================= */
  function switchView(v) {
    document.body.className = "view-" + v;
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.view === v));
    window.scrollTo({ top: 0 });
  }

  function refreshAll() {
    buildCards();
    renderColorChips();
    renderStamp();
    renderModal();
    fillFilters();
    runSearch();
    renderDeck();
    renderSettings();
  }

  function bindEvents() {
    document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => switchView(t.dataset.view)));
    let timer;
    $("#q").addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(runSearch, 180); });
    ["#fSet", "#fRar", "#fSort", "#fStock"].forEach((s) => $(s).addEventListener("change", runSearch));
    $("#more").addEventListener("click", showMore);

    $("#deckSelect").addEventListener("change", (e) => {
      currentId = e.target.value;
      store.set(LS.current, currentId);
      renderDeck();
      renderResultsCounts();
    });
    document.querySelector(".deck-actions").addEventListener("click", async (e) => {
      const act = e.target.dataset.act;
      if (!act) return;
      if (act === "new") {
        const name = await ask("新卡組的名稱", `卡組 ${decks.length + 1}`);
        if (!name) return;
        const d = newDeck(name);
        decks.push(d);
        currentId = d.id;
      } else if (act === "rename") {
        const name = await ask("卡組名稱", deck().name);
        if (!name) return;
        deck().name = name;
      } else if (act === "copy") {
        const src = deck();
        const d = newDeck(src.name + "（複製）");
        d.cards = { ...src.cards };
        d.meta = { ...src.meta };
        decks.push(d);
        currentId = d.id;
      } else if (act === "delete") {
        if (!(await confirmBox(`確定刪除「${deck().name}」？`))) return;
        decks = decks.filter((d) => d.id !== currentId);
        if (!decks.length) decks.push(newDeck("我的卡組"));
        currentId = decks[0].id;
      }
      saveDecks();
      renderDeck();
      renderResultsCounts();
    });
    $("#btnCheapest").addEventListener("click", swapToCheapest);
    $("#btnClear").addEventListener("click", async () => {
      if (!Object.keys(deck().cards).length) return;
      if (!(await confirmBox(`確定清空「${deck().name}」的所有卡片？`))) return;
      deck().cards = {};
      deck().meta = {};
      saveDecks();
      renderDeck();
      renderResultsCounts();
    });
    $("#btnText").addEventListener("click", () => {
      if (!Object.keys(deck().cards).length) return toast("卡組是空的");
      copyText(deckText(), "已複製卡組清單");
    });
    $("#btnImage").addEventListener("click", exportImage);
    $("#btnCode").addEventListener("click", () => {
      if (!Object.keys(deck().cards).length) return toast("卡組是空的");
      copyText(encodeDeck(), "已複製卡組代碼");
    });
    $("#btnLoadCode").addEventListener("click", async () => {
      const code = await ask("貼上卡組代碼（UA1: 開頭）");
      if (!code) return;
      try {
        const obj = decodeDeck(code);
        const d = newDeck(obj.n || "匯入的卡組");
        for (const [k, q] of obj.c) {
          if (typeof k !== "string" || !(q > 0)) continue;
          d.cards[k] = Math.min(+q, 99);
          const c = BYKEY.get(k);
          if (c) d.meta[k] = [c.num, c.rar, c.name, c.set, c.id];
        }
        decks.push(d);
        currentId = d.id;
        saveDecks();
        renderDeck();
        renderResultsCounts();
        toast(`已匯入「${d.name}」`);
      } catch (e) {
        toast("代碼格式不正確");
      }
    });
    // 點卡片 → 放大視窗（點到按鈕、連結時不算）
    const onRowClick = (e) => {
      if (e.target.closest("button, a, input, select")) return;
      const row = e.target.closest(".card-row[data-k]");
      if (row) openCard(row.dataset.k);
    };
    const onRowKey = (e) => {
      if (e.key !== "Enter" || e.target.closest("button, a")) return;
      const row = e.target.closest(".card-row[data-k]");
      if (row) openCard(row.dataset.k);
    };
    ["#results", "#deckList"].forEach((s) => { $(s).addEventListener("click", onRowClick); $(s).addEventListener("keydown", onRowKey); });
    $("#cmClose").addEventListener("click", () => closeCard());
    $("#cardModal").addEventListener("click", (e) => { if (e.target.id === "cardModal") closeCard(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && modalKey) closeCard(); });
    window.addEventListener("popstate", () => { if (modalKey) closeCard(true); });
    $("#ghSave").addEventListener("click", saveGitHub);
    $("#ghSync").addEventListener("click", async () => {
      $("#ghState").textContent = "同步中…";
      const r = await syncToGitHub();
      renderGitHub();
      toast(r.msg, 4000);
    });
    $("#ghRemove").addEventListener("click", async () => {
      if (!(await confirmBox("確定移除這台電腦上的 GitHub 金鑰？（已同步的價格不會被刪除）"))) return;
      gh = null;
      localStorage.removeItem(LS.gh);
      renderGitHub();
    });
    $("#btnBackup").addEventListener("click", backup);
    $("#restoreFile").addEventListener("change", (e) => {
      const f = e.target.files[0];
      if (f) restore(f);
      e.target.value = "";
    });
    if (channel) {
      let t;
      channel.onmessage = (e) => {
        if (!e.data || e.data.type !== "imports-changed") return;
        clearTimeout(t);
        const cleared = e.data.cleared || [];
        for (const shop of cleared) delete imports[shop];
        t = setTimeout(async () => {
          // 用「合併」而不是「取代」，這個分頁正在接收的資料才不會被舊版本蓋掉
          imports = mergeImportSets(imports, await readLocalImports());
          refreshAll();
        }, 500);
      };
    }
    // 其他分頁修改了資料時同步
    window.addEventListener("storage", (e) => {
      if (!Object.values(LS).includes(e.key)) return;
      decks = store.get(LS.decks, decks);
      if (!decks.find((d) => d.id === currentId)) currentId = decks[0].id;
      refreshAll();
    });
  }

  /* ======================= 啟動 ======================= */
  let importsReady = Promise.resolve();
  async function init() {
    importsReady = loadLocalImports();
    bindEvents();
    renderDeck();
    setupBookmarklet();
    window.addEventListener("message", onImportMessage);
    window.addEventListener("hashchange", () => { if (location.hash === "#import") startImportMode(); });
    if (location.hash === "#import") startImportMode();
    await Promise.all([importsReady, loadRemoteImports()]);
    try {
      // 舊的伺服器抓價資料（目前遊々亭擋伺服器連線，通常是空的）
      const r = await fetch("data/cards.json", { cache: "no-cache" });
      if (r.ok) DATA = await r.json();
    } catch (e) { /* 沒有也沒關係 */ }
    DATA.sets = DATA.sets || {};
    refreshAll();
  }

  function renderStamp() {
    const eff = effImports();
    const times = IMPORT_SHOPS.map((s) => (eff[s] && eff[s].t) || 0);
    if (DATA.updated) times.push(new Date(DATA.updated).getTime());
    const latest = Math.max(...times);
    const fmt = (t) => new Date(t).toLocaleString([], { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
    $("#dataStamp").textContent = latest ? `價格最後更新 ${fmt(latest)}` : "還沒有價格資料";
    const empty = !CARDS.length;
    $("#notice").hidden = !empty;
    if (empty) $("#notice").textContent = "還沒有價格資料。請用電腦到「匯入・設定」分頁設定書籤，先從遊々亭匯入（卡片清單和卡圖也會一起匯入）。";
  }

  init();
})();
