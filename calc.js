// 源泉所得税・社会保険料の計算ロジック（ブラウザ: window.GENSEN_CALC / Node: module.exports）
(function(root){
'use strict';
const fmt = n => Math.round(n).toLocaleString('ja-JP');
const AGE_BANDS = [
  ['40歳未満', {kenpo:true, care:false, pension:true}],
  ['40〜64歳（介護保険あり）', {kenpo:true, care:true, pension:true}],
  ['65〜69歳（介護保険は年金から）', {kenpo:true, care:false, pension:true}],
  ['70〜74歳（厚生年金なし）', {kenpo:true, care:false, pension:false}],
  ['75歳以上（健保・厚年なし）', {kenpo:false, care:false, pension:false}],
];

// ---------- 数値ユーティリティ（浮動小数の誤差を避けて整数で計算） ----------
// amount × rate% の1円未満切捨て。rate は小数3桁まで（例 3.063）
function pct(amount, rate){ return Math.floor(amount * Math.round(rate * 1000) / 100000); }
// 被保険者負担分の端数処理: 50銭以下切捨て・50銭超切上げ。num/den が金額
function roundHalfDown(num, den){ const f = Math.floor(num / den); const rem = num - f * den; return rem * 2 > den ? f + 1 : f; }
// 標準報酬 × rate% ÷ 2（折半）。rate は小数2桁まで
function half(amount, rate){ return roundHalfDown(amount * Math.round(rate * 100), 20000); }
// 賃金 × rate%（雇用保険）。rate は小数2桁まで
function full(amount, rate){ return roundHalfDown(amount * Math.round(rate * 100), 10000); }
function parseYen(str){
  if (str == null) return null;
  let s = String(str).replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/[,，、\s円]/g, '');
  if (s === '') return null;
  if (!/^-?\d+$/.test(s)) return NaN;
  return parseInt(s, 10);
}

// ---------- 所得税（月額表） ----------
function monthlyTax(T, A, col, deps, otsuDeps){
  const m = T.monthly, d = Math.min(deps, 7);
  let tax, basis;
  if (A < m.threshold){
    if (col === 'kou'){ tax = 0; basis = `${fmt(m.threshold)}円未満の行 → 税額 0円`; }
    else { tax = pct(A, m.otsuBelowRate); basis = `${fmt(m.threshold)}円未満の行 → ${fmt(A)}円 × ${m.otsuBelowRate}%（1円未満切捨て）`; }
  } else {
    const row = m.rows.find(r => A >= r[0] && A < r[1]);
    if (row){
      tax = col === 'kou' ? row[2 + d] : row[10];
      basis = `${fmt(row[0])}円以上 ${fmt(row[1])}円未満の行`;
    } else if (col === 'kou'){
      let a = null; for (const x of m.anchors) if (x[0] <= A) a = x;
      const rule = m.kouRules.find(r => r[0] === a[0]);
      const base = a[1 + d];
      if (A === a[0]){ tax = base; basis = `${fmt(a[0])}円の行`; }
      else { tax = base + pct(A - a[0], rule[1]); basis = `${fmt(a[0])}円の場合の税額 ${fmt(base)}円 ＋ 超える金額 ${fmt(A - a[0])}円 × ${rule[1]}%（1円未満切捨て）`; }
    } else {
      const a = m.anchors.find(x => x[0] === A && x[9] != null);
      if (a){ tax = a[9]; basis = `${fmt(A)}円の行`; }
      else {
        let r = null; for (const x of m.otsuRules) if (x[0] <= A) r = x;
        tax = r[1] + pct(A - r[0], r[2]);
        basis = `${fmt(r[1])}円 ＋ ${fmt(r[0])}円を超える金額 ${fmt(A - r[0])}円 × ${r[2]}%（1円未満切捨て）`;
      }
    }
  }
  const notes = [];
  if (col === 'kou' && deps > 7){ const ded = (deps - 7) * m.extraDependentDeduction; tax -= ded; notes.push(`扶養親族等が7人を超える分: ${deps - 7}人 × ${fmt(m.extraDependentDeduction)}円 を控除`); }
  if (col === 'otsu' && otsuDeps > 0){ const ded = otsuDeps * m.otsuDependentDeduction; tax -= ded; notes.push(`従たる給与の扶養控除等申告書: ${otsuDeps}人 × ${fmt(m.otsuDependentDeduction)}円 を控除`); }
  if (tax < 0) tax = 0;
  return { tax, basis, notes };
}

// ---------- 所得税（賞与） ----------
function bonusTax(T, bonus, prev, col, deps, otsuDeps, months){
  const colName = col === 'kou' ? `甲欄 扶養${Math.min(deps, 7)}人${deps > 7 ? '（7人超）' : ''}` : '乙欄';
  if (prev == null || prev <= 0){
    const part = Math.floor(bonus / months);
    const t = monthlyTax(T, part, col, deps, otsuDeps);
    return { tax: t.tax * months, special: true,
      basis: `前月の給与がないため月額表で計算: 賞与 ÷ ${months} = ${fmt(part)}円 → 月額表 ${colName}（${t.basis}）= ${fmt(t.tax)}円 × ${months}`, notes: t.notes };
  }
  if (bonus > prev * 10){
    const part = Math.floor(bonus / months);
    const t1 = monthlyTax(T, part + prev, col, deps, otsuDeps);
    const t0 = monthlyTax(T, prev, col, deps, otsuDeps);
    const tax = Math.max(0, t1.tax - t0.tax) * months;
    return { tax, special: true,
      basis: `賞与が前月給与の10倍を超えるため月額表で計算: （賞与 ÷ ${months} ＝ ${fmt(part)}円 ＋ 前月給与 ${fmt(prev)}円）の税額 ${fmt(t1.tax)}円 － 前月給与の税額 ${fmt(t0.tax)}円 ＝ ${fmt(t1.tax - t0.tax)}円 × ${months}`, notes: t1.notes };
  }
  const list = col === 'kou' ? T.bonus.kou[Math.min(deps, 7)] : T.bonus.otsu;
  const r = list.find(x => prev >= x[0] && (x[1] == null || prev < x[1]));
  const range = r[1] == null ? `${fmt(r[0])}円以上` : (r[0] === 0 ? `${fmt(r[1])}円未満` : `${fmt(r[0])}円以上 ${fmt(r[1])}円未満`);
  const notes = [];
  if (col === 'kou' && deps > 7) notes.push('賞与の算出率表は7人以上が同じ率です');
  if (col === 'otsu' && otsuDeps > 0) notes.push('賞与の乙欄には扶養親族等による控除はありません');
  return { tax: pct(bonus, r[2]), rate: r[2], basis: `算出率表 ${colName} ／ 前月給与 ${range} → ${r[2]}%（賞与 ${fmt(bonus)}円 × ${r[2]}%、1円未満切捨て）`, notes };
}

// ---------- 社会保険料 ----------
function gradeByRemuneration(S, rem){
  const g = S.kenpo.grades;
  return g.find(x => rem >= x[2] && (x[3] == null || rem < x[3])) || g[g.length - 1];
}
function pensionStd(S, grade){
  if (grade[4] != null) return grade[1];
  const g = S.kenpo.grades;
  if (grade[1] < S.pension.minGradeUpper) return g.find(x => x[4] === 1)[1];
  return g.filter(x => x[4] != null).pop()[1];
}
function computeSI(S, o){
  const flags = AGE_BANDS[o.age][1];
  const rem = o.taxable + o.commute;
  const grade = o.std ? S.kenpo.grades.find(x => x[1] === o.std) : gradeByRemuneration(S, rem);
  const prefRate = S.kenpo.prefectures[o.pref][1];
  const kenpoRate = Math.round((prefRate + S.kenpo.supportRate + (flags.care ? S.kenpo.careRate : 0)) * 100) / 100;
  const pStd = pensionStd(S, grade);
  const kenpo = flags.kenpo ? half(grade[1], kenpoRate) : 0;
  const pension = flags.pension ? half(pStd, S.pension.rate) : 0;
  const empRate = o.emp >= 0 ? S.employment.options[o.emp][1] : null;
  const emp = empRate != null ? full(rem, empRate) : 0;
  return { grade, pStd, kenpoRate, prefRate, kenpo, pension, emp, empRate, total: kenpo + pension + emp, flags, rem };
}
function computeSIBonus(S, o){
  const flags = AGE_BANDS[o.age][1];
  const stdBonus = Math.floor(o.taxable / 1000) * 1000;
  const prefRate = S.kenpo.prefectures[o.pref][1];
  const kenpoRate = Math.round((prefRate + S.kenpo.supportRate + (flags.care ? S.kenpo.careRate : 0)) * 100) / 100;
  const pStd = Math.min(stdBonus, S.pension.bonusCapMonthly);
  const kenpo = flags.kenpo ? half(stdBonus, kenpoRate) : 0;
  const pension = flags.pension ? half(pStd, S.pension.rate) : 0;
  const empRate = o.emp >= 0 ? S.employment.options[o.emp][1] : null;
  const emp = empRate != null ? full(o.taxable, empRate) : 0;
  return { stdBonus, pStd, kenpoRate, prefRate, kenpo, pension, emp, empRate, total: kenpo + pension + emp, flags };
}

const api = { AGE_BANDS, pct, roundHalfDown, half, full, parseYen, monthlyTax, bonusTax, gradeByRemuneration, pensionStd, computeSI, computeSIBonus };
if (typeof module !== 'undefined' && module.exports) module.exports = api;
root.GENSEN_CALC = api;
})(typeof window !== 'undefined' ? window : globalThis);
