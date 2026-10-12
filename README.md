# 源泉所得税 計算（gensen-calc）

給与・賞与の源泉所得税を、国税庁の「給与所得の源泉徴収税額表」から求める計算機です。
ブラウザだけで動き、入力した金額は外部に送信されません。

- 月額表（甲欄・乙欄、扶養親族等の数、7人超の控除、74万円超の計算式）
- 賞与の算出率表（甲欄・乙欄）と、前月給与なし／賞与が前月給与の10倍超のときの特例計算
- 切り替えで社会保険料（協会けんぽ 健康保険・介護保険・子ども・子育て支援金、厚生年金、雇用保険）の本人負担分も計算
- 年分の切り替え（令和8年分・令和9年分）

日額表（丙欄）には対応していません。

## ファイル

| パス | 内容 |
| --- | --- |
| `index.html` | 画面 |
| `calc.js` | 計算ロジック（ブラウザ・Node 共用） |
| `tables/YYYY.js` | 月額表・賞与算出率表（`tools/convert.py` で国税庁 Excel から生成） |
| `tables/si-YYYY.js` | 社会保険料率・標準報酬月額表（`tools/convert_si.py` で協会けんぽ Excel から生成） |
| `source/` | 変換元の Excel（国税庁・協会けんぽ） |
| `tools/test.js` | 全行・境界値のテスト（`node tools/test.js`） |

## 毎年の更新

1. 国税庁の「源泉徴収税額表」ページから月額表（01-07）と賞与（15-16）の Excel を `source/YYYY/` に保存
2. 変換（`.xls` は xlrd、`.xlsx` は openpyxl が必要）

   ```bash
   python3 tools/convert.py --year 2028 --era 令和10年分 \
     --monthly source/2028/01-07.xlsx --bonus source/2028/15-16.xls \
     --monthly-url <ExcelのURL> --bonus-url <ExcelのURL>
   ```

3. `index.html` の `<script src="tables/2028.js">` を追加
4. 協会けんぽの保険料額表（全都道府県 Excel）を `source/kenpo/` に保存し、`tools/convert_si.py` で `tables/si-2028.js` を生成。雇用保険料率は `convert_si.py` 内の `EMPLOYMENT` を更新
5. `node tools/test.js` が通ることを確認

## 出典

- 国税庁 [令和8年分 源泉徴収税額表](https://www.nta.go.jp/publication/pamph/gensen/zeigakuhyo2026/01.htm)、[令和9年分 源泉徴収税額表](https://www.nta.go.jp/publication/pamph/gensen/zeigakuhyo2027/01.htm)
- 全国健康保険協会 [令和8年度 保険料額表](https://www.kyoukaikenpo.or.jp/about/business/insurance_rate/premium_prefectures/r08)
- 厚生労働省 [雇用保険料率について](https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/0000108634.html)
