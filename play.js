/* 查價之境 — 練習對戰桌（第 1 版：自己操作卡片效果，一個人練牌）
   規則依官方規則說明書 Ver1.1：
   - 起手 7 張，可換手牌 1 次（手牌先放旁邊 → 再抽 7 張 → 放旁邊的放回卡組洗牌）
   - 生命區 7 張（背面朝上）
   - 前線最多 4 張角色；能源線最多合計 4 張角色＋場域
   - AP 卡：先攻 1/2/3 張、後攻 2/2/3 張（第 1/2/3 回合以後）
   - 起始階段：休息的卡全部置為活動 → AP 卡依回合放置 → 抽 1 張（先攻第 1 回合不抽）→ 可付 1AP 額外抽卡（每回合 1 次）
   - 結束階段：場上休息的角色、場域置為活動（AP 卡不會）；手牌 9 張以上時放到移除區剩 8 張
   - 場上已滿還要登場／移動時，先把場上的卡放到移除區 */
(() => {
  "use strict";
  const UA = window.UA;
  if (!UA) return;
  const { el, $, toast } = UA;

  const PHASES = ["起始", "移動", "主要", "攻擊", "結束"];
  const PHASE_HINT = [
    "已自動：休息的卡置為活動、放置 AP 卡、抽 1 張。想再抽可以付 1AP 額外抽卡（每回合 1 次）。",
    "可以把能源線的角色移到前線（不能從前線移回能源線，除非有ステップ）。點場上的卡操作。",
    "使用卡片：點手牌選擇登場、突襲或使用事件。也可以發動場上卡片的起動メイン效果。",
    "用前線活動的角色攻擊：點角色 →「攻擊（轉為休息）」。對手的防禦、BP 比較請自己判斷。",
    "結束階段會把場上休息的角色、場域置為活動（AP 卡不會）。手牌超過 8 張要放到移除區。",
  ];
  const AP_TABLE = { first: [1, 2, 3], second: [2, 2, 3] };
  const SLOTS = 4;

  let S = null;          // 目前的牌局狀態
  let CARDS = {};        // uid → 卡片資料
  let undoStack = [];
  let open = false;

  /* ---------- 小工具 ---------- */
  const card = (uid) => CARDS[uid];
  const nameOf = (uid) => (card(uid) ? card(uid).name : "?");
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
    if (S.log.length > 40) S.log.length = 40;
  }
  const apAvail = () => S.ap.slice(0, S.apCount).filter((x) => !x).length;
  function payAP(n) {
    let left = n;
    for (let i = 0; i < S.apCount && left > 0; i++) if (!S.ap[i]) { S.ap[i] = true; left--; }
  }
  const lineArr = (line) => (line === "front" ? S.front : S.energy);
  const LINE_NAME = { front: "前線", energy: "能源線" };
  const freeSlot = (line) => lineArr(line).findIndex((x) => !x);

  /* ---------- 開始一局 ---------- */
  function start() {
    const entries = UA.deckEntries().filter(({ c }) => !UA.isAP(c.num));
    const total = entries.reduce((n, e) => n + e.q, 0);
    if (total < 15) return toast("主卡組至少要 15 張才能開始練習（起手 7 張＋生命 7 張＋抽牌）");
    CARDS = {};
    const deck = [];
    let n = 0;
    for (const { c, q } of entries) for (let i = 0; i < q; i++) { const uid = "c" + (n++); CARDS[uid] = c; deck.push(uid); }
    S = {
      stage: "first", deckName: UA.deckName(), total,
      deck: shuffle(deck), hand: [], life: [], front: Array(SLOTS).fill(null), energy: Array(SLOTS).fill(null),
      outside: [], remove: [], reveal: [], ap: [false, false, false], apCount: 0,
      turn: 0, first: true, phase: 0, extraDrawn: false, mulled: false, attacks: 0, damage: 0, over: "", log: [],
    };
    undoStack = [];
    show();
    render();
    if (total !== 50) toast(`這副主卡組是 ${total} 張（正式規則要剛好 50 張），還是可以練習`);
  }
  function chooseOrder(first) {
    snap();
    S.first = first;
    S.hand = S.deck.splice(0, 7);
    S.stage = "mull";
    log(`${first ? "先攻" : "後攻"}，抽起手 7 張`);
    render();
  }
  function mulligan(doIt) {
    snap();
    if (doIt) { // 規則：手牌先放旁邊 → 再抽 7 張 → 放旁邊的放回卡組洗牌
      const aside = S.hand;
      S.hand = S.deck.splice(0, 7);
      S.deck = shuffle(S.deck.concat(aside));
      S.mulled = true;
      log("換手牌（重抽 7 張）");
    }
    S.life = S.deck.splice(0, 7);
    log("從卡組上方放 7 張到生命區");
    S.stage = "play";
    S.turn = 0;
    startTurn();
  }

  /* ---------- 回合與階段 ---------- */
  function startTurn() {
    S.turn += 1;
    S.phase = 0;
    S.extraDrawn = false;
    S.attacks = 0;
    for (const line of [S.front, S.energy]) for (const s of line) if (s) s.rest = false;
    const table = S.first ? AP_TABLE.first : AP_TABLE.second;
    S.apCount = table[Math.min(S.turn, 3) - 1];
    S.ap = [false, false, false];
    let msg = `第 ${S.turn} 回合開始：AP ${S.apCount} 張`;
    if (S.first && S.turn === 1) msg += "（先攻第 1 回合不抽卡）";
    else if (!S.deck.length) { S.over = "卡組沒有卡了，起始階段無法抽卡 —— 這局輸了"; msg += "，卡組沒有卡可以抽"; }
    else { S.hand.push(S.deck.shift()); msg += "，抽 1 張"; }
    log(msg);
    render();
  }
  function nextPhase() {
    if (S.stage !== "play") return;
    snap();
    if (S.phase < 4) {
      S.phase += 1;
      if (S.phase === 4) { // 結束階段
        for (const line of [S.front, S.energy]) for (const s of line) if (s) s.rest = false;
        log("結束階段：場上休息的角色、場域置為活動");
        if (S.hand.length > 8) toast(`手牌 ${S.hand.length} 張，超過 8 張：請點手牌把多的放到移除區`, 4500);
      } else log(`進入${PHASES[S.phase]}階段`);
      render();
    } else {
      if (S.hand.length > 8) { undoStack.pop(); return toast(`手牌還有 ${S.hand.length} 張，請先把多的放到移除區（剩 8 張）`, 4000); }
      log("（對手回合省略）");
      startTurn();
    }
  }
  function extraDraw() {
    if (S.extraDrawn) return toast("額外抽卡每回合只能 1 次");
    if (apAvail() < 1) return toast("沒有活動的 AP 卡可以支付");
    if (!S.deck.length) return toast("卡組沒有卡了");
    snap();
    payAP(1);
    S.hand.push(S.deck.shift());
    S.extraDrawn = true;
    log("支付 1AP 額外抽卡");
    render();
  }
  function takeDamage(n = 1) {
    if (!S.life.length) return toast("生命區已經沒有卡了");
    snap();
    for (let i = 0; i < n && S.life.length; i++) S.reveal.push(S.life.shift());
    S.damage += n;
    log(`受到 ${n} 傷害，翻開生命區的卡做觸發確認`);
    if (!S.life.length) S.over = "生命區剩 0 張 —— 這局輸了（觸發確認處理完才算數）";
    render();
  }

  /* ---------- 移動卡片 ---------- */
  // 從所有區域拿掉 uid（場上的話連同突襲底下的卡一起回傳）
  function detach(uid) {
    for (const key of ["deck", "hand", "life", "outside", "remove", "reveal"]) {
      const i = S[key].indexOf(uid);
      if (i >= 0) { S[key].splice(i, 1); return { from: key, under: [] }; }
    }
    for (const line of ["front", "energy"]) {
      const arr = S[line];
      const i = arr.findIndex((s) => s && s.uid === uid);
      if (i >= 0) { const s = arr[i]; arr[i] = null; return { from: line, under: s.under || [], slot: s }; }
    }
    return null;
  }
  function toPile(uid, pile, where = "top") {
    const d = detach(uid);
    if (!d) return;
    if (pile === "deck") { where === "top" ? S.deck.unshift(uid) : S.deck.push(uid); }
    else S[pile].push(uid);
    // 突襲底下的卡：跟著去場外／移除區；回手牌或牌庫時放到場外
    for (const u of d.under) S[pile === "remove" ? "remove" : "outside"].push(u);
  }
  const PILE_NAME = { hand: "手牌", outside: "場外", remove: "移除區", deck: "牌庫", life: "生命區", reveal: "觸發確認區" };

  // 放到場上（line 已滿時先請玩家選一張放到移除區）
  function placeOnLine(uid, line, { rest = true, payCost = 0, why = "登場" } = {}) {
    const go = () => {
      let i = freeSlot(line);
      if (i < 0) return chooseReplace(line, () => go());
      snap();
      const d = detach(uid);
      lineArr(line)[i] = { uid, rest, under: d && d.under ? d.under : [] };
      if (payCost) payAP(payCost);
      log(`${nameOf(uid)} ${why}到${LINE_NAME[line]}${payCost ? `（支付 ${payCost}AP）` : ""}`);
      render();
    };
    go();
  }
  function chooseReplace(line, then) {
    const arr = lineArr(line);
    sheet(`${LINE_NAME[line]}已經有 4 張`, "照規則要先選 1 張場上的卡放到移除區：", arr.map((s, i) => s && {
      label: `把「${nameOf(s.uid)}」放到移除區`,
      run: () => { snap(); toPile(s.uid, "remove"); log(`${nameOf(s.uid)} 放到移除區（騰出空位）`); then(); },
    }).filter(Boolean));
  }
  // 從手牌使用：先確認 AP
  function withAP(uid, run) {
    const cost = Number.isInteger(card(uid).ap) ? card(uid).ap : null;
    if (cost == null) return sheet("這張卡沒有消耗 AP 資料", "請選擇要支付多少 AP：", [0, 1, 2, 3].map((n) => ({ label: `支付 ${n}AP`, run: () => run(n) })));
    if (apAvail() >= cost) return run(cost);
    sheet("AP 不夠", `這張要消耗 ${cost}AP，目前剩 ${apAvail()} 張活動的 AP 卡。`, [
      { label: "仍然使用（不扣 AP，例如有效果讓它免費）", run: () => run(0) },
    ]);
  }
  function raid(uid) {
    const targets = [];
    for (const line of ["front", "energy"]) S[line].forEach((s, i) => { if (s) targets.push({ line, i, s }); });
    if (!targets.length) return toast("場上沒有可以突襲的角色");
    sheet("突襲：選擇要重疊在哪張角色上", "突襲元卡的效果會無效；突襲後置為活動。", targets.map(({ line, i, s }) => ({
      label: `${LINE_NAME[line]}：${nameOf(s.uid)}`,
      run: () => withAP(uid, (cost) => {
        snap();
        detach(uid);
        S[line][i] = { uid, rest: false, under: [s.uid, ...(s.under || [])] };
        if (cost) payAP(cost);
        log(`${nameOf(uid)} 突襲到「${nameOf(s.uid)}」上${cost ? `（支付 ${cost}AP）` : ""}`);
        render();
        if (line === "energy") sheet("突襲完成", "在能源線突襲的角色可以移動到前線：", [
          { label: "移到前線", run: () => moveLine(uid, "front") },
          { label: "留在能源線", run: () => {} },
        ]);
      }),
    })));
  }
  function moveLine(uid, to) {
    const from = to === "front" ? "energy" : "front";
    const i = S[from].findIndex((s) => s && s.uid === uid);
    if (i < 0) return;
    const go = () => {
      const j = freeSlot(to);
      if (j < 0) return chooseReplace(to, go);
      snap();
      const s = S[from][i];
      S[from][i] = null;
      S[to][j] = s;
      log(`${nameOf(uid)} 移到${LINE_NAME[to]}`);
      render();
    };
    go();
  }
  function toggleRest(uid, why) {
    for (const line of [S.front, S.energy]) for (const s of line) if (s && s.uid === uid) {
      snap();
      s.rest = !s.rest;
      log(why || `${nameOf(uid)} ${s.rest ? "轉為休息" : "置為活動"}`);
      render();
      return;
    }
  }

  /* ---------- 點卡片的選單 ---------- */
  function cardMenu(uid, zone) {
    const c = card(uid);
    const info = [c.num, c.color ? c.color : "", Number.isInteger(c.energy) ? `能源 ${c.energy}` : "", Number.isInteger(c.ap) ? `AP ${c.ap}` : ""].filter(Boolean).join("・");
    const zoom = { label: "放大看卡", run: () => { const u = UA.officialList(c)[0]; if (u) UA.openZoom(u, c.name); } };
    const items = [];
    if (zone === "hand") {
      items.push(
        { label: "角色登場到前線（休息）", run: () => withAP(uid, (cost) => placeOnLine(uid, "front", { payCost: cost })) },
        { label: "登場到能源線（休息）", run: () => withAP(uid, (cost) => placeOnLine(uid, "energy", { payCost: cost })) },
        { label: "突襲", run: () => raid(uid) },
        { label: "使用事件卡（用完放到場外）", run: () => withAP(uid, (cost) => { snap(); toPile(uid, "outside"); if (cost) payAP(cost); log(`使用事件「${c.name}」${cost ? `（支付 ${cost}AP）` : ""}`); render(); }) },
        { label: "放到場外", run: () => move(uid, "outside") },
        { label: "放到移除區", run: () => move(uid, "remove") },
        { label: "放回牌庫頂", run: () => move(uid, "deck", "top") },
        { label: "放回牌庫底", run: () => move(uid, "deck", "bottom") },
      );
    } else if (zone === "front" || zone === "energy") {
      const s = S[zone].find((x) => x && x.uid === uid);
      if (zone === "front" && S.phase === 3 && s && !s.rest) items.push({ label: "攻擊（轉為休息）", run: () => { toggleRest(uid, `${c.name} 攻擊`); S.attacks++; } });
      items.push({ label: s && s.rest ? "置為活動（直向）" : "轉為休息（橫向）", run: () => toggleRest(uid) });
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
      // 牌庫／場外／移除區／生命區／觸發確認區 裡的卡
      items.push(
        { label: "加入手牌", run: () => move(uid, "hand") },
        { label: "登場到前線（休息）", run: () => placeOnLine(uid, "front", { why: "登場" }) },
        { label: "登場到能源線（休息）", run: () => placeOnLine(uid, "energy", { why: "登場" }) },
      );
      if (zone !== "outside") items.push({ label: "放到場外", run: () => move(uid, "outside") });
      if (zone !== "remove") items.push({ label: "放到移除區", run: () => move(uid, "remove") });
      if (zone !== "deck") items.push({ label: "放到牌庫頂", run: () => move(uid, "deck", "top") }, { label: "放到牌庫底", run: () => move(uid, "deck", "bottom") });
      if (zone !== "life") items.push({ label: "放到生命區（最上面）", run: () => { snap(); detach(uid); S.life.unshift(uid); log(`${c.name} 放到生命區`); render(); } });
    }
    items.push(zoom);
    sheet(c.name, info, items, c);
  }
  function move(uid, pile, where) {
    snap();
    toPile(uid, pile, where);
    log(`${nameOf(uid)} → ${PILE_NAME[pile]}${pile === "deck" ? (where === "top" ? "頂" : "底") : ""}`);
    render();
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
  function closeSheet() { $("#pySheetWrap").hidden = true; }

  // 查看一疊卡（牌庫、場外、移除區…）
  function pileView(zone, list, title) {
    const box = $("#pySheet");
    box.textContent = "";
    box.append(el("div", { class: "py-sh-head" }, el("div", {}, el("b", { text: `${title}（${list.length} 張）` }),
      zone === "deck" ? el("p", { text: "由上到下排列。看完記得按「洗牌」。" }) : zone === "life" ? el("p", { text: "生命區的卡正常是背面朝上，看完請記得不要偷看喔。" }) : null)));
    const grid = el("ul", { class: "py-pile" });
    list.forEach((uid) => grid.append(cardEl(uid, { onclick: () => { if (zone) { closeSheet(); cardMenu(uid, zone); } else { const u = UA.officialList(card(uid))[0]; if (u) UA.openZoom(u, nameOf(uid)); } } })));
    if (!list.length) grid.append(el("li", { class: "py-empty", text: "沒有卡" }));
    box.append(grid);
    const btns = el("div", { class: "py-sh-list row" });
    if (zone === "deck") btns.append(el("button", { type: "button", class: "py-sh-btn", onclick: () => { snap(); shuffle(S.deck); log("洗牌"); closeSheet(); render(); toast("已洗牌"); } }, "洗牌"));
    btns.append(el("button", { type: "button", class: "py-sh-btn cancel", onclick: closeSheet }, "關閉"));
    box.append(btns);
    $("#pySheetWrap").hidden = false;
  }

  /* ---------- 畫面 ---------- */
  function cardEl(uid, { rest = false, back = false, badge = "", onclick, cls = "" } = {}) {
    const c = card(uid);
    const li = el("li", { class: `py-card ${rest ? "rest" : ""} ${back ? "back" : ""} ${cls}`, title: back ? "" : c.name });
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
    if (onclick) { li.tabIndex = 0; li.addEventListener("click", onclick); li.addEventListener("keydown", (e) => { if (e.key === "Enter") onclick(); }); }
    return li;
  }

  function render() {
    if (!open || !S) return;
    const root = $("#pyBoard");
    root.textContent = "";
    // 準備階段
    if (S.stage === "first") {
      root.append(el("div", { class: "py-setup" },
        el("h3", { text: `「${S.deckName}」準備開始` }),
        el("p", { text: "已洗牌。請選擇先攻或後攻（實際對戰用猜拳決定）。先攻第 1 回合 AP 1 張、不抽卡；後攻第 1 回合 AP 2 張。" }),
        el("div", { class: "py-row" },
          el("button", { class: "btn primary", type: "button", onclick: () => chooseOrder(true) }, "我先攻"),
          el("button", { class: "btn", type: "button", onclick: () => chooseOrder(false) }, "我後攻"))));
      renderTop();
      return;
    }
    if (S.stage === "mull") {
      const ul = el("ul", { class: "py-hand big" });
      S.hand.forEach((u) => ul.append(cardEl(u, { onclick: () => { const x = UA.officialList(card(u))[0]; if (x) UA.openZoom(x, nameOf(u)); } })));
      root.append(el("div", { class: "py-setup" },
        el("h3", { text: "起手 7 張" }),
        el("p", { text: "要換手牌嗎？最多可以換 1 次：手牌先放旁邊，重新抽 7 張，再把放旁邊的放回卡組洗牌。" }),
        ul,
        el("div", { class: "py-row" },
          el("button", { class: "btn", type: "button", onclick: () => mulligan(true) }, "換手牌"),
          el("button", { class: "btn primary", type: "button", onclick: () => mulligan(false) }, "不換，開始"))));
      renderTop();
      return;
    }
    // 結束提示
    if (S.over) root.append(el("div", { class: "py-over" }, S.over, el("button", { class: "btn small", type: "button", onclick: () => { snap(); S.over = ""; render(); } }, "知道了")));
    // AP
    const apRow = el("div", { class: "py-ap" }, el("span", { class: "py-lbl", text: "AP" }));
    S.ap.forEach((rest, i) => {
      const usable = i < S.apCount;
      apRow.append(el("button", {
        type: "button", class: `py-apcard ${rest ? "rest" : ""} ${usable ? "" : "off"}`, disabled: !usable,
        title: usable ? (rest ? "已支付（休息）" : "活動") : "這回合還不能用",
        onclick: () => { snap(); S.ap[i] = !S.ap[i]; log(`AP 卡 ${S.ap[i] ? "轉為休息（支付 1AP）" : "置為活動"}`); render(); },
      }, "AP"));
    });
    apRow.append(el("span", { class: "py-apinfo", text: `可用 ${apAvail()} / ${S.apCount}` }),
      el("button", { type: "button", class: "btn small", disabled: S.extraDrawn || S.phase !== 0, onclick: extraDraw, title: "起始階段可以支付 1AP 再抽 1 張（每回合 1 次）" }, "額外抽卡（1AP）"));
    root.append(apRow);
    // 場上
    for (const line of ["front", "energy"]) {
      const row = el("ul", { class: `py-line ${line}` });
      S[line].forEach((s, i) => {
        if (!s) row.append(el("li", { class: "py-slot", text: "" }));
        else row.append(cardEl(s.uid, { rest: s.rest, badge: s.under && s.under.length ? `突襲` : "", onclick: () => cardMenu(s.uid, line) }));
      });
      root.append(el("div", { class: "py-zone" }, el("span", { class: "py-lbl", text: LINE_NAME[line] }), row));
    }
    // 各區
    const piles = el("div", { class: "py-piles" },
      pileBtn("生命", S.life.length, "life", "py-life", [
        { t: "受到 1 傷害", f: () => takeDamage(1) },
        { t: "受到 2 傷害", f: () => takeDamage(2) },
      ]),
      pileBtn("牌庫", S.deck.length, "deck", "", [{ t: "抽 1 張", f: () => { if (!S.deck.length) return toast("卡組沒有卡了"); snap(); S.hand.push(S.deck.shift()); log("抽 1 張（效果）"); render(); } }]),
      pileBtn("場外", S.outside.length, "outside", ""),
      pileBtn("移除區", S.remove.length, "remove", ""));
    root.append(piles);
    // 觸發確認區
    if (S.reveal.length) {
      const ul = el("ul", { class: "py-hand" });
      S.reveal.forEach((u) => ul.append(cardEl(u, { onclick: () => cardMenu(u, "reveal") })));
      root.append(el("div", { class: "py-reveal" },
        el("div", { class: "py-row sp" }, el("b", { text: "觸發確認：有觸發效果的話可以發動，處理完放到場外" }),
          el("button", { class: "btn small", type: "button", onclick: () => { snap(); const n = S.reveal.length; S.outside.push(...S.reveal); S.reveal = []; log(`觸發確認的 ${n} 張放到場外`); render(); } }, "全部放到場外")),
        ul));
    }
    // 手牌
    const hand = el("ul", { class: "py-hand" });
    S.hand.forEach((u) => hand.append(cardEl(u, { onclick: () => cardMenu(u, "hand") })));
    if (!S.hand.length) hand.append(el("li", { class: "py-empty", text: "沒有手牌" }));
    root.append(el("div", { class: "py-zone hand" }, el("span", { class: "py-lbl", text: `手牌 ${S.hand.length}` }), hand));
    // 紀錄
    root.append(el("details", { class: "py-log" }, el("summary", { text: S.log[0] ? `紀錄：${S.log[0]}` : "紀錄" }),
      el("ol", {}, ...S.log.map((t) => el("li", { text: t })))));
    renderTop();
  }
  function pileBtn(label, n, zone, cls, extra = []) {
    const box = el("div", { class: `py-pilebox ${cls}` },
      el("button", { type: "button", class: "py-pilebtn", onclick: () => pileView(zone, zone === "life" ? S.life : S[zone], label === "生命" ? "生命區" : label) },
        el("span", { class: "py-pn", text: String(n) }), el("span", { text: label })));
    for (const x of extra) box.append(el("button", { type: "button", class: "btn small", onclick: x.f }, x.t));
    return box;
  }
  function renderTop() {
    const top = $("#pyTop");
    top.textContent = "";
    if (S.stage !== "play") {
      top.append(el("b", { text: "練習對戰" }), el("span", { class: "py-sub", text: S.deckName }));
    } else {
      const ph = el("div", { class: "py-phases" });
      PHASES.forEach((p, i) => ph.append(el("span", { class: i === S.phase ? "on" : i < S.phase ? "done" : "", text: p })));
      top.append(
        el("div", { class: "py-turn" }, el("b", { text: `第 ${S.turn} 回合` }), el("span", { class: "py-sub", text: S.first ? "先攻" : "後攻" })),
        ph,
        el("button", { type: "button", class: "btn primary small", onclick: nextPhase }, S.phase < 4 ? `下一階段：${PHASES[S.phase + 1]}` : "結束回合"));
    }
    top.append(
      el("button", { type: "button", class: "btn small", onclick: undo, disabled: !undoStack.length }, "復原"),
      el("button", { type: "button", class: "btn small", onclick: () => sheet("練習對戰", "", [
        { label: "重新開始（重新洗牌）", run: start },
        { label: "結束練習", run: () => close() },
      ]) }, "⋯"));
    $("#pyHint").textContent = S.stage === "play" ? `${PHASES[S.phase]}階段：${PHASE_HINT[S.phase]}` : "";
    $("#pyHint").hidden = S.stage !== "play";
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
  function back() { // 返回鍵／Esc：先關選單，再關對戰桌
    if (!$("#pySheetWrap").hidden) { closeSheet(); try { history.pushState({ uaPlay: 1 }, ""); } catch (e) {} return; }
    close(true);
  }

  function esc() { if (!$("#pySheetWrap").hidden) closeSheet(); else close(); }
  window.UAPlay = { start, isOpen: () => open, back, close, esc };
})();
