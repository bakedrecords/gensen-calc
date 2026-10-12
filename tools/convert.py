#!/usr/bin/env python3
"""国税庁「給与所得の源泉徴収税額表」の Excel（月額表・賞与算出率表）を JSON/JS に変換する。

使い方:
  python convert.py --year 2026 --monthly source/2026/01-07.xls --bonus source/2026/15-16.xls \
      --monthly-url https://... --bonus-url https://... --out tables

依存: xlrd（.xls）、openpyxl（.xlsx）
"""
import argparse, datetime, json, re, sys
from pathlib import Path


def load_rows(path: Path):
    """シート先頭を [[cell,...],...] で返す。空セルは ''、数値は float。"""
    if path.suffix.lower() == ".xls":
        import xlrd
        sh = xlrd.open_workbook(str(path)).sheet_by_index(0)
        return [[sh.cell_value(r, c) for c in range(sh.ncols)] for r in range(sh.nrows)]
    import openpyxl
    ws = openpyxl.load_workbook(str(path), data_only=True).worksheets[0]
    out = []
    for row in ws.iter_rows(values_only=True):
        out.append([("" if v is None else v) for v in row])
    return out


def num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def to_int(v):
    return int(round(float(v)))


def yen(s):
    return int(s.replace(",", ""))


def s(v):
    return v.strip() if isinstance(v, str) else ""


def parse_monthly(rows):
    title = s(rows[0][1]); notice = s(rows[1][1])
    threshold = None; below_rate = None
    table = []; anchors = []; kou_rules = {}; otsu_rules = {}; per_dep = None
    for r in rows:
        r = list(r) + [""] * (12 - len(r))
        c1, c2 = r[1], r[2]
        kou = r[3:11]; otsu = r[11]
        # 「105,000円未満」行
        if num(c1) and s(c2) == "円未満":
            threshold = to_int(c1)
            m = re.search(r"([\d.]+)％に相当する金額", s(otsu))
            below_rate = float(m.group(1)) if m else None
            continue
        # 通常行: 以上・未満・甲0〜7人・乙
        if num(c1) and num(c2) and all(num(k) for k in kou) and num(otsu):
            table.append([to_int(c1), to_int(c2)] + [to_int(k) for k in kou] + [to_int(otsu)])
            continue
        # 基準額行: 「740,000円」+ 甲0〜7人（+乙）
        m = re.fullmatch(r"([\d,]+)円", s(c1))
        if m and all(num(k) for k in kou):
            anchors.append([yen(m.group(1))] + [to_int(k) for k in kou] + [to_int(otsu) if num(otsu) else None])
            continue
        # 甲欄の計算式（3列目）: 「740,000円を超える金額の20.42％に相当する金額を加算」
        # ※令和9年分は「…のう」「ち740,000円を超える…」と2セルに分かれているので先頭の「ち」を許す
        m = re.search(r"^\s*ち?\s*([\d,]+)円を超える金額の([\d.]+)％に相当する金額を加算", s(r[3]))
        if m:
            kou_rules[yen(m.group(1))] = float(m.group(2))
        # 乙欄の計算式（乙列）: 「259,200円に、…のうち740,000円を超える金額の40.84％に相当する金額を加算」
        m = re.search(r"([\d,]+)円に、その月の社会保険料等控除後の給与等の金額のうち([\d,]+)円を超える金額の([\d.]+)％", s(otsu))
        if m:
            otsu_rules[yen(m.group(2))] = [yen(m.group(1)), float(m.group(3))]
        for cell in r:
            m = re.search(r"１人ごとに([\d,]+)円を控除", s(cell))
            if m and per_dep is None:
                per_dep = yen(m.group(1))
    # 検証
    assert threshold is not None and below_rate is not None, "閾値行が見つからない"
    table.sort(); anchors.sort()
    assert table[0][0] == threshold, f"先頭行 {table[0][0]} が閾値 {threshold} と一致しない"
    for a, b in zip(table, table[1:]):
        assert a[1] == b[0], f"行が連続していない: {a[:2]} -> {b[:2]}"
    for row in table:
        ks = row[2:10]
        assert all(x >= y for x, y in zip(ks, ks[1:])), f"扶養人数で税額が増えている: {row}"
    assert anchors and anchors[0][0] == table[-1][1], "基準額の先頭が通常行の末尾と一致しない"
    for a in anchors:
        assert a[0] in kou_rules, f"基準額 {a[0]} に対応する甲欄の率がない"
    assert per_dep, "7人超の控除額が見つからない"
    kr = sorted(kou_rules.items()); orr = sorted(otsu_rules.items())
    return {
        "title": title, "notice": notice,
        "threshold": threshold, "otsuBelowRate": below_rate,
        "rows": table,
        "anchors": anchors,
        "kouRules": [[k, v] for k, v in kr],
        "otsuRules": [[k, v[0], v[1]] for k, v in orr],
        "extraDependentDeduction": per_dep,
        "otsuDependentDeduction": per_dep,
    }


def parse_bonus(rows):
    title = s(rows[0][1]); notice = s(rows[1][1])
    kou = [[] for _ in range(8)]; otsu = []
    for r in rows:
        r = list(r) + [""] * (21 - len(r))
        if not num(r[1]):
            continue
        rate = float(r[1])
        def rng(lo, hi):
            if not num(lo):
                return None
            lo_y = to_int(lo) * 1000
            if s(hi) == "千円未満":
                return [0, lo_y, rate]
            if s(hi) == "千円以上":
                return [lo_y, None, rate]
            if num(hi):
                return [lo_y, to_int(hi) * 1000, rate]
            return None
        for k in range(8):
            x = rng(r[3 + 2 * k], r[4 + 2 * k])
            if x: kou[k].append(x)
        x = rng(r[19], r[20])
        if x: otsu.append(x)
    # 検証: 各列が 0 から連続して ∞ まで覆う
    def check(lst, name):
        lst.sort(key=lambda x: x[0])
        assert lst[0][0] == 0 and lst[-1][1] is None, f"{name}: 範囲の端が不正 {lst[0]} {lst[-1]}"
        for a, b in zip(lst, lst[1:]):
            assert a[1] == b[0], f"{name}: 範囲が連続していない {a} -> {b}"
            assert a[2] < b[2], f"{name}: 率が単調でない {a} -> {b}"
    for k in range(8):
        check(kou[k], f"甲{k}人")
    check(otsu, "乙")
    return {"title": title, "notice": notice, "kou": kou, "otsu": otsu}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--year", type=int, required=True)
    ap.add_argument("--era", required=True, help="例: 令和8年分")
    ap.add_argument("--monthly", type=Path, required=True)
    ap.add_argument("--bonus", type=Path, required=True)
    ap.add_argument("--monthly-url", default="")
    ap.add_argument("--bonus-url", default="")
    ap.add_argument("--out", type=Path, default=Path("tables"))
    a = ap.parse_args()
    data = {
        "year": a.year, "era": a.era,
        "retrieved": datetime.date.today().isoformat(),
        "source": {"monthly": a.monthly_url, "bonus": a.bonus_url},
        "monthly": parse_monthly(load_rows(a.monthly)),
        "bonus": parse_bonus(load_rows(a.bonus)),
    }
    a.out.mkdir(parents=True, exist_ok=True)
    js = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    (a.out / f"{a.year}.json").write_text(json.dumps(data, ensure_ascii=False, indent=None) + "\n", encoding="utf-8")
    (a.out / f"{a.year}.js").write_text(
        f"// 自動生成: tools/convert.py（{data['retrieved']}）。手で編集しない。\n"
        f"window.GENSEN_TABLES = window.GENSEN_TABLES || {{}};\n"
        f"window.GENSEN_TABLES[\"{a.year}\"] = {js};\n", encoding="utf-8")
    m = data["monthly"]; b = data["bonus"]
    print(f"{a.era}: 月額表 通常行 {len(m['rows'])} 行（{m['rows'][0][0]:,}〜{m['rows'][-1][1]:,}）, "
          f"閾値 {m['threshold']:,} / 乙 {m['otsuBelowRate']}%, 基準額 {len(m['anchors'])} 件, "
          f"甲率 {m['kouRules']}, 乙式 {m['otsuRules']}, 7人超控除 {m['extraDependentDeduction']}")
    print(f"  賞与: 甲 各{[len(x) for x in b['kou']]} 区分, 乙 {len(b['otsu'])} 区分")


if __name__ == "__main__":
    main()
