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
  const who = (P) => `玩家 ${PN[P.idx]}`;
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
  function start(deckA, deckB) {
    CARDS = {};
    const A = makePlayer(0, deckA), B = makePlayer(1, deckB);
    const short = [A, B].filter((P) => P.total < 15);
    if (short.length) return toast(`${short.map(who).join("、")}的主卡組不到 15 張，沒辦法開始`);
    S = { stage: "first", players: [A, B], deckIds: [deckA, deckB], first: 0, cur: 0, mullIdx: 0, phase: 0, over: "", log: [] };
    undoStack = [];
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
  function startTurn() {
    const P = CUR();
    P.turn += 1;
    S.phase = 0;
    P.extraDrawn = false;
    for (const line of ["front", "energy"]) for (const s of P[line]) if (s) s.rest = false;
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
        for (const line of ["front", "energy"]) for (const s of P[line]) if (s) s.rest = false;
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
  const normTag = (t) => String(t).replace(/\s+/g, "").replace(/[①❶１]/g, "1").replace(/[②❷２]/g, "2").replace(/[③❸３]/g, "3").replace(/＋/g, "+");
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
      if (TIMING_TAGS.includes(tag)) { cur = { timing: tag, turn1: false, text: "" }; abil.push(cur); continue; }
      if (tag === "ターン1") { if (cur) cur.turn1 = true; continue; }
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
    sheet("能源不夠", `「${c.name}」需要${COLOR_ZH[c.color] || c.color}色能源 ${c.energy}，${who(P)}的能源線目前只有 ${have}。`, [
      { label: "仍然使用（有效果讓它不需要能源時）", run: then },
    ], c);
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
        title: `${who(PL(uid))}「${c.name}」的${TIMING_ZH[timing] || timing}效果`,
        uid, text: `［${timing}］${a.turn1 ? "［ターン1］" : ""}${a.text}`,
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
  function pickCards(title, uids, n, upTo, onPick) {
    if (!uids.length) { toast("沒有符合的卡可以選"); return; }
    const sel = [];
    const box = $("#pySheet");
    const draw = () => {
      box.textContent = "";
      box.append(el("div", { class: "py-sh-head" }, el("div", {}, el("b", { text: title }), el("p", { text: upTo ? `最多選 ${n} 張` : `選 ${n} 張` }))));
      const grid = el("ul", { class: "py-pile" });
      uids.forEach((u) => {
        const li = cardEl(u, { bp: true, mod: slotMod(u), cls: sel.includes(u) ? "picked" : "", onclick: () => {
          const k = sel.indexOf(u);
          if (k >= 0) sel.splice(k, 1); else { if (sel.length >= n) sel.shift(); sel.push(u); }
          draw();
        } });
        grid.append(li);
      });
      box.append(grid);
      box.append(el("div", { class: "py-sh-list row" },
        el("button", { type: "button", class: "py-sh-btn cancel", onclick: closeSheet }, "取消"),
        el("button", { type: "button", class: "py-sh-btn", disabled: upTo ? sel.length === 0 : sel.length !== Math.min(n, uids.length), onclick: () => { closeSheet(); onPick(sel.slice()); } }, `確定（${sel.length}）`)));
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
    const t = String(text).replace(/［[^］]*］/g, "");
    for (const sen of t.split("。")) {
      let m;
      if ((m = sen.match(/カードを(\d+)枚引/))) {
        const n = +m[1];
        acts.push({ label: `${who(P)}抽 ${n} 張`, run: (done) => { snap(); let k = 0; for (; k < n && P.deck.length; k++) P.hand.push(P.deck.shift()); log(`${who(P)}抽 ${k} 張（效果）`); done(); } });
      }
      if (/このカードを手札に加え/.test(sen) && srcUid) {
        acts.push({ label: "這張卡加入手牌", run: (done) => { snap(); toPile(srcUid, "hand"); log(`${who(P)}：${nameOf(srcUid)} 加入手牌（效果）`); done(); } });
      }
      // 選角色＋動作
      if ((m = sen.match(/(相手|自分)の(フロントL|エナジーL|場)?の?([^、]*?)キャラ(?:カード)?を(\d+)枚(まで)?選び、?(.*)$/))) {
        const side = m[1] === "相手" ? opp : P;
        const zone = m[2] === "フロントL" ? "front" : m[2] === "エナジーL" ? "energy" : "both";
        const cond = m[3] || "", n = +m[4], upTo = !!m[5], rest = m[6] || "";
        const bpMax = (cond.match(/BP(\d+)以下/) || [])[1], bpMin = (cond.match(/BP(\d+)以上/) || [])[1];
        const verbs = [];
        if (/退場させ/.test(rest)) verbs.push(["retire", "退場"]);
        if (/手札に戻/.test(rest)) verbs.push(["hand", "回到手牌"]);
        if (/レストに/.test(rest)) verbs.push(["rest", "轉為休息"]);
        if (/アクティブに/.test(rest)) verbs.push(["active", "置為活動"]);
        if (/場外に置/.test(rest) && !/退場/.test(rest)) verbs.push(["outside", "放到場外"]);
        if (/リムーブエリア|除外/.test(rest)) verbs.push(["remove", "放到移除區"]);
        const bpm = rest.match(/BP([+\-−])(\d+)/);
        if (bpm) verbs.push(["bp", `BP${bpm[1] === "+" ? "+" : "−"}${bpm[2]}`, (bpm[1] === "+" ? 1 : -1) * +bpm[2]]);
        if (verbs.length) {
          const zn = zone === "front" ? "前線" : zone === "energy" ? "能源線" : "場上";
          const filt = bpMax ? `BP${bpMax}以下` : bpMin ? `BP${bpMin}以上` : "";
          acts.push({
            label: `選${side === P ? "自己" : "對手"}${zn}${filt}的角色${upTo ? "最多" : ""} ${n} 張 → ${verbs.map((v) => v[1]).join("、")}`,
            run: (done) => {
              const cands = fieldUids(side, zone).filter((u) => { const b = bpNow(u); return !(bpMax && b != null && b > +bpMax) && !(bpMin && b != null && b < +bpMin); });
              pickCards(`選擇目標（${who(side)}）`, cands, n, upTo, (list) => {
                snap();
                for (const u of list) for (const [v, , d] of verbs) {
                  if (!slotOf(u)) break;
                  if (v === "retire") retire(u, "效果");
                  else if (v === "hand") { toPile(u, "hand"); log(`${who(side)}：${nameOf(u)} 回到手牌（效果）`); }
                  else if (v === "outside") { toPile(u, "outside"); log(`${who(side)}：${nameOf(u)} 放到場外（效果）`); }
                  else if (v === "remove") { toPile(u, "remove"); log(`${who(side)}：${nameOf(u)} 放到移除區（效果）`); }
                  else if (v === "rest" || v === "active") { const f = slotOf(u); f.s.rest = v === "rest"; log(`${who(side)}：${nameOf(u)} ${v === "rest" ? "轉為休息" : "置為活動"}（效果）`); }
                  else if (v === "bp") addBP(u, d, "效果");
                }
                done();
              });
            },
          });
        }
      } else if ((m = sen.match(/このキャラ(?:は|に|の)[^。]*?BP([+\-−])(\d+)/)) && srcUid) {
        const d = (m[1] === "+" ? 1 : -1) * +m[2];
        acts.push({ label: `這張角色 BP${d > 0 ? "+" : "−"}${Math.abs(d)}（本回合）`, run: (done) => { if (!slotOf(srcUid)) return toast("這張卡不在場上"); snap(); addBP(srcUid, d, "效果"); done(); } });
      }
      if ((m = sen.match(/山札の上から(\d+)枚(?:を)?見/))) {
        const n = +m[1];
        acts.push({ label: `看自己牌庫上面 ${n} 張`, run: (done) => { pileView("deck", P.deck.slice(0, n), `${who(P)}的牌庫上面 ${n} 張`, P); done(); } });
      }
      if (/自分の場外/.test(sen)) acts.push({ label: "打開自己的場外", run: (done) => { pileView("outside", P.outside, `${who(P)}的場外`, P); done(); } });
      if ((m = sen.match(/手札を(\d+)枚(?:選び、)?場外に置/))) {
        const n = +m[1];
        acts.push({ label: `選自己手牌 ${n} 張放到場外`, run: (done) => pickCards(`${who(P)}的手牌`, P.hand.slice(), n, false, (list) => { snap(); list.forEach((u) => toPile(u, "outside")); log(`${who(P)}：手牌 ${list.length} 張放到場外（效果）`); done(); }) });
      }
      if ((m = sen.match(/相手に(\d+)ダメージ/))) {
        const n = +m[1];
        acts.push({ label: `對手受到 ${n} 傷害`, run: (done) => { done(); takeDamage(opp, n, srcUid); } });
      }
    }
    return acts;
  }

  // 起動メイン：從卡片選單發動（費用自動處理：支付 AP、休息、退場）
  function activate(uid, a) {
    const P = PL(uid);
    const f = slotOf(uid);
    const turnKey = `${S.cur}-${P.turn}`;
    if (a.turn1 && f && f.s.used && f.s.used[a.text] === turnKey) return toast("這個效果這回合已經用過了（ターン1）");
    const [costPart, effPart] = a.text.includes("：") ? [a.text.slice(0, a.text.indexOf("：")), a.text.slice(a.text.indexOf("：") + 1)] : ["", a.text];
    const apCost = +((costPart.match(/APを(\d+)支払/) || [])[1] || 0);
    const needRest = /レストにする/.test(costPart);
    const selfRetire = /このカードを退場/.test(costPart);
    if (apCost && apAvail(P) < apCost) return toast(`AP 不夠（要支付 ${apCost}AP）`);
    if (needRest && f && f.s.rest) return toast("這張卡已經休息，沒辦法再「レストにする」");
    snap();
    if (apCost) payAP(P, apCost);
    if (needRest && f) f.s.rest = true;
    if (a.turn1 && f) { f.s.used = f.s.used || {}; f.s.used[a.text] = turnKey; }
    log(`${who(P)}：發動「${nameOf(uid)}」的起動メイン${apCost ? `（支付 ${apCost}AP）` : ""}`);
    if (selfRetire) retire(uid, "效果的費用");
    FXQ.unshift({ title: `${who(P)}「${nameOf(uid)}」的起動メイン效果`, uid, text: `［起動メイン］${a.turn1 ? "［ターン1］" : ""}${a.text}`, actions: actionsFor(effPart, P, uid), buttons: [{ label: "處理完了", primary: true }] });
    render();
    renderLife();
  }

  // 觸發：翻開生命卡時
  function queueTriggers(P, uids) {
    for (const u of uids) {
      const c = card(u);
      if (!c.trigger) continue;
      const tm = c.trigger.match(/^\[([^\]]+)\]/);
      FXQ.push({
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
  function closeLifeOnly() { LP = null; renderLife(); } // 生命視窗按「好」：接著處理排隊中的觸發

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
          el("button", { type: "button", class: "btn primary", onclick: () => {
            const atk = AT.uid; AT = null; log(`${who(Dp)}不防禦`);
            const k = kwOf(atk);
            takeDamage(Dp, (k.damage || 1) + (k.damagePlus || 0), atk); // ダメージ❷／+1 自動套用
          } }, "不防禦（受到傷害）"));
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
        AT = null; render(); renderLife();
      };
      const winD = () => { log(`對戰結果：${who(Dp)}的「${nameOf(T)}」${known ? `（BP ${td}）` : ""}勝，${nameOf(AT.uid)}${known ? `（BP ${ta}）` : ""} 不會退場`); AT = null; renderLife(); render(); };
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
  function raid(uid) {
    const P = PL(uid);
    const targets = [];
    for (const line of ["front", "energy"]) P[line].forEach((s, i) => { if (s) targets.push({ line, i, s }); });
    if (!targets.length) return toast("場上沒有可以突襲的角色");
    sheet("突襲：選擇要重疊在哪張角色上", "突襲元卡的效果會無效；突襲後置為活動。", targets.map(({ line, i, s }) => ({
      label: `${LINE_NAME[line]}：${nameOf(s.uid)}`,
      run: () => raidOnto(uid, line, i),
    })));
  }
  function raidOnto(uid, line, i) {
    const P = PL(uid);
    const s = P[line][i];
    if (!s) return;
    playFromHand(uid, (cost) => {
      snap();
      detach(uid);
      P[line][i] = { uid, rest: false, under: [s.uid, ...(s.under || [])] };
      if (cost) payAP(P, cost);
      log(`${who(P)}：${nameOf(uid)} 突襲到「${nameOf(s.uid)}」上${cost ? `（支付 ${cost}AP）` : ""}`);
      render();
      fireTiming(uid, "登場時");
      renderLife();
      if (line === "energy") sheet("突襲完成", "在能源線突襲的角色可以移動到前線：", [
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
          { label: "突襲", run: () => raid(uid) },
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
        if (mine) fxOf(c).abil.filter((a) => a.timing === "起動メイン").forEach((a) => items.unshift({ label: `發動起動メイン${a.turn1 ? "（ターン1）" : ""}：${a.text.replace(/［[^］]*］/g, "").slice(0, 26)}…`, run: () => activate(uid, a) }));
        effects();
        if (mine) lineMoves();
      }
      else if (ph === 3) {
        if (mine && zone === "front" && s && !s.rest) items.push({ label: "攻擊", run: () => startAttack(uid) });
        effects(); // 觸發效果可能讓角色退場、回手等
      } else note = PHASE_BLOCK[ph];
      if (s && s.under && s.under.length) items.push({ label: `查看突襲底下的卡（${s.under.length} 張）`, run: () => pileView(null, s.under, `「${c.name}」底下的卡`) });
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
        FXQ.push({ title: `${who(P)}使用事件「${c.name}」`, uid, text: c.effect, actions: actionsFor(c.effect, P, null), buttons: [{ label: "處理完了", primary: true }] });
        renderLife();
      }
    });
  }

  /* ---------- 選單（從下方滑出） ---------- */
  function sheet(title, sub, items, c) {
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
    for (const it of items) ul.append(el("button", { type: "button", class: "py-sh-btn", onclick: () => { closeSheet(); it.run(); } }, it.label));
    ul.append(el("button", { type: "button", class: "py-sh-btn cancel", onclick: closeSheet }, "取消"));
    box.append(ul);
    $("#pySheetWrap").hidden = false;
  }
  function closeSheet() { const w = $("#pySheetWrap"); if (w) w.hidden = true; }
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
        if (target) return raidOnto(uid, to, slot); // 拖到自己場上的角色上 = 突襲
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
      const ul = el("ul", { class: "py-hand big" });
      P.hand.forEach((u) => ul.append(cardEl(u, { onclick: () => { const x = UA.officialList(card(u))[0]; if (x) UA.openZoom(x, nameOf(u)); } })));
      root.append(el("div", { class: "py-setup" },
        el("h3", { text: `${who(P)}的起手 7 張（${P.idx === S.first ? "先攻" : "後攻"}）` }),
        el("p", { text: "要換手牌嗎？最多可以換 1 次：手牌先放旁邊，重新抽 7 張，再把放旁邊的放回卡組洗牌。由先攻玩家先決定。" }),
        ul,
        el("div", { class: "py-row" },
          el("button", { class: "btn", type: "button", onclick: () => mulligan(true) }, "換手牌"),
          el("button", { class: "btn primary", type: "button", onclick: () => mulligan(false) }, "不換"))));
      return renderTop();
    }
    if (S.over) root.append(el("div", { class: "py-over" }, S.over, el("button", { class: "btn small", type: "button", onclick: () => { snap(); S.over = ""; render(); } }, "知道了")));

    const layout = el("div", { class: "py-layout" });
    layout.append(sidePanel(S.players[0]), mainArea(CUR()), sidePanel(S.players[1]));
    root.append(layout);
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
        P[line].forEach((s) => row.append(s ? cardEl(s.uid, { rest: s.rest, badge: s.under && s.under.length ? "突" : "", onclick: () => cardMenu(s.uid, line), bp: true, mod: s.mod || 0 }) : el("li", { class: "py-slot" })));
        box.append(el("div", { class: "py-zone mini" }, el("span", { class: "py-lbl", text: LINE_NAME[line] }), row));
      }
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
        else row.append(cardEl(s.uid, { rest: s.rest, badge: s.under && s.under.length ? "突襲" : "", onclick: () => cardMenu(s.uid, line), drag: line, drop: { zone: line, slot: i, owner: P.idx }, bp: true, mod: s.mod || 0 }));
      });
      main.append(el("div", { class: "py-zone" }, el("span", { class: "py-lbl", text: LINE_NAME[line] }), row));
    }
    const hand = el("ul", { class: "py-hand" });
    P.hand.forEach((u) => hand.append(cardEl(u, { onclick: () => cardMenu(u, "hand"), drag: "hand" })));
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
        el("button", { type: "button", class: "btn small", onclick: prevPhase, disabled: S.phase === 0, title: "回到上一個階段" }, S.phase > 0 ? `上一階段：${PHASES[S.phase - 1]}` : "上一階段"),
        el("button", { type: "button", class: "btn primary small", onclick: nextPhase }, S.phase < 4 ? `下一階段：${PHASES[S.phase + 1]}` : `結束回合（換玩家 ${PN[1 - S.cur]}）`));
    }
    top.append(
      el("button", { type: "button", class: "btn small", onclick: undo, disabled: !undoStack.length }, "復原"),
      el("button", { type: "button", class: "btn small", onclick: () => sheet("練習對戰", "", [
        { label: "重新開始（同樣兩副卡組重新洗牌）", run: () => start(S.deckIds[0], S.deckIds[1]) },
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
