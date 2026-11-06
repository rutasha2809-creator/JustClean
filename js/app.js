import { createApi } from './api.js';
import { ddsReport, opuReport, profitability, expandPlanned, forecast, balanceAt, checks, internalImbalance, monthLabel, ym, r2 } from './calc.js';

const api = window.__API__ || createApi();
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => (n == null ? '' : n === 0 ? '-' : Number(n).toLocaleString('ru-RU', { maximumFractionDigits: 2 }));
const fmtDate = d => (d ? d.split('-').reverse().join('.') : '');
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const addDays = (s, n) => { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const parseAmount = v => { const x = Number(String(v).replace(/\s/g, '').replace(',', '.')); return Number.isFinite(x) ? x : NaN; };

const S = {
  user: null, role: null, tab: 'ops', refTab: 'objects',
  objects: [], accounts: [], articles: [], ops: [], planned: [], members: [], branches: [], owners: [], branch: '',
  f: { month: '', object: '', account: '', article: '', q: '', limit: 200 },
  rep: { from: `${new Date().getFullYear()}-01`, to: ym(todayStr()), object: '', mode: 'months' },
  prof: { from: `${new Date().getFullYear()}-01`, to: ym(todayStr()) },
  cal: { days: 60 },
  cons: { from: `${new Date().getFullYear()}-01`, to: ym(todayStr()) },
};
const isEditor = () => S.role === 'editor';
const byId = (list, id) => list.find(x => x.id === id);

/* ---------- служебное: уведомления, окна ---------- */
let toastTimer;
function toast(msg, err = false) {
  const t = $('#toast'); t.textContent = msg; t.className = 'show' + (err ? ' err' : '');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.className = ''), err ? 6000 : 2800);
}
function closeModal() { $('#modal-root').innerHTML = ''; }
function openModal(html) {
  $('#modal-root').innerHTML = `<div class="overlay"><div class="modal">${html}</div></div>`;
  return $('#modal-root .modal');
}
function confirmDialog(text, okLabel = 'Удалить') {
  return new Promise(res => {
    const m = openModal(`<h3>${esc(text)}</h3><div class="actions"><button class="btn" data-no>Отмена</button><button class="btn primary danger-fill" data-ok style="background:var(--red);border-color:var(--red)">${esc(okLabel)}</button></div>`);
    m.querySelector('[data-no]').onclick = () => { closeModal(); res(false); };
    m.querySelector('[data-ok]').onclick = () => { closeModal(); res(true); };
  });
}
let busy = false;
async function run(fn, okMsg) {
  if (busy) return false;                       // защита от двойного нажатия
  busy = true;
  document.querySelectorAll('.modal button').forEach(b => (b.disabled = true));
  try { await fn(); await reload(); render(); if (okMsg) toast(okMsg); return true; }
  catch (e) { toast('Не сохранено: ' + e.message, true); return false; }
  finally { busy = false; document.querySelectorAll('.modal button').forEach(b => (b.disabled = false)); }
}

/* ---------- загрузка ---------- */
async function reload() {
  const [objects, accounts, articles, ops, planned, branches, owners] = await Promise.all(['objects', 'accounts', 'articles', 'ops', 'planned', 'branches', 'owners'].map(t => api.load(t)));
  Object.assign(S, { objects, accounts, articles, ops, planned, branches, owners });
  if (S.branch && !byId(S.branches, +S.branch)) S.branch = '';
  S.articles.sort((a, b) => a.sort - b.sort || a.id - b.id);
  if (isEditor()) S.members = await api.loadMembers();
}
const activeArts = () => S.articles.filter(a => a.active);
const artName = id => byId(S.articles, id)?.name || '?';
const brName = id => byId(S.branches, id)?.name || '?';
const activeBranches = () => S.branches.filter(b => b.active);
const multi = () => !S.branch && activeBranches().length > 1;
const sfx = o => (o && multi() ? ` · ${brName(o.branch_id)}` : '');
const inBr = x => !S.branch || String(x.branch_id) === S.branch;
const sObjects = () => S.objects.filter(inBr), sAccounts = () => S.accounts.filter(inBr), sOps = () => S.ops.filter(inBr), sPlanned = () => S.planned.filter(inBr);
const labeled = list => list.map(o => ({ ...o, name: o.name + sfx(o) }));
const objName = id => { const o = byId(S.objects, id); return o ? o.name + sfx(o) : '?'; };
const accName = id => { if (!id) return ''; const a = byId(S.accounts, id); return a ? a.name + sfx(a) : '?'; };
const saveBranch = () => { try { localStorage.setItem('cl_branch', S.branch); } catch { } };

/* ---------- старт и вход ---------- */
async function boot() {
  const s = await api.session();
  if (!s) return renderLogin();
  S.user = s;
  S.role = await api.register();
  if (S.role === 'pending') return renderPending();
  try { S.branch = localStorage.getItem('cl_branch') || ''; } catch { }
  try { await reload(); } catch (e) { $('#app').innerHTML = `<main><div class="card">Не удалось загрузить данные: ${esc(e.message)}</div></main>`; return; }
  render();
}
function renderLogin(msg = '') {
  $('#app').innerHTML = `<div class="login"><div class="card"><h2 style="margin:0">Управленческий учёт</h2>
    <label>Email<input id="em" type="email" autocomplete="username"></label>
    <label>Пароль<input id="pw" type="password" autocomplete="current-password"></label>
    <div id="lmsg" class="${msg ? '' : 'muted'}" style="min-height:20px">${esc(msg)}</div>
    <button class="btn primary" id="in">Войти</button><button class="btn" id="up">Зарегистрироваться</button></div></div>`;
  const creds = () => [$('#em').value.trim(), $('#pw').value];
  const say = t => ($('#lmsg').textContent = t);
  $('#in').onclick = async () => { const [e, p] = creds(); if (!e || !p) return say('Введите email и пароль'); try { await api.signIn(e, p); await boot(); } catch (x) { say('Не удалось войти: ' + x.message); } };
  $('#up').onclick = async () => { const [e, p] = creds(); if (!e || p.length < 6) return say('Введите email и пароль не короче 6 символов'); try { const r = await api.signUp(e, p); if (r.needsConfirm) say('Проверьте почту и подтвердите адрес, затем войдите'); else await boot(); } catch (x) { say('Не удалось зарегистрироваться: ' + x.message); } };
  $('#pw').onkeydown = e => { if (e.key === 'Enter') $('#in').click(); };
}
function renderPending() {
  $('#app').innerHTML = `<div class="login"><div class="card"><h3 style="margin:0">Доступ ещё не выдан</h3><div class="muted">${esc(S.user.email)}</div><button class="btn" id="out">Выйти</button></div></div>`;
  $('#out').onclick = async () => { await api.signOut(); renderLogin(); };
}

/* ---------- каркас ---------- */
const TABS = [['ops', 'Операции'], ['dds', 'ДДС'], ['opu', 'ОПУ'], ['prof', 'Рентабельность'], ['own', 'Собственники'], ['cons', 'Свод по филиалам'], ['cal', 'Платёжный календарь'], ['ref', 'Справочники']];
function render() {
  const view = { ops: viewOps, dds: viewDds, opu: viewOpu, prof: viewProf, own: viewOwn, cons: viewCons, cal: viewCal, ref: viewRef }[S.tab];
  $('#app').innerHTML = `<header><div class="bar"><span class="logo">Управленческий учёт</span>
    <nav>${TABS.map(([k, t]) => `<button data-tab="${k}" class="${S.tab === k ? 'on' : ''}">${t}</button>`).join('')}</nav>
    <select id="branch-sel" class="branchsel" title="Филиал"><option value="">Все филиалы</option>${opt(activeBranches(), S.branch)}</select>
    <span class="who">${esc(S.user.email)} <span class="badge ${isEditor() ? '' : 'off'}">${isEditor() ? 'редактор' : 'просмотр'}</span><button class="link" id="out">Выйти</button></span></div></header>
    <main>${view()}</main>`;
  document.querySelectorAll('nav [data-tab]').forEach(b => (b.onclick = () => { S.tab = b.dataset.tab; render(); }));
  $('#out').onclick = async () => { await api.signOut(); S.user = null; renderLogin(); };
  $('#branch-sel').onchange = () => { S.branch = $('#branch-sel').value; saveBranch(); Object.assign(S.f, { object: '', account: '', limit: 200 }); S.rep.object = ''; render(); };
  ({ ops: bindOps, dds: bindRep, opu: bindRep, prof: bindProf, own: () => { }, cons: bindCons, cal: bindCal, ref: bindRef }[S.tab])();
}
const opt = (list, sel, label = x => x.name, empty = null) => (empty != null ? `<option value="">${esc(empty)}</option>` : '') + list.map(x => `<option value="${x.id}" ${String(x.id) === String(sel) ? 'selected' : ''}>${esc(label(x))}</option>`).join('');

/* ---------- Операции ---------- */
function filteredOps() {
  const f = S.f, q = f.q.trim().toLowerCase();
  return sOps().filter(o => {
    if (f.month && ym(o.op_date) !== f.month && ym(o.period) !== f.month) return false;
    if (f.object && String(o.object_id) !== f.object) return false;
    if (f.account && String(o.account_id) !== f.account) return false;
    if (f.article && String(o.article_id) !== f.article) return false;
    if (q && !`${o.counterparty || ''} ${o.comment || ''}`.toLowerCase().includes(q)) return false;
    return true;
  }).sort((a, b) => (b.op_date || b.period).localeCompare(a.op_date || a.period) || b.id - a.id);
}
function viewOps() {
  const list = filteredOps(), months = [...new Set(sOps().flatMap(o => [ym(o.op_date), ym(o.period)]).filter(Boolean))].sort().reverse();
  const issues = checks(sOps(), S.articles), imb = internalImbalance(sOps(), S.articles);
  let inc = 0, exp = 0;
  list.forEach(o => { const a = byId(S.articles, o.article_id); if (!o.op_date || a.dds_section === 'internal') return; a.kind === 'income' ? (inc += Number(o.amount)) : (exp += Number(o.amount)); });
  return `<div class="card"><div class="toolbar">
    <label>Месяц<select id="f-month"><option value="">Все</option>${months.map(m => `<option value="${m}" ${S.f.month === m ? 'selected' : ''}>${monthLabel(m)}</option>`).join('')}</select></label>
    <label>Объект<select id="f-object">${opt(sObjects(), S.f.object, o => o.name + sfx(o), 'Все')}</select></label>
    <label>Счёт<select id="f-account">${opt(sAccounts(), S.f.account, o => o.name + sfx(o), 'Все')}</select></label>
    <label>Статья<select id="f-article">${opt(S.articles, S.f.article, undefined, 'Все')}</select></label>
    <label>Поиск<input id="f-q" value="${esc(S.f.q)}" placeholder="контрагент, комментарий"></label>
    <span class="spacer"></span>${isEditor() ? '<button class="btn primary" id="add-op">Добавить операцию</button>' : ''}</div>
    <div class="summary"><span>Записей: <b>${list.length}</b></span><span>Поступления: <b class="pos">${fmt(r2(inc))}</b></span><span>Платежи: <b class="neg">${fmt(r2(exp))}</b></span>
    ${issues.length ? `<span class="badge warn">Требуют внимания: ${issues.length}</span>` : ''}${imb !== 0 ? `<span class="badge warn">Перемещения не сходятся на ${fmt(imb)}</span>` : ''}</div>
    <div class="tablewrap"><table><thead><tr><th>Дата оплаты</th><th>Период</th><th>Счёт</th><th>Статья</th><th>Объект</th><th>Контрагент</th><th>Комментарий</th><th class="num">Сумма</th><th></th></tr></thead><tbody>
    ${list.slice(0, S.f.limit).map(o => { const a = byId(S.articles, o.article_id); return `<tr><td>${fmtDate(o.op_date) || '<span class="muted">начисление</span>'}</td><td>${o.period ? monthLabel(ym(o.period)) : ''}</td><td>${esc(accName(o.account_id))}</td><td>${esc(a.name)}</td><td>${esc(objName(o.object_id))}</td><td>${esc(o.counterparty)}</td><td class="wrap">${esc(o.comment)}</td><td class="num ${a.kind === 'income' ? 'pos' : 'neg'}">${a.kind === 'income' ? '' : '-'}${fmt(Number(o.amount))}</td><td>${isEditor() ? `<button class="link" data-edit="${o.id}">Изменить</button><button class="link danger" data-del="${o.id}">Удалить</button>` : ''}</td></tr>`; }).join('') || '<tr><td colspan="9" class="muted">Операций нет</td></tr>'}
    </tbody></table></div>${list.length > S.f.limit ? '<p><button class="btn" id="more">Показать ещё</button></p>' : ''}
    ${issues.length ? `<details style="margin-top:12px"><summary>Что требует внимания (${issues.length})</summary><ul>${issues.slice(0, 50).map(i => `<li>${fmtDate(i.op.op_date) || monthLabel(ym(i.op.period))}, ${esc(artName(i.op.article_id))}, ${fmt(Number(i.op.amount))}: ${esc(i.issue)} <button class="link" data-edit="${i.op.id}">Открыть</button></li>`).join('')}</ul></details>` : ''}</div>`;
}
function bindOps() {
  const set = (id, k) => { const el = $(id); el.onchange = el.oninput = () => { S.f[k] = el.value; S.f.limit = 200; const pos = el.selectionStart; render(); const n = $(id); if (k === 'q') { n.focus(); try { n.setSelectionRange(pos, pos); } catch { } } }; };
  set('#f-month', 'month'); set('#f-object', 'object'); set('#f-account', 'account'); set('#f-article', 'article'); set('#f-q', 'q');
  $('#more') && ($('#more').onclick = () => { S.f.limit += 200; render(); });
  $('#add-op') && ($('#add-op').onclick = () => openOpForm(null));
  document.querySelectorAll('[data-edit]').forEach(b => (b.onclick = () => openOpForm(byId(S.ops, +b.dataset.edit))));
  document.querySelectorAll('[data-del]').forEach(b => (b.onclick = async () => {
    const o = byId(S.ops, +b.dataset.del);
    if (await confirmDialog(`Удалить операцию: ${artName(o.article_id)}, ${fmt(Number(o.amount))}?`)) run(() => api.remove('ops', o.id), 'Операция удалена');
  }));
}

let lastPreset = {};
const refOpts = (list, brId, sel, empty) => opt(list.filter(x => String(x.branch_id) === String(brId) && (x.active || x.id === sel)), sel, undefined, empty);
const defaultBranch = (p = {}) => +(p.branch_id || S.branch || lastPreset.branch_id || activeBranches()[0]?.id || 0);
const branchField = (id, sel, disabled) => `<label class="full">Филиал<select id="${id}" ${disabled ? 'disabled' : ''}>${opt(S.branches.filter(b => b.active || b.id === sel), sel)}</select></label>`;
function openOpForm(op, preset = null, afterSave = null) {
  const p = preset || {};
  const isNew = !op;
  const brInit = op ? op.branch_id : defaultBranch(p);
  const init = op || { op_date: p.op_date ?? lastPreset.op_date ?? todayStr(), account_id: p.account_id ?? lastPreset.account_id ?? '', article_id: p.article_id ?? '', object_id: p.object_id ?? lastPreset.object_id ?? '', period: p.period ?? null, amount: p.amount ?? '', counterparty: p.counterparty ?? '', comment: p.comment ?? '' };
  let mode = op && !op.op_date ? 'accrual' : 'pay';
  let periodTouched = !!op && !!op.period;
  const m = openModal(`<h3>${isNew ? 'Новая операция' : 'Изменить операцию'}</h3><div class="form">
    <div class="full seg"><label><input type="radio" name="mode" value="pay"> Оплата</label><label><input type="radio" name="mode" value="accrual"> Начисление без оплаты</label></div>
    ${branchField('o-br', brInit, !isNew)}
    <label data-pay>Дата оплаты<input type="date" id="o-date" value="${esc(init.op_date || '')}"></label>
    <label data-pay>Счёт<select id="o-acc">${refOpts(S.accounts, brInit, init.account_id, 'Выберите')}</select></label>
    <label class="full">Статья<select id="o-art"></select></label>
    <label>Объект<select id="o-obj">${refOpts(S.objects, brInit, init.object_id, 'Выберите')}</select></label>
    <label>Период (месяц)<input type="month" id="o-per" value="${init.period ? ym(init.period) : ''}"></label>
    <label>Сумма<input id="o-amt" inputmode="decimal" value="${init.amount === '' ? '' : String(init.amount).replace('.', ',')}"></label>
    <label>Контрагент<input id="o-cp" value="${esc(init.counterparty)}"></label>
    <label class="full">Комментарий<textarea id="o-cm" rows="2">${esc(init.comment)}</textarea></label>
    <div class="err" id="o-err"></div></div>
    <div class="actions"><button class="btn" data-cancel>Отмена</button>${isNew ? '<button class="btn" data-more>Сохранить и добавить ещё</button>' : ''}<button class="btn primary" data-save>Сохранить</button></div>`);
  const artSel = () => {
    const list = activeArts().filter(a => mode === 'pay' || a.opu_group); const cur = $('#o-art', m).value || init.article_id;
    const keep = list.concat(byId(S.articles, init.article_id) && !list.some(a => a.id === init.article_id) ? [byId(S.articles, init.article_id)] : []);
    $('#o-art', m).innerHTML = '<option value="">Выберите</option>' + keep.map(a => `<option value="${a.id}" ${String(a.id) === String(cur) ? 'selected' : ''}>${esc(a.name)}</option>`).join('');
  };
  const sync = () => {
    m.querySelectorAll('[data-pay]').forEach(e => e.classList.toggle('hidden', mode === 'accrual'));
    const a = byId(S.articles, +$('#o-art', m).value);
    const per = $('#o-per', m);
    if (a && !a.opu_group) { per.value = ''; per.disabled = true; } else {
      per.disabled = false;
      if (mode === 'pay' && !periodTouched && a && $('#o-date', m).value) per.value = ym($('#o-date', m).value);
    }
  };
  m.querySelectorAll('[name=mode]').forEach(r => { r.checked = r.value === mode; r.onchange = () => { mode = r.value; artSel(); sync(); }; });
  artSel(); sync();
  $('#o-br', m).onchange = () => { const b = +$('#o-br', m).value; $('#o-acc', m).innerHTML = refOpts(S.accounts, b, null, 'Выберите'); $('#o-obj', m).innerHTML = refOpts(S.objects, b, null, 'Выберите'); };
  $('#o-art', m).onchange = sync; $('#o-date', m).onchange = sync; $('#o-per', m).oninput = () => (periodTouched = true);
  m.querySelector('[data-cancel]').onclick = closeModal;
  const collect = () => {
    const err = t => { $('#o-err', m).textContent = t; return null; };
    const amount = parseAmount($('#o-amt', m).value), article_id = +$('#o-art', m).value, object_id = +$('#o-obj', m).value;
    const a = byId(S.articles, article_id);
    const date = $('#o-date', m).value, acc = +$('#o-acc', m).value, per = $('#o-per', m).value;
    if (mode === 'pay' && !date) return err('Укажите дату оплаты');
    if (mode === 'pay' && !acc) return err('Выберите счёт');
    if (!article_id) return err('Выберите статью');
    if (!object_id) return err('Выберите объект');
    if (mode === 'accrual' && !per) return err('Укажите период начисления');
    if (!(amount > 0)) return err('Введите сумму больше нуля');
    $('#o-err', m).textContent = '';
    return { branch_id: +$('#o-br', m).value, op_date: mode === 'pay' ? date : null, account_id: mode === 'pay' ? acc : null, article_id, object_id, period: a.opu_group && per ? per + '-01' : null, amount: r2(amount), counterparty: $('#o-cp', m).value.trim() || null, comment: $('#o-cm', m).value.trim() || null };
  };
  const save = again => async () => {
    const row = collect(); if (!row) return;
    const ok = await run(async () => { if (isNew) await api.insert('ops', row); else await api.update('ops', op.id, row); if (afterSave) await afterSave(row); }, isNew ? 'Операция внесена' : 'Изменения сохранены');
    if (!ok) return;
    lastPreset = { op_date: row.op_date, account_id: row.account_id, object_id: row.object_id, branch_id: row.branch_id };
    closeModal(); if (again) openOpForm(null);
  };
  m.querySelector('[data-save]').onclick = save(false);
  m.querySelector('[data-more]') && (m.querySelector('[data-more]').onclick = save(true));
}

/* ---------- Отчёты ДДС / ОПУ ---------- */
function repControls(withBalance) {
  const r = S.rep;
  return `<div class="toolbar"><label>С<input type="month" id="r-from" value="${r.from}"></label><label>По<input type="month" id="r-to" value="${r.to}"></label>
    <label>Разрез<select id="r-mode"><option value="months" ${r.mode === 'months' ? 'selected' : ''}>По месяцам</option><option value="objects" ${r.mode === 'objects' ? 'selected' : ''}>По объектам</option></select></label>
    <label ${r.mode === 'objects' ? 'class="hidden"' : ''}>Объект<select id="r-obj"><option value="">Свод по всем</option>${opt(sObjects(), r.object, o => o.name + sfx(o))}</select></label></div>`;
}
function matrixTable(rep) {
  const cell = (row, v) => { const pc = row.type === 'percent'; return `<td class="num ${v < 0 ? 'neg' : ''}">${v == null ? '' : pc ? (v === 0 ? '-' : fmt(v) + '%') : fmt(v)}</td>`; };
  return `<div class="tablewrap"><table class="rep"><thead><tr><th>Статья</th>${rep.colLabels.map(l => `<th class="num">${esc(l)}</th>`).join('')}<th class="num">Итого</th></tr></thead><tbody>
  ${rep.rows.map(r => r.type === 'section' ? `<tr class="section"><td colspan="${rep.cols.length + 2}">${esc(r.label)}</td></tr>` : `<tr class="${r.type}"><td>${esc(r.label)}</td>${rep.cols.map(c => cell(r, r.vals[c])).join('')}${cell(r, r.total)}</tr>`).join('')}
  </tbody></table></div>`;
}
function repArgs() {
  const r = S.rep;
  return { ops: sOps(), arts: S.articles, objects: labeled(sObjects()), accounts: sAccounts(), from: r.from, to: r.to <= r.from ? r.from : r.to, objectId: r.object ? +r.object : null, mode: r.mode };
}
function viewDds() {
  const rep = ddsReport(repArgs());
  return `<div class="card"><h3 style="margin-top:0">Движение денежных средств</h3>${repControls()}${matrixTable(rep)}
  ${rep.balances ? `<div class="summary" style="margin-top:12px">${rep.balances.map(b => `<span>${esc(b.name)}: <b class="${b.value < 0 ? 'neg' : ''}">${fmt(b.value) === '-' ? '0' : fmt(b.value)}</b></span>`).join('')}</div>` : ''}</div>`;
}
function viewOpu() {
  return `<div class="card"><h3 style="margin-top:0">Отчёт о прибылях и убытках</h3>${repControls()}${matrixTable(opuReport(repArgs()))}</div>`;
}
function bindRep() {
  const set = (id, k) => ($(id).onchange = () => { S.rep[k] = $(id).value; render(); });
  set('#r-from', 'from'); set('#r-to', 'to'); set('#r-mode', 'mode'); $('#r-obj') && set('#r-obj', 'object');
}

/* ---------- Рентабельность ---------- */
function viewProf() {
  const p = S.prof, to = p.to < p.from ? p.from : p.to;
  const d = profitability({ ops: sOps(), arts: S.articles, objects: labeled(sObjects()), from: p.from, to });
  const row = (r, cls = '') => `<tr class="${cls}"><td>${esc(r.name)}</td><td class="num">${fmt(r.revenue)}</td><td class="num">${fmt(r.direct)}</td><td class="num ${r.margin < 0 ? 'neg' : ''}">${fmt(r.margin)}</td><td class="num">${fmt(r.other)}</td><td class="num ${r.profit < 0 ? 'neg' : 'pos'}">${fmt(r.profit)}</td><td class="num ${r.rentab < 0 ? 'neg' : ''}">${r.rentab == null ? '' : fmt(r.rentab) + '%'}</td></tr>`;
  return `<div class="card"><h3 style="margin-top:0">Рентабельность по объектам</h3><div class="toolbar"><label>С<input type="month" id="p-from" value="${p.from}"></label><label>По<input type="month" id="p-to" value="${p.to}"></label></div>
  <div class="tablewrap"><table><thead><tr><th>Объект</th><th class="num">Выручка</th><th class="num">Прямые расходы</th><th class="num">Маржа</th><th class="num">Прочие расходы</th><th class="num">Прибыль</th><th class="num">Рентабельность</th></tr></thead><tbody>
  ${d.rows.sort((a, b) => b.profit - a.profit).map(r => row(r)).join('')}${d.common ? row(d.common) : ''}${row(d.total, 'total')}</tbody></table></div></div>`;
}
function bindProf() { ['from', 'to'].forEach(k => ($('#p-' + k).onchange = () => { S.prof[k] = $('#p-' + k).value; render(); })); }

/* ---------- Собственники ---------- */
const sumOps = (ops, artId, from = null, to = null) => r2(ops.filter(o => o.op_date && o.article_id === artId && (!from || ym(o.op_date) >= from) && (!to || ym(o.op_date) <= to)).reduce((t, o) => t + Number(o.amount), 0));
const branchProfit = (b, from = '2000-01', to = '2999-12') => profitability({ ops: S.ops.filter(o => o.branch_id === b.id), arts: S.articles, objects: S.objects.filter(o => o.branch_id === b.id), from, to }).total;
function viewOwn() {
  const brs = activeBranches().filter(b => !S.branch || String(b.id) === S.branch);
  const blocks = brs.map(b => {
    const ops = S.ops.filter(o => o.branch_id === b.id), prof = branchProfit(b).profit, owners = S.owners.filter(w => w.branch_id === b.id && w.active);
    let tAcc = 0, tPaid = 0, tIn = 0;
    const rows = owners.map(w => {
      const acc = r2(prof * Number(w.share) / 100), paid = w.dividend_article_id ? sumOps(ops, w.dividend_article_id) : 0, inn = w.contribution_article_id ? sumOps(ops, w.contribution_article_id) : 0;
      tAcc += acc; tPaid += paid; tIn += inn;
      return `<tr><td>${esc(w.name)}</td><td class="num">${fmt(Number(w.share))}%</td><td class="num">${fmt(acc)}</td><td class="num">${fmt(paid)}</td><td class="num ${acc - paid < 0 ? 'neg' : ''}">${fmt(r2(acc - paid))}</td><td class="num">${fmt(inn)}</td></tr>`;
    });
    return `<div class="card"><h3 style="margin-top:0">${esc(b.name)}</h3><div class="summary"><span>Прибыль филиала: <b class="${prof < 0 ? 'neg' : ''}">${fmt(prof) === '-' ? '0' : fmt(prof)}</b></span></div>
    <div class="tablewrap"><table><thead><tr><th>Собственник</th><th class="num">Доля</th><th class="num">Начислено</th><th class="num">Выплачено дивидендов</th><th class="num">Остаток к выплате</th><th class="num">Вложено</th></tr></thead><tbody>
    ${rows.join('') || '<tr><td colspan="6" class="muted">Собственники не заданы</td></tr>'}${owners.length > 1 ? `<tr class="total"><td>Итого</td><td></td><td class="num">${fmt(r2(tAcc))}</td><td class="num">${fmt(r2(tPaid))}</td><td class="num">${fmt(r2(tAcc - tPaid))}</td><td class="num">${fmt(r2(tIn))}</td></tr>` : ''}</tbody></table></div></div>`;
  });
  return blocks.join('') || '<div class="card muted">Филиалов нет</div>';
}

/* ---------- Свод по филиалам ---------- */
const nextMonth01 = k => { let [y, m] = k.split('-').map(Number); m++; if (m > 12) { m = 1; y++; } return `${y}-${String(m).padStart(2, '0')}-01`; };
function consData() {
  const c = S.cons, to = c.to < c.from ? c.from : c.to, end = nextMonth01(to);
  return activeBranches().map(b => {
    const ops = S.ops.filter(o => o.branch_id === b.id), t = branchProfit(b, c.from, to);
    const divIds = new Set(S.owners.filter(w => w.branch_id === b.id && w.dividend_article_id).map(w => w.dividend_article_id));
    const div = r2([...divIds].reduce((s, id) => s + sumOps(ops, id, c.from, to), 0));
    const cash = balanceAt(end, S.accounts.filter(a => a.branch_id === b.id), ops, S.articles);
    return { name: b.name, revenue: t.revenue, direct: t.direct, other: t.other, profit: t.profit, rentab: t.revenue ? r2(t.profit / t.revenue * 100) : null, div, cash };
  });
}
function viewCons() {
  const c = S.cons, rows = consData();
  const tot = rows.reduce((a, r) => ({ revenue: a.revenue + r.revenue, direct: a.direct + r.direct, other: a.other + r.other, profit: a.profit + r.profit, div: a.div + r.div, cash: a.cash + r.cash }), { revenue: 0, direct: 0, other: 0, profit: 0, div: 0, cash: 0 });
  const line = (r, cls = '') => `<tr class="${cls}"><td>${esc(r.name)}</td><td class="num">${fmt(r2(r.revenue))}</td><td class="num">${fmt(r2(r.direct))}</td><td class="num">${fmt(r2(r.other))}</td><td class="num ${r.profit < 0 ? 'neg' : 'pos'}">${fmt(r2(r.profit))}</td><td class="num">${r.revenue ? fmt(r2(r.profit / r.revenue * 100)) + '%' : ''}</td><td class="num">${fmt(r2(r.div))}</td><td class="num ${r.cash < 0 ? 'neg' : ''}">${fmt(r2(r.cash)) === '-' ? '0' : fmt(r2(r.cash))}</td></tr>`;
  return `<div class="card"><h3 style="margin-top:0">Финансовый результат по филиалам</h3><div class="toolbar"><label>С<input type="month" id="k-from" value="${c.from}"></label><label>По<input type="month" id="k-to" value="${c.to}"></label></div>
  <div class="tablewrap"><table><thead><tr><th>Филиал</th><th class="num">Выручка</th><th class="num">Прямые расходы</th><th class="num">Прочие расходы</th><th class="num">Прибыль</th><th class="num">Рентабельность</th><th class="num">Выплачено дивидендов</th><th class="num">Остаток денег на конец периода</th></tr></thead><tbody>
  ${rows.map(r => line(r)).join('')}${line({ name: 'Итого по JustClean', ...tot }, 'total')}</tbody></table></div></div>`;
}
function bindCons() { ['from', 'to'].forEach(k => ($('#k-' + k).onchange = () => { S.cons[k] = $('#k-' + k).value; render(); })); }

/* ---------- Платёжный календарь ---------- */
function viewCal() {
  const today = todayStr(), horizon = addDays(today, S.cal.days);
  const occ = expandPlanned(sPlanned(), '0001-01-01', horizon);
  const start = balanceAt(addDays(today, 1), sAccounts(), sOps(), S.articles);
  const rows = forecast(start, occ, S.articles);
  return `<div class="card"><div class="toolbar"><label>Горизонт<select id="c-days">${[30, 60, 90, 180].map(d => `<option value="${d}" ${S.cal.days === d ? 'selected' : ''}>${d} дней</option>`).join('')}</select></label>
    <span class="spacer"></span>${isEditor() ? '<button class="btn primary" id="add-plan">Добавить платёж</button>' : ''}</div>
    <div class="summary"><span>Остаток на сегодня: <b class="${start < 0 ? 'neg' : ''}">${fmt(start) === '-' ? '0' : fmt(start)}</b></span></div>
    <div class="tablewrap"><table><thead><tr><th>Дата</th><th>Статья</th><th>Объект</th><th>Счёт</th><th>Комментарий</th><th class="num">Сумма</th><th class="num">Остаток после</th><th></th></tr></thead><tbody>
    ${rows.map(o => `<tr class="${o.date < today ? 'overdue' : ''} ${o.balance < 0 ? 'low' : ''}"><td>${fmtDate(o.date)}${o.date < today ? ' <span class="badge warn">просрочено</span>' : ''}${o.recurrence === 'monthly' ? ' <span class="badge">ежемесячно</span>' : ''}</td><td>${esc(artName(o.article_id))}</td><td>${esc(objName(o.object_id))}</td><td>${esc(accName(o.account_id))}</td><td class="wrap">${esc(o.comment)}</td><td class="num ${o.sign > 0 ? 'pos' : 'neg'}">${o.sign > 0 ? '' : '-'}${fmt(Number(o.amount))}</td><td class="num bal">${fmt(o.balance) === '-' ? '0' : fmt(o.balance)}</td>
    <td>${isEditor() ? `<button class="link" data-paid="${o.plan_id}|${o.date}">Оплачено</button><button class="link" data-pedit="${o.plan_id}">Изменить</button><button class="link danger" data-pdel="${o.plan_id}">Удалить</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="8" class="muted">Запланированных платежей нет</td></tr>'}
    </tbody></table></div></div>`;
}
function bindCal() {
  $('#c-days').onchange = () => { S.cal.days = +$('#c-days').value; render(); };
  $('#add-plan') && ($('#add-plan').onclick = () => openPlanForm(null));
  document.querySelectorAll('[data-pedit]').forEach(b => (b.onclick = () => openPlanForm(byId(S.planned, +b.dataset.pedit))));
  document.querySelectorAll('[data-pdel]').forEach(b => (b.onclick = async () => {
    const p = byId(S.planned, +b.dataset.pdel);
    const txt = p.recurrence === 'monthly' ? `Удалить весь ежемесячный платёж: ${artName(p.article_id)}, ${fmt(Number(p.amount))}?` : `Удалить платёж: ${artName(p.article_id)}, ${fmt(Number(p.amount))}?`;
    if (await confirmDialog(txt)) run(() => api.remove('planned', p.id), 'Платёж удалён');
  }));
  document.querySelectorAll('[data-paid]').forEach(b => (b.onclick = () => {
    const [id, date] = b.dataset.paid.split('|'), p = byId(S.planned, +id), a = byId(S.articles, p.article_id);
    openOpForm(null, { branch_id: p.branch_id, op_date: date, account_id: p.account_id || '', article_id: p.article_id, object_id: p.object_id, amount: p.amount, comment: p.comment || '', period: a.opu_group ? date.slice(0, 7) + '-01' : null },
      () => api.update('planned', p.id, { done_dates: [...(p.done_dates || []), date] }));
  }));
}
function openPlanForm(p) {
  const brInit = p ? p.branch_id : defaultBranch();
  const init = p || { plan_date: todayStr(), article_id: '', object_id: '', account_id: '', amount: '', comment: '', recurrence: 'none', until: null };
  const m = openModal(`<h3>${p ? 'Изменить платёж' : 'Новый платёж'}</h3><div class="form">
    ${branchField('p-br', brInit, !!p)}
    <label>Дата<input type="date" id="p-date" value="${esc(init.plan_date)}"></label>
    <label>Сумма<input id="p-amt" inputmode="decimal" value="${init.amount === '' ? '' : String(init.amount).replace('.', ',')}"></label>
    <label class="full">Статья<select id="p-art">${opt(activeArts(), init.article_id, undefined, 'Выберите')}</select></label>
    <label>Объект<select id="p-obj">${refOpts(S.objects, brInit, init.object_id, 'Выберите')}</select></label>
    <label>Счёт<select id="p-acc">${refOpts(S.accounts, brInit, init.account_id, 'Не указан')}</select></label>
    <label class="full">Комментарий<input id="p-cm" value="${esc(init.comment)}"></label>
    <label>Повтор<select id="p-rec"><option value="none" ${init.recurrence === 'none' ? 'selected' : ''}>Разовый</option><option value="monthly" ${init.recurrence === 'monthly' ? 'selected' : ''}>Ежемесячно</option></select></label>
    <label id="p-until-l">Повторять до<input type="month" id="p-until" value="${init.until ? ym(init.until) : ''}"></label>
    <div class="err" id="p-err"></div></div><div class="actions"><button class="btn" data-cancel>Отмена</button><button class="btn primary" data-save>Сохранить</button></div>`);
  const sync = () => $('#p-until-l', m).classList.toggle('hidden', $('#p-rec', m).value !== 'monthly');
  $('#p-br', m).onchange = () => { const b = +$('#p-br', m).value; $('#p-acc', m).innerHTML = refOpts(S.accounts, b, null, 'Не указан'); $('#p-obj', m).innerHTML = refOpts(S.objects, b, null, 'Выберите'); };
  $('#p-rec', m).onchange = sync; sync();
  m.querySelector('[data-cancel]').onclick = closeModal;
  m.querySelector('[data-save]').onclick = async () => {
    const err = t => ($('#p-err', m).textContent = t);
    const amount = parseAmount($('#p-amt', m).value), date = $('#p-date', m).value;
    if (!date) return err('Укажите дату'); if (!$('#p-art', m).value) return err('Выберите статью'); if (!$('#p-obj', m).value) return err('Выберите объект'); if (!(amount > 0)) return err('Введите сумму больше нуля');
    const rec = $('#p-rec', m).value, u = $('#p-until', m).value;
    let until = null; if (rec === 'monthly' && u) { const [y, mo] = u.split('-').map(Number); until = new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10); }
    const row = { branch_id: +$('#p-br', m).value, plan_date: date, article_id: +$('#p-art', m).value, object_id: +$('#p-obj', m).value, account_id: $('#p-acc', m).value ? +$('#p-acc', m).value : null, amount: r2(amount), comment: $('#p-cm', m).value.trim() || null, recurrence: rec, until };
    if (await run(() => (p ? api.update('planned', p.id, row) : api.insert('planned', row)), p ? 'Изменения сохранены' : 'Платёж внесён')) closeModal();
  };
}

/* ---------- Справочники ---------- */
const SEC = { operating: 'Операционная', investing: 'Инвестиционная', financing: 'Финансовая', internal: 'Перемещения (не в потоке)' };
const OPU_GROUPS = ['Выручка', 'Прямые расходы', 'Коммерческие и агентские', 'Административные', 'Прочие доходы и расходы', 'Налоги'];
const REFS = {
  objects: { title: 'Объекты', table: 'objects', cols: [['Филиал', o => esc(brName(o.branch_id))], ['Название', o => esc(o.name)], ['Юрлицо', o => esc(o.legal_entity)], ['Тип', o => (o.is_common ? 'Общие расходы' : '')]] },
  accounts: { title: 'Счета', table: 'accounts', cols: [['Филиал', o => esc(brName(o.branch_id))], ['Название', o => esc(o.name)], ['Остаток на начало', o => fmt(Number(o.opening_balance)) === '-' ? '0' : fmt(Number(o.opening_balance))], ['Дата остатка', o => fmtDate(o.opening_date)]] },
  branches: { title: 'Филиалы', table: 'branches', cols: [['Название', o => esc(o.name)]] },
  owners: { title: 'Собственники', table: 'owners', cols: [['Филиал', o => esc(brName(o.branch_id))], ['Собственник', o => esc(o.name)], ['Доля, %', o => fmt(Number(o.share))], ['Статья дивидендов', o => esc(artName(o.dividend_article_id))], ['Статья вложений', o => esc(artName(o.contribution_article_id))]] },
  articles: { title: 'Статьи', table: 'articles', cols: [['Название', o => esc(o.name)], ['Вид', o => (o.kind === 'income' ? 'Доход' : 'Расход')], ['ДДС', o => SEC[o.dds_section]], ['ОПУ', o => esc(o.opu_group || 'не входит')]] },
};
const refList = k => ({ objects: sObjects(), accounts: sAccounts(), owners: S.owners.filter(inBr) }[k] || S[REFS[k].table]);
function viewRef() {
  const tabs = [...Object.entries(REFS).map(([k, v]) => [k, v.title]), ...(isEditor() ? [['access', 'Доступ']] : [])];
  let body;
  if (S.refTab === 'access') {
    body = `<div class="tablewrap"><table><thead><tr><th>Email</th><th>Роль</th><th></th></tr></thead><tbody>${S.members.map(u => `<tr><td>${esc(u.email)}</td><td>${u.user_id === S.user.id ? 'редактор (вы)' : `<select data-role="${u.user_id}"><option value="pending" ${u.role === 'pending' ? 'selected' : ''}>ожидает</option><option value="viewer" ${u.role === 'viewer' ? 'selected' : ''}>просмотр</option><option value="editor" ${u.role === 'editor' ? 'selected' : ''}>редактор</option></select>`}</td><td>${u.user_id === S.user.id ? '' : `<button class="link danger" data-mdel="${u.user_id}">Убрать доступ</button>`}</td></tr>`).join('')}</tbody></table></div>`;
  } else {
    const R = REFS[S.refTab], list = refList(S.refTab);
    body = `<div class="tablewrap"><table><thead><tr>${R.cols.map(c => `<th>${c[0]}</th>`).join('')}<th>Статус</th><th></th></tr></thead><tbody>${list.map(o => `<tr class="${o.active ? '' : 'muted'}">${R.cols.map(c => `<td>${c[1](o)}</td>`).join('')}<td><span class="badge ${o.active ? '' : 'off'}">${o.active ? 'активен' : 'в архиве'}</span></td><td>${isEditor() ? `<button class="link" data-redit="${o.id}">Изменить</button>${o.is_common ? '' : `<button class="link ${o.active ? 'danger' : ''}" data-rarch="${o.id}">${o.active ? 'В архив' : 'Вернуть'}</button>`}` : ''}</td></tr>`).join('')}</tbody></table></div>`;
  }
  return `<div class="card"><div class="tabs">${tabs.map(([k, t]) => `<button data-reftab="${k}" class="${S.refTab === k ? 'on' : ''}">${t}</button>`).join('')}</div>
   ${isEditor() && S.refTab !== 'access' ? '<p><button class="btn primary" id="add-ref">Добавить</button></p>' : ''}${body}</div>`;
}
function bindRef() {
  document.querySelectorAll('[data-reftab]').forEach(b => (b.onclick = () => { S.refTab = b.dataset.reftab; render(); }));
  $('#add-ref') && ($('#add-ref').onclick = () => openRefForm(null));
  document.querySelectorAll('[data-redit]').forEach(b => (b.onclick = () => openRefForm(byId(S[REFS[S.refTab].table], +b.dataset.redit))));
  document.querySelectorAll('[data-rarch]').forEach(b => (b.onclick = async () => {
    const R = REFS[S.refTab], o = byId(S[R.table], +b.dataset.rarch);
    if (o.active && !(await confirmDialog(`Отправить в архив: ${o.name}?`, 'В архив'))) return;
    run(() => api.update(R.table, o.id, { active: !o.active }), o.active ? 'Отправлено в архив' : 'Возвращено');
  }));
  document.querySelectorAll('[data-role]').forEach(s => (s.onchange = () => run(() => api.updateMember(s.dataset.role, { role: s.value }), 'Роль изменена')));
  document.querySelectorAll('[data-mdel]').forEach(b => (b.onclick = async () => { if (await confirmDialog('Убрать доступ у этого пользователя?', 'Убрать')) run(() => api.removeMember(b.dataset.mdel), 'Доступ убран'); }));
}
function openRefForm(o) {
  const k = S.refTab, R = REFS[k], isNew = !o;
  const brSel = `<label class="full">Филиал<select id="x-br" ${isNew ? '' : 'disabled'}>${opt(S.branches.filter(b => b.active || b.id === o?.branch_id), o?.branch_id || defaultBranch())}</select></label>`;
  const artsOf = kind => activeArts().filter(a => a.kind === kind && a.dds_section === 'financing');
  const fields = {
    branches: `<label class="full">Название<input id="x-name" value="${esc(o?.name)}"></label>`,
    owners: `${brSel}<label class="full">Собственник<input id="x-name" value="${esc(o?.name)}"></label><label>Доля, %<input id="x-share" inputmode="decimal" value="${o ? String(o.share).replace('.', ',') : '50'}"></label>
      <label class="full">Статья дивидендов<select id="x-div">${opt(artsOf('expense'), o?.dividend_article_id, undefined, 'Выберите')}</select></label><label class="full">Статья вложений<select id="x-con">${opt(artsOf('income'), o?.contribution_article_id, undefined, 'Выберите')}</select></label>`,
    objects: `${brSel}<label class="full">Название<input id="x-name" value="${esc(o?.name)}"></label><label class="full">Юрлицо<input id="x-legal" value="${esc(o?.legal_entity)}"></label>`,
    accounts: `${brSel}<label class="full">Название<input id="x-name" value="${esc(o?.name)}"></label><label>Остаток на начало<input id="x-bal" inputmode="decimal" value="${o ? String(o.opening_balance).replace('.', ',') : '0'}"></label><label>Дата остатка<input type="date" id="x-date" value="${o?.opening_date || '2026-01-01'}"></label>`,
    articles: `<label class="full">Название<input id="x-name" value="${esc(o?.name)}"></label>
      <label>Вид<select id="x-kind"><option value="income" ${o?.kind === 'income' ? 'selected' : ''}>Доход</option><option value="expense" ${!o || o.kind === 'expense' ? 'selected' : ''}>Расход</option></select></label>
      <label>Раздел ДДС<select id="x-sec">${Object.entries(SEC).map(([v, t]) => `<option value="${v}" ${o?.dds_section === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label class="full">Группа ОПУ<select id="x-opu"><option value="">Не входит в ОПУ</option>${OPU_GROUPS.map(g => `<option ${o?.opu_group === g ? 'selected' : ''}>${g}</option>`).join('')}</select></label>`,
  }[k];
  const m = openModal(`<h3>${isNew ? 'Добавить' : 'Изменить'}: ${R.title.toLowerCase()}</h3><div class="form">${fields}<div class="err" id="x-err"></div></div><div class="actions"><button class="btn" data-cancel>Отмена</button><button class="btn primary" data-save>Сохранить</button></div>`);
  m.querySelector('[data-cancel]').onclick = closeModal;
  m.querySelector('[data-save]').onclick = async () => {
    const err = t => ($('#x-err', m).textContent = t), name = $('#x-name', m).value.trim();
    if (!name) return err('Введите название');
    const bid = isNew && $('#x-br', m) ? +$('#x-br', m).value : o?.branch_id;
    if (S[R.table].some(x => x.name.toLowerCase() === name.toLowerCase() && x.id !== o?.id && (k === 'branches' || k === 'articles' || x.branch_id === bid))) return err('Такое название уже есть');
    let row;
    if (k === 'branches') row = { name };
    if (k === 'owners') { const sh = parseAmount($('#x-share', m).value); if (!(sh > 0 && sh <= 100)) return err('Доля должна быть больше 0 и не больше 100'); row = { ...(isNew ? { branch_id: bid } : {}), name, share: r2(sh), dividend_article_id: +$('#x-div', m).value || null, contribution_article_id: +$('#x-con', m).value || null }; }
    if (k === 'objects') row = { ...(isNew ? { branch_id: bid } : {}), name, legal_entity: $('#x-legal', m).value.trim() || null };
    if (k === 'accounts') { const b = parseAmount($('#x-bal', m).value); if (Number.isNaN(b)) return err('Введите остаток числом'); if (!$('#x-date', m).value) return err('Укажите дату остатка'); row = { ...(isNew ? { branch_id: bid } : {}), name, opening_balance: r2(b), opening_date: $('#x-date', m).value }; }
    if (k === 'articles') row = { name, kind: $('#x-kind', m).value, dds_section: $('#x-sec', m).value, opu_group: $('#x-opu', m).value || null, ...(isNew ? { sort: 500 } : {}) };
    if (await run(() => (isNew ? api.insert(R.table, row) : api.update(R.table, o.id, row)), isNew ? 'Данные внесены' : 'Изменения сохранены')) closeModal();
  };
}

boot();
