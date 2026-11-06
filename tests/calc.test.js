import test from 'node:test';
import assert from 'node:assert/strict';
import { ddsReport, opuReport, profitability, expandPlanned, forecast, balanceAt, checks, internalImbalance, monthList } from '../js/calc.js';

const arts = [
  { id: 1, name: 'Выручка', kind: 'income', dds_section: 'operating', opu_group: 'Выручка', sort: 1 },
  { id: 2, name: 'ЗП клининг', kind: 'expense', dds_section: 'operating', opu_group: 'Прямые расходы', sort: 2 },
  { id: 3, name: 'Аренда', kind: 'expense', dds_section: 'operating', opu_group: 'Административные', sort: 3 },
  { id: 4, name: 'Дивиденды', kind: 'expense', dds_section: 'financing', opu_group: null, sort: 4 },
  { id: 5, name: 'Перем. приход', kind: 'income', dds_section: 'internal', opu_group: null, sort: 5 },
  { id: 6, name: 'Перем. расход', kind: 'expense', dds_section: 'internal', opu_group: null, sort: 6 },
];
const objects = [{ id: 1, name: 'Лесная' }, { id: 2, name: 'Борк' }, { id: 9, name: 'Все объекты', is_common: true }];
const accounts = [{ id: 1, name: 'ИП', opening_balance: 1000, opening_date: '2026-01-01', active: true }, { id: 2, name: 'ООО', opening_balance: 500, opening_date: '2026-01-01', active: true }];
let n = 0;
const op = (o) => ({ id: ++n, op_date: null, account_id: null, period: null, ...o });
const ops = [
  op({ op_date: '2026-01-10', account_id: 1, article_id: 1, object_id: 1, period: '2026-01-01', amount: 1000 }),
  op({ op_date: '2026-02-05', account_id: 1, article_id: 1, object_id: 1, period: '2026-01-01', amount: 200 }),   // оплата января в феврале
  op({ op_date: '2026-01-12', account_id: 1, article_id: 1, object_id: 2, period: '2026-01-01', amount: 600 }),
  op({ period: '2026-01-01', article_id: 1, object_id: 2, amount: 300 }),                                         // начисление без оплаты
  op({ op_date: '2026-01-15', account_id: 1, article_id: 2, object_id: 1, period: '2026-01-01', amount: 400 }),
  op({ op_date: '2026-01-20', account_id: 2, article_id: 3, object_id: 9, period: '2026-01-01', amount: 100 }),
  op({ op_date: '2026-01-25', account_id: 2, article_id: 4, object_id: 9, amount: 50 }),                           // дивиденды: только ДДС
  op({ op_date: '2026-01-28', account_id: 1, article_id: 6, object_id: 9, amount: 70 }),                           // перемещение ИП -> ООО
  op({ op_date: '2026-01-28', account_id: 2, article_id: 5, object_id: 9, amount: 70 }),
];
const base = { ops, arts, objects, accounts, from: '2026-01', to: '2026-02' };
const row = (rep, label) => rep.rows.find(r => r.label === label);

test('monthList', () => assert.deepEqual(monthList('2025-11', '2026-02'), ['2025-11', '2025-12', '2026-01', '2026-02']));

test('ДДС по месяцам: оплаты по дате, начисление без оплаты не попадает, перемещения не в потоке', () => {
  const r = ddsReport(base);
  assert.equal(row(r, 'Выручка').vals['2026-01'], 1600);
  assert.equal(row(r, 'Выручка').vals['2026-02'], 200);
  assert.equal(row(r, 'Выручка').total, 1800);            // 300 начисления нет
  assert.equal(row(r, 'Аренда').total, 100);
  assert.equal(row(r, 'Дивиденды').total, 50);
  assert.ok(!r.rows.some(x => x.label.startsWith('Перем')));
  assert.equal(row(r, 'Чистый денежный поток').vals['2026-01'], 1600 - 400 - 100 - 50);
  assert.equal(row(r, 'Чистый денежный поток').total, 1800 - 400 - 100 - 50);
});

test('ДДС остатки: начало, конец, по счетам; перемещения не меняют итог', () => {
  const r = ddsReport(base);
  const open = row(r, 'Остаток на начало'), close = row(r, 'Остаток на конец');
  assert.equal(open.vals['2026-01'], 1500);
  assert.equal(close.vals['2026-01'], 1500 + 1600 - 400 - 100 - 50);
  assert.equal(open.vals['2026-02'], close.vals['2026-01']);
  assert.equal(close.vals['2026-02'], 1500 + 1800 - 550);
  const byName = Object.fromEntries(r.balances.map(b => [b.name, b.value]));
  assert.equal(byName['ИП'] + byName['ООО'], close.vals['2026-02']);
  assert.equal(byName['ИП'], 1000 + 1800 - 400 - 70);
  assert.equal(byName['ООО'], 500 - 100 - 50 + 70);
});

test('ДДС по объекту: без остатков, только его операции', () => {
  const r = ddsReport({ ...base, objectId: 1 });
  assert.equal(row(r, 'Выручка').total, 1200);
  assert.equal(row(r, 'Аренда'), undefined);
  assert.equal(row(r, 'Остаток на начало'), undefined);
});

test('ДДС по объектам: колонки объектов', () => {
  const r = ddsReport({ ...base, mode: 'objects' });
  assert.deepEqual(r.colLabels, ['Лесная', 'Борк', 'Все объекты']);
  assert.equal(row(r, 'Выручка').vals['1'], 1200);
  assert.equal(row(r, 'Выручка').vals['2'], 600);
});

test('ОПУ: по периоду, включает начисление, исключает дивиденды и перемещения', () => {
  const r = opuReport(base);
  assert.equal(row(r, 'Выручка').vals['2026-01'], 2100);   // 1000+200+600+300
  assert.equal(row(r, 'Выручка').vals['2026-02'], 0);
  assert.equal(row(r, 'Маржинальная прибыль').vals['2026-01'], 1700);
  assert.equal(row(r, 'Операционная прибыль').vals['2026-01'], 1600);
  assert.equal(row(r, 'Чистая прибыль').total, 1600);
  assert.equal(row(r, 'Чистая прибыль, % от выручки').total, 76.19);
  assert.ok(!r.rows.some(x => x.label === 'Дивиденды'));
});

test('ОПУ по объекту и по объектам', () => {
  const o1 = opuReport({ ...base, objectId: 1 });
  assert.equal(row(o1, 'Чистая прибыль').total, 1200 - 400);
  const by = opuReport({ ...base, mode: 'objects' });
  assert.equal(row(by, 'Выручка').vals['2'], 900);
  assert.equal(row(by, 'Чистая прибыль').vals['9'], -100);
});

test('Рентабельность по объектам, общие расходы отдельно, итог сходится с ОПУ', () => {
  const p = profitability(base);
  const l = p.rows.find(r => r.name === 'Лесная'), b = p.rows.find(r => r.name === 'Борк');
  assert.equal(l.revenue, 1200); assert.equal(l.direct, 400); assert.equal(l.profit, 800); assert.equal(l.rentab, 66.67);
  assert.equal(b.revenue, 900); assert.equal(b.profit, 900); assert.equal(b.rentab, 100);
  assert.equal(p.common.profit, -100); assert.equal(p.common.rentab, null);
  assert.equal(p.total.profit, 1600);
  assert.equal(p.total.profit, row(opuReport(base), 'Чистая прибыль').total);
});

test('Баланс на дату и контроль перемещений', () => {
  assert.equal(balanceAt('2026-01-01', accounts, ops, arts), 1500);
  assert.equal(balanceAt('2026-01-11', accounts, ops, arts), 2500);
  assert.equal(internalImbalance(ops, arts), 0);
  assert.equal(internalImbalance(ops.slice(0, -1), arts), -70);
});

test('Контроль данных', () => {
  const bad = [op({ op_date: '2026-03-01', account_id: 1, article_id: 1, object_id: 1, amount: 5 }), op({ op_date: '2026-03-01', account_id: 1, article_id: 4, object_id: 1, period: '2026-03-01', amount: 5 })];
  const c = checks(bad, arts);
  assert.equal(c.length, 2);
  assert.equal(checks(ops, arts).length, 0);
});

test('Календарь: ежемесячный платёж, конец месяца, until, выполненные даты', () => {
  const planned = [
    { id: 1, plan_date: '2026-01-31', article_id: 3, recurrence: 'monthly', until: '2026-04-30', done_dates: ['2026-02-28'], amount: 100 },
    { id: 2, plan_date: '2026-03-05', article_id: 1, recurrence: 'none', done_dates: [], amount: 1000 },
  ];
  const occ = expandPlanned(planned, '2026-01-15', '2026-06-30');
  assert.deepEqual(occ.map(o => o.date), ['2026-01-31', '2026-03-05', '2026-03-31', '2026-04-30']);
  const f = forecast(500, occ, arts);
  assert.deepEqual(f.map(x => x.balance), [400, 1400, 1300, 1200]);
});

test('рентабельность: общие расходы нескольких филиалов суммируются', () => {
  const objs = [{ id: 1, name: 'Все объекты', is_common: true }, { id: 2, name: 'Все объекты', is_common: true }, { id: 3, name: 'Заказ', is_common: false }];
  const ops = [
    { article_id: 1, object_id: 3, period: '2026-11-01', amount: 1000 },
    { article_id: 3, object_id: 1, period: '2026-11-01', amount: 100 },
    { article_id: 3, object_id: 2, period: '2026-11-01', amount: 50 },
  ];
  const r = profitability({ ops, arts, objects: objs, from: '2026-11', to: '2026-11' });
  assert.equal(r.common.other, 150); assert.equal(r.total.profit, 850);
});
