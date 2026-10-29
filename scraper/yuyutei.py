"""
遊々亭 ユニオンアリーナ 價格抓取程式
--------------------------------------
每天由 GitHub Actions 自動執行一次，把所有系列的卡片與售價存到 data/cards.json。

輸出格式（為了讓手機載入快一點，每張卡用一個陣列表示）：
{
  "updated": "2026-10-29T05:00:00+08:00",
  "sets":  { "shy1": "SHY", ... },             # 系列代碼 → 系列名稱
  "cards": [
    [卡號, 稀有度, 卡名, 價格(円), 庫存, 系列代碼, 遊々亭商品編號],
    ...
  ]
}
庫存：0 = 售完，1~98 = 剩幾張，99 = 充足（◯），-1 = 看不出來

手動測試（只抓前 3 個系列）：  python scraper/yuyutei.py --limit 3
"""

import argparse
import datetime
import json
import os
import re
import sys
import time

import requests
from bs4 import BeautifulSoup

BASE = "https://yuyu-tei.jp"
# 任一個系列頁面都有完整的「収録弾」清單，用來取得所有系列代碼
INDEX_PAGE = BASE + "/sell/ua/s/new"
FALLBACK_INDEX = BASE + "/sell/ua/s/shy1"
OUT_FILE = os.path.join(os.path.dirname(__file__), "..", "data", "cards.json")

DELAY_SECONDS = 3      # 每頁之間停 3 秒，避免造成對方網站負擔
MIN_TOTAL_CARDS = 500  # 抓到的卡太少時視為失敗，不覆蓋舊資料

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/130.0 Safari/537.36"
    ),
    "Accept-Language": "ja,zh-TW;q=0.8,en;q=0.6",
}

TW = datetime.timezone(datetime.timedelta(hours=8))


def log(msg):
    print(msg, flush=True)


def get(session, url, retries=3):
    for attempt in range(1, retries + 1):
        try:
            r = session.get(url, headers=HEADERS, timeout=30)
            if r.status_code == 200:
                return r.text
            log(f"  HTTP {r.status_code}：{url}")
        except requests.RequestException as e:
            log(f"  連線失敗（第 {attempt} 次）：{e}")
        time.sleep(DELAY_SECONDS * attempt)
    return None


def parse_sets(html):
    """從頁面上的『収録弾』勾選框取得 {系列代碼: 系列名稱}"""
    soup = BeautifulSoup(html, "html.parser")
    sets = {}
    for inp in soup.select('input[name="vers[]"]'):
        code = (inp.get("value") or "").strip()
        if not code or code in sets:
            continue
        name = code
        if inp.get("id"):
            label = soup.find("label", attrs={"for": inp["id"]})
            if label:
                name = label.get_text(" ", strip=True)
        sets[code] = name
    return sets


def parse_stock(text):
    text = re.sub(r"\s+", "", text or "")
    text = text.replace("在庫", "").lstrip(":：")
    if not text:
        return -1
    if "×" in text or "✕" in text:
        return 0
    m = re.search(r"(\d+)", text)
    if m:
        return min(int(m.group(1)), 98)
    if any(s in text for s in "◯○◎"):
        return 99
    return -1


def parse_price(text):
    digits = re.sub(r"[^\d]", "", text or "")
    return int(digits) if digits else None


def parse_cards(html, set_code):
    soup = BeautifulSoup(html, "html.parser")
    rows = []

    # 卡片依稀有度分區（div.cards-list），區塊標題是稀有度
    sections = soup.select("div.cards-list") or [soup]
    for sec in sections:
        sec_rarity = ""
        head = sec.select_one("h3 span")
        if head:
            sec_rarity = head.get_text(strip=True)

        for c in sec.select(".card-product"):
            num_el = c.select_one("span.border")
            name_el = c.select_one("h4")
            price_el = c.select_one("strong")
            stock_el = c.select_one(".cart_sell_zaiko")
            img_el = c.select_one("img.card")
            link_el = c.select_one('a[href*="/sell/ua/card/"]')

            num = num_el.get_text(strip=True) if num_el else ""
            name = name_el.get_text(" ", strip=True) if name_el else ""
            price = parse_price(price_el.get_text() if price_el else "")

            # 圖片 alt 的格式是「卡號 稀有度 卡名」
            rarity = sec_rarity
            if img_el and img_el.get("alt"):
                parts = img_el["alt"].split(" ", 2)
                if len(parts) >= 2:
                    if not num:
                        num = parts[0]
                    if parts[0] == num:
                        rarity = parts[1]
                    if not name and len(parts) == 3:
                        name = parts[2]

            item_set, item_id = set_code, ""
            src = ""
            if link_el:
                src = link_el.get("href", "")
            elif img_el:
                src = img_el.get("src", "")
            m = re.search(r"/(?:card|100_140)/([a-z0-9]+)/(\d+)", src)
            if m:
                item_set, item_id = m.group(1), m.group(2)

            if not num or price is None:
                continue
            rows.append([
                num,
                rarity,
                name,
                price,
                parse_stock(stock_el.get_text() if stock_el else ""),
                item_set,
                item_id,
            ])
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0, help="只抓前 N 個系列（測試用）")
    args = ap.parse_args()

    session = requests.Session()

    log("讀取系列清單…")
    html = get(session, INDEX_PAGE) or get(session, FALLBACK_INDEX)
    if not html:
        log("無法連到遊々亭，這次不更新。")
        sys.exit(1)
    sets = parse_sets(html)
    if not sets:
        log("找不到系列清單，可能是遊々亭改版了。")
        sys.exit(1)
    log(f"共 {len(sets)} 個系列")

    codes = list(sets.keys())
    if args.limit:
        codes = codes[: args.limit]

    cards, seen, failed = [], set(), []
    for i, code in enumerate(codes, 1):
        time.sleep(DELAY_SECONDS)
        page = get(session, f"{BASE}/sell/ua/s/{code}")
        if not page:
            failed.append(code)
            continue
        rows = parse_cards(page, code)
        new = 0
        for r in rows:
            key = (r[5], r[6], r[0], r[1])
            if key in seen:
                continue
            seen.add(key)
            cards.append(r)
            new += 1
        log(f"[{i}/{len(codes)}] {code} {sets[code]}：{new} 張")

    if not args.limit and len(cards) < MIN_TOTAL_CARDS:
        log(f"只抓到 {len(cards)} 張，太少了，保留舊資料不覆蓋。")
        sys.exit(1)

    data = {
        "updated": datetime.datetime.now(TW).isoformat(timespec="seconds"),
        "sets": {c: sets[c] for c in codes},
        "cards": cards,
        "failed": failed,
    }
    os.makedirs(os.path.dirname(OUT_FILE), exist_ok=True)
    with open(OUT_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    log(f"完成：{len(cards)} 張卡，失敗 {len(failed)} 個系列 {failed}")


if __name__ == "__main__":
    main()
