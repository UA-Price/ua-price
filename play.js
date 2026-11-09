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
    "已自動：休息的卡置為活動、放置 AP 卡、抽 1 張。想再抽可以付 1AP 額外抽卡（每回合 1 次）。",
    "把能源線的角色拖到前線（不能從前線移回能源線，除非有ステップ）。也可以點卡片用選單操作。",
    "把手牌拖到前線或能源線登場；拖到場上的角色上＝突襲；拖到場外＝使用事件。也可以點卡片用選單操作。",
    "點前線活動的角色 →「攻擊」。對手要防禦就點對手前線的角色（在旁邊的資訊欄）轉為休息；打到玩家就按對手那邊的「受到 1 傷害」。",
    "結束階段會把場上休息的角色、場域置為活動（AP 卡不會）。手牌超過 8 張要放到移除區。",
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
  function nextPhase() {
    if (S.stage !== "play") return;
    const P = CUR();
    snap();
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
  function takeDamage(P, n = 1) {
    if (!P.life.length) return toast("生命區已經沒有卡了");
    snap();
    for (let i = 0; i < n && P.life.length; i++) P.reveal.push(P.life.shift());
    log(`${who(P)}受到 ${n} 傷害，翻開生命區的卡做觸發確認`);
    if (!P.life.length) S.over = `${who(P)}的生命區剩 0 張 —— ${who(S.players[1 - P.idx])}獲勝（觸發確認處理完才算數）`;
    render();
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
    for (const u of d.under) P[pile === "remove" ? "remove" : "outside"].push(u); // 突襲底下的卡跟著走
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
    withAP(uid, (cost) => {
      snap();
      detach(uid);
      P[line][i] = { uid, rest: false, under: [s.uid, ...(s.under || [])] };
      if (cost) payAP(P, cost);
      log(`${who(P)}：${nameOf(uid)} 突襲到「${nameOf(s.uid)}」上${cost ? `（支付 ${cost}AP）` : ""}`);
      render();
      if (line === "energy") sheet("突襲完成", "在能源線突襲的角色可以移動到前線：", [
        { label: "移到前線", run: () => moveLine(uid, "front") },
        { label: "留在能源線", run: () => {} },
      ]);
    });
  }
  function moveLine(uid, to, slot = -1) {
    const P = PL(uid);
    const from = to === "front" ? "energy" : "front";
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
  function cardMenu(uid, zone) {
    const c = card(uid);
    const P = PL(uid);
    const mine = P.idx === S.cur;
    const info = [who(P), c.num, c.color || "", Number.isInteger(c.energy) ? `能源 ${c.energy}` : "", Number.isInteger(c.ap) ? `AP ${c.ap}` : ""].filter(Boolean).join("・");
    const zoom = { label: "放大看卡", run: () => { const u = UA.officialList(c)[0]; if (u) UA.openZoom(u, c.name); } };
    const items = [];
    if (zone === "hand") {
      items.push(
        { label: "角色登場到前線（休息）", run: () => withAP(uid, (cost) => placeOnLine(uid, "front", { payCost: cost })) },
        { label: "登場到能源線（休息）", run: () => withAP(uid, (cost) => placeOnLine(uid, "energy", { payCost: cost })) },
        { label: "突襲", run: () => raid(uid) },
        { label: "使用事件卡（用完放到場外）", run: () => useEvent(uid) },
        { label: "放到場外", run: () => move(uid, "outside") },
        { label: "放到移除區", run: () => move(uid, "remove") },
        { label: "放回牌庫頂", run: () => move(uid, "deck", "top") },
        { label: "放回牌庫底", run: () => move(uid, "deck", "bottom") },
      );
    } else if (zone === "front" || zone === "energy") {
      const f = slotOf(uid);
      const s = f && f.s;
      if (mine && zone === "front" && S.phase === 3 && s && !s.rest) items.push({ label: "攻擊（轉為休息）", run: () => setRest(uid, true, `${who(P)}：${c.name} 攻擊`) });
      if (!mine && zone === "front" && s && !s.rest) items.push({ label: "防禦（轉為休息）", run: () => setRest(uid, true, `${who(P)}：${c.name} 防禦`) });
      items.push({ label: s && s.rest ? "置為活動（直向）" : "轉為休息（橫向）", run: () => setRest(uid) });
      if (zone === "energy") items.push({ label: "移到前線", run: () => moveLine(uid, "front") });
      else items.push({ label: "移到能源線（ステップ）", run: () => moveLine(uid, "energy") });
      items.push(
        { label: "退場（放到場外）", run: () => move(uid, "outside") },
        { label: "放到移除區", run: () => move(uid, "remove") },
        { label: "回到手牌", run: () => move(uid, "hand") },
        { label: "放回牌庫頂", run: () => move(uid, "deck", "top") },
        { label: "放回牌庫底", run: () => move(uid, "deck", "bottom") },
      );
      if (s && s.under && s.under.length) items.push({ label: `查看突襲底下的卡（${s.under.length} 張）`, run: () => pileView(null, s.under, `「${c.name}」底下的卡`) });
    } else {
      items.push(
        { label: "加入手牌", run: () => move(uid, "hand") },
        { label: "登場到前線（休息）", run: () => placeOnLine(uid, "front") },
        { label: "登場到能源線（休息）", run: () => placeOnLine(uid, "energy") },
      );
      if (zone !== "outside") items.push({ label: "放到場外", run: () => move(uid, "outside") });
      if (zone !== "remove") items.push({ label: "放到移除區", run: () => move(uid, "remove") });
      if (zone !== "deck") items.push({ label: "放到牌庫頂", run: () => move(uid, "deck", "top") }, { label: "放到牌庫底", run: () => move(uid, "deck", "bottom") });
      if (zone !== "life") items.push({ label: "放到生命區（最上面）", run: () => { snap(); detach(uid); P.life.unshift(uid); log(`${who(P)}：${c.name} 放到生命區`); render(); } });
    }
    items.push(zoom);
    sheet(c.name, info, items, c);
  }
  function useEvent(uid) {
    withAP(uid, (cost) => { snap(); toPile(uid, "outside"); if (cost) payAP(PL(uid), cost); log(`${who(PL(uid))}使用事件「${nameOf(uid)}」${cost ? `（支付 ${cost}AP）` : ""}`); render(); });
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
  function cardEl(uid, { rest = false, back = false, badge = "", onclick, cls = "", drag = "", drop = null } = {}) {
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
    const isLine = (z) => z === "front" || z === "energy";
    if (isLine(to)) {
      const target = slot >= 0 ? P[to][slot] : null;
      if (from === "hand") {
        if (target) return raidOnto(uid, to, slot); // 拖到自己場上的角色上 = 突襲
        return withAP(uid, (cost) => placeOnLine(uid, to, { payCost: cost, slot }));
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
    box.append(el("div", { class: "py-side-btns" },
      el("button", { type: "button", class: "btn small", onclick: () => takeDamage(P, 1) }, "受到 1 傷害"),
      el("button", { type: "button", class: "btn small", onclick: () => takeDamage(P, 2) }, "受到 2 傷害"),
      el("button", { type: "button", class: "btn small", onclick: () => drawOne(P) }, "抽 1 張")));
    box.append(el("div", { class: "py-sub", text: `手牌 ${P.hand.length} 張` }));
    // 不是回合中的玩家：顯示他的場地縮圖（點了可以防禦、退場）
    if (!active) {
      for (const line of ["front", "energy"]) {
        const row = el("ul", { class: "py-mini" });
        P[line].forEach((s) => row.append(s ? cardEl(s.uid, { rest: s.rest, badge: s.under && s.under.length ? "突" : "", onclick: () => cardMenu(s.uid, line) }) : el("li", { class: "py-slot" })));
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
        else row.append(cardEl(s.uid, { rest: s.rest, badge: s.under && s.under.length ? "突襲" : "", onclick: () => cardMenu(s.uid, line), drag: line, drop: { zone: line, slot: i, owner: P.idx } }));
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
    $("#playView").hidden = true;
    document.body.classList.remove("modal-open");
    if (!fromHistory && history.state && history.state.uaPlay) { try { history.back(); } catch (e) {} }
  }
  function back() { // 返回鍵：先關選單，再關對戰桌
    if (!$("#pySheetWrap").hidden) { closeSheet(); try { history.pushState({ uaPlay: 1 }, ""); } catch (e) {} return; }
    close(true);
  }
  function esc() { if (!$("#pySheetWrap").hidden) closeSheet(); else close(); }
  window.UAPlay = { start, isOpen: () => open, back, close, esc };
})();
