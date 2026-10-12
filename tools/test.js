// node tools/test.js — 税額表の全行・基準額・賞与区分の境界で calc.js の結果を検証する
const path = require('path');
global.window = globalThis;
for (const f of ['../tables/2026.js', '../tables/2027.js', '../tables/si-2026.js', '../calc.js']) require(path.join(__dirname, f));
const C = window.GENSEN_CALC, T = window.GENSEN_TABLES, SI = window.GENSEN_SI;
let fails = 0, checks = 0;
const ok = (cond, msg) => { checks++; if (!cond) { fails++; console.log('FAIL', msg); } };

for (const y of Object.keys(T)) {
  const t = T[y], m = t.monthly;
  // 閾値未満
  ok(C.monthlyTax(t, m.threshold - 1, 'kou', 0, 0).tax === 0, `${y} 閾値未満 甲`);
  ok(C.monthlyTax(t, 100000, 'otsu', 0, 0).tax === Math.floor(100000 * m.otsuBelowRate * 1000 / 100000), `${y} 閾値未満 乙`);
  ok(C.monthlyTax(t, 0, 'otsu', 0, 0).tax === 0, `${y} 0円 乙`);
  // 通常行: 下端・上端-1 で表の値と一致
  for (const r of m.rows) for (const A of [r[0], r[1] - 1]) {
    for (let d = 0; d < 8; d++) ok(C.monthlyTax(t, A, 'kou', d, 0).tax === r[2 + d], `${y} 行${r[0]} A=${A} 甲${d}`);
    ok(C.monthlyTax(t, A, 'otsu', 0, 0).tax === r[10], `${y} 行${r[0]} A=${A} 乙`);
  }
  // 7人超・従たる給与
  const row = m.rows.find(r => 300000 >= r[0] && 300000 < r[1]);
  ok(C.monthlyTax(t, 300000, 'kou', 9, 0).tax === Math.max(0, row[9] - 2 * m.extraDependentDeduction), `${y} 7人超`);
  ok(C.monthlyTax(t, 300000, 'otsu', 0, 2).tax === row[10] - 2 * m.otsuDependentDeduction, `${y} 従たる給与`);
  ok(C.monthlyTax(t, 140000, 'kou', 8, 0).tax === 0, `${y} 7人超で負にならない`);
  // 基準額ちょうど
  for (const a of m.anchors) {
    for (let d = 0; d < 8; d++) ok(C.monthlyTax(t, a[0], 'kou', d, 0).tax === a[1 + d], `${y} 基準額${a[0]} 甲${d}`);
    if (a[9] != null) ok(C.monthlyTax(t, a[0], 'otsu', 0, 0).tax === a[9], `${y} 基準額${a[0]} 乙`);
  }
  // 基準額の間: 1円手前の計算式の値と次の基準額の値の差。
  // 200万円未満は連続（表の丸めで ±100円）。213万円以上の基準額は基礎控除の逓減で表自体が段差を持つ（数千円）ので上限 6,000円で確認
  for (let i = 0; i + 1 < m.anchors.length; i++) {
    const a = m.anchors[i], b = m.anchors[i + 1];
    const tol = b[0] < 2000000 ? 100 : 6000;
    for (let d = 0; d < 8; d++) {
      const v = C.monthlyTax(t, b[0] - 1, 'kou', d, 0).tax;
      ok(Math.abs(v - b[1 + d]) <= tol && v <= b[1 + d], `${y} 連続性 ${a[0]}→${b[0]} 甲${d}: ${v} vs ${b[1 + d]}`);
    }
  }
  // 計算式の具体値
  const a0 = m.anchors[0], r0 = m.kouRules[0];
  ok(C.monthlyTax(t, a0[0] + 10000, 'kou', 0, 0).tax === a0[1] + Math.floor(10000 * r0[1] * 1000 / 100000), `${y} 740,000+10,000 甲`);
  const o0 = m.otsuRules[0];
  ok(C.monthlyTax(t, 1000000, 'otsu', 0, 0).tax === o0[1] + Math.floor((1000000 - o0[0]) * o0[2] * 1000 / 100000), `${y} 1,000,000 乙`);
  const last = m.anchors[m.anchors.length - 1], rl = m.kouRules[m.kouRules.length - 1];
  ok(C.monthlyTax(t, 5000000, 'kou', 3, 0).tax === last[4] + Math.floor(1500000 * rl[1] * 1000 / 100000), `${y} 5,000,000 甲3`);
  // 賞与: 区分の境界
  // 賞与 100,000円（前月給与の10倍を超えない範囲）で各区分の下端・上端-1 を確認。期待値も整数演算で出す
  const expectTax = (amt, rate) => Math.floor(amt * Math.round(rate * 1000) / 100000);
  for (let d = 0; d < 8; d++) for (const seg of t.bonus.kou[d]) {
    for (const prev of [seg[0] === 0 ? seg[1] - 1 : seg[0], seg[1] == null ? seg[0] + 1000000 : seg[1] - 1]) {
      const r = C.bonusTax(t, 100000, prev, 'kou', d, 0, 6);
      ok(r.rate === seg[2] && r.tax === expectTax(100000, seg[2]), `${y} 賞与 甲${d} prev=${prev} → ${r.rate}/${r.tax} (期待 ${seg[2]})`);
    }
  }
  for (const seg of t.bonus.otsu) {
    for (const prev of [seg[0] === 0 ? seg[1] - 1 : seg[0], seg[1] == null ? seg[0] + 1000000 : seg[1] - 1]) {
      const r = C.bonusTax(t, 300000, prev, 'otsu', 0, 0, 6);
      ok(r.rate === seg[2] && r.tax === expectTax(300000, seg[2]), `${y} 賞与 乙 prev=${prev} → ${r.rate}`);
    }
  }
  // 浮動小数の罠: 100,000 × 4.084% は 4,084円（素朴な float 計算だと 4,083 になる）
  ok(C.pct(100000, 4.084) === 4084, '4.084% の端数');
  ok(C.bonusTax(t, 500000, 300000, 'kou', 10, 0, 6).rate === C.bonusTax(t, 500000, 300000, 'kou', 7, 0, 6).rate, `${y} 賞与 7人超は7人と同じ`);
  // 賞与 特例
  const sp = C.bonusTax(t, 600000, 0, 'kou', 0, 0, 6);
  ok(sp.special && sp.tax === C.monthlyTax(t, 100000, 'kou', 0, 0).tax * 6, `${y} 賞与 前月なし`);
  const sp2 = C.bonusTax(t, 3000000, 250000, 'kou', 1, 0, 6);
  ok(sp2.special && sp2.tax === (C.monthlyTax(t, 750000, 'kou', 1, 0).tax - C.monthlyTax(t, 250000, 'kou', 1, 0).tax) * 6, `${y} 賞与 10倍超`);
  ok(!C.bonusTax(t, 2500000, 250000, 'kou', 1, 0, 6).special, `${y} 賞与 ちょうど10倍は通常`);
}

// 社会保険（東京・令和8年度）
const S = SI['2026'];
const tokyo = S.kenpo.prefectures.findIndex(p => p[0] === '東京都');
ok(tokyo === 12 && S.kenpo.prefectures[tokyo][1] === 9.85, '東京都 9.85%');
let si = C.computeSI(S, { taxable: 300000, commute: 0, pref: tokyo, age: 0, std: 0, emp: 0 });
ok(si.grade[0] === 22 && si.grade[1] === 300000, '30万 → 22等級');
ok(si.kenpo === 15120, `健保 15,120 (got ${si.kenpo})`);
ok(si.pension === 27450, `厚年 27,450 (got ${si.pension})`);
ok(si.emp === 1500, `雇用 1,500 (got ${si.emp})`);
si = C.computeSI(S, { taxable: 300000, commute: 0, pref: tokyo, age: 1, std: 0, emp: 0 });
ok(si.kenpo === 17550, `健保+介護 17,550 (got ${si.kenpo})`);
si = C.computeSI(S, { taxable: 60000, commute: 0, pref: tokyo, age: 0, std: 0, emp: 0 });
ok(si.grade[0] === 1 && si.kenpo === 2923 && si.pStd === 88000 && si.pension === 8052, `1等級: 健保 ${si.kenpo} 厚年 ${si.pStd}/${si.pension}`);
si = C.computeSI(S, { taxable: 1400000, commute: 0, pref: tokyo, age: 0, std: 0, emp: -1 });
ok(si.grade[0] === 50 && si.pStd === 650000 && si.emp === 0, `50等級: 厚年 ${si.pStd}`);
si = C.computeSI(S, { taxable: 250000, commute: 12000, pref: tokyo, age: 3, std: 0, emp: 0 });
ok(si.grade[1] === 260000 && si.pension === 0 && si.emp === C.full(262000, 0.5), '通勤手当込みで等級判定・70歳以上は厚年なし');
si = C.computeSI(S, { taxable: 250000, commute: 0, pref: tokyo, age: 4, std: 0, emp: 0 });
ok(si.kenpo === 0 && si.pension === 0 && si.emp === 1250, '75歳以上は健保・厚年なし');
si = C.computeSI(S, { taxable: 250000, commute: 0, pref: tokyo, age: 0, std: 410000, emp: 0 });
ok(si.grade[1] === 410000, '標準報酬の手動指定');
ok(C.roundHalfDown(1005, 10) === 100 && C.roundHalfDown(1006, 10) === 101 && C.roundHalfDown(1000, 10) === 100, '50銭以下切捨て・50銭超切上げ');
let sb = C.computeSIBonus(S, { taxable: 512345, commute: 0, pref: tokyo, age: 1, std: 0, emp: 0 });
ok(sb.stdBonus === 512000 && sb.kenpo === C.half(512000, 11.70) && sb.pension === C.half(512000, 18.3) && sb.emp === C.full(512345, 0.5), '賞与の社保');
sb = C.computeSIBonus(S, { taxable: 2000000, commute: 0, pref: tokyo, age: 0, std: 0, emp: -1 });
ok(sb.pStd === 1500000 && sb.emp === 0, '賞与 厚年上限150万');
ok(C.parseYen('２５３,０００円') === 253000 && C.parseYen('') === null && Number.isNaN(C.parseYen('abc')), 'parseYen');

console.log(`${checks} checks, ${fails} failures`);
process.exit(fails ? 1 : 0);
