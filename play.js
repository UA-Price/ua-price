/* 查價之境 — 練習對戰桌（第 2 版：玩家 A、B 輪流，一個人操作兩邊，卡片效果自己處理）
   規則依官方規則說明書 Ver1.1：
   - 起手 7 張，可換手牌 1 次（手牌先放旁邊 → 再抽 7 張 → 放旁邊的放回卡組洗牌），由先攻玩家先決定
   - 生命區 7 張（背面朝上）
   - 前線最多 4 張角色；能源線最多合計 4 張角色＋場域；已滿還要放時，先把場上的卡放到移除區
   - AP 卡：先攻 1/2/3 張、後攻 2/2/3 張（自己的第 1/2/3 回合以後）
   - 起始階段：休息的卡全部置為活動 → 放 AP 卡 → 抽 1 張（先攻第 1 回合不抽）→ 可付 1AP 額外抽卡（每回合 1 次）
   - 結束階段：場上休息的角色、場域置為活動（AP 卡不會）；手牌 9 張以上時放到移除區剩 8 張
   - 勝利：對手生命區 0 張；或對手卡組 0 張且起始階段無法抽卡 */
(() => {
  "use strict";
  const UA = window.UA;
  if (!UA) return;
  const { el, $, toast } = UA;

  const PHASES = ["起始", "移動", "主要", "攻擊", "結束"];
  const PHASE_HINT = [
    "已自動：休息的卡置為活動、放置 AP 卡、抽 1 張。這個階段只能付 1AP 額外抽卡（每回合 1 次）。",
    "這個階段只能移動角色：把能源線的角色拖到前線（有ステップ才能從前線移回能源線）。",
    "把手牌拖到前線或能源線登場；拖到場上的角色上＝突襲；拖到場外＝使用事件。也可以點卡片用選單操作。",
    "點前線活動的角色 →「攻擊」。接著會自動問對手要不要防禦；沒防禦就直接跳出生命區讓你選要翻哪幾張。",
    "已自動把場上休息的角色、場域置為活動（AP 卡不會）。這個階段只能把超過 8 張的手牌放到移除區。",
  ];
  const AP_TABLE = { first: [1, 2, 3], second: [2, 2, 3] };
  const SLOTS = 4;
  const PN = ["A", "B"];
  const LINE_NAME = { front: "前線", energy: "能源線" };
  const PILE_NAME = { hand: "手牌", outside: "場外", remove: "移除區", deck: "牌庫", life: "生命區", reveal: "觸發確認區" };

  let S = null;          // 牌局狀態
  let CARDS = {};        // uid → 卡片資料（uid 開頭 a / b 代表玩家 A / B）
  let undoStack = [];
  let open = false;
  const sideOpen = [false, false]; // 手機上資訊欄有沒有展開

  /* ---------- 小工具 ---------- */
  const card = (uid) => CARDS[uid];
  const nameOf = (uid) => (card(uid) ? card(uid).name : "?");
  const ownerIdx = (uid) => (String(uid)[0] === "b" ? 1 : 0);
  const PL = (uid) => S.players[ownerIdx(uid)];   // 這張卡的主人
  const CUR = () => S.players[S.cur];              // 目前回合的玩家
  const who = (P) => `玩家 ${PN[P.idx]}${S && S.ai && S.ai[P.idx] ? "（電腦）" : ""}`;
  function shuffle(a) {
    const r = new Uint32Array(1);
    for (let i = a.length - 1; i > 0; i--) {
      crypto.getRandomValues(r);
      const j = r[0] % (i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  const clone = (o) => JSON.parse(JSON.stringify(o));
  function snap() {
    undoStack.push(clone(S));
    if (undoStack.length > 80) undoStack.shift();
  }
  function undo() {
    if (!undoStack.length) return toast("沒有可以復原的動作");
    S = undoStack.pop();
    render();
    toast("已復原上一步");
  }
  function log(t) {
    S.log.unshift(t);
    if (S.log.length > 60) S.log.length = 60;
  }
  const apAvail = (P) => P.ap.slice(0, P.apCount).filter((x) => !x).length;
  function payAP(P, n) {
    let left = n;
    for (let i = 0; i < P.apCount && left > 0; i++) if (!P.ap[i]) { P.ap[i] = true; left--; }
  }
  const freeSlot = (P, line) => P[line].findIndex((x) => !x);

  /* ---------- 開始一局 ---------- */
  function makePlayer(idx, deckId) {
    const entries = UA.entriesOf(deckId).filter(({ c }) => !UA.isAP(c.num));
    const deck = [];
    let n = 0;
    for (const { c, q } of entries) for (let i = 0; i < q; i++) { const uid = (idx ? "b" : "a") + (n++); CARDS[uid] = c; deck.push(uid); }
    return {
      idx, deckName: UA.deckNameOf(deckId), total: deck.length,
      deck: shuffle(deck), hand: [], life: [], front: Array(SLOTS).fill(null), energy: Array(SLOTS).fill(null),
      outside: [], remove: [], reveal: [], ap: [false, false, false], apCount: 0, turn: 0, extraDrawn: false, mulled: false,
    };
  }
  function start(deckA, deckB, aiB = false) {
    CARDS = {};
    const A = makePlayer(0, deckA), B = makePlayer(1, deckB);
    const short = [A, B].filter((P) => P.total < 15);
    if (short.length) return toast(`${short.map(who).join("、")}的主卡組不到 15 張，沒辦法開始`);
    S = { stage: "first", players: [A, B], deckIds: [deckA, deckB], ai: [false, !!aiB], first: 0, cur: 0, mullIdx: 0, phase: 0, over: "", log: [] };
    undoStack = [];
    REVQ.length = 0;
    show();
    render();
    const odd = [A, B].filter((P) => P.total !== 50);
    if (odd.length) toast(odd.map((P) => `${who(P)} ${P.total} 張`).join("、") + "（正式規則要剛好 50 張，還是可以練習）", 4000);
  }
  function chooseFirst(i) {
    snap();
    S.first = i;
    S.cur = i;
    for (const P of S.players) P.hand = P.deck.splice(0, 7);
    S.stage = "mull";
    S.mullIdx = i;
    log(`${who(S.players[i])}先攻，雙方抽起手 7 張`);
    render();
  }
  function mulligan(doIt) {
    snap();
    const P = S.players[S.mullIdx];
    if (doIt) { // 規則：手牌先放旁邊 → 再抽 7 張 → 放旁邊的放回卡組洗牌
      const aside = P.hand;
      P.hand = P.deck.splice(0, 7);
      P.deck = shuffle(P.deck.concat(aside));
      P.mulled = true;
      log(`${who(P)}換手牌`);
    } else log(`${who(P)}不換手牌`);
    if (S.mullIdx === S.first) { S.mullIdx = 1 - S.first; return render(); }
    for (const Q of S.players) Q.life = Q.deck.splice(0, 7);
    log("雙方從卡組上方各放 7 張到生命區");
    S.stage = "play";
    S.cur = S.first;
    startTurn();
  }

  /* ---------- 回合與階段 ---------- */
  // 置為活動；有「次の1回アクティブにならない」的這次跳過
  function untap(s, P) {
    if (!s.rest) return;
    if (s.skip) { s.skip -= 1; log(`${who(P)}：${nameOf(s.uid)} 這次不會置為活動（效果）`); return; }
    s.rest = false;
  }
  function startTurn() {
    const P = CUR();
    P.turn += 1;
    S.phase = 0;
    P.extraDrawn = false;
    for (const line of ["front", "energy"]) for (const s of P[line]) if (s) untap(s, P);
    const isFirst = P.idx === S.first;
    P.apCount = (isFirst ? AP_TABLE.first : AP_TABLE.second)[Math.min(P.turn, 3) - 1];
    P.ap = [false, false, false];
    let msg = `${who(P)}的第 ${P.turn} 回合：AP ${P.apCount} 張`;
    if (isFirst && P.turn === 1) msg += "（先攻第 1 回合不抽卡）";
    else if (!P.deck.length) { S.over = `${who(P)}的卡組沒有卡了，起始階段無法抽卡 —— ${who(S.players[1 - P.idx])}獲勝`; msg += "，卡組沒有卡可以抽"; }
    else { P.hand.push(P.deck.shift()); msg += "，抽 1 張"; }
    log(msg);
    render();
  }
  // 上一階段：如果進入這個階段後還沒做任何事，就整個還原（例如結束階段自動置為活動的卡）；否則只把階段往回調
  let phaseMark = -1;
  function prevPhase() {
    if (S.stage !== "play" || S.phase === 0) return;
    if (phaseMark === undoStack.length && undoStack.length) {
      S = undoStack.pop();
      phaseMark = -1;
      render();
      return toast(`回到${PHASES[S.phase]}階段`);
    }
    snap();
    S.phase -= 1;
    log(`${who(CUR())}回到${PHASES[S.phase]}階段`);
    render();
    toast(`回到${PHASES[S.phase]}階段（這個階段做過的動作沒有還原，需要的話請按「復原」）`, 3500);
  }
  function nextPhase() {
    if (S.stage !== "play") return;
    const P = CUR();
    snap();
    if (S.phase < 4) phaseMark = undoStack.length;
    if (S.phase < 4) {
      S.phase += 1;
      if (S.phase === 4) {
        for (const line of ["front", "energy"]) for (const s of P[line]) if (s) untap(s, P);
        log(`${who(P)}結束階段：場上休息的角色、場域置為活動`);
        if (P.hand.length > 8) toast(`手牌 ${P.hand.length} 張，超過 8 張：請把多的拖到移除區`, 4500);
      } else log(`${who(P)}進入${PHASES[S.phase]}階段`);
      render();
    } else {
      if (P.hand.length > 8) { undoStack.pop(); return toast(`手牌還有 ${P.hand.length} 張，請先把多的放到移除區（剩 8 張）`, 4000); }
      // 回合結束：「在這個回合中」的效果失效（BP 增減、攻擊／防禦次數）
      for (const Q of S.players) for (const line of ["front", "energy"]) for (const x of Q[line]) if (x) { x.mod = 0; x.atk = 0; x.blk = 0; }
      S.cur = 1 - S.cur;
      startTurn();
      toast(`換${who(CUR())}的回合`);
    }
  }
  function extraDraw() {
    const P = CUR();
    if (P.extraDrawn) return toast("額外抽卡每回合只能 1 次");
    if (apAvail(P) < 1) return toast("沒有活動的 AP 卡可以支付");
    if (!P.deck.length) return toast("卡組沒有卡了");
    snap();
    payAP(P, 1);
    P.hand.push(P.deck.shift());
    P.extraDrawn = true;
    log(`${who(P)}支付 1AP 額外抽卡`);
    render();
  }
  /* ======================= 卡片效果（官方效果文字） =======================
     - 關鍵字：ステップ、狙い撃ち、2回アタック／ブロック、インパクト、ダメージ、インパクト無効 → 自動套用
     - 時機效果：登場時／アタック時／ブロック時／退場時 → 自動跳出效果文字；起動メイン → 卡片選單發動
     - 觸發：翻到生命卡時自動跳出
     - 常見句型（抽卡、BP±、退場、回手、休息／活動…）變成按鈕一鍵執行；條件請玩家自己確認 */
  const TIMING_TAGS = ["登場時", "退場時", "アタック時", "ブロック時", "起動メイン", "自分のターン中", "相手のターン中"];
  const TIMING_ZH = { 登場時: "登場時", 退場時: "退場時", アタック時: "攻擊時", ブロック時: "防禦時", 起動メイン: "起動メイン" };
  const COLOR_ZH = { 赤: "紅", 青: "藍", 黄: "黃", 緑: "綠", 紫: "紫" };
  const normTag = (t) => String(t).replace(/\s+/g, "").replace(/[（(]\s*([0-9０-９①-⑨❶-❾+＋]+)\s*[）)]/g, "$1").replace(/[①❶１]/g, "1").replace(/[②❷２]/g, "2").replace(/[③❸３]/g, "3").replace(/＋/g, "+");
  function keywordOf(tag) {
    let m;
    if (tag === "ステップ") return { step: true };
    if (tag === "狙い撃ち") return { snipe: true };
    if (tag === "2回アタック") return { twoAtk: true };
    if (tag === "2回ブロック") return { twoBlk: true };
    if (tag === "インパクト無効") return { noImpact: true };
    if ((m = tag.match(/^インパクト\+(\d)$/))) return { impactPlus: +m[1] };
    if ((m = tag.match(/^インパクト(\d)$/))) return { impact: +m[1] };
    if ((m = tag.match(/^ダメージ\+(\d)$/))) return { damagePlus: +m[1] };
    if ((m = tag.match(/^ダメージ(\d)$/))) return { damage: +m[1] };
    return null;
  }
  const fxCache = new Map();
  function fxOf(c) {
    if (!c) return { kw: {}, abil: [], has: false };
    const key = c.num + "|" + (c.effect || "").length;
    if (fxCache.has(key)) return fxCache.get(key);
    const kw = {}, abil = [];
    let cur = null;
    for (const part of String(c.effect || "").split(/(\[[^\]]{1,20}\])/)) {
      if (!part) continue;
      const m = part.match(/^\[(.*)\]$/);
      if (!m) { if (cur) cur.text += part; continue; }
      const tag = normTag(m[1]);
      if (TIMING_TAGS.includes(tag)) { cur = { timing: tag, turn1: false, text: "", costs: [], where: "", tags: "" }; abil.push(cur); continue; }
      if (tag === "ターン1") { if (cur) { cur.turn1 = true; cur.tags += "［ターン1］"; } continue; }
      // 時機標籤後面、效果文字前面的標籤：發動條件（フロントLにある場合）或費用（レストにする、手札を1枚場外に置く…）
      if (cur && !cur.text.trim() && !keywordOf(tag)) {
        if (/にある場合$/.test(tag)) cur.where = tag; else cur.costs.push(tag);
        cur.tags += `［${m[1]}］`;
        continue;
      }
      const k = keywordOf(tag);
      // 句子開頭（不在時機效果裡、或前一句已經結束）的關鍵字 = 這張卡本身就有；寫在效果句子裡的 = 有條件才有
      if (k && (!cur || /。\s*$/.test(cur.text))) { Object.assign(kw, k); cur = null; continue; }
      if (cur) cur.text += `［${m[1]}］`;
    }
    const r = { kw, abil, has: !!(c.type || c.effect) };
    fxCache.set(key, r);
    return r;
  }
  const kwOf = (uid) => fxOf(card(uid)).kw;
  const hasData = (uid) => fxOf(card(uid)).has;
  const slotMod = (uid) => { const f = slotOf(uid); return f ? f.s.mod || 0 : 0; };
  const bpNow = (uid) => (Number.isInteger(card(uid).bp) ? card(uid).bp + slotMod(uid) : null);

  // 能源檢查：能源線上卡片的發生能源（同顏色）要 ≥ 必要エナジー
  function energyAvail(P) {
    const g = {};
    let unknown = false;
    for (const s of P.energy) if (s) {
      const c = card(s.uid);
      if (!c.gen) { if (!c.type) unknown = true; continue; }
      for (const [k, v] of Object.entries(c.gen)) g[k] = (g[k] || 0) + v;
    }
    return { g, unknown };
  }
  function checkEnergy(uid, then) {
    const c = card(uid), P = PL(uid);
    if (!c.color || !Number.isInteger(c.energy) || c.energy <= 0) return then();
    const { g, unknown } = energyAvail(P);
    const have = (g[c.color] || 0) + (g.虹 || 0);
    if (have >= c.energy || unknown) return then(); // 能源線有卡沒有資料時不擋
    // 能源不夠：預設就是不登場；只有真的有效果減少能源時才強制登場，而且會寫進紀錄
    sheet("能源不夠，不能登場", `「${c.name}」需要${COLOR_ZH[c.color] || c.color}色能源 ${c.energy}，${who(P)}的能源線目前只有 ${have}。`, [
      { label: "好，不登場", cls: "primary", run: () => {} },
      { label: "強制登場（只有效果讓必要能源減少時才用）", cls: "warn", run: () => { log(`${who(P)}：能源不夠（${have}／${c.energy}），強制使用「${c.name}」`); then(); } },
    ], c, { noCancel: true });
  }
  const playFromHand = (uid, fn) => checkEnergy(uid, () => withAP(uid, fn));

  // ---------- 效果視窗（排隊一個一個處理） ----------
  const FXQ = [];
  const fxNodes = (t) => String(t).split(/(\[[^\]]{1,20}\]|［[^］]{1,20}］)/).filter(Boolean)
    .map((p) => /^[\[［].*[\]］]$/.test(p) ? el("span", { class: "fx-tag", text: p.slice(1, -1) }) : p);
  function fireTiming(uid, timing) {
    const c = card(uid);
    for (const a of fxOf(c).abil.filter((x) => x.timing === timing)) {
      FXQ.push({
        owner: PL(uid).idx,
        title: `${who(PL(uid))}「${c.name}」的${TIMING_ZH[timing] || timing}效果`,
        uid, text: `［${timing}］${a.tags || ""}${a.text}`,
        actions: actionsFor(a.text, PL(uid), uid),
        buttons: [{ label: "處理完了", primary: true }],
      });
    }
  }
  function renderPrompt() {
    const p = FXQ[0];
    if (p.task) { FXQ.shift(); p.task(); return renderLife(); }
    const box = $("#pyLife");
    box.textContent = "";
    box.append(el("h3", { text: p.title }));
    const head = el("div", { class: "py-fx-head" });
    if (p.uid) head.append(el("ul", { class: "py-poprow" }, popCard(p.uid, { bp: true })));
    head.append(el("div", { class: "py-fx-text" }, ...fxNodes(p.text || "（沒有效果文字）")));
    box.append(head);
    if (p.actions && p.actions.length) {
      const acts = el("div", { class: "py-fx-acts" });
      p.actions.forEach((a) => acts.append(el("button", {
        type: "button", class: `btn small ${a.done ? "done" : ""}`,
        onclick: () => a.run(() => { a.done = true; render(); renderLife(); }),
      }, (a.done ? "✓ " : "") + a.label)));
      box.append(el("span", { class: "py-lbl", text: "一鍵執行（是否符合條件請自己確認）" }), acts);
    } else box.append(el("p", { class: "py-sub", text: "這個效果請自己操作（點卡片或拖曳），處理完按下面的按鈕。" }));
    const btns = el("div", { class: "py-row py-life-btns" });
    for (const b of p.buttons || []) btns.append(el("button", {
      type: "button", class: `btn ${b.primary ? "primary" : ""}`,
      onclick: () => { FXQ.shift(); if (b.run) b.run(); render(); renderLife(); },
    }, b.label));
    box.append(btns);
    $("#pyLifeWrap").hidden = false;
  }

  // ---------- 選目標 ----------
  // 效果裡的檢索條件：〈卡名〉、[特徴：X]／《X》（兩種以上用「か」連接＝其中一種就行）、顏色、卡片種類、必要エナジー、BP
  function specOf(raw) {
    const s = String(raw || "");
    const excl = [...s.matchAll(/〈([^〉]+)〉以外/g)].map((x) => x[1].replace(/\s+/g, ""));
    const names = [...s.matchAll(/〈([^〉]+)〉(?!以外)/g)].map((x) => x[1].replace(/\s+/g, ""));
    const apEq = (s.match(/消費AP(?:が)?(\d+)(?!以)/) || [])[1];
    const traits = [...s.matchAll(/\[?特徴[:：]\s*([^\]、》]+)\]?/g), ...s.matchAll(/《([^》]+)》/g)].map((x) => x[1].trim());
    const col = (s.match(/(赤|青|黄|緑|紫)の/) || [])[1];
    const type = /イベント/.test(s) ? "イベント" : /フィールド/.test(s) ? "フィールド" : /キャラ/.test(s) ? "キャラ" : "";
    const enMax = (s.match(/必要エナジー(?:が)?(\d+)以下/) || [])[1], enMin = (s.match(/必要エナジー(?:が)?(\d+)以上/) || [])[1];
    const bpMax = (s.match(/BP(\d+)以下/) || [])[1];
    const ok = (u) => {
      const c = card(u);
      if (!c) return false;
      if (excl.some((x) => String(c.name || "").replace(/\s+/g, "").includes(x))) return false;
      if (apEq && Number.isInteger(c.ap) && c.ap !== +apEq) return false;
      if (names.length || traits.length) {
        const nm = String(c.name || "").replace(/\s+/g, ""), tr = String(c.traits || "");
        if (!names.some((x) => nm.includes(x)) && !traits.some((x) => tr.includes(x))) return false;
      }
      if (col && c.color !== col) return false;
      if (type && !String(c.type || "").includes(type)) return false;
      if (enMax && (c.energy || 0) > +enMax) return false;
      if (enMin && (c.energy || 0) < +enMin) return false;
      if (bpMax && (c.bp || 0) > +bpMax) return false;
      return true;
    };
    const parts = [...names.map((x) => `〈${x}〉`), ...traits.map((x) => `特徵「${x}」`)];
    const label = [
      col ? (COLOR_ZH[col] || col) + "色" : "",
      enMax ? `必要エナジー ${enMax} 以下` : enMin ? `必要エナジー ${enMin} 以上` : "",
      apEq ? `消費 AP ${apEq}` : "",
      bpMax ? `BP${bpMax} 以下` : "",
      parts.length ? parts.join("或") : "",
      type === "イベント" ? "事件卡" : type === "フィールド" ? "場域卡" : type === "キャラ" ? "角色卡" : parts.length ? "" : "卡",
    ].filter(Boolean).join(" ") + (excl.length ? `（${excl.map((x) => `〈${x}〉`).join("、")}除外）` : "") || "卡";
    return { ok, label };
  }
  // 公開的卡給大家看（電腦公開時特別跳出來，看完按「知道了」它才繼續）
  const REVQ = [];
  function revealShow(P, list, why) {
    if (!isAI(P.idx)) return; // 自己操作的那邊本來就看得到
    REVQ.push({ P, list: list.slice(), why });
    if (REVQ.length === 1) drawReveal();
  }
  function drawReveal() {
    const r = REVQ[0];
    if (!r) return;
    const box = $("#pySheet");
    box.textContent = "";
    box.append(el("div", { class: "py-sh-head" }, el("div", {}, el("b", { text: `${who(r.P)}公開了 ${r.list.length} 張` }), el("p", { text: `${r.why}：${r.list.map(nameOf).join("、")}・點卡片可以放大` }))));
    const grid = el("ul", { class: "py-pile" });
    r.list.forEach((u) => grid.append(cardEl(u, { bp: true, onclick: () => { const x = UA.officialList(card(u))[0]; if (x) UA.openZoom(x, nameOf(u)); } })));
    box.append(grid);
    // 5 秒沒動作就自動關掉繼續；有點卡片（想放大看）就停止倒數，等你按「知道了」
    const btn = el("button", { type: "button", class: "py-sh-btn", onclick: closeSheet }, "知道了（5）");
    box.append(el("div", { class: "py-sh-list row" }, btn));
    $("#pySheetWrap").hidden = false;
    let left = 5;
    clearInterval(revTimer);
    revTimer = setInterval(() => {
      if (REVQ[0] !== r) return clearInterval(revTimer);
      left--;
      if (left <= 0) { clearInterval(revTimer); closeSheet(); } else btn.textContent = `知道了（${left}）`;
    }, 1000);
    grid.addEventListener("pointerdown", () => { clearInterval(revTimer); btn.textContent = "知道了"; }, { once: true });
  }
  let revTimer = null;
  // 手牌丟 N 張到場外（電腦挑 BP 最低的）
  function discardHand(P, n, done) {
    const pick = (list) => { snap(); list.forEach((u) => toPile(u, "outside")); log(`${who(P)}：手牌 ${list.length} 張放到場外（${list.map(nameOf).join("、")}）`); done(); };
    if (!P.hand.length) return done();
    if (isAI(P.idx)) return pick(P.hand.slice().sort((a, b) => (card(a).bp || 0) - (card(b).bp || 0)).slice(0, n));
    pickCards(`${who(P)}：選手牌 ${n} 張放到場外`, P.hand.slice(), n, false, pick);
  }
  // 照自己想要的順序排卡：依序點卡片＝第 1、2、3…張
  function orderCards(P, list, restTo, onDone) {
    const ord = [];
    const box = $("#pySheet");
    const top = restTo === "top", bottom = restTo === "bottom";
    const draw = () => {
      box.textContent = "";
      box.append(el("div", { class: "py-sh-head" }, el("div", {}, el("b", { text: `排順序（${list.length} 張）` }),
        el("p", { text: `依序點卡片：第 1 張會在${top ? "牌庫最上面" : bottom ? "這幾張的最上面（放到牌庫下面時）" : "最上面"}。點錯可以再點一次取消。` }))));
      const grid = el("ul", { class: "py-pile" });
      list.forEach((u) => {
        const k = ord.indexOf(u);
        grid.append(cardEl(u, { badge: k >= 0 ? `第 ${k + 1}` : "", cls: k >= 0 ? "picked" : "", onclick: () => { if (k >= 0) ord.splice(k, 1); else ord.push(u); draw(); } }));
      });
      box.append(grid);
      const rest = () => ord.concat(list.filter((u) => !ord.includes(u)));
      box.append(el("div", { class: "py-sh-list row" },
        el("button", { type: "button", class: "py-sh-btn cancel", onclick: () => { ord.length = 0; draw(); } }, "重排"),
        el("button", { type: "button", class: "py-sh-btn", onclick: () => { closeSheet(); onDone(rest()); } }, ord.length === list.length ? "確定" : "確定（沒點的照原順序接在後面）")));
    };
    draw();
    $("#pySheetWrap").hidden = false;
  }
  function pickCards(title, uids, n, upTo, onPick, rule = null, note = "", zeroOk = false) {
    if (AUTO_PICK) { // 電腦對手：自動選
      if (!uids.length) return;
      const list = AUTO_PICK(uids, n, upTo, rule);
      if (list.length || upTo) onPick(list);
      return;
    }
    if (!uids.length) { toast("沒有符合的卡可以選"); return; }
    const sel = [];
    const box = $("#pySheet");
    const draw = () => {
      box.textContent = "";
      box.append(el("div", { class: "py-sh-head" }, el("div", {}, el("b", { text: title }), el("p", { text: (n >= 99 ? "可以選多張" : upTo ? `最多選 ${n} 張` : `選 ${n} 張`) + (note ? `・${note}` : "") }))));
      const grid = el("ul", { class: "py-pile" });
      uids.forEach((u) => {
        const li = cardEl(u, { bp: true, mod: slotMod(u), cls: sel.includes(u) ? "picked" : "", onclick: () => {
          const k = sel.indexOf(u);
          if (k >= 0) sel.splice(k, 1);
          else {
            const why = rule && rule(sel, u);
            if (why) return toast(why);
            if (sel.length >= n) sel.shift();
            sel.push(u);
          }
          draw();
        } });
        grid.append(li);
      });
      box.append(grid);
      box.append(el("div", { class: "py-sh-list row" },
        el("button", { type: "button", class: "py-sh-btn cancel", onclick: closeSheet }, "取消"),
        el("button", { type: "button", class: "py-sh-btn", disabled: upTo ? !zeroOk && sel.length === 0 : sel.length !== Math.min(n, uids.length), onclick: () => { closeSheet(); onPick(sel.slice()); } }, `確定（${sel.length}）`)));
    };
    draw();
    $("#pySheetWrap").hidden = false;
  }
  const fieldUids = (P, zone) => (zone === "front" ? P.front : zone === "energy" ? P.energy : P.front.concat(P.energy)).filter(Boolean).map((x) => x.uid);

  // ---------- BP 增減、退場 ----------
  function addBP(uid, d, why) {
    const f = slotOf(uid);
    if (!f) return;
    f.s.mod = (f.s.mod || 0) + d;
    log(`${who(PL(uid))}：${nameOf(uid)} BP${d > 0 ? "+" : ""}${d}（本回合）${why ? "・" + why : ""}`);
    const now = bpNow(uid);
    if (now != null && now <= 0) retire(uid, "BP 降到 0 以下");
  }
  // 「このキャラのアタック終了時、…」：攻擊整個結束（對戰或傷害、觸發都處理完）後跳出來
  // 看角色下面的卡（突襲的卡、效果放下去的卡），可以拿出來或翻面
  function underView(hostUid) {
    const f = slotOf(hostUid);
    if (!f) return;
    const P = PL(hostUid);
    const box = $("#pySheet");
    box.textContent = "";
    const fd = f.s.fd || [];
    box.append(el("div", { class: "py-sh-head" }, el("div", {}, el("b", { text: `「${nameOf(hostUid)}」下面的卡（${(f.s.under || []).length} 張）` }),
      el("p", { text: `背面朝上 ${fd.length} 張（標「背」）。點卡片可以拿出來或翻面。角色離開場上時，下面的卡會全部放到場外。` }))));
    const grid = el("ul", { class: "py-pile" });
    (f.s.under || []).forEach((u) => grid.append(cardEl(u, { badge: fd.includes(u) ? "背" : "", onclick: () => {
      const take = (pile, label) => ({ label, run: () => { snap(); f.s.under = f.s.under.filter((x) => x !== u); f.s.fd = (f.s.fd || []).filter((x) => x !== u); P[pile].push(u); log(`${who(P)}：「${nameOf(hostUid)}」下面的 ${nameOf(u)} → ${PILE_NAME[pile]}`); render(); } });
      const isDown = (f.s.fd || []).includes(u);
      sheet(nameOf(u), `在「${nameOf(hostUid)}」下面・${isDown ? "背面朝上" : "正面朝上"}`, [
        take("hand", "加入手牌"), take("outside", "放到場外"), take("remove", "放到移除區"),
        { label: isDown ? "翻成正面" : "翻成背面", run: () => { snap(); f.s.fd = isDown ? f.s.fd.filter((x) => x !== u) : [...(f.s.fd || []), u]; render(); underView(hostUid); } },
      ], card(u));
    } })));
    box.append(grid);
    box.append(el("div", { class: "py-sh-list row" }, el("button", { type: "button", class: "py-sh-btn cancel", onclick: closeSheet }, "關閉")));
    $("#pySheetWrap").hidden = false;
  }
  // 場上卡片下方的標記：突襲／下面背面朝上的張數
  function underBadge(s, short) {
    const n = (s.under || []).length, d = (s.fd || []).length;
    if (!n) return "";
    const raidN = n - d;
    return [raidN ? (short ? "突" : "突襲") : "", d ? (short ? `背${d}` : `下背 ${d}`) : ""].filter(Boolean).join("・");
  }
  function fireAttackEnd(uid) {
    const c = card(uid);
    if (!c || !c.effect || !/アタック終了時/.test(c.effect)) return;
    const txt = c.effect.slice(c.effect.indexOf("このキャラのアタック終了時") >= 0 ? c.effect.indexOf("このキャラのアタック終了時") : c.effect.indexOf("アタック終了時"));
    const sen = txt.split(/(?=\[)/)[0];
    FXQ.push({ owner: PL(uid).idx, title: `${who(PL(uid))}「${c.name}」的攻擊結束時效果`, uid, text: sen, note: "", actions: actionsFor(sen, PL(uid), uid), buttons: [{ label: "處理完了", primary: true }] });
  }
  function retire(uid, why) {
    const P = PL(uid);
    toPile(uid, "outside");
    log(`${who(P)}：${nameOf(uid)} 退場${why ? `（${why}）` : ""}`);
    fireTiming(uid, "退場時");
  }

  // ---------- 常見句型 → 按鈕 ----------
  function actionsFor(text, P, srcUid) {
    const acts = [];
    const opp = S.players[1 - P.idx];
    let t = String(text).replace(/［特徴[:：]\s*([^］]+)］/g, "《$1》").replace(/［[^］]*］/g, "").replace(/。(それ|そのキャラ)は、?次の1回アクティブにならない/g, "、$1は次の1回アクティブにならない");
    const t0 = t;
    let curPos = 0;
    { const push0 = acts.push.bind(acts); acts.push = (x) => push0(Object.assign(x, { pos: x.pos ?? curPos })); }
    // 看牌庫上面 N 張 → 選符合條件的卡（加入手牌／放到場外，可能要公開）→ 剩下的照自己想要的順序放回 →（加入的話）手牌丟 N 張
    let lm = t.match(/(?:自分の)?山札の上から(\d+)枚(?:を)?見(?:る|て)?[。、]?(?:その中から)?(.*?)を(\d+)枚(まで)?(?:選び、?)?(公開し)?(手札に加え|場外に置)(?:る|く)?。?(?:(?:残り|それ以外)(?:のカード)?を(.*?)置(?:く|き)。?)?(?:(?:カードを)?手札に加えた場合、自分の手札を(\d+)枚(?:選び、?)?場外に置(?:く)?。?)?/);
    if (lm) {
      const look = +lm[1], spec = specOf(lm[2]), k = +lm[3], upTo = !!lm[4], pub = !!lm[5], toOut = lm[6].startsWith("場外"), restTxt = lm[7] || "", disc = +(lm[8] || 0);
      const anyOrder = /望む順|好きな順/.test(restTxt);
      const restTo = /場外/.test(restTxt) ? "outside" : /上か下|上または下/.test(restTxt) ? "either" : /山札の上/.test(restTxt) ? "top" : "bottom";
      const restZh = { outside: "放到場外", top: "放回牌庫上面", bottom: "放到牌庫下面", either: "放回牌庫上面或下面" }[restTo];
      const destZh = toOut ? "放到場外" : `${pub ? "公開後" : ""}加入手牌`;
      t = t.replace(lm[0], ""); curPos = t0.indexOf(lm[0]);
      acts.push({
        ai: "good",
        label: `看牌庫上面 ${look} 張，${spec.label}${upTo ? "最多" : ""} ${k} 張${destZh}，剩下的${anyOrder && restTo !== "outside" ? "照你想要的順序" : ""}${restZh}${disc ? `；有加入的話手牌 ${disc} 張放到場外` : ""}`,
        run: (done) => {
          const pool = P.deck.slice(0, look);
          if (!pool.length) { toast("牌庫沒有卡"); return done(); }
          const finish = (list) => {
            snap();
            for (const u of list) { P.deck.splice(P.deck.indexOf(u), 1); (toOut ? P.outside : P.hand).push(u); }
            const rest = pool.filter((u) => !list.includes(u));
            for (const u of rest) P.deck.splice(P.deck.indexOf(u), 1);
            const what = list.length ? `「${list.map(nameOf).join("、")}」${destZh}` : "沒有選卡";
            const after = () => {
              if (list.length && (pub || toOut)) revealShow(P, list, `看牌庫上面 ${pool.length} 張，${destZh}`);
              else if (!list.length && isAI(P.idx)) toast(`${who(P)}看了牌庫上面 ${pool.length} 張，沒有選卡`);
              render();
              if (list.length && disc && !toOut) discardHand(P, disc, done); else done();
            };
            const put = (order, where) => {
              if (where === "outside") P.outside.push(...order);
              else if (where === "top") P.deck.unshift(...order);
              else P.deck.push(...order);
              log(`${who(P)}：看牌庫上面 ${pool.length} 張，${what}，剩下 ${order.length} 張${{ outside: "放到場外", top: "放回牌庫上面", bottom: "放到牌庫下面" }[where]}`);
              after();
            };
            const pickWhere = (order) => {
              if (restTo !== "either") return put(order, restTo);
              if (isAI(P.idx) || !order.length) return put(order, "bottom");
              sheet("剩下的卡要放哪裡？", `${order.length} 張`, [
                { label: "放回牌庫上面", run: () => put(order, "top") },
                { label: "放到牌庫下面", run: () => put(order, "bottom") },
              ]);
            };
            if (anyOrder && restTo !== "outside" && rest.length > 1 && !isAI(P.idx)) orderCards(P, rest, restTo, pickWhere);
            else pickWhere(rest);
          };
          pickCards(`${who(P)}的牌庫上面 ${pool.length} 張（由上到下）`, pool, k, upTo, finish,
            (sel, u) => (spec.ok(u) ? null : `這張不符合條件（要${spec.label}）`), `選要${destZh}的卡・條件：${spec.label}・不符合的點不了，可以一張都不選`, true);
        },
      });
    }
    // 「手札を N 枚リムーブエリア／場外に置いてもよい。そうした場合、…」：先付代價，付了才做後面的效果
    lm = t.match(/(?:その後、)?自分の手札を(\d+)枚(リムーブエリア|場外)に置いてもよい。そうした場合、([^。]*。?)/);
    if (lm) {
      const n = +lm[1], zoneKey = lm[2] === "場外" ? "outside" : "remove", zoneZh = lm[2] === "場外" ? "場外" : "移除區";
      const thenText = lm[3];
      t = t.replace(lm[0], ""); curPos = t0.indexOf(lm[0]);
      const sub = actionsFor(thenText, P, srcUid);
      const subZh = sub.map((a) => a.label).join("；") || "後面的效果";
      acts.push({
        ai: sub.length && sub.every((a) => a.ai === "good") ? "good" : "ui",
        label: `（可以不做）手牌 ${n} 張放到${zoneZh}，然後：${subZh}`,
        run: (done) => {
          if (P.hand.length < n) { toast("手牌不夠"); return done(); }
          const after = (list) => {
            if (!list.length) return done();
            snap();
            list.forEach((u) => toPile(u, zoneKey));
            log(`${who(P)}：手牌「${list.map(nameOf).join("、")}」放到${zoneZh}`);
            render();
            let i = 0;
            const next = () => { if (i >= sub.length) return done(); const a = sub[i++]; a.run(next); };
            next();
          };
          if (isAI(P.idx)) {
            if (sub.some((a) => a.aiWorth && !a.aiWorth())) return done(); // 沒有可以拿的目標就不付代價
            return after(P.hand.slice().sort((a, b) => (card(a).bp || 0) - (card(b).bp || 0)).slice(0, n));
          }
          pickCards(`選手牌 ${n} 張放到${zoneKey === "remove" ? "移除區" : "場外"}（付了才會${subZh}）`, P.hand.slice(), n, false, after);
        },
      });
    }
    // 從移除區／場外／手牌／牌庫把符合條件的角色登場（例：リムーブエリアから…を1枚まで自分の場にレストで登場させる）
    lm = t.match(/自分の(リムーブエリア|場外|手札|山札)から(.*?)を(\d+)枚(まで)?(?:選び、?)?自分の場に(レストで|アクティブで)?登場させ(?:る)?。?/);
    if (lm) {
      const zk = { リムーブエリア: "remove", 場外: "outside", 手札: "hand", 山札: "deck" }[lm[1]], zz = { remove: "移除區", outside: "場外", hand: "手牌", deck: "牌庫" }[zk];
      const spec = specOf(lm[2]), k = +lm[3], upTo = !!lm[4], rest = lm[5] !== "アクティブで";
      t = t.replace(lm[0], ""); curPos = t0.indexOf(lm[0]);
      const cands = () => P[zk].filter((u) => spec.ok(u) && !/イベント/.test(card(u).type || ""));
      acts.push({
        ai: "good",
        aiWorth: () => cands().length > 0,
        label: `從${zz}選${spec.label}${upTo ? "最多" : ""} ${k} 張登場到場上（${rest ? "休息" : "活動"}，不用付費）`,
        run: (done) => {
          const list0 = cands();
          if (!list0.length) { toast(`${zz}沒有${spec.label}`); return done(); }
          pickCards(`從${zz}選要登場的卡（${spec.label}）`, list0, k, upTo, (list) => {
            let i = 0;
            const next = () => {
              if (i >= list.length) { if (zk === "deck") shuffle(P.deck); return done(); }
              const u = list[i++];
              if (isAI(P.idx) && list.length) revealShow(P, [u], `從${zz}登場`);
              const go = (line) => { placeOnLine(u, line, { rest, why: `從${zz}登場` }); next(); };
              if (isAI(P.idx)) return go(freeSlot(P, "front") >= 0 ? "front" : "energy");
              sheet(`「${nameOf(u)}」要登場到哪裡？`, `${rest ? "休息" : "活動"}狀態登場`, [
                { label: "前線", cls: "primary", run: () => go("front") },
                { label: "能源線", run: () => go("energy") },
              ], card(u), { noCancel: true });
            };
            next();
          }, null, "", true);
        },
      });
    }
    // 看牌庫上面 N 張，每張自己選放哪裡（例：山札の上から1枚見て、山札の上か場外に置く／山札の上か下に置く）
    lm = t.match(/(?:自分の)?山札の上から(\d+)枚(?:を)?見(?:る|て)[。、]?([^。]*?)に置く。?/);
    if (lm) {
      const where = lm[2];
      const dests = [];
      if (/上/.test(where.replace(/山札の上から/g, ""))) dests.push("top");
      if (/下/.test(where)) dests.push("bottom");
      if (/場外/.test(where)) dests.push("outside");
      if (dests.length >= 2 || (dests.length === 1 && /望む順|好きな順/.test(where))) {
        const look = +lm[1], anyOrder = /望む順|好きな順/.test(where) || look > 1;
        const ZH = { top: "放回牌庫上面", bottom: "放到牌庫下面", outside: "放到場外" };
        t = t.replace(lm[0], ""); curPos = t0.indexOf(lm[0]);
        acts.push({
          ai: "good",
          label: `看牌庫上面 ${look} 張，每張選擇${dests.map((d) => ZH[d]).join("或")}`,
          run: (done) => {
            const pool = P.deck.slice(0, look);
            if (!pool.length) { toast("牌庫沒有卡"); return done(); }
            const pick = { top: [], bottom: [], outside: [] };
            const finish = () => {
              snap();
              for (const u of pool) P.deck.splice(P.deck.indexOf(u), 1);
              const end = (topOrder, botOrder) => {
                P.deck.unshift(...topOrder);
                P.deck.push(...botOrder);
                P.outside.push(...pick.outside);
                const parts = [];
                if (topOrder.length) parts.push(`${topOrder.length} 張放回上面`);
                if (botOrder.length) parts.push(`${botOrder.length} 張放到下面`);
                if (pick.outside.length) parts.push(`「${pick.outside.map(nameOf).join("、")}」放到場外`);
                log(`${who(P)}：看牌庫上面 ${pool.length} 張，${parts.join("，")}`);
                if (pick.outside.length && isAI(P.idx)) revealShow(P, pick.outside, "看牌庫上面後放到場外");
                render();
                done();
              };
              const human = !isAI(P.idx);
              const doBottom = (topOrder) => human && anyOrder && pick.bottom.length > 1 ? orderCards(P, pick.bottom, "bottom", (b) => end(topOrder, b)) : end(topOrder, pick.bottom);
              if (human && anyOrder && pick.top.length > 1) orderCards(P, pick.top, "top", doBottom); else doBottom(pick.top);
            };
            if (isAI(P.idx)) {
              const { g } = energyAvail(P);
              const have = Object.values(g).reduce((a, b) => a + b, 0);
              for (const u of pool) {
                const good = (card(u).energy || 0) <= have + 1;
                const d = good && dests.includes("top") ? "top" : dests.includes("outside") ? "outside" : dests.includes("bottom") ? "bottom" : dests[0];
                pick[d].push(u);
              }
              return finish();
            }
            let i = 0;
            const ask = () => {
              if (i >= pool.length) return finish();
              const u = pool[i];
              sheet(`看牌庫上面 ${pool.length} 張：第 ${i + 1} 張`, `「${nameOf(u)}」要放哪裡？`, dests.map((d) => ({ label: ZH[d], cls: d === "top" ? "primary" : "", run: () => { pick[d].push(u); i++; ask(); } })), card(u), { noCancel: true });
            };
            ask();
          },
        });
      }
    }
    // 從場外／牌庫找符合條件的卡加入手牌（例：自分の場外から〈X〉を1枚まで手札に加える）
    lm = t.match(/自分の(場外|山札)から(.*?)を(\d+)枚(まで)?(?:選び、?)?(公開し)?手札に加え(?:る)?。?/);
    if (lm && !/このキャラの下/.test(lm[2])) {
      const fromDeck = lm[1] === "山札", spec = specOf(lm[2]), k = +lm[3], upTo = !!lm[4], pub = !!lm[5] || !fromDeck;
      t = t.replace(lm[0], ""); curPos = t0.indexOf(lm[0]);
      acts.push({
        ai: "good",
        label: `從${fromDeck ? "牌庫" : "場外"}找${spec.label}${upTo ? "最多" : ""} ${k} 張加入手牌${fromDeck ? "（之後洗牌）" : ""}`,
        run: (done) => {
          const zone = fromDeck ? P.deck : P.outside;
          const cands = zone.filter(spec.ok);
          const finish = (list) => {
            snap();
            for (const u of list) { zone.splice(zone.indexOf(u), 1); P.hand.push(u); }
            if (fromDeck) shuffle(P.deck);
            log(`${who(P)}：從${fromDeck ? "牌庫" : "場外"}${list.length ? `把「${list.map(nameOf).join("、")}」加入手牌` : "沒有找到卡"}${fromDeck ? "，洗牌" : ""}`);
            if (list.length && pub) revealShow(P, list, `從${fromDeck ? "牌庫" : "場外"}找到後加入手牌`);
            else if (!list.length && isAI(P.idx)) toast(`${who(P)}沒有找到符合的卡`);
            done();
          };
          if (!cands.length) { toast(`${fromDeck ? "牌庫" : "場外"}沒有${spec.label}`); return finish([]); }
          pickCards(`從${fromDeck ? "牌庫" : "場外"}選${spec.label}`, cands, k, upTo, finish, null, "", true);
        },
      });
    }
    for (const sen of t.split("。")) {
      curPos = sen ? t0.indexOf(sen) : curPos;
      let m;
      if ((m = sen.match(/カードを(\d+)枚引/))) {
        const n = +m[1];
        acts.push({ ai: "good", label: `${who(P)}抽 ${n} 張`, run: (done) => { snap(); let k = 0; for (; k < n && P.deck.length; k++) P.hand.push(P.deck.shift()); log(`${who(P)}抽 ${k} 張（效果）`); done(); } });
      }
      if (/このキャラは、?次の1回アクティブにならない/.test(sen) && srcUid) {
        acts.push({ ai: "good", label: "這張角色下一次不會置為活動", run: (done) => { const f = slotOf(srcUid); if (f) { f.s.skip = 1; log(`${who(P)}：${nameOf(srcUid)} 下一次不會置為活動`); render(); } done(); } });
      }
      if (/このカードを手札に加え/.test(sen) && srcUid) {
        acts.push({ ai: "good", label: "這張卡加入手牌", run: (done) => { snap(); toPile(srcUid, "hand"); log(`${who(P)}：${nameOf(srcUid)} 加入手牌（效果）`); done(); } });
      }
      // 選角色＋動作
      if ((m = sen.match(/(相手|自分)の(フロントL|エナジーL|場)?の?((?:(?!相手の|自分の)[^、])*?)キャラ(?:カード)?を(\d+)枚(まで)?選び、?(.*)$/))) {
        const side = m[1] === "相手" ? opp : P;
        const zone = m[2] === "フロントL" ? "front" : m[2] === "エナジーL" ? "energy" : "both";
        const cond = m[3] || "", n = +m[4], upTo = !!m[5], rest = m[6] || "";
        let bpMax = (cond.match(/BP(\d+)以下/) || [])[1];
        const bpMin = (cond.match(/BP(\d+)以上/) || [])[1];
        // 「自分の場外にあるイベントカードの枚數×1000以下のBP」這種：用當下張數算
        const cm = sen.match(/自分の(場外|手札|リムーブエリア|エナジーL|フロントL|場)にある(イベント|キャラ)?カードの枚数×(\d+)以下のBP/);
        const dynMax = cm ? () => {
          const zk = { 場外: "outside", 手札: "hand", リムーブエリア: "remove" }[cm[1]];
          const pool = zk ? P[zk] : fieldUids(P, cm[1] === "エナジーL" ? "energy" : cm[1] === "フロントL" ? "front" : "both");
          return pool.filter((u) => !cm[2] || String(card(u).type || "").includes(cm[2])).length * +cm[3];
        } : null;
        const dynZh = cm ? `自己${{ 場外: "場外", 手札: "手牌", リムーブエリア: "移除區", エナジーL: "能源線", フロントL: "前線", 場: "場上" }[cm[1]]}的${cm[2] === "イベント" ? "事件卡" : cm[2] === "キャラ" ? "角色卡" : "卡"}張數×${cm[3]}` : "";
        const verbs = [];
        if (/退場させ/.test(rest)) verbs.push(["retire", "退場"]);
        if (/手札に戻/.test(rest)) verbs.push(["hand", "回到手牌"]);
        if (/レストに/.test(rest)) verbs.push(["rest", "轉為休息"]);
        if (/アクティブにす|アクティブにし/.test(rest)) verbs.push(["active", "置為活動"]);
        if (/アクティブにならない/.test(rest)) verbs.push(["skip", "下一次不會置為活動"]);
        if (/場外に置/.test(rest) && !/退場/.test(rest)) verbs.push(["outside", "放到場外"]);
        if (/リムーブエリア|除外/.test(rest)) verbs.push(["remove", "放到移除區"]);
        const bpm = rest.match(/BP([+\-−])(\d+)/);
        if (bpm) verbs.push(["bp", `BP${bpm[1] === "+" ? "+" : "−"}${bpm[2]}`, (bpm[1] === "+" ? 1 : -1) * +bpm[2]]);
        if (verbs.length) {
          const zn = zone === "front" ? "前線" : zone === "energy" ? "能源線" : "場上";
          const filt = dynMax ? `BP（${dynZh}）以下` : bpMax ? `BP${bpMax}以下` : bpMin ? `BP${bpMin}以上` : "";
          const harm = verbs.some((v) => ["retire", "hand", "rest", "outside", "remove", "skip"].includes(v[0]) || (v[0] === "bp" && v[2] < 0));
          const help = verbs.some((v) => v[0] === "active" || (v[0] === "bp" && v[2] > 0));
          acts.push({
            ai: side === P ? (help && !harm ? "good" : "bad") : (harm ? "good" : "bad"),
            label: `選${side === P ? "自己" : "對手"}${zn}${filt}的角色${upTo ? "最多" : ""} ${n} 張 → ${verbs.map((v) => v[1]).join("、")}`,
            run: (done) => {
              if (dynMax) bpMax = dynMax();
              const cands = fieldUids(side, zone).filter((u) => { const b = bpNow(u); return !(bpMax != null && b != null && b > +bpMax) && !(bpMin && b != null && b < +bpMin); });
              if (dynMax) log(`${who(P)}：${dynZh} = ${bpMax}，可以選 BP${bpMax} 以下的角色`);
              pickCards(`選擇目標（${who(side)}）`, cands, n, upTo, (list) => {
                snap();
                for (const u of list) for (const [v, , d] of verbs) {
                  if (!slotOf(u)) break;
                  if (v === "retire") retire(u, "效果");
                  else if (v === "hand") { toPile(u, "hand"); log(`${who(side)}：${nameOf(u)} 回到手牌（效果）`); }
                  else if (v === "outside") { toPile(u, "outside"); log(`${who(side)}：${nameOf(u)} 放到場外（效果）`); }
                  else if (v === "remove") { toPile(u, "remove"); log(`${who(side)}：${nameOf(u)} 放到移除區（效果）`); }
                  else if (v === "rest") { const f = slotOf(u); f.s.rest = true; log(`${who(side)}：${nameOf(u)} 轉為休息（效果）`); }
                  else if (v === "active") { const f = slotOf(u); if (f.s.skip && f.s.rest) untap(f.s, side); else f.s.rest = false; log(`${who(side)}：${nameOf(u)} 置為活動（效果）`); }
                  else if (v === "skip") { const f = slotOf(u); f.s.skip = 1; log(`${who(side)}：${nameOf(u)} 下一次不會置為活動`); }
                  else if (v === "bp") addBP(u, d, "效果");
                }
                done();
              });
            },
          });
        }
      } else if ((m = sen.match(/このキャラ(?:は|に|の)[^。]*?BP([+\-−])(\d+)/)) && srcUid) {
        const d = (m[1] === "+" ? 1 : -1) * +m[2];
        acts.push({ ai: d > 0 ? "good" : "bad", label: `這張角色 BP${d > 0 ? "+" : "−"}${Math.abs(d)}（本回合）`, run: (done) => { if (!slotOf(srcUid)) return toast("這張卡不在場上"); snap(); addBP(srcUid, d, "效果"); done(); } });
      }
      // 把卡放到這張角色下面（例：自分の場外から赤の〈綾波 レイ〉を各必要エナジーにつき1枚までこのキャラの下に裏向きで置く）
      if ((m = sen.match(/(?:自分の)?(場外|手札|ライフ|山札の上から(\d+)枚)(?:の中)?から(.*?)このキャラの下に(裏向き|表向き)?で?置/)) && srcUid) {
        const src = m[1].startsWith("場外") ? "outside" : m[1].startsWith("手札") ? "hand" : m[1].startsWith("ライフ") ? "life" : "deck";
        const topN = m[2] ? +m[2] : 0, spec = m[3] || "", down = m[4] !== "表向き";
        const col = (spec.match(/(赤|青|黄|緑|紫)の/) || [])[1];
        const names = [...spec.matchAll(/〈([^〉]+)〉/g)].map((x) => x[1].replace(/\s+/g, ""));
        const max = /各必要エナジーにつき/.test(spec) ? 99 : +((spec.match(/(\d+)枚/) || [])[1] || 1); // 「各必要エナジーにつき1枚まで」= 每種費用 1 張、不限總數
        const distinct = /各必要エナジーにつき1枚/.test(spec);
        const srcName = { outside: "場外", hand: "手牌", life: "生命區", deck: `牌庫上面 ${topN} 張` }[src];
        acts.push({
          ai: "good",
          label: `從${srcName}選${col ? (COLOR_ZH[col] || col) + "色" : ""}${names.length ? names.map((x) => `〈${x}〉`).join("或") : "卡"}放到這張角色下面（${down ? "背面朝上" : "正面朝上"}${distinct ? "，每種費用最多 1 張" : ""}）`,
          run: (done) => {
            const f = slotOf(srcUid);
            if (!f) return toast("這張角色不在場上");
            const pool = src === "deck" ? P.deck.slice(0, topN) : P[src].slice();
            const cands = pool.filter((u) => { const c = card(u); return (!col || c.color === col) && (!names.length || names.some((x) => c.name.replace(/\s+/g, "").includes(x))); });
            const rule = distinct ? (sel, u) => (sel.some((x) => card(x).energy === card(u).energy) ? `已經選了必要エナジー ${card(u).energy} 的卡（每種費用最多 1 張）` : null) : null;
            pickCards(`放到「${nameOf(srcUid)}」下面`, cands, max, true, (list) => {
              snap();
              for (const u of list) {
                detach(u);
                f.s.under = f.s.under || [];
                f.s.under.push(u);
                if (down) { f.s.fd = f.s.fd || []; f.s.fd.push(u); }
              }
              log(`${who(P)}：${list.map(nameOf).join("、")} 放到「${nameOf(srcUid)}」下面（${down ? "背面朝上" : "正面朝上"}）`);
              done();
            }, rule, distinct ? "每種必要エナジー最多 1 張" : "");
          },
        });
      }
      // 看下面背面的卡，選幾張加入手牌（例：このキャラの下の裏向きのカードを見て、2枚まで公開し手札に加える）
      if ((m = sen.match(/このキャラの下の(裏向きの)?カードを見て、(\d+)枚まで(?:公開し)?手札に加え/)) && srcUid) {
        const n = +m[2], onlyDown = !!m[1];
        acts.push({
          ai: "good",
          label: `看這張角色下面${onlyDown ? "背面" : ""}的卡，最多 ${n} 張加入手牌`,
          run: (done) => {
            const f = slotOf(srcUid);
            if (!f) return toast("這張角色不在場上");
            const pool = (f.s.under || []).filter((u) => !onlyDown || (f.s.fd || []).includes(u));
            pickCards(`「${nameOf(srcUid)}」下面的卡`, pool, n, true, (list) => {
              snap();
              for (const u of list) { f.s.under = f.s.under.filter((x) => x !== u); f.s.fd = (f.s.fd || []).filter((x) => x !== u); P.hand.push(u); }
              log(`${who(P)}：從「${nameOf(srcUid)}」下面拿 ${list.length} 張加入手牌（${list.map(nameOf).join("、")}）`);
              if (list.length && /公開し/.test(sen)) revealShow(P, list, `從「${nameOf(srcUid)}」下面拿出來加入手牌`);
              done();
            });
          },
        });
      }
      // 觸發的レイド：讓這張卡突襲（不用付 AP，要滿足能源）
      if (/レイドさせ/.test(sen) && srcUid && P.reveal.includes(srcUid)) {
        acts.push({ ai: "good", label: "突襲到自己場上的角色（不用付 AP）", run: (done) => {
          if (AUTO_PICK) { const t = aiRaidTarget(srcUid); if (t) raidOnto(srcUid, t.line, t.i, true, true); return done(); }
          raid(srcUid, true); done();
        } });
      }
      if ((m = sen.match(/山札の上から(\d+)枚(?:を)?見/))) {
        const n = +m[1];
        acts.push({ ai: "ui", label: `看自己牌庫上面 ${n} 張`, run: (done) => { pileView("deck", P.deck.slice(0, n), `${who(P)}的牌庫上面 ${n} 張`, P); done(); } });
      }
      if (/自分の場外/.test(sen) && !/このキャラの下に/.test(sen)) acts.push({ ai: "ui", label: "打開自己的場外", run: (done) => { pileView("outside", P.outside, `${who(P)}的場外`, P); done(); } });
      if ((m = sen.match(/手札を(\d+)枚(?:選び、)?場外に置/))) {
        const n = +m[1];
        acts.push({ ai: "bad", label: `選自己手牌 ${n} 張放到場外`, run: (done) => pickCards(`${who(P)}的手牌`, P.hand.slice(), n, false, (list) => { snap(); list.forEach((u) => toPile(u, "outside")); log(`${who(P)}：手牌 ${list.length} 張放到場外（效果）`); done(); }) });
      }
      if ((m = sen.match(/相手に(\d+)ダメージ/))) {
        const n = +m[1];
        acts.push({ ai: "good", label: `對手受到 ${n} 傷害`, run: (done) => { done(); takeDamage(opp, n, srcUid); } });
      }
    }
    acts.sort((x, y) => x.pos - y.pos);
    return acts;
  }

  // 起動メイン：從卡片選單發動（費用自動處理：支付 AP、休息、退場）
  function activate(uid, a) {
    const P = PL(uid);
    const f = slotOf(uid);
    const turnKey = `${S.cur}-${P.turn}`;
    if (a.turn1 && f && f.s.used && f.s.used[a.text] === turnKey) return toast("這個效果這回合已經用過了（ターン1）");
    if (a.where === "フロントLにある場合" && (!f || f.line !== "front")) return toast("這張卡要在前線才能發動");
    if (a.where === "エナジーLにある場合" && (!f || f.line !== "energy")) return toast("這張卡要在能源線才能發動");
    // 費用：官方用圖示標在效果前面（舊格式寫在「：」前面）
    const costText = a.costs.join("、") + (a.text.includes("：") ? "、" + a.text.slice(0, a.text.indexOf("：")) : "");
    const effPart = a.text.includes("：") ? a.text.slice(a.text.indexOf("：") + 1) : a.text;
    const apCost = +((costText.match(/APを(\d+)支払/) || [])[1] || 0);
    const needRest = /レストにする/.test(costText);
    const selfRetire = /このカードを退場/.test(costText);
    const discard = +((costText.match(/手札を(\d+)枚場外に置/) || [])[1] || 0);
    if (apCost && apAvail(P) < apCost) return toast(`AP 不夠（要支付 ${apCost}AP）`);
    if (needRest && f && f.s.rest) return toast("這張卡已經休息，沒辦法再「レストにする」");
    if (discard && P.hand.length < discard) return toast(`手牌不夠（要放 ${discard} 張到場外）`);
    const go = (discarded = []) => {
      snap();
      if (apCost) payAP(P, apCost);
      if (needRest && f) f.s.rest = true;
      discarded.forEach((u) => toPile(u, "outside"));
      if (a.turn1 && f) { f.s.used = f.s.used || {}; f.s.used[a.text] = turnKey; }
      const paid = [apCost ? `支付 ${apCost}AP` : "", needRest ? "轉為休息" : "", discarded.length ? `手牌 ${discarded.length} 張放到場外` : "", selfRetire ? "讓這張卡退場" : ""].filter(Boolean).join("、");
      log(`${who(P)}：發動「${nameOf(uid)}」的起動メイン${paid ? `（${paid}）` : ""}`);
      if (selfRetire) retire(uid, "效果的費用");
      FXQ.unshift({ owner: P.idx, title: `${who(P)}「${nameOf(uid)}」的起動メイン效果`, uid, text: `［起動メイン］${a.tags || ""}${a.text}`, actions: actionsFor(effPart, P, uid), buttons: [{ label: "處理完了", primary: true }] });
      render();
      renderLife();
    };
    if (discard) return pickCards(`費用：選 ${discard} 張手牌放到場外`, P.hand.slice(), discard, false, go);
    go();
  }

  // 觸發：翻開生命卡時
  function queueTriggers(P, uids) {
    for (const u of uids) {
      const c = card(u);
      if (!c.trigger) continue;
      const tm = c.trigger.match(/^\[([^\]]+)\]/);
      FXQ.push({
        owner: P.idx,
        title: `${who(P)}翻到觸發：「${c.name}」${tm ? `（${tm[1]}）` : ""}`,
        uid: u, text: c.trigger,
        actions: actionsFor(c.trigger.replace(/^\[[^\]]+\]/, ""), P, u),
        buttons: [
          { label: "不發動（放到場外）", run: () => { if (P.reveal.includes(u)) { snap(); toPile(u, "outside"); log(`${who(P)}：${c.name} 不發動觸發，放到場外`); } } },
          { label: "處理完了（放到場外）", primary: true, run: () => { if (P.reveal.includes(u)) { toPile(u, "outside"); log(`${who(P)}：${c.name} 觸發處理完，放到場外`); } } },
        ],
      });
    }
  }

  /* ---------- 受到傷害：彈出生命區 7 格，由攻擊方選要翻哪幾張 ---------- */
  // 規則：由對手指定與傷害數字相同張數的生命區卡片，承受傷害的玩家翻開做觸發確認
  let LP = null; // { P, n, picked: [index…], done }
  function takeDamage(P, n = 1, atkUid = null) {
    if (!P.life.length) return toast("生命區已經沒有卡了");
    LP = { P, n, picked: [], done: false, atk: atkUid };
    renderLife();
  }
  function renderLife() {
    aiPump();
    const w = $("#pyLifeWrap");
    if (!LP) { if (FXQ.length) return renderPrompt(); if (AT) return renderAttack(); w.hidden = true; return; }
    const { P, n } = LP;
    const need = Math.min(n, P.life.length);
    const atk = S.players[1 - P.idx];
    const box = $("#pyLife");
    box.textContent = "";
    box.append(el("h3", { text: LP.done ? `${who(P)}翻開的生命卡` : `${who(atk)}${LP.atk ? `的「${nameOf(LP.atk)}」` : ""}攻擊成功：選 ${need} 張${who(P)}的生命卡翻開` }));
    if (!LP.done) {
      const chips = el("div", { class: "py-row py-dmg" }, el("span", { class: "py-lbl", text: "傷害" }));
      [1, 2, 3, 4, 5, 6, 7].forEach((k) => chips.append(el("button", {
        type: "button", class: `py-chip ${k === n ? "on" : ""}`,
        onclick: () => { LP.n = k; LP.picked = LP.picked.slice(0, Math.min(k, P.life.length)); renderLife(); },
      }, String(k))));
      box.append(chips, el("p", { class: "py-sub", text: "一般是 1 傷害，有ダメージ❷ 等效果就改成 2。點背面朝上的卡選擇要翻開哪幾張（左邊是生命區最上面），空格是已經失去的生命。" }));
    }
    const grid = el("ul", { class: "py-lifegrid" });
    for (let i = 0; i < 7; i++) {
      if (LP.done) {
        const uid = LP.revealed[i];
        if (uid) grid.append(cardEl(uid, { cls: "flip", onclick: () => { const u = UA.officialList(card(uid))[0]; if (u) UA.openZoom(u, nameOf(uid)); } }));
        else grid.append(el("li", { class: `py-lifeslot ${i < LP.left ? "back" : "gone"}` }));
        continue;
      }
      if (i >= P.life.length) { grid.append(el("li", { class: "py-lifeslot gone", title: "已經失去" })); continue; }
      const order = LP.picked.indexOf(i);
      grid.append(el("li", { class: `py-lifeslot back ${order >= 0 ? "picked" : ""}` },
        el("button", {
          type: "button", "aria-label": `生命區第 ${i + 1} 張`,
          onclick: () => {
            const k = LP.picked.indexOf(i);
            if (k >= 0) LP.picked.splice(k, 1);
            else if (LP.picked.length < need) LP.picked.push(i);
            else { LP.picked.shift(); LP.picked.push(i); }
            renderLife();
          },
        }, order >= 0 ? String(order + 1) : "")));
    }
    box.append(grid);
    const btns = el("div", { class: "py-row py-life-btns" });
    if (!LP.done) {
      btns.append(
        el("button", { type: "button", class: "btn", onclick: closeLife }, "取消"),
        el("button", { type: "button", class: "btn", onclick: () => { LP.picked = Array.from({ length: need }, (_, k) => k); renderLife(); } }, "從最上面選"),
        el("button", { type: "button", class: "btn primary", disabled: LP.picked.length !== need, onclick: flipLife }, `翻開（${LP.picked.length}/${need}）`));
    } else {
      box.append(el("p", { class: "py-sub", text: "按「好」之後，有觸發效果的卡會一張一張跳出來讓你發動；沒有觸發的卡留在中間的觸發確認區，處理完再放到場外。" }));
      btns.append(el("button", { type: "button", class: "btn primary", onclick: closeLifeOnly }, "好"));
    }
    box.append(btns);
    w.hidden = false;
  }
  function flipLife() {
    const { P } = LP;
    snap();
    const before = P.life.length; // 翻開前的生命張數
    const uids = LP.picked.map((i) => P.life[i]);
    const revealed = Array(7).fill(null);
    LP.picked.forEach((i, k) => { revealed[i] = uids[k]; });
    P.life = P.life.filter((u) => !uids.includes(u));
    P.reveal.push(...uids);
    log(`${who(S.players[1 - P.idx])}選了${who(P)}生命區第 ${LP.picked.map((i) => i + 1).join("、")} 張翻開（${uids.map(nameOf).join("、")}）`);
    if (!P.life.length) S.over = `${who(P)}的生命區剩 0 張 —— ${who(S.players[1 - P.idx])}獲勝（觸發確認處理完才算數）`;
    // 翻開畫面：翻開的顯示卡面，沒翻的顯示背面，原本就空的顯示空格
    queueTriggers(P, uids);
    LP.done = true;
    LP.revealed = revealed;
    LP.left = before;
    render();
    renderLife();
  }
  function closeLife() { LP = null; AT = null; FXQ.length = 0; renderLife(); }
  function closeLifeOnly() { // 生命視窗按「好」：接著處理排隊中的觸發，最後是攻擊結束時效果
    const atk = LP && LP.done && LP.atk;
    LP = null;
    if (atk) fireAttackEnd(atk);
    renderLife();
  }

  /* ---------- 攻擊流程：指定攻擊 → 對手決定防禦 → 對戰或造成傷害（自動接下去） ---------- */
  // 規則書：攻擊角色轉為休息 → 對手可以用前線活動的角色防禦（轉為休息）→
  //   攻擊對象是角色：比 BP，攻擊方 ≥ 防禦方 → 防禦角色退場；否則攻擊方戰敗（攻擊角色不會退場）
  //   攻擊對象是玩家：造成 1 傷害（ダメージ❷ 等於 2），由攻擊方指定生命卡翻開做觸發確認
  let AT = null; // { uid, step: "block" | "battle", target }
  function startAttack(uid) {
    const P = PL(uid);
    const f = slotOf(uid);
    if (!f || f.s.rest || f.line !== "front") return toast("只有前線活動的角色可以攻擊");
    snap();
    f.s.rest = true;
    f.s.atk = (f.s.atk || 0) + 1;
    log(`${who(P)}：${nameOf(uid)} 攻擊`);
    if (kwOf(uid).twoAtk && f.s.atk === 1) { f.s.rest = false; log(`${nameOf(uid)}：2回アタック，第一次攻擊時置為活動`); }
    render();
    AT = { uid, step: "block", target: null, snipe: false };
    fireTiming(uid, "アタック時"); // 先處理攻擊時效果，再問對手要不要防禦
    renderLife();
  }
  function popCard(uid, extra = {}) {
    return cardEl(uid, { cls: "py-popcard", onclick: () => { const u = UA.officialList(card(uid))[0]; if (u) UA.openZoom(u, nameOf(uid)); }, ...extra });
  }
  function renderAttack() {
    const w = $("#pyLifeWrap");
    const box = $("#pyLife");
    const A = PL(AT.uid), Dp = S.players[1 - A.idx];
    box.textContent = "";
    if (AT.step === "block") {
      const blockers = Dp.front.filter((s) => s && !s.rest);
      const targets = Dp.front.filter(Boolean);
      box.append(el("h3", { text: AT.snipe ? `狙い撃ち：選要攻擊${who(Dp)}的哪張角色` : `${who(A)}的「${nameOf(AT.uid)}」攻擊！${who(Dp)}要防禦嗎？` }));
      const atkRow = el("ul", { class: "py-poprow" }, popCard(AT.uid, { bp: true, mod: slotMod(AT.uid) }));
      box.append(el("div", { class: "py-vs" }, el("span", { class: "py-lbl", text: "攻擊角色" }), atkRow));
      const list = AT.snipe ? targets : blockers;
      const row = el("ul", { class: "py-poprow" });
      list.forEach((s) => row.append(el("li", { class: "py-pick" },
        popCard(s.uid, { rest: s.rest, bp: true, mod: s.mod || 0 }),
        el("button", { type: "button", class: "btn small primary", onclick: () => { AT.snipe ? chooseTarget(s.uid, false) : chooseTarget(s.uid, true); } }, AT.snipe ? "攻擊這張" : "用這張防禦"))));
      if (!list.length) row.append(el("li", { class: "py-empty", text: AT.snipe ? "對手前線沒有角色" : "對手前線沒有活動的角色可以防禦" }));
      box.append(el("div", { class: "py-vs" }, el("span", { class: "py-lbl", text: AT.snipe ? `${who(Dp)}前線的角色` : `${who(Dp)}可以防禦的角色（前線・活動）` }), row));
      const btns = el("div", { class: "py-row py-life-btns" });
      if (!AT.snipe) {
        const canSnipe = !hasData(AT.uid) || kwOf(AT.uid).snipe;
        btns.append(
          canSnipe ? el("button", { type: "button", class: "btn", title: "攻擊角色有「狙い撃ち」時，可以改成攻擊對手前線的角色", onclick: () => { AT.snipe = true; renderAttack(); } }, "狙い撃ち（改攻擊角色）") : null,
          el("button", { type: "button", class: "btn primary", onclick: noBlock }, "不防禦（受到傷害）"));
      } else btns.append(el("button", { type: "button", class: "btn", onclick: () => { AT.snipe = false; renderAttack(); } }, "返回"));
      box.append(btns);
    } else {
      const T = AT.target;
      const mod = AT.mod || (AT.mod = { a: 0, d: 0 });
      const ba = bpNow(AT.uid) != null ? bpNow(AT.uid) : card(AT.uid).bp, bd = bpNow(T) != null ? bpNow(T) : card(T).bp;
      const known = Number.isInteger(ba) && Number.isInteger(bd);
      const ta = (ba || 0) + mod.a, td = (bd || 0) + mod.d;
      const adj = (side) => el("div", { class: "py-adj" }, ...[-1000, -500, 500, 1000].map((d) => el("button", {
        type: "button", class: "py-chip", onclick: () => { mod[side] += d; renderAttack(); },
      }, (d > 0 ? "+" : "−") + Math.abs(d))));
      const bpLine = (b, m, total) => el("div", { class: "py-bpline" },
        Number.isInteger(b) ? el("b", { text: `BP ${total.toLocaleString()}` }) : el("b", { text: "沒有 BP 資料" }),
        m ? el("span", { class: "py-sub", text: `（${b} ${m > 0 ? "+" : "−"} ${Math.abs(m)}）` }) : null);
      box.append(el("h3", { text: `對戰：${nameOf(AT.uid)} vs ${nameOf(T)}` }));
      box.append(el("div", { class: "py-battle" },
        el("div", { class: "py-vs" }, el("span", { class: "py-lbl", text: `${who(A)}（攻擊）` }), el("ul", { class: "py-poprow" }, popCard(AT.uid)), bpLine(ba, mod.a, ta), adj("a")),
        el("b", { class: "py-vs-mark", text: "VS" }),
        el("div", { class: "py-vs" }, el("span", { class: "py-lbl", text: `${who(Dp)}（${AT.blocked ? "防禦" : "被攻擊"}）` }), el("ul", { class: "py-poprow" }, popCard(T)), bpLine(bd, mod.d, td), adj("d"))));
      const atkWins = known ? ta >= td : null;
      box.append(el("p", { class: "py-sub", text: known
        ? `攻擊方 BP ${ta.toLocaleString()} ${ta >= td ? "≥" : "<"} 防禦方 BP ${td.toLocaleString()} → ${ta >= td ? "攻擊方勝，被攻擊的角色退場" : "防禦方勝，攻擊角色不會退場"}。有效果改變 BP 的話，用上面的 ± 按鈕調整。`
        : "有一方沒有 BP 資料（請先用擴充功能匯入卡拍拍），請看卡片自己判斷：攻擊方 BP 大於或等於對方 → 攻擊方勝。" }));
      const winA = () => {
        snap();
        const atk = AT.uid;
        log(`對戰結果：${who(A)}的「${nameOf(atk)}」${known ? `（BP ${ta}）` : ""}勝`);
        // インパクト：攻擊後戰勝時，對對手造成傷害（對方有インパクト無効就沒有）
        const k = kwOf(atk);
        let impact = k.impact || 0;
        if (k.impactPlus) impact = impact ? impact + k.impactPlus : k.impactPlus;
        if (kwOf(T).noImpact) impact = 0;
        retire(T, "對戰戰敗");
        if (impact > 0 && Dp.life.length) FXQ.push({ task: () => { log(`${nameOf(atk)}：インパクト ${impact}`); takeDamage(Dp, impact, atk); } });
        else fireAttackEnd(atk); // 有インパクト的話，等翻完生命才算攻擊結束
        AT = null; render(); renderLife();
      };
      const winD = () => { log(`對戰結果：${who(Dp)}的「${nameOf(T)}」${known ? `（BP ${td}）` : ""}勝，${nameOf(AT.uid)}${known ? `（BP ${ta}）` : ""} 不會退場`); fireAttackEnd(AT.uid); AT = null; renderLife(); render(); };
      AT.confirm = atkWins === false ? winD : winA; // 電腦對手用：照 BP 結果確定（沒有 BP 資料時當攻擊方勝）
      if (atkWins === null) AT.confirm = winA;
      const row = el("div", { class: "py-row py-life-btns" });
      if (atkWins === null) row.append(
        el("button", { type: "button", class: "btn", onclick: winD }, "防禦方勝"),
        el("button", { type: "button", class: "btn primary", onclick: winA }, "攻擊方勝（對方角色退場）"));
      else row.append(
        el("button", { type: "button", class: "btn small", title: "效果造成不同結果時才用", onclick: atkWins ? winD : winA }, atkWins ? "改成防禦方勝" : "改成攻擊方勝"),
        el("button", { type: "button", class: "btn primary", onclick: atkWins ? winA : winD }, atkWins ? `確定：攻擊方勝（${nameOf(T)} 退場）` : "確定：防禦方勝"));
      box.append(row);
    }
    w.hidden = false;
  }
  function noBlock() {
    const atk = AT.uid, Dp = S.players[1 - PL(atk).idx];
    AT = null; log(`${who(Dp)}不防禦`);
    const k = kwOf(atk);
    takeDamage(Dp, (k.damage || 1) + (k.damagePlus || 0), atk); // ダメージ❷／+1 自動套用
  }
  function chooseTarget(tuid, blocked) {
    const Dp = PL(tuid);
    if (blocked) {
      snap();
      const f = slotOf(tuid);
      if (f) {
        f.s.rest = true;
        f.s.blk = (f.s.blk || 0) + 1;
        if (kwOf(tuid).twoBlk && f.s.blk === 1) f.s.rest = false;
      }
      log(`${who(Dp)}：${nameOf(tuid)} 防禦${f && !f.s.rest ? "（2回ブロック，置為活動）" : ""}`);
      render();
      fireTiming(tuid, "ブロック時");
    } else log(`狙い撃ち：攻擊${who(Dp)}的「${nameOf(tuid)}」`);
    AT.step = "battle";
    AT.target = tuid;
    AT.blocked = blocked;
    renderLife();
  }
  function drawOne(P) {
    if (!P.deck.length) return toast("卡組沒有卡了");
    snap();
    P.hand.push(P.deck.shift());
    log(`${who(P)}抽 1 張（效果）`);
    render();
  }

  /* ---------- 移動卡片（永遠回到主人自己的區域） ---------- */
  function detach(uid) {
    const P = PL(uid);
    for (const key of ["deck", "hand", "life", "outside", "remove", "reveal"]) {
      const i = P[key].indexOf(uid);
      if (i >= 0) { P[key].splice(i, 1); return { from: key, under: [] }; }
    }
    for (const line of ["front", "energy"]) {
      const i = P[line].findIndex((s) => s && s.uid === uid);
      if (i >= 0) { const s = P[line][i]; P[line][i] = null; return { from: line, under: s.under || [], slot: s }; }
    }
    return null;
  }
  function toPile(uid, pile, where = "top") {
    const P = PL(uid);
    const d = detach(uid);
    if (!d) return;
    if (pile === "deck") { where === "top" ? P.deck.unshift(uid) : P.deck.push(uid); }
    else P[pile].push(uid);
    for (const u of d.under) P.outside.push(u); // 規則：突襲底下的卡一律放到場外（不算退場）
  }
  function move(uid, pile, where) {
    snap();
    toPile(uid, pile, where);
    log(`${who(PL(uid))}：${nameOf(uid)} → ${PILE_NAME[pile]}${pile === "deck" ? (where === "top" ? "頂" : "底") : ""}`);
    render();
  }
  function placeOnLine(uid, line, { rest = true, payCost = 0, why = "登場", slot = -1 } = {}) {
    const P = PL(uid);
    const go = () => {
      const i = slot >= 0 && !P[line][slot] ? slot : freeSlot(P, line);
      if (i < 0) return chooseReplace(P, line, go);
      snap();
      const d = detach(uid);
      P[line][i] = { uid, rest, under: d && d.under ? d.under : [] };
      if (payCost) payAP(P, payCost);
      log(`${who(P)}：${nameOf(uid)} ${why}到${LINE_NAME[line]}${payCost ? `（支付 ${payCost}AP）` : ""}`);
      render();
      fireTiming(uid, "登場時");
      renderLife();
    };
    go();
  }
  function chooseReplace(P, line, then) {
    sheet(`${who(P)}的${LINE_NAME[line]}已經有 4 張`, "照規則要先選 1 張場上的卡放到移除區：", P[line].map((s) => s && {
      label: `把「${nameOf(s.uid)}」放到移除區`,
      run: () => { snap(); toPile(s.uid, "remove"); log(`${who(P)}：${nameOf(s.uid)} 放到移除區（騰出空位）`); then(); },
    }).filter(Boolean));
  }
  function withAP(uid, run) {
    const P = PL(uid);
    const cost = Number.isInteger(card(uid).ap) ? card(uid).ap : null;
    if (cost == null) return sheet("這張卡沒有消耗 AP 資料", "請選擇要支付多少 AP：", [0, 1, 2, 3].map((n) => ({ label: `支付 ${n}AP`, run: () => run(n) })));
    if (apAvail(P) >= cost) return run(cost);
    sheet("AP 不夠", `這張要消耗 ${cost}AP，${who(P)}目前剩 ${apAvail(P)} 張活動的 AP 卡。`, [
      { label: "仍然使用（不扣 AP，例如有效果讓它免費）", run: () => run(0) },
    ]);
  }
  // 突襲（レイド）：只有寫著［レイド］〈卡名〉的卡能突襲，而且只能疊到自己場上名字相符、本身沒有レイド的角色上
  // 沒有效果資料的卡不擋（照你自己判斷）
  function raidWant(uid) {
    const c = card(uid);
    const m = String(c.effect || "").match(/\[レイド\]〈([^〉]+)〉/);
    if (m) return m[1].replace(/\s+/g, "");
    return hasData(uid) ? false : null; // false = 沒有突襲；null = 沒資料
  }
  function raidOk(uid, target) {
    const want = raidWant(uid);
    if (want === null) return true;
    if (want === false) return false;
    const t = card(target);
    return String(t.name || "").replace(/\s+/g, "").includes(want) && !/^\[レイド\]/.test(t.effect || "");
  }
  function raidWhyNot(uid, target) {
    const want = raidWant(uid);
    if (want === false) return `「${nameOf(uid)}」沒有突襲（レイド），不能疊到角色上`;
    return `「${nameOf(uid)}」只能突襲到〈${(card(uid).effect.match(/\[レイド\]〈([^〉]+)〉/) || [])[1]}〉上${target ? `，「${nameOf(target)}」不行` : ""}`;
  }
  function energyText(P) {
    const { g, unknown } = energyAvail(P);
    const parts = Object.entries(g).filter(([, v]) => v).map(([k, v]) => `${k === "虹" ? "任意色" : COLOR_ZH[k] || k}${v}`);
    return parts.length ? `能源 ${parts.join("・")}${unknown ? "（有卡沒資料）" : ""}` : unknown ? "能源（有卡沒資料）" : "能源 0";
  }
  function raid(uid, free = false) {
    const P = PL(uid);
    if (raidWant(uid) === false) return toast(raidWhyNot(uid));
    const targets = [];
    for (const line of ["front", "energy"]) P[line].forEach((s, i) => { if (s && raidOk(uid, s.uid)) targets.push({ line, i, s }); });
    if (!targets.length) return toast(raidWant(uid) ? `場上沒有可以突襲的〈${card(uid).effect.match(/\[レイド\]〈([^〉]+)〉/)[1]}〉` : "場上沒有可以突襲的角色");
    sheet("突襲：選擇要重疊在哪張角色上", "突襲元卡的效果會無效；突襲後置為活動。", targets.map(({ line, i, s }) => ({
      label: `${LINE_NAME[line]}：${nameOf(s.uid)}`,
      run: () => raidOnto(uid, line, i, free),
    })));
  }
  function raidOnto(uid, line, i, free = false, auto = false) {
    const P = PL(uid);
    const s = P[line][i];
    if (!s) return;
    (free ? (fn) => checkEnergy(uid, () => fn(0)) : (fn) => playFromHand(uid, fn))((cost) => {
      snap();
      detach(uid);
      P[line][i] = { uid, rest: false, under: [s.uid, ...(s.under || [])], fd: (s.fd || []).slice() };
      if (cost) payAP(P, cost);
      log(`${who(P)}：${nameOf(uid)} 突襲到「${nameOf(s.uid)}」上${cost ? `（支付 ${cost}AP）` : ""}`);
      render();
      fireTiming(uid, "登場時");
      renderLife();
      if (line === "energy" && auto) { if (freeSlot(P, "front") >= 0) moveLine(uid, "front"); }
      else if (line === "energy") sheet("突襲完成", "在能源線突襲的角色可以移動到前線：", [
        { label: "移到前線", run: () => moveLine(uid, "front") },
        { label: "留在能源線", run: () => {} },
      ]);
    });
  }
  function moveLine(uid, to, slot = -1) {
    const P = PL(uid);
    const from = to === "front" ? "energy" : "front";
    if (to === "energy" && hasData(uid) && !kwOf(uid).step) return toast(`「${nameOf(uid)}」沒有ステップ，不能從前線移到能源線`);
    const i = P[from].findIndex((s) => s && s.uid === uid);
    if (i < 0) return;
    const go = () => {
      const j = slot >= 0 && !P[to][slot] ? slot : freeSlot(P, to);
      if (j < 0) return chooseReplace(P, to, go);
      snap();
      const s = P[from][i];
      P[from][i] = null;
      P[to][j] = s;
      log(`${who(P)}：${nameOf(uid)} 移到${LINE_NAME[to]}`);
      render();
    };
    go();
  }
  function slotOf(uid) {
    const P = PL(uid);
    for (const line of ["front", "energy"]) { const s = P[line].find((x) => x && x.uid === uid); if (s) return { s, line }; }
    return null;
  }
  function setRest(uid, rest, why) {
    const f = slotOf(uid);
    if (!f) return;
    snap();
    f.s.rest = rest == null ? !f.s.rest : rest;
    log(why || `${who(PL(uid))}：${nameOf(uid)} ${f.s.rest ? "轉為休息" : "置為活動"}`);
    render();
  }

  /* ---------- 點卡片的選單 ---------- */
  // 各階段可以做的事（照規則書）：
  //   起始：只能額外抽卡　移動：只能把角色在前線／能源線之間移動　主要：使用卡片、起動效果等全部
  //   攻擊：攻擊、防禦、處理觸發效果（不能使用手牌）　結束：只能把多的手牌放到移除區
  const PHASE_BLOCK = ["起始階段只能額外抽卡", "移動階段只能移動角色（能源線 ↔ 前線）", "", "攻擊階段不能使用手牌", "結束階段只能把多的手牌放到移除區"];
  function cardMenu(uid, zone) {
    const c = card(uid);
    const P = PL(uid);
    const mine = P.idx === S.cur;
    const ph = S.phase;
    const info = [who(P), c.num, c.color || "", Number.isInteger(c.energy) ? `能源 ${c.energy}` : "", Number.isInteger(c.ap) ? `AP ${c.ap}` : "", Number.isInteger(c.bp) ? `BP ${c.bp}` : ""].filter(Boolean).join("・");
    const zoom = { label: "放大看卡", run: () => { const u = UA.officialList(c)[0]; if (u) UA.openZoom(u, c.name); } };
    const items = [];
    let note = "";
    const toPiles = (list) => list.forEach(([label, pile, where]) => items.push({ label, run: () => move(uid, pile, where) }));
    if (zone === "hand") {
      if (ph === 2) {
        items.push(
          { label: "角色登場到前線（休息）", run: () => playFromHand(uid, (cost) => placeOnLine(uid, "front", { payCost: cost })) },
          { label: "登場到能源線（休息）", run: () => playFromHand(uid, (cost) => placeOnLine(uid, "energy", { payCost: cost })) },
          raidWant(uid) !== false ? { label: "突襲", run: () => raid(uid) } : null,
          { label: "使用事件卡（用完放到場外）", run: () => useEvent(uid) },
        );
        toPiles([["放到場外", "outside"], ["放到移除區", "remove"], ["放回牌庫頂", "deck", "top"], ["放回牌庫底", "deck", "bottom"]]);
      } else if (ph === 4) toPiles([["放到移除區（手牌超過 8 張時）", "remove"]]);
      else note = PHASE_BLOCK[ph];
    } else if (zone === "front" || zone === "energy") {
      const f = slotOf(uid);
      const s = f && f.s;
      const lineMoves = () => {
        if (zone === "energy") items.push({ label: "移到前線", run: () => moveLine(uid, "front") });
        else if (!hasData(uid) || kwOf(uid).step) items.push({ label: "移到能源線（ステップ）", run: () => moveLine(uid, "energy") });
      };
      const effects = () => {
        items.push({ label: s && s.rest ? "置為活動（直向）" : "轉為休息（橫向）", run: () => setRest(uid) });
        items.push({ label: "退場（放到場外）", run: () => { snap(); retire(uid); render(); renderLife(); } });
        toPiles([["放到移除區", "remove"], ["回到手牌", "hand"], ["放回牌庫頂", "deck", "top"], ["放回牌庫底", "deck", "bottom"]]);
      };
      if (ph === 1) { if (mine) lineMoves(); else note = PHASE_BLOCK[1]; }
      else if (ph === 2) {
        if (mine) fxOf(c).abil.filter((a) => a.timing === "起動メイン").forEach((a) => items.unshift({ label: `發動起動メイン${a.turn1 ? "（ターン1）" : ""}${a.costs.length ? `〔${a.costs.join("・")}〕` : ""}：${a.text.replace(/［[^］]*］/g, "").slice(0, 24)}…`, run: () => activate(uid, a) }));
        effects();
        if (mine) lineMoves();
      }
      else if (ph === 3) {
        if (mine && zone === "front" && s && !s.rest) items.push({ label: "攻擊", run: () => startAttack(uid) });
        effects(); // 觸發效果可能讓角色退場、回手等
      } else note = PHASE_BLOCK[ph];
      if (s && s.under && s.under.length) items.push({ label: `下面的卡（${s.under.length} 張${(s.fd || []).length ? `・背面 ${s.fd.length} 張` : ""}）`, run: () => underView(uid) });
      if (s && (ph === 2 || ph === 3)) items.push({ label: "從場外選卡放到這張角色下面（背面朝上）", run: () => {
        pickCards(`放到「${c.name}」下面`, P.outside.slice(), 99, true, (list) => {
          snap();
          const f2 = slotOf(uid);
          for (const u of list) { detach(u); f2.s.under = f2.s.under || []; f2.s.under.push(u); f2.s.fd = f2.s.fd || []; f2.s.fd.push(u); }
          log(`${who(P)}：${list.map(nameOf).join("、")} 放到「${c.name}」下面（背面朝上）`);
          render();
        });
      } });
    } else {
      // 牌庫／場外／移除區／生命區／觸發確認區：主要階段（效果）和攻擊階段（觸發效果）才能動
      if (ph === 2 || ph === 3) {
        items.push(
          { label: "加入手牌", run: () => move(uid, "hand") },
          { label: "登場到前線（休息）", run: () => placeOnLine(uid, "front") },
          { label: "登場到能源線（休息）", run: () => placeOnLine(uid, "energy") },
        );
        if (zone !== "outside") items.push({ label: "放到場外", run: () => move(uid, "outside") });
        if (zone !== "remove") items.push({ label: "放到移除區", run: () => move(uid, "remove") });
        if (zone !== "deck") items.push({ label: "放到牌庫頂", run: () => move(uid, "deck", "top") }, { label: "放到牌庫底", run: () => move(uid, "deck", "bottom") });
        if (zone !== "life") items.push({ label: "放到生命區（最上面）", run: () => { snap(); detach(uid); P.life.unshift(uid); log(`${who(P)}：${c.name} 放到生命區`); render(); } });
      } else note = ph === 0 ? PHASE_BLOCK[0] : ph === 1 ? PHASE_BLOCK[1] : PHASE_BLOCK[4];
    }
    items.push(zoom);
    sheet(c.name, note ? `${info}\n※ ${note}` : info, items, c);
  }
  // 拖曳在這個階段可不可以
  function dropAllowed(uid, from, to) {
    const ph = S.phase, mine = ownerIdx(uid) === S.cur;
    const isLine = (z) => z === "front" || z === "energy";
    if (from === "hand") return ph === 2 || (ph === 4 && to === "remove");
    if (isLine(from)) {
      if (isLine(to)) return mine && (ph === 1 || ph === 2);
      return ph === 2 || ph === 3;
    }
    return ph === 2 || ph === 3; // 觸發確認區等
  }
  function useEvent(uid) {
    playFromHand(uid, (cost) => {
      const P = PL(uid), c = card(uid);
      snap(); toPile(uid, "outside"); if (cost) payAP(P, cost);
      log(`${who(P)}使用事件「${c.name}」${cost ? `（支付 ${cost}AP）` : ""}`);
      render();
      if (c.effect) { // 事件卡的效果直接跳出來處理
        FXQ.push({ owner: P.idx, title: `${who(P)}使用事件「${c.name}」`, uid, text: c.effect, actions: actionsFor(c.effect, P, null), buttons: [{ label: "處理完了", primary: true }] });
        renderLife();
      }
    });
  }

  /* ---------- 選單（從下方滑出） ---------- */
  function sheet(title, sub, items, c, opts = {}) {
    const box = $("#pySheet");
    box.textContent = "";
    const head = el("div", { class: "py-sh-head" });
    if (c) {
      const list = UA.imgCandidates(c, 240);
      if (list.length) { const im = el("img", { alt: "", referrerpolicy: "no-referrer" }); UA.setImgChain(im, list, () => im.remove()); head.append(im); }
    }
    head.append(el("div", {}, el("b", { text: title }), sub ? el("p", { text: sub }) : null));
    box.append(head);
    if (c && (c.effect || c.trigger)) box.append(el("div", { class: "py-sh-fx" },
      c.effect ? el("p", {}, el("b", { text: "效果　" }), ...fxNodes(c.effect)) : null,
      c.trigger ? el("p", {}, el("b", { text: "觸發　" }), ...fxNodes(c.trigger)) : null));
    const ul = el("div", { class: "py-sh-list" });
    for (const it of items) if (it) ul.append(el("button", { type: "button", class: `py-sh-btn ${it.cls || ""}`, onclick: () => { closeSheet(); it.run(); } }, it.label));
    if (!opts.noCancel) ul.append(el("button", { type: "button", class: "py-sh-btn cancel", onclick: closeSheet }, "取消"));
    box.append(ul);
    $("#pySheetWrap").hidden = false;
  }
  function closeSheet() {
    const w = $("#pySheetWrap");
    if (w) w.hidden = true;
    clearInterval(revTimer);
    if (REVQ.length) { REVQ.shift(); if (REVQ.length) drawReveal(); else aiPump(); }
  }
  function pileView(zone, list, title, P) {
    const box = $("#pySheet");
    box.textContent = "";
    box.append(el("div", { class: "py-sh-head" }, el("div", {}, el("b", { text: `${title}（${list.length} 張）` }),
      zone === "deck" ? el("p", { text: "由上到下排列。看完記得按「洗牌」。" }) : zone === "life" ? el("p", { text: "生命區正常是背面朝上，看完請當作沒看到喔。" }) : null)));
    const grid = el("ul", { class: "py-pile" });
    list.forEach((uid) => grid.append(cardEl(uid, { onclick: () => { if (zone) { closeSheet(); cardMenu(uid, zone); } else { const u = UA.officialList(card(uid))[0]; if (u) UA.openZoom(u, nameOf(uid)); } } })));
    if (!list.length) grid.append(el("li", { class: "py-empty", text: "沒有卡" }));
    box.append(grid);
    const btns = el("div", { class: "py-sh-list row" });
    if (zone === "deck" && P) btns.append(el("button", { type: "button", class: "py-sh-btn", onclick: () => { snap(); shuffle(P.deck); log(`${who(P)}洗牌`); closeSheet(); render(); toast("已洗牌"); } }, "洗牌"));
    btns.append(el("button", { type: "button", class: "py-sh-btn cancel", onclick: closeSheet }, "關閉"));
    box.append(btns);
    $("#pySheetWrap").hidden = false;
  }

  /* ---------- 卡片元素＋拖曳 ---------- */
  function cardEl(uid, { rest = false, back = false, badge = "", onclick, cls = "", drag = "", drop = null, bp = false, mod = 0 } = {}) {
    const c = card(uid);
    const li = el("li", { class: `py-card ${rest ? "rest" : ""} ${back ? "back" : ""} ${drag ? "draggable" : ""} ${cls}`, title: back ? "" : c.name });
    if (drop) { li.dataset.drop = drop.zone; li.dataset.slot = drop.slot; li.dataset.owner = drop.owner; }
    const inner = el("div", { class: "py-in" });
    if (back) inner.append(el("div", { class: "py-back" }));
    else {
      const list = UA.imgCandidates(c, 240);
      if (list.length) {
        const im = el("img", { alt: c.name, loading: "lazy", referrerpolicy: "no-referrer", decoding: "async" });
        UA.setImgChain(im, list, () => im.replaceWith(el("div", { class: "py-noimg", text: c.name })));
        inner.append(im);
      } else inner.append(el("div", { class: "py-noimg", text: c.name }));
    }
    li.append(inner);
    if (badge) li.append(el("span", { class: "py-badge", text: badge }));
    if (bp && Number.isInteger(c.bp) && !back) {
      const v = c.bp + (mod || 0);
      li.append(el("span", { class: `py-bpv ${mod > 0 ? "up" : mod < 0 ? "down" : ""}`, text: Math.abs(v) >= 1000 ? (v / 1000).toFixed(v % 1000 ? 1 : 0) + "k" : String(v), title: `BP ${v}${mod ? `（原本 ${c.bp}）` : ""}` }));
    }
    if (onclick) {
      li.tabIndex = 0;
      li.addEventListener("click", onclick);
      li.addEventListener("keydown", (e) => { if (e.key === "Enter") onclick(); });
    }
    if (drag) li.addEventListener("pointerdown", (e) => dragStart(e, uid, drag, li));
    return li;
  }

  let D = null;
  function dragStart(e, uid, zone, li) {
    if (e.button > 0 || S.stage !== "play") return;
    D = { uid, zone, li, x0: e.clientX, y0: e.clientY, on: false, pid: e.pointerId, ghost: null, hover: null };
    window.addEventListener("pointermove", dragMove, { passive: false });
    window.addEventListener("pointerup", dragEnd);
    window.addEventListener("pointercancel", dragCancel);
  }
  function dragMove(e) {
    if (!D || e.pointerId !== D.pid) return;
    const dx = e.clientX - D.x0, dy = e.clientY - D.y0;
    if (!D.on) {
      if (Math.hypot(dx, dy) < 10) return;
      D.on = true;
      const r = D.li.getBoundingClientRect();
      const w = Math.min(Math.max(r.width, 70), 110);
      const g = D.li.querySelector(".py-in").cloneNode(true);
      g.className = "py-ghost";
      g.style.width = w + "px";
      g.style.height = w * 837 / 600 + "px";
      D.ghost = g;
      D.gw = w;
      document.body.append(g);
      D.li.classList.add("dragging");
      $("#playView").classList.add("is-dragging");
      try { D.li.setPointerCapture(D.pid); } catch (err) {}
    }
    e.preventDefault();
    autoScroll(e.clientY);
    D.ghost.style.transform = `translate(${e.clientX - D.gw / 2}px, ${e.clientY - D.gw * 0.7}px) rotate(-4deg)`;
    const t = dropTargetAt(e.clientX, e.clientY);
    if (t !== D.hover) {
      if (D.hover) D.hover.classList.remove("drop-hover");
      D.hover = t;
      if (t) t.classList.add("drop-hover");
    }
  }
  // 拖到畫面上下邊緣時自動捲動（手機上場地和手牌不一定同時看得到）
  let scrollTimer = null, scrollV = 0;
  function autoScroll(y) {
    const b = $("#pyBoard").getBoundingClientRect();
    const edge = 60;
    scrollV = y < b.top + edge ? -Math.ceil((b.top + edge - y) / 4) : y > b.bottom - edge ? Math.ceil((y - (b.bottom - edge)) / 4) : 0;
    if (scrollV && !scrollTimer) scrollTimer = setInterval(() => {
      if (!scrollV || !D) { clearInterval(scrollTimer); scrollTimer = null; return; }
      $("#pyBoard").scrollTop += scrollV;
    }, 16);
  }
  function dropTargetAt(x, y) {
    const n = document.elementFromPoint(x, y);
    const t = n && n.closest ? n.closest("[data-drop]") : null;
    // 只能放到這張卡主人自己的區域
    return t && D && +t.dataset.owner === ownerIdx(D.uid) ? t : null;
  }
  function dragCleanup() {
    scrollV = 0;
    window.removeEventListener("pointermove", dragMove);
    window.removeEventListener("pointerup", dragEnd);
    window.removeEventListener("pointercancel", dragCancel);
    if (D && D.ghost) D.ghost.remove();
    if (D && D.hover) D.hover.classList.remove("drop-hover");
    if (D && D.li) D.li.classList.remove("dragging");
    const v = $("#playView");
    if (v) v.classList.remove("is-dragging");
  }
  function dragCancel() { dragCleanup(); D = null; }
  function dragEnd(e) {
    if (!D || e.pointerId !== D.pid) return;
    const d = D;
    const t = d.on ? dropTargetAt(e.clientX, e.clientY) : null;
    dragCleanup();
    D = null;
    if (!d.on) return; // 沒拖動 → 交給 click 開選單
    const eat = (ev) => { ev.stopPropagation(); ev.preventDefault(); }; // 吃掉放開後的 click
    window.addEventListener("click", eat, true);
    setTimeout(() => window.removeEventListener("click", eat, true), 0);
    if (t) dropTo(d.uid, d.zone, t.dataset.drop, t.dataset.slot != null && t.dataset.slot !== "" ? +t.dataset.slot : -1);
  }
  function dropTo(uid, from, to, slot) {
    const P = PL(uid);
    if (!dropAllowed(uid, from, to)) {
      const ph = S.phase;
      return toast(from === "hand" && ph !== 2 && ph !== 4 ? PHASE_BLOCK[ph] || "這個階段不能這樣做" : ph === 4 ? PHASE_BLOCK[4] : ph === 0 ? PHASE_BLOCK[0] : ph === 1 ? PHASE_BLOCK[1] : "這個階段不能這樣做");
    }
    const isLine = (z) => z === "front" || z === "energy";
    if (isLine(to)) {
      const target = slot >= 0 ? P[to][slot] : null;
      if (from === "hand") {
        if (target) return raidOk(uid, target.uid) ? raidOnto(uid, to, slot) : toast(raidWhyNot(uid, target.uid)); // 拖到自己場上的角色上 = 突襲
        return playFromHand(uid, (cost) => placeOnLine(uid, to, { payCost: cost, slot }));
      }
      if (isLine(from)) {
        if (target && target.uid === uid) return;
        if (from === to) {
          const i = P[from].findIndex((x) => x && x.uid === uid);
          if (slot < 0 || i < 0) return;
          snap();
          [P[to][i], P[to][slot]] = [P[to][slot], P[to][i]];
          log(`${who(P)}：${nameOf(uid)} 換位置`);
          return render();
        }
        return moveLine(uid, to, slot);
      }
      return placeOnLine(uid, to, { slot });
    }
    if (to === from) return;
    if (to === "outside" && from === "hand") {
      return sheet(nameOf(uid), "拖到場外：", [
        { label: "使用事件卡（扣 AP，用完放到場外）", run: () => useEvent(uid) },
        { label: "直接放到場外（不扣 AP）", run: () => move(uid, "outside") },
      ], card(uid));
    }
    if (to === "deck") return move(uid, "deck", "top");
    if (["outside", "remove", "hand"].includes(to)) return move(uid, to);
  }

  /* ======================= 電腦對手（規則型） =======================
     照規則出牌、移動、攻擊、防禦、選生命卡；認得的效果會自動用（目標挑 BP 最高的），認不出來的效果跳過。
     每一步間隔一下，讓你看得到它在做什麼。 */
  let AUTO_PICK = null;
  let aiTimer = null, aiBusy = false;
  const isAI = (idx) => !!(S && S.ai && S.ai[idx]);
  const AI_DELAY = 750;
  function aiPump() {
    if (!open || !S || !S.ai || !S.ai.some(Boolean) || S.over) return;
    clearTimeout(aiTimer);
    aiTimer = setTimeout(() => { if (!aiBusy) { aiBusy = true; try { aiStep(); } finally { aiBusy = false; } } }, AI_DELAY);
  }
  // 電腦選目標：對手的卡挑 BP 最高；自己的卡（加 BP、置為活動）也挑 BP 最高；有限制（每種費用 1 張）就照規則挑
  function aiChooser(uids, n, upTo, rule) {
    const sorted = uids.slice().sort((a, b) => (bpNow(b) ?? card(b).bp ?? 0) - (bpNow(a) ?? card(a).bp ?? 0));
    const sel = [];
    for (const u of sorted) { if (sel.length >= n) break; if (rule && rule(sel, u)) continue; sel.push(u); }
    return sel;
  }
  function aiRaidTarget(uid) {
    const m = String(card(uid).effect || "").match(/\[レイド\]〈([^〉]+)〉/);
    if (!m) return null;
    const want = m[1].replace(/\s+/g, "");
    const P = PL(uid);
    for (const line of ["front", "energy"]) for (let i = 0; i < SLOTS; i++) {
      const s2 = P[line][i];
      if (s2 && card(s2.uid).name.replace(/\s+/g, "").includes(want) && !String(card(s2.uid).effect || "").startsWith("[レイド]")) return { line, i };
    }
    return null;
  }
  const energyHave = (P, col) => { const { g } = energyAvail(P); return (g[col] || 0) + (g.虹 || 0); };
  const canPay = (uid) => {
    const c = card(uid), P = PL(uid);
    const apOk = !Number.isInteger(c.ap) || apAvail(P) >= c.ap;
    const enOk = !c.color || !Number.isInteger(c.energy) || c.energy <= 0 || energyHave(P, c.color) >= c.energy;
    return apOk && enOk;
  };
  const genCount = (P) => P.energy.filter(Boolean).reduce((n, s2) => n + Object.values(card(s2.uid).gen || { x: 1 }).reduce((a, b) => a + b, 0), 0);
  const energyNeed = (P) => Math.min(6, Math.max(2, ...P.hand.map((u) => card(u).energy || 0)));
  const isEvent = (c) => /イベント/.test(c.type || "");
  const isField = (c) => /フィールド/.test(c.type || "");
  // 執行一個效果視窗裡電腦覺得「好」的按鈕
  function aiResolvePrompt(p) {
    AUTO_PICK = aiChooser;
    try {
      for (const a of p.actions || []) if (a.ai === "good" && !a.done) a.run(() => { a.done = true; });
    } finally { AUTO_PICK = null; }
    FXQ.shift();
    const b = (p.buttons || []).find((x) => x.primary) || (p.buttons || [])[0];
    if (b && b.run) b.run();
    log(`（電腦處理完：${p.title}）`);
    render(); renderLife();
  }
  function aiStep() {
    if (!S || S.over) return;
    if (REVQ.length) return; // 等你看完電腦公開的卡
    // 1. 生命視窗：攻擊方是電腦 → 隨機挑生命卡翻開；翻完自動關
    if (LP) {
      const atkIdx = 1 - LP.P.idx;
      if (!isAI(atkIdx)) return;
      if (!LP.done) {
        const need = Math.min(LP.n, LP.P.life.length);
        const idx = shuffle(LP.P.life.map((_, i) => i)).slice(0, need);
        LP.picked = idx;
        flipLife();
      } else closeLifeOnly();
      return aiPump();
    }
    // 2. 效果視窗：主人是電腦就自動處理
    if (FXQ.length) {
      const p = FXQ[0];
      if (p.task) { renderLife(); return aiPump(); }
      if (isAI(p.owner)) { aiResolvePrompt(p); return aiPump(); }
      return;
    }
    // 3. 攻擊中
    if (AT) {
      const A = PL(AT.uid), Dp = S.players[1 - A.idx];
      if (AT.step === "block" && isAI(Dp.idx) && !AT.snipe) {
        const abp = bpNow(AT.uid) ?? 0;
        const blockers = Dp.front.filter((x) => x && !x.rest).map((x) => x.uid);
        const winners = blockers.filter((u) => (bpNow(u) ?? 0) > abp).sort((a, b) => bpNow(a) - bpNow(b));
        const k = kwOf(AT.uid), dmg = (k.damage || 1) + (k.damagePlus || 0);
        if (winners.length) chooseTarget(winners[0], true);
        else if (blockers.length && Dp.life.length <= dmg) chooseTarget(blockers.sort((a, b) => bpNow(a) - bpNow(b))[0], true); // 快輸了就擋
        else noBlock();
        return aiPump();
      }
      if (AT.step === "block" && AT.snipe && AT.pendingSnipe && isAI(A.idx)) { const t = AT.pendingSnipe; AT.pendingSnipe = null; chooseTarget(t, false); return aiPump(); }
      if (AT.step === "battle" && isAI(A.idx) && AT.confirm) { AT.confirm(); return aiPump(); }
      return;
    }
    if (!$("#pySheetWrap").hidden) return;
    // 4. 換手牌
    if (S.stage === "mull" && isAI(S.mullIdx)) {
      const P = S.players[S.mullIdx];
      const cheap = P.hand.filter((u) => (card(u).energy || 0) <= 2 && !isEvent(card(u))).length;
      mulligan(cheap < 2);
      return aiPump();
    }
    if (S.stage !== "play" || !isAI(S.cur)) return;
    const P = CUR(), opp = S.players[1 - P.idx];
    // 5. 自己的回合
    if (S.phase === 0) {
      if (!P.extraDrawn && P.hand.length <= 3 && apAvail(P) >= 2 && P.deck.length) { extraDraw(); return aiPump(); }
      nextPhase(); return aiPump();
    }
    if (S.phase === 1) {
      const need = energyNeed(P);
      for (let i = 0; i < SLOTS; i++) {
        const s2 = P.energy[i];
        if (!s2 || isField(card(s2.uid)) || freeSlot(P, "front") < 0) continue;
        const g = Object.values(card(s2.uid).gen || { x: 1 }).reduce((a, b) => a + b, 0);
        if (genCount(P) - g >= need) { moveLine(s2.uid, "front"); return aiPump(); }
      }
      nextPhase(); return aiPump();
    }
    if (S.phase === 2) {
      // 突襲
      for (const u of P.hand) {
        const t = aiRaidTarget(u);
        if (t && canPay(u)) { raidOnto(u, t.line, t.i, false, true); return aiPump(); }
      }
      // 角色、場域（費用高的先出）
      const playable = P.hand.filter((u) => !isEvent(card(u)) && !/^\[レイド\]/.test(card(u).effect || "") && canPay(u)).sort((a, b) => (card(b).energy || 0) - (card(a).energy || 0));
      for (const u of playable) {
        const c = card(u);
        const wantEnergy = isField(c) || genCount(P) < energyNeed(P) || freeSlot(P, "front") < 0;
        const line = wantEnergy && freeSlot(P, "energy") >= 0 ? "energy" : freeSlot(P, "front") >= 0 && !isField(c) ? "front" : null;
        if (!line) continue;
        placeOnLine(u, line, { payCost: Number.isInteger(c.ap) ? c.ap : 1 });
        return aiPump();
      }
      // 事件：有「好」的效果才用
      for (const u of P.hand.filter((x) => isEvent(card(x)) && canPay(x))) {
        const acts = actionsFor(card(u).effect || "", P, null);
        const good = acts.filter((a) => a.ai === "good");
        const hasTarget = good.some((a) => !/選對手/.test(a.label) || opp.front.concat(opp.energy).some(Boolean));
        if (good.length && hasTarget) { useEvent(u); return aiPump(); }
      }
      // 起動メイン
      for (const line of ["front", "energy"]) for (const s2 of P[line]) {
        if (!s2) continue;
        for (const a of fxOf(card(s2.uid)).abil.filter((x) => x.timing === "起動メイン")) {
          const turnKey = `${S.cur}-${P.turn}`;
          if (a.turn1 && s2.used && s2.used[a.text] === turnKey) continue;
          if (a.where === "フロントLにある場合" && line !== "front") continue;
          if (a.where === "エナジーLにある場合" && line !== "energy") continue;
          const cost = a.costs.join("、");
          if (/レストにする/.test(cost) && s2.rest) continue;
          if (/このカードを退場/.test(cost)) continue; // 電腦不拿自己的卡當費用
          const ap = +((cost.match(/APを(\d+)支払/) || [])[1] || 0);
          if (ap && apAvail(P) < ap) continue;
          const good = actionsFor(a.text, P, s2.uid).filter((x) => x.ai === "good");
          if (!good.length) continue;
          if (good.some((x) => /選對手/.test(x.label)) && !opp.front.concat(opp.energy).some(Boolean)) continue;
          AUTO_PICK = aiChooser;
          try { activate(s2.uid, a); } finally { AUTO_PICK = null; }
          return aiPump();
        }
      }
      nextPhase(); return aiPump();
    }
    if (S.phase === 3) {
      const atk = P.front.find((x) => x && !x.rest);
      if (atk) {
        startAttack(atk.uid);
        // 狙い撃ち：挑打得贏的對手角色
        if (AT && kwOf(atk.uid).snipe) {
          const abp = bpNow(atk.uid) ?? 0;
          const t = opp.front.filter(Boolean).map((x) => x.uid).filter((u) => (bpNow(u) ?? 0) <= abp).sort((a, b) => bpNow(b) - bpNow(a))[0];
          if (t) { AT.snipe = true; AT.pendingSnipe = t; }
        }
        return aiPump();
      }
      nextPhase(); return aiPump();
    }
    if (S.phase === 4) {
      if (P.hand.length > 8) { // 丟掉最難出的（費用最高）
        const u = P.hand.slice().sort((a, b) => (card(b).energy || 0) - (card(a).energy || 0))[0];
        move(u, "remove");
        return aiPump();
      }
      nextPhase(); return aiPump();
    }
  }

  /* ---------- 畫面 ---------- */
  function render() {
    if (!open || !S) return;
    const root = $("#pyBoard");
    root.textContent = "";
    if (S.stage === "first") {
      const [A, B] = S.players;
      root.append(el("div", { class: "py-setup" },
        el("h3", { text: "準備開始" }),
        el("p", { text: `玩家 A：${A.deckName}（${A.total} 張）／玩家 B：${B.deckName}（${B.total} 張）。雙方都已洗牌。` }),
        el("p", { text: "請決定誰先攻（實際對戰用猜拳）。先攻第 1 回合 AP 1 張、不抽卡；後攻第 1 回合 AP 2 張。" }),
        el("div", { class: "py-row" },
          el("button", { class: "btn primary", type: "button", onclick: () => chooseFirst(0) }, "玩家 A 先攻"),
          el("button", { class: "btn primary", type: "button", onclick: () => chooseFirst(1) }, "玩家 B 先攻"))));
      return renderTop();
    }
    if (S.stage === "mull") {
      const P = S.players[S.mullIdx];
      if (isAI(P.idx)) { root.append(el("div", { class: "py-setup" }, el("h3", { text: `${who(P)}（電腦）正在決定要不要換手牌…` }))); aiPump(); return renderTop(); }
      const ul = el("ul", { class: "py-hand big" });
      P.hand.forEach((u) => ul.append(cardEl(u, { onclick: () => { const x = UA.officialList(card(u))[0]; if (x) UA.openZoom(x, nameOf(u)); } })));
      root.append(el("div", { class: "py-setup" },
        el("h3", { text: `${who(P)}的起手 7 張（${P.idx === S.first ? "先攻" : "後攻"}）` }),
        el("p", { text: "要換手牌嗎？最多可以換 1 次：手牌先放旁邊，重新抽 7 張，再把放旁邊的放回卡組洗牌。由先攻玩家先決定。" }),
        ul,
        el("div", { class: "py-row" },
          el("button", { class: "btn", type: "button", onclick: () => mulligan(true) }, "換手牌"),
          el("button", { class: "btn primary", type: "button", onclick: () => mulligan(false) }, "不換"))));
      aiPump();
      return renderTop();
    }
    if (S.over) root.append(el("div", { class: "py-over" }, S.over, el("button", { class: "btn small", type: "button", onclick: () => { snap(); S.over = ""; render(); } }, "知道了")));

    const layout = el("div", { class: "py-layout" });
    layout.append(sidePanel(S.players[0]), oppArea(S.players[1 - S.cur]), mainArea(CUR()), sidePanel(S.players[1]));
    root.append(layout);
    aiPump();
    root.append(el("details", { class: "py-log" }, el("summary", { text: S.log[0] ? `紀錄：${S.log[0]}` : "紀錄" }),
      el("ol", {}, ...S.log.map((t) => el("li", { text: t })))));
    renderTop();
  }

  // 左右兩邊的玩家資訊
  function sidePanel(P) {
    const active = P.idx === S.cur;
    const box = el("aside", { class: `py-side ${active ? "active" : ""} ${sideOpen[P.idx] ? "open" : ""} p${PN[P.idx]}` });
    box.append(el("div", { class: "py-side-head" },
      el("b", { text: who(P) }),
      el("span", { class: "py-tag", text: P.idx === S.first ? "先攻" : "後攻" }),
      active ? el("span", { class: "py-tag on", text: "回合中" }) : null,
      el("button", { type: "button", class: "py-more", "aria-expanded": sideOpen[P.idx] ? "true" : "false",
        onclick: () => { sideOpen[P.idx] = !sideOpen[P.idx]; render(); } }, sideOpen[P.idx] ? "收起" : "展開")),
      el("div", { class: "py-sub py-deckname", text: P.deckName }));
    const apRow = el("div", { class: "py-ap" });
    P.ap.forEach((rest, i) => {
      const usable = i < P.apCount;
      apRow.append(el("button", {
        type: "button", class: `py-apcard ${rest ? "rest" : ""} ${usable ? "" : "off"}`, disabled: !usable,
        title: usable ? (rest ? "已支付（休息）" : "活動") : "這回合還不能用",
        onclick: () => { snap(); P.ap[i] = !P.ap[i]; log(`${who(P)}：AP 卡 ${P.ap[i] ? "轉為休息（支付 1AP）" : "置為活動"}`); render(); },
      }, "AP"));
    });
    apRow.append(el("span", { class: "py-apinfo", text: `AP ${apAvail(P)}/${P.apCount}` }));
    box.append(apRow);
    box.append(el("div", { class: "py-piles" },
      pileBtn(P, "生命", "life", "py-life"),
      pileBtn(P, "牌庫", "deck", ""),
      pileBtn(P, "場外", "outside", ""),
      pileBtn(P, "移除區", "remove", "")));
    box.append(el("div", { class: "py-sub", text: `手牌 ${P.hand.length} 張` }));
    // 不是回合中的玩家：顯示他的場地縮圖（點了可以防禦、退場）
    if (!active) {
      for (const line of ["front", "energy"]) {
        const row = el("ul", { class: "py-mini" });
        P[line].forEach((s) => row.append(s ? cardEl(s.uid, { rest: s.rest, cls: s.skip ? "noup" : "", badge: underBadge(s, true), onclick: () => cardMenu(s.uid, line), bp: true, mod: s.mod || 0 }) : el("li", { class: "py-slot" })));
        box.append(el("div", { class: "py-zone mini" }, el("span", { class: "py-lbl", text: LINE_NAME[line] }), row));
      }
    }
    return box;
  }
  // 手機版：對手的場地（像真的對坐：能源線在上、前線靠近中間），電腦版用資訊欄裡的縮圖
  function oppArea(Q) {
    const box = el("section", { class: `py-opp p${PN[Q.idx]}` });
    box.append(el("div", { class: "py-opp-head" }, el("b", { text: `${who(Q)}的場地` }), el("span", { class: "py-sub", text: `手牌 ${Q.hand.length} 張` })));
    for (const line of ["energy", "front"]) {
      const row = el("ul", { class: "py-mini" });
      Q[line].forEach((s) => row.append(s ? cardEl(s.uid, { rest: s.rest, cls: s.skip ? "noup" : "", badge: underBadge(s, true), onclick: () => cardMenu(s.uid, line), bp: true, mod: s.mod || 0 }) : el("li", { class: "py-slot" })));
      box.append(el("div", { class: "py-zone mini" }, el("span", { class: "py-lbl", text: LINE_NAME[line] }), row));
    }
    return box;
  }
  function pileBtn(P, label, zone, cls) {
    const list = P[zone];
    return el("div", { class: `py-pilebox ${cls}`, "data-drop": zone === "life" ? null : zone, "data-owner": P.idx },
      el("button", { type: "button", class: "py-pilebtn", onclick: () => pileView(zone, list, `${who(P)}的${label === "生命" ? "生命區" : label}`, P) },
        el("span", { class: "py-pn", text: String(list.length) }), el("span", { text: label })));
  }

  // 中間：目前回合玩家的場地和手牌
  function mainArea(P) {
    const main = el("section", { class: "py-main" });
    main.append(el("div", { class: "py-main-head" },
      el("b", { text: `${who(P)}的場地` }),
      el("button", { type: "button", class: "btn small", disabled: P.extraDrawn || S.phase !== 0, onclick: extraDraw, title: "起始階段可以支付 1AP 再抽 1 張（每回合 1 次）" }, "額外抽卡（1AP）")));
    for (const Q of S.players) {
      if (!Q.reveal.length) continue;
      const ul = el("ul", { class: "py-hand" });
      Q.reveal.forEach((u) => ul.append(cardEl(u, { onclick: () => cardMenu(u, "reveal"), drag: "reveal" })));
      main.append(el("div", { class: "py-reveal" },
        el("div", { class: "py-row sp" }, el("b", { text: `${who(Q)}的觸發確認：有觸發效果可以發動，處理完放到場外` }),
          el("button", { class: "btn small", type: "button", onclick: () => { snap(); const n = Q.reveal.length; Q.outside.push(...Q.reveal); Q.reveal = []; log(`${who(Q)}：觸發確認的 ${n} 張放到場外`); render(); } }, "全部放到場外")),
        ul));
    }
    for (const line of ["front", "energy"]) {
      const row = el("ul", { class: `py-line ${line}`, "data-drop": line, "data-owner": P.idx });
      P[line].forEach((s, i) => {
        if (!s) row.append(el("li", { class: "py-slot", "data-drop": line, "data-slot": i, "data-owner": P.idx }));
        else row.append(cardEl(s.uid, { rest: s.rest, cls: s.skip ? "noup" : "", badge: underBadge(s, false), onclick: () => cardMenu(s.uid, line), drag: line, drop: { zone: line, slot: i, owner: P.idx }, bp: true, mod: s.mod || 0 }));
      });
      main.append(el("div", { class: "py-zone" }, el("span", { class: "py-lbl", text: line === "energy" ? `能源線・${energyText(P)}` : LINE_NAME[line] }), row));
    }
    const hand = el("ul", { class: "py-hand" });
    if (isAI(P.idx)) P.hand.forEach((u) => hand.append(cardEl(u, { back: true }))); // 電腦的手牌不給看
    else P.hand.forEach((u) => hand.append(cardEl(u, { onclick: () => cardMenu(u, "hand"), drag: "hand" })));
    if (!P.hand.length) hand.append(el("li", { class: "py-empty", text: "沒有手牌" }));
    main.append(el("div", { class: "py-zone hand", "data-drop": "hand", "data-owner": P.idx }, el("span", { class: "py-lbl", text: `${who(P)}的手牌 ${P.hand.length}` }), hand));
    return main;
  }

  function renderTop() {
    const top = $("#pyTop");
    top.textContent = "";
    if (S.stage !== "play") {
      top.append(el("b", { text: "練習對戰" }), el("span", { class: "py-sub", text: `${S.players[0].deckName} vs ${S.players[1].deckName}` }));
    } else {
      const P = CUR();
      const ph = el("div", { class: "py-phases" });
      PHASES.forEach((p, i) => ph.append(el("span", { class: i === S.phase ? "on" : i < S.phase ? "done" : "", text: p })));
      top.append(
        el("div", { class: "py-turn" }, el("b", { text: `${who(P)}・第 ${P.turn} 回合` }), el("span", { class: "py-sub", text: P.idx === S.first ? "先攻" : "後攻" })),
        ph,
        ...(isAI(S.cur) ? [el("span", { class: "py-tag on py-ai-tag", text: "電腦回合中…" })] : [
          el("button", { type: "button", class: "btn small", onclick: prevPhase, disabled: S.phase === 0, title: "回到上一個階段" }, S.phase > 0 ? `上一階段：${PHASES[S.phase - 1]}` : "上一階段"),
          el("button", { type: "button", class: "btn primary small", onclick: nextPhase }, S.phase < 4 ? `下一階段：${PHASES[S.phase + 1]}` : `結束回合（換玩家 ${PN[1 - S.cur]}）`)]));
    }
    top.append(
      el("button", { type: "button", class: "btn small", onclick: undo, disabled: !undoStack.length }, "復原"),
      el("button", { type: "button", class: "btn small", onclick: () => sheet("練習對戰", "", [
        { label: "重新開始（同樣兩副卡組重新洗牌）", run: () => start(S.deckIds[0], S.deckIds[1], S.ai && S.ai[1]) },
        { label: "結束練習", run: () => close() },
      ]) }, "⋯"));
    const hint = $("#pyHint");
    hint.hidden = S.stage !== "play";
    hint.textContent = S.stage === "play" ? `${who(CUR())}・${PHASES[S.phase]}階段：${PHASE_HINT[S.phase]}` : "";
  }

  /* ---------- 開關 ---------- */
  function show() {
    let v = $("#playView");
    if (!v) {
      v = el("div", { id: "playView", class: "play-view", role: "dialog", "aria-label": "練習對戰" },
        el("div", { id: "pyTop", class: "py-top" }),
        el("p", { id: "pyHint", class: "py-hint" }),
        el("div", { id: "pyBoard", class: "py-board" }),
        el("div", { id: "pyLifeWrap", class: "py-life-wrap", hidden: true, onclick: (e) => { if (e.target.id === "pyLifeWrap" && !AT && !FXQ.length && !(LP && LP.done === false)) closeLife(); } },
          el("div", { id: "pyLife", class: "py-life-box", role: "dialog", "aria-label": "翻開生命卡" })),
        el("div", { id: "pySheetWrap", class: "py-sheet-wrap", hidden: true, onclick: (e) => { if (e.target.id === "pySheetWrap") closeSheet(); } },
          el("div", { id: "pySheet", class: "py-sheet" })));
      document.body.append(v);
    }
    v.hidden = false;
    document.body.classList.add("modal-open");
    if (!open) { open = true; try { history.pushState({ uaPlay: 1 }, ""); } catch (e) {} }
  }
  function close(fromHistory) {
    if (!open) return;
    open = false;
    REVQ.length = 0;
    closeSheet();
    LP = null;
    AT = null;
    FXQ.length = 0;
    const lw = $("#pyLifeWrap"); if (lw) lw.hidden = true;
    $("#playView").hidden = true;
    document.body.classList.remove("modal-open");
    if (!fromHistory && history.state && history.state.uaPlay) { try { history.back(); } catch (e) {} }
  }
  function back() { // 返回鍵：先關選單、翻生命視窗，再關對戰桌
    if (!$("#pySheetWrap").hidden || LP || AT || FXQ.length) { closeSheet(); closeLife(); try { history.pushState({ uaPlay: 1 }, ""); } catch (e) {} return; }
    close(true);
  }
  function esc() { if (!$("#pySheetWrap").hidden) closeSheet(); else if (LP || AT || FXQ.length) closeLife(); else close(); }
  window.UAPlay = { start, isOpen: () => open, back, close, esc };
})();
