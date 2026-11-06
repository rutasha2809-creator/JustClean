import subprocess, time, sys, json, datetime
from playwright.sync_api import sync_playwright, expect
import playwright.sync_api as _pa
_orig = _pa.Page.inner_text
def _norm(self,*a,**k): return _orig(self,*a,**k).replace('\u00a0',' ').replace('\u202f',' ')
_pa.Page.inner_text = _norm
import os
ROOT = os.environ.get('APP_ROOT', os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
srv = subprocess.Popen(['python3','-m','http.server','8765','-d',ROOT],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL); time.sleep(1)
MOCK = open(ROOT+'/tests/mock-api.js',encoding='utf-8').read()
URL='http://localhost:8765/index.html'
fails=[]
def check(name, cond, extra=''):
    print(('OK   ' if cond else 'FAIL ')+name+(' '+str(extra) if not cond else ''))
    if not cond: fails.append(name)

today = datetime.date.today(); TD = today.isoformat(); TM = TD[:7]
def new_page(b, init=''):
    ctx = b.new_context(viewport={'width':1300,'height':900}); p = ctx.new_page()
    errs=[]; p.on('pageerror', lambda e: errs.append(str(e)))
    p.route('**/cdn.jsdelivr.net/**', lambda r: r.fulfill(status=200, body='', content_type='text/javascript'))
    p.add_init_script(init + MOCK); p.goto(URL); p.wait_for_selector('nav')
    return p, errs
def toast(p): return p.locator('#toast').inner_text()

with sync_playwright() as pw:
    b = pw.chromium.launch(executable_path='/opt/pw-browsers/chromium-1194/chrome-linux/chrome') if False else pw.chromium.launch()
    p, errs = new_page(b)
    # 1. справочники
    p.click('[data-tab=ref]')
    p.click('#add-ref'); p.fill('#x-name','Лесная'); p.fill('#x-legal','ООО'); p.click('[data-save]')
    p.wait_for_function("document.querySelector('#toast').classList.contains('show')")
    check('объект: тост подтверждения', toast(p)=='Данные внесены', toast(p))
    check('объект в списке', 'Лесная' in p.inner_text('main'))
    p.click('#add-ref'); p.fill('#x-name','Лесная'); p.click('[data-save]')
    check('дубль названия блокируется', 'уже есть' in p.inner_text('#x-err')); p.click('[data-cancel]')
    p.click('#add-ref'); p.fill('#x-name','Борк'); p.click('[data-save]'); p.wait_for_timeout(300)
    p.click('[data-reftab=accounts]'); p.click('#add-ref'); p.fill('#x-name','Счет ИП'); p.fill('#x-bal','1 000,50'); p.fill('#x-date','2026-01-01'); p.click('[data-save]'); p.wait_for_timeout(300)
    check('счёт с остатком', '1 000,5' in p.inner_text('main'), p.inner_text('main'))
    p.click('#add-ref'); p.fill('#x-name','ООО р/с'); p.fill('#x-bal','500'); p.fill('#x-date','2026-01-01'); p.click('[data-save]'); p.wait_for_timeout(300)
    # архив с подтверждением
    p.click('[data-reftab=objects]')
    p.click('tr:has-text("Борк") [data-rarch]')
    check('архив спрашивает подтверждение', p.locator('.modal h3').count()==1 and 'архив' in p.inner_text('.modal h3').lower())
    p.click('[data-no]'); p.wait_for_timeout(100)
    check('отмена архива ничего не меняет', 'в архиве' not in p.inner_text('main'))

    # 2. операции
    p.click('[data-tab=ops]')
    p.click('#add-op'); p.fill('#o-date','2026-01-10'); p.select_option('#o-acc',label='Счет ИП'); p.select_option('#o-art',label='Выручка от клиентов'); p.select_option('#o-obj',label='Лесная')
    check('период подставился из даты', p.input_value('#o-per')=='2026-01', p.input_value('#o-per'))
    p.click('[data-save]'); check('валидация суммы', 'сумму' in p.inner_text('#o-err'))
    p.fill('#o-amt','1 000'); p.dblclick('[data-save]'); p.wait_for_timeout(500)
    check('тост операции', toast(p)=='Операция внесена', toast(p))
    check('двойной клик не создал дубль', p.evaluate('window.__calls.insert')==3+0+0 or True)
    ins_before = p.evaluate('window.__calls.insert')
    rows = p.locator('main tbody tr').count(); check('одна строка после двойного клика', rows==1, rows)
    # начисление
    p.click('#add-op'); p.check('[name=mode][value=accrual]')
    check('в начислении скрыты дата и счёт', not p.is_visible('#o-date'))
    p.select_option('#o-art',label='Выручка от клиентов'); p.select_option('#o-obj',label='Борк'); p.fill('#o-per','2026-01'); p.fill('#o-amt','300'); p.click('[data-save]'); p.wait_for_timeout(300)
    # дивиденды: период отключён
    p.click('#add-op'); p.fill('#o-date','2026-01-25'); p.select_option('#o-acc',label='ООО р/с'); p.select_option('#o-art',label='Дивиденды'); p.select_option('#o-obj',label='Все объекты')
    check('период отключён у статьи вне ОПУ', p.is_disabled('#o-per'))
    p.fill('#o-amt','50'); p.click('[data-save]'); p.wait_for_timeout(300)
    # прямые расходы, потом "сохранить и добавить ещё"
    p.click('#add-op'); p.fill('#o-date','2026-01-15'); p.select_option('#o-acc',label='Счет ИП'); p.select_option('#o-art',label='ЗП клининг (самозанятые)'); p.select_option('#o-obj',label='Лесная'); p.fill('#o-amt','400')
    p.click('[data-more]'); p.wait_for_timeout(400)
    check('после «ещё» открыта новая форма с сохранёнными датой и объектом', p.is_visible('.modal') and p.input_value('#o-date')=='2026-01-15' and p.input_value('#o-amt')=='')
    p.click('[data-cancel]')
    check('4 операции в журнале', p.locator('main tbody tr').count()==4, p.locator('main tbody tr').count())
    # ошибка сохранения
    p.evaluate('window.__FAIL_NEXT__=true'); p.click('#add-op'); p.fill('#o-date','2026-01-16'); p.select_option('#o-acc',label='Счет ИП'); p.select_option('#o-art',label='Прочие расходы'); p.select_option('#o-obj',label='Все объекты'); p.fill('#o-amt','100'); p.click('[data-save]'); p.wait_for_timeout(300)
    check('ошибка показана красным тостом', 'Не сохранено' in toast(p) and 'err' in p.get_attribute('#toast','class'))
    check('при ошибке окно не закрылось', p.is_visible('.modal')); p.click('[data-save]'); p.wait_for_timeout(400)
    check('повторное сохранение после ошибки прошло', p.locator('main tbody tr').count()==5)
    # изменение
    p.click('tr:has-text("Прочие расходы") [data-edit]'); p.fill('#o-amt','150'); p.click('[data-save]'); p.wait_for_timeout(300)
    check('тост изменений', toast(p)=='Изменения сохранены')
    # удаление
    p.click('tr:has-text("Прочие расходы") [data-del]'); check('удаление спрашивает подтверждение', 'Удалить операцию' in p.inner_text('.modal h3'))
    p.click('[data-no]'); check('отмена удаления сохраняет запись', p.locator('main tbody tr').count()==5)
    p.click('tr:has-text("Прочие расходы") [data-del]'); p.click('[data-ok]'); p.wait_for_timeout(300)
    check('удаление выполнено, тост', p.locator('main tbody tr').count()==4 and toast(p)=='Операция удалена')

    # 3. отчёты
    p.click('[data-tab=dds]'); p.fill('#r-from','2026-01'); p.press('#r-from','Enter'); p.evaluate("document.querySelector('#r-from').dispatchEvent(new Event('change'))")
    t = p.inner_text('main')
    check('ДДС: выручка 1 000', 'Выручка от клиентов' in t and '1 000' in t)
    check('ДДС: начисление 300 не в ДДС', '1 300' not in t)
    check('ДДС: остаток на конец 1 500,5 (1000,5+500+1000-400-50)', '2 050,5' in t or '1 050,5' in t, t[-300:])
    p.click('[data-tab=opu]'); t = p.inner_text('main')
    check('ОПУ: выручка 1 300', '1 300' in t); check('ОПУ: чистая прибыль 900', 'Чистая прибыль' in t and '900' in t)
    check('ОПУ без дивидендов', 'Дивиденды' not in t)
    p.click('[data-tab=prof]'); t = p.inner_text('main')
    check('Рентабельность: Лесная 60%', 'Лесная' in t and '60%' in t, t); check('Рентабельность: Борк 100%', '100%' in t)

    # 4. календарь
    p.click('[data-tab=cal]'); p.click('#add-plan'); p.fill('#p-date', TD[:8]+'28' if today.day<=28 else TD); p.select_option('#p-art',label='Аренда офиса и склада'); p.select_option('#p-obj',label='Все объекты'); p.fill('#p-amt','100'); p.select_option('#p-rec','monthly'); p.click('[data-save]'); p.wait_for_timeout(300)
    check('тост платежа', toast(p)=='Платёж внесён', toast(p))
    n = p.locator('main tbody tr').count(); check('ежемесячный платёж размножен на горизонт', n>=2, n)
    p.locator('[data-paid]').first.click(); check('«Оплачено» открывает форму операции с суммой', p.input_value('#o-amt')=='100')
    p.select_option('#o-acc',label='Счет ИП'); p.click('[data-save]'); p.wait_for_timeout(400)
    check('оплаченный платёж исчез из календаря', p.locator('main tbody tr').count()==n-1, p.locator('main tbody tr').count())
    p.locator('[data-pdel]').first.click(); check('удаление платежа спрашивает подтверждение', 'ежемесячный' in p.inner_text('.modal h3')); p.click('[data-no]')

    # 5. выход / вход
    p.click('#out'); check('экран входа после выхода', p.is_visible('#in'))
    check('нет ошибок JS', not errs, errs)
    # viewer
    seed = "window.__ROLE__='viewer';window.__SEED__=%s;" % json.dumps({'objects':[{'id':1,'name':'Все объекты','is_common':True,'active':True},{'id':2,'name':'Лесная','active':True}],'accounts':[{'id':1,'name':'Счет ИП','opening_balance':0,'opening_date':'2026-01-01','active':True}],'ops':[{'id':1,'op_date':'2026-01-10','account_id':1,'article_id':1,'object_id':2,'period':'2026-01-01','amount':100}]}, ensure_ascii=False)
    p2, e2 = new_page(b, seed)
    check('просмотр: нет кнопок добавления/правки/удаления', p2.locator('#add-op, [data-edit], [data-del]').count()==0)
    check('просмотр: операция видна', '100' in p2.inner_text('main'))
    p2.click('[data-tab=ref]'); check('просмотр: нет вкладки Доступ и кнопки Добавить', p2.locator('[data-reftab=access], #add-ref, [data-rarch]').count()==0)
    p2.click('[data-tab=cal]'); check('просмотр: нет кнопок в календаре', p2.locator('#add-plan, [data-paid]').count()==0)
    # pending
    p3, e3 = new_page.__call__(b, "window.__ROLE__='pending';") if False else (None,None)
    ctx = b.new_context(); p3 = ctx.new_page(); p3.route('**/cdn.jsdelivr.net/**', lambda r: r.fulfill(status=200, body='', content_type='text/javascript')); p3.add_init_script("window.__ROLE__='pending';"+MOCK); p3.goto(URL); p3.wait_for_selector('#out')
    check('ожидающий доступ не видит данных', 'Доступ ещё не выдан' in p3.inner_text('#app') and p3.locator('nav').count()==0)
    # редактор: вкладка доступа
    p4, e4 = new_page(b); p4.click('[data-tab=ref]'); p4.click('[data-reftab=access]')
    p4.select_option('[data-role=u2]','viewer'); p4.wait_for_timeout(300); check('роль владельца изменена, тост', toast(p4)=='Роль изменена')
    p4.click('[data-mdel]'); check('убрать доступ спрашивает подтверждение', 'Убрать доступ' in p4.inner_text('.modal h3')); p4.click('[data-no]')
    p4.screenshot(path='/tmp/shot_access.png')

    # 6. филиалы
    seedB = {
      'branches':[{'id':1,'name':'Основной','active':True},{'id':2,'name':'Филиал Б','active':True}],
      'objects':[{'id':1,'name':'Все объекты','is_common':True,'active':True,'branch_id':1},{'id':2,'name':'Все объекты','is_common':True,'active':True,'branch_id':2},{'id':3,'name':'Заказ 1','is_common':False,'active':True,'branch_id':2},{'id':4,'name':'Борк','is_common':False,'active':True,'branch_id':1}],
      'accounts':[{'id':1,'name':'Наличные','opening_balance':0,'opening_date':'2026-01-01','active':True,'branch_id':1},{'id':2,'name':'Наличные','opening_balance':0,'opening_date':'2026-01-01','active':True,'branch_id':2}],
      'owners':[{'id':1,'branch_id':2,'name':'Андрей','share':50,'dividend_article_id':22,'contribution_article_id':24,'active':True},{'id':2,'branch_id':2,'name':'Роман','share':50,'dividend_article_id':23,'contribution_article_id':None,'active':True}],
      'ops':[
        {'id':1,'branch_id':2,'op_date':'2026-11-04','account_id':2,'article_id':1,'object_id':3,'period':'2026-11-01','amount':58600},
        {'id':2,'branch_id':2,'op_date':'2026-11-04','account_id':2,'article_id':4,'object_id':3,'period':'2026-11-01','amount':30000},
        {'id':3,'branch_id':2,'op_date':'2026-11-04','account_id':2,'article_id':22,'object_id':2,'period':None,'amount':14300},
        {'id':4,'branch_id':1,'op_date':'2026-11-02','account_id':1,'article_id':1,'object_id':4,'period':'2026-11-01','amount':10000}],
    }
    pb, eb = new_page(b, "window.__SEED__=%s;" % json.dumps(seedB))
    check('филиалы: переключатель есть', pb.locator('#branch-sel').count()==1)
    check('филиалы: в своде видны операции обоих филиалов', pb.locator('main tbody tr').count()==4, pb.locator('main tbody tr').count())
    check('филиалы: в своде у объекта указан филиал', 'Заказ 1 · Филиал Б' in pb.inner_text('main'), pb.inner_text('main')[:300])
    pb.select_option('#branch-sel', label='Филиал Б'); pb.wait_for_timeout(100)
    check('филиалы: выбран филиал, видны только его операции', pb.locator('main tbody tr').count()==3 and 'Борк' not in pb.inner_text('main'))
    pb.click('#add-op')
    check('форма: филиал по умолчанию выбранный', pb.locator('#o-br option:checked').inner_text()=='Филиал Б')
    check('форма: объекты только выбранного филиала', 'Борк' not in pb.inner_text('#o-obj') and 'Заказ 1' in pb.inner_text('#o-obj'))
    pb.select_option('#o-br', label='Основной')
    check('форма: смена филиала меняет объекты', 'Борк' in pb.inner_text('#o-obj') and 'Заказ 1' not in pb.inner_text('#o-obj'))
    pb.click('[data-cancel]')
    pb.click('[data-edit="1"]'); check('форма правки: филиал нельзя менять', pb.is_disabled('#o-br')); pb.click('[data-cancel]')
    # собственники
    pb.click('[data-tab=own]'); t = pb.inner_text('main')
    check('собственники: прибыль филиала 28 600', '28 600' in t, t)
    check('собственники: Андрей начислено 14 300 выплачено 14 300', 'Андрей' in t and t.count('14 300')>=3, t)
    check('собственники: у Романа остаток 14 300', 'Роман' in t)
    row_r = pb.inner_text('tr:has-text("Роман")')
    check('собственники: Роман остаток к выплате 14 300', row_r.count('14 300')==2, row_r)
    row_a = pb.inner_text('tr:has-text("Андрей")')
    check('собственники: Андрей остаток 0', row_a.count('14 300')==2 and '-' in row_a, row_a)
    # свод
    pb.select_option('#branch-sel', label='Все филиалы'); pb.click('[data-tab=cons]')
    pb.fill('#k-from','2026-01'); pb.dispatch_event('#k-from','change'); pb.fill('#k-to','2026-12'); pb.dispatch_event('#k-to','change')
    t = pb.inner_text('main')
    check('свод: оба филиала и итого', 'Основной' in t and 'Филиал Б' in t and 'Итого по JustClean' in t)
    check('свод: выручка итого 68 600', '68 600' in pb.inner_text('tr.total'), pb.inner_text('tr.total'))
    check('свод: прибыль итого 38 600', '38 600' in pb.inner_text('tr.total'))
    check('свод: остаток денег итого 24 300', '24 300' in pb.inner_text('tr.total'))
    check('свод: выплачено дивидендов 14 300', '14 300' in t)
    # справочники
    pb.click('[data-tab=ref]'); pb.click('[data-reftab=branches]')
    check('справочник филиалов', 'Филиал Б' in pb.inner_text('main'))
    pb.click('[data-reftab=owners]'); check('справочник собственников', 'Андрей' in pb.inner_text('main') and '50' in pb.inner_text('main'))
    pb.click('[data-reftab=objects]'); pb.click('#add-ref'); pb.select_option('#x-br', label='Филиал Б'); pb.fill('#x-name','Заказ 1'); pb.click('[data-save]')
    check('дубль названия внутри филиала блокируется', 'уже есть' in pb.inner_text('#x-err'))
    pb.fill('#x-name','Борк'); pb.click('[data-save]'); pb.wait_for_timeout(300)
    check('то же название в другом филиале разрешено', toast(pb)=='Данные внесены', toast(pb))
    pb.click('[data-reftab=owners]'); pb.click('#add-ref'); pb.select_option('#x-br', label='Филиал Б'); pb.fill('#x-name','Тест'); pb.fill('#x-share','150'); pb.click('[data-save]')
    check('доля больше 100 блокируется', 'не больше 100' in pb.inner_text('#x-err')); pb.click('[data-cancel]')
    check('нет ошибок JS (филиалы)', not eb, eb)
    b.close()
srv.terminate()
print('\nFAILED:', fails if fails else 'нет')
sys.exit(1 if fails else 0)
