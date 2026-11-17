// Расчётное ядро: чистые функции без обращения к странице и базе (покрыты тестами)

export const MONTHS_RU = ['январь','февраль','март','апрель','май','июнь','июль','август','сентябрь','октябрь','ноябрь','декабрь'];
export const OPU_ORDER = ['Выручка', 'Прямые расходы', '#Маржинальная прибыль', 'Административные', 'Коммерческие', 'Агентские', '#Операционная прибыль', 'Прочие доходы и расходы', 'Налоги', '#Чистая прибыль'];
// Старое название группы до разделения: считаем коммерческими (кроме агентских статей)
export const opuGroup = a => (a.opu_group === 'Коммерческие и агентские' ? (/агентск/i.test(a.name) ? 'Агентские' : 'Коммерческие') : a.opu_group);
export const DDS_SECTIONS = [['operating','Операционная деятельность'], ['investing','Инвестиционная деятельность'], ['financing','Финансовая деятельность']];

export const r2 = x => Math.round((x + Number.EPSILON) * 100) / 100;
export const ym = d => (d ? String(d).slice(0, 7) : null);
export const monthLabel = k => { const [y, m] = k.split('-'); return MONTHS_RU[+m - 1].slice(0, 3) + ' ' + y.slice(2); };

export function monthList(from, to) {            // 'YYYY-MM' .. 'YYYY-MM' включительно
  const out = []; let [y, m] = from.split('-').map(Number); const [ty, tm] = to.split('-').map(Number);
  while (y < ty || (y === ty && m <= tm)) { out.push(`${y}-${String(m).padStart(2, '0')}`); m++; if (m > 12) { m = 1; y++; } }
  return out;
}

const artMap = arts => new Map(arts.map(a => [a.id, a]));
export const signed = (op, art) => (art.kind === 'income' ? 1 : -1) * Number(op.amount);

// ДДС считает операции с датой оплаты, ОПУ с периодом
const dateOf = basis => (basis === 'cash' ? o => o.op_date : o => o.period);
const inBasis = (o, a, basis) => basis === 'cash' ? !!o.op_date : (!!o.period && !!a.opu_group);

// Суммы по статье и колонке: { artId: { col: сумма } }
export function sumMatrix(ops, arts, basis, colOf, colKeys) {
  const am = artMap(arts), keys = new Set(colKeys), res = {};
  for (const o of ops) {
    const a = am.get(o.article_id); if (!a || !inBasis(o, a, basis)) continue;
    const c = colOf(o, dateOf(basis)(o)); if (!keys.has(c)) continue;
    ((res[a.id] ??= {})[c] = (res[a.id][c] || 0) + Number(o.amount));
  }
  return res;
}

const rowVals = (cols, f) => Object.fromEntries(cols.map(c => [c, r2(f(c))]));
const sum = (obj, cols) => r2(cols.reduce((s, c) => s + (obj[c] || 0), 0));

function artRows(list, m, cols, level) {
  return list.map(a => {
    const v = rowVals(cols, c => m[a.id]?.[c] || 0);
    return { type: 'article', label: a.name, vals: v, total: sum(v, cols), level };
  }).filter(r => r.total !== 0);
}

// Остаток на начало дня date: стартовые остатки + все оплаты до этой даты (по счетам, дата >= даты остатка)
export function balanceAt(date, accounts, ops, arts, accountId = null) {
  const am = artMap(arts), acc = new Map(accounts.map(a => [a.id, a]));
  let b = accounts.filter(a => (accountId == null || a.id === accountId) && a.opening_date <= date).reduce((s, a) => s + Number(a.opening_balance), 0);
  for (const o of ops) {
    if (!o.op_date || o.op_date >= date || (accountId != null && o.account_id !== accountId)) continue;
    const a = acc.get(o.account_id); if (!a || o.op_date < a.opening_date) continue;
    b += signed(o, am.get(o.article_id));
  }
  return r2(b);
}

const monthEnd = k => { const [y, m] = k.split('-').map(Number); return `${k}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`; };
const addDay = d => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + 1); return t.toISOString().slice(0, 10); };
function dayList(a, b) { const out = []; for (let d = a; d <= b; d = addDay(d)) out.push(d); return out; }
function nextMonthStart(k) { let [y, m] = k.split('-').map(Number); m++; if (m > 12) { m = 1; y++; } return `${y}-${String(m).padStart(2, '0')}-01`; }

// Отчёт ДДС. objectIds: null = свод по всем объектам, иначе массив id. mode: 'months' | 'objects'
export function ddsReport({ ops, arts, objects, accounts, from, to, objectId = null, mode = 'months' }) {
  const months = monthList(from, to);
  let cols, colOf, colLabels;
  if (mode === 'objects') {
    const objs = objects.filter(o => ops.some(x => x.object_id === o.id));
    cols = objs.map(o => String(o.id)); colLabels = objs.map(o => o.name);
    colOf = o => String(o.object_id);
  } else if (mode === 'days') {
    cols = dayList(from + '-01', monthEnd(to)); colLabels = cols.map(d => d.slice(8, 10) + '.' + d.slice(5, 7)); colOf = (o, d) => d;
  } else {
    cols = months; colLabels = months.map(monthLabel); colOf = (o, d) => ym(d);
  }
  const scoped = ops.filter(o => o.op_date && ym(o.op_date) >= from && ym(o.op_date) <= to && (mode === 'objects' || objectId == null || o.object_id === objectId));
  const m = sumMatrix(scoped, arts, 'cash', colOf, cols);
  const rows = []; const flow = {}; cols.forEach(c => flow[c] = 0);
  for (const [sec, title] of DDS_SECTIONS) {
    const inc = arts.filter(a => a.dds_section === sec && a.kind === 'income').sort((a, b) => a.sort - b.sort);
    const exp = arts.filter(a => a.dds_section === sec && a.kind === 'expense').sort((a, b) => a.sort - b.sort);
    const ri = artRows(inc, m, cols, 2), re = artRows(exp, m, cols, 2);
    if (!ri.length && !re.length) continue;
    const tin = rowVals(cols, c => ri.reduce((s, r) => s + r.vals[c], 0)), tex = rowVals(cols, c => re.reduce((s, r) => s + r.vals[c], 0));
    const net = rowVals(cols, c => tin[c] - tex[c]); cols.forEach(c => flow[c] += net[c]);
    rows.push({ type: 'section', label: title });
    rows.push({ type: 'group', label: 'Поступления', vals: tin, total: sum(tin, cols), level: 1 }, ...ri);
    rows.push({ type: 'group', label: 'Платежи', vals: tex, total: sum(tex, cols), level: 1 }, ...re);
    rows.push({ type: 'subtotal', label: 'Сальдо: ' + title.toLowerCase(), vals: net, total: sum(net, cols) });
  }
  rows.push({ type: 'total', label: 'Чистый денежный поток', vals: rowVals(cols, c => flow[c]), total: sum(flow, cols) });
  let balances = null;
  if (mode === 'months' && objectId == null) {
    const open = {}, close = {};
    months.forEach(k => { open[k] = balanceAt(k + '-01', accounts, ops, arts); close[k] = balanceAt(nextMonthStart(k), accounts, ops, arts); });
    rows.push({ type: 'metric', label: 'Остаток на начало', vals: open, total: open[months[0]] });
    rows.push({ type: 'metric', label: 'Остаток на конец', vals: close, total: close[months[months.length - 1]] });
    balances = accounts.filter(a => a.active).map(a => ({ name: a.name, value: balanceAt(nextMonthStart(months[months.length - 1]), accounts, ops, arts, a.id) }));
  }
  return { cols, colLabels, rows, balances };
}

// Отчёт ОПУ (по начислению). mode: 'months' | 'objects'
export function opuReport({ ops, arts, objects, from, to, objectId = null, mode = 'months' }) {
  const months = monthList(from, to);
  let cols, colLabels, colOf;
  if (mode === 'objects') {
    const objs = objects.filter(o => ops.some(x => x.object_id === o.id && x.period));
    cols = objs.map(o => String(o.id)); colLabels = objs.map(o => o.name); colOf = o => String(o.object_id);
  } else { cols = months; colLabels = months.map(monthLabel); colOf = (o, d) => ym(d); }
  const scoped = ops.filter(o => o.period && ym(o.period) >= from && ym(o.period) <= to && (mode === 'objects' || objectId == null || o.object_id === objectId));
  const m = sumMatrix(scoped, arts, 'accrual', colOf, cols);
  const rows = []; let profit = Object.fromEntries(cols.map(c => [c, 0])); let revenue = null;
  const pct = (v) => Object.fromEntries(cols.map(c => [c, revenue && revenue[c] ? r2(v[c] / revenue[c] * 100) : 0]));
  for (const g of OPU_ORDER) {
    if (g[0] === '#') {
      const name = g.slice(1), vals = rowVals(cols, c => profit[c]);
      rows.push({ type: 'subtotal', label: name, vals, total: sum(vals, cols) });
      const p = pct(vals); rows.push({ type: 'percent', label: name + ', % от выручки', vals: p, total: revenue ? r2(sum(vals, cols) / (sum(revenue, cols) || 1) * 100) : 0 });
      continue;
    }
    const list = arts.filter(a => opuGroup(a) === g).sort((a, b) => a.sort - b.sort);
    const items = artRows(list, m, cols, 1);
    const vals = rowVals(cols, c => list.reduce((s, a) => s + signed({ amount: m[a.id]?.[c] || 0 }, a), 0));
    const total = sum(vals, cols);
    if (g === 'Выручка') revenue = vals;
    if (!items.length && !(g === 'Выручка')) continue;
    cols.forEach(c => profit[c] += vals[c]);
    const gv = rowVals(cols, c => Math.abs(vals[c]));
    rows.push({ type: 'group', label: g, vals: g === 'Прочие доходы и расходы' ? vals : gv, total: g === 'Прочие доходы и расходы' ? total : Math.abs(total), level: 0 }, ...items);
  }
  return { cols, colLabels, rows };
}

// Рентабельность по объектам за период (по начислению). Общие расходы ("Все объекты") отдельной строкой
// other = adm + com + agent + tax (налоги и прочие доходы/расходы); все расходы положительные
const PZ = () => ({ revenue: 0, direct: 0, adm: 0, com: 0, agent: 0, tax: 0 });
const PK = ['revenue', 'direct', 'adm', 'com', 'agent', 'tax'];
export function profitability({ ops, arts, objects, from, to }) {
  const am = artMap(arts);
  const by = {};
  for (const o of ops) {
    const a = am.get(o.article_id);
    if (!a || !o.period || !a.opu_group || ym(o.period) < from || ym(o.period) > to) continue;
    const r = (by[o.object_id] ??= PZ());
    const v = Number(o.amount), g = opuGroup(a);
    if (g === 'Выручка') r.revenue += v;
    else if (g === 'Прямые расходы') r.direct += v;
    else if (g === 'Административные') r.adm -= signed(o, a);
    else if (g === 'Коммерческие') r.com -= signed(o, a);
    else if (g === 'Агентские') r.agent -= signed(o, a);
    else r.tax -= signed(o, a);                  // налоги, прочие доходы и расходы (доход уменьшает)
  }
  const mk = (id, name, common, r = PZ()) => {
    const x = Object.fromEntries(PK.map(k => [k, r2(r[k])]));
    const other = r2(x.adm + x.com + x.agent + x.tax), margin = r2(x.revenue - x.direct), profit = r2(margin - other);
    return { id, name, common, ...x, margin, other, profit, rentab: x.revenue ? r2(profit / x.revenue * 100) : null };
  };
  const add = (a, b) => Object.fromEntries(PK.map(k => [k, a[k] + b[k]]));
  const list = objects.filter(o => !o.is_common && by[o.id]).map(o => mk(o.id, o.name, false, by[o.id]));
  const commons = objects.filter(o => o.is_common && by[o.id]);
  const merged = commons.reduce((a, o) => add(a, by[o.id]), PZ());
  const common = commons.length ? mk(commons[0].id, commons.length > 1 ? 'Общие расходы (все филиалы)' : commons[0].name + ' (общие расходы)', true, merged) : null;
  const all = [...list, ...(common ? [common] : [])];
  const t = all.reduce((s, r) => add(s, r), PZ());
  const total = mk('total', 'Итого по компании', false, t);
  return { rows: list, common, total };
}

// Платёжный календарь
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
export function expandPlanned(planned, from, to) {   // from/to 'YYYY-MM-DD'
  const out = [];
  for (const p of planned) {
    const [y0, m0, d0] = p.plan_date.split('-').map(Number);
    const done = new Set(p.done_dates || []);
    const push = date => { if (date >= from && date <= to && !(p.until && date > p.until) && !done.has(date)) out.push({ ...p, plan_id: p.id, date }); };
    if (p.recurrence === 'monthly') {
      let y = y0, m = m0;
      for (let i = 0; i < 600; i++) {
        const date = `${y}-${String(m).padStart(2, '0')}-${String(Math.min(d0, lastDay(y, m))).padStart(2, '0')}`;
        if (date > to) break; push(date); m++; if (m > 12) { m = 1; y++; }
      }
    } else push(p.plan_date);
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.plan_id - b.plan_id);
}

export function forecast(startBalance, occurrences, arts) {
  const am = artMap(arts); let bal = startBalance;
  return occurrences.map(o => { const a = am.get(o.article_id); bal = r2(bal + signed(o, a)); return { ...o, sign: a.kind === 'income' ? 1 : -1, balance: bal }; });
}

// Платёжный календарь: факт (операции) + план (запланированные платежи). Просроченный план переносится на сегодня
export function planOccurrences(planned, toDate, today) {
  return expandPlanned(planned, '0001-01-01', toDate).map(o => (o.date < today ? { ...o, overdue: true, plan_date_orig: o.date, date: today } : o));
}
export function payCalendar({ ops, planned, arts, objects, accounts: allAccounts, from, to, today, objectId = null, view = 'months' }) {
  // счета с отметкой «не учитывать в платёжном календаре» исключаются вместе с их операциями и платежами
  const accounts = allAccounts.filter(a => a.in_calendar !== false), skip = new Set(allAccounts.filter(a => a.in_calendar === false).map(a => a.id));
  ops = ops.filter(o => !skip.has(o.account_id)); planned = planned.filter(p => !skip.has(p.account_id));
  const am = artMap(arts), start = from + '-01', end = monthEnd(to);
  const plan = planOccurrences(planned, end, today);
  const objOk = o => objectId == null || o.object_id === objectId;
  const pseudo = plan.map(p => ({ op_date: p.date, article_id: p.article_id, object_id: p.object_id, account_id: p.account_id, amount: p.amount }));
  const rep = ddsReport({ ops: [...ops, ...pseudo], arts, objects, accounts, from, to, objectId, mode: view === 'days' ? 'days' : 'months' });
  rep.rows = rep.rows.filter(r => r.type !== 'metric');
  const planNet = d => plan.reduce((s, p) => s + (p.date < d ? signed(p, am.get(p.article_id)) : 0), 0);
  const bal = d => r2(balanceAt(d, accounts, ops, arts) + planNet(d));
  const cols = rep.cols, isDays = view === 'days';
  const first = k => (isDays ? k : k + '-01'), next = k => (isDays ? addDay(k) : nextMonthStart(k)), last = k => (isDays ? k : monthEnd(k));
  rep.status = Object.fromEntries(cols.map(k => [k, last(k) < today ? 'факт' : first(k) > today ? 'план' : 'факт + план']));
  if (objectId == null) {
    const open = {}, close = {};
    cols.forEach(k => { open[k] = bal(first(k)); close[k] = bal(next(k)); });
    rep.rows.push({ type: 'metric', label: 'Остаток на начало', vals: open, total: open[cols[0]] });
    rep.rows.push({ type: 'metric', label: 'Остаток на конец', vals: close, total: close[cols[cols.length - 1]] });
  }
  // список по дням
  const items = [];
  for (const o of ops) {
    const a = am.get(o.article_id);
    if (!a || !o.op_date || a.dds_section === 'internal' || o.op_date < start || o.op_date > end || !objOk(o)) continue;
    items.push({ kind: 'fact', date: o.op_date, op: o, article_id: o.article_id, object_id: o.object_id, account_id: o.account_id, amount: Number(o.amount), comment: o.comment || '', counterparty: o.counterparty || '' });
  }
  for (const p of plan) {
    const a = am.get(p.article_id);
    if (!a || a.dds_section === 'internal' || p.date < start || p.date > end || !objOk(p)) continue;
    items.push({ kind: 'plan', date: p.date, plan: p, plan_id: p.plan_id, overdue: !!p.overdue, plan_date_orig: p.plan_date_orig, recurrence: p.recurrence, article_id: p.article_id, object_id: p.object_id, account_id: p.account_id, amount: Number(p.amount), comment: p.comment || '' });
  }
  items.sort((x, y) => x.date.localeCompare(y.date) || (x.kind === y.kind ? 0 : x.kind === 'fact' ? -1 : 1));
  let run = objectId == null ? bal(start) : 0;
  const opening = run;
  for (const it of items) { it.sign = am.get(it.article_id).kind === 'income' ? 1 : -1; run = r2(run + it.sign * it.amount); it.balance = run; }
  const planned_ = items.filter(i => i.kind === 'plan');
  const minPlan = planned_.length ? planned_.reduce((m, i) => (i.balance < m.balance ? i : m)) : null;
  return { ...rep, items, opening, closing: objectId == null ? bal(nextMonthStart(to)) : run, todayBalance: r2(balanceAt(addDay(today), accounts, ops, arts)), minPlan, withBalance: objectId == null, skipped: allAccounts.filter(a => skip.has(a.id)) };
}

// Контроль данных: что может исказить отчёты
export function checks(ops, arts) {
  const am = artMap(arts), out = [];
  for (const o of ops) {
    const a = am.get(o.article_id); if (!a) continue;
    if (a.opu_group && !o.period) out.push({ op: o, issue: 'Нет периода: операция не попадёт в ОПУ' });
    if (!a.opu_group && o.period) out.push({ op: o, issue: 'Статья вне ОПУ, период не учитывается' });
    if (a.dds_section === 'internal' && !o.op_date) out.push({ op: o, issue: 'Перемещение без даты' });
  }
  return out;
}

// Проверка баланса перемещений между счетами: приходы и расходы по перемещениям должны совпадать
export function internalImbalance(ops, arts) {
  const am = artMap(arts); let d = 0;
  for (const o of ops) { const a = am.get(o.article_id); if (a?.dds_section === 'internal' && o.op_date) d += signed(o, a); }
  return r2(d);
}
