# Index.html — «Курстағылар» батырмасы (4 өзгеріс)

Бұрынғы `Index-түзету.md` түзетулерін жасап қойсаңыз, олар өз орнында қалады. Бұл — соған қосымша.

## 1. Стиль

`</style>` жолын табыңыз да, **оның алдына** мынаны қойыңыз:

```css
  /* ── Ем курстары ── */
  .col-head .head-actions { display: flex; align-items: baseline; gap: 12px; }
  .link-btn { border: 0; background: none; color: var(--accent); font-weight: 600; font-size: 13.5px; padding: 0; }
  .link-btn:hover { text-decoration: underline; }
  .course-list { list-style: none; margin: 12px 0 0; padding: 0; border: 1px solid var(--line); border-radius: var(--radius); max-height: 55vh; overflow: auto; }
  .course-list li { border-bottom: 1px solid var(--line); }
  .course-list li:last-child { border-bottom: 0; }
  .course-list label { display: grid; grid-template-columns: 22px 1fr auto; gap: 10px; align-items: center; padding: 10px 12px; cursor: pointer; }
  .course-list input { width: 18px; height: 18px; accent-color: var(--accent); }
  .course-list .cl-meta { display: block; color: var(--muted); font-size: 12.5px; }
  .course-list .cl-time { font-weight: 600; }
  .course-list li.done { opacity: .55; }
  .courses-empty { color: var(--muted); margin: 12px 0 0; }
```

## 2. Батырма

Мына бөлікті табыңыз:

```html
          <div class="col-head">
            <h2>Ем: физио, плазма</h2>
            <span class="count" id="physioCount"></span>
          </div>
```

…және мынамен ауыстырыңыз:

```html
          <div class="col-head">
            <h2>Ем: физио, плазма</h2>
            <span class="head-actions">
              <button type="button" class="link-btn" id="coursesBtn">Курстағылар</button>
              <span class="count" id="physioCount"></span>
            </span>
          </div>
```

## 3. Терезе

`<div class="toast" id="toast"` жолын табыңыз да, **оның алдына** мынаны қойыңыз:

```html
  <dialog id="coursesDialog" class="sheet">
    <form method="dialog" id="coursesForm">
      <div class="sheet-head">
        <h3 id="coursesTitle">Курстағы пациенттер</h3>
        <button type="button" class="icon-btn" data-close aria-label="Жабу">×</button>
      </div>
      <p class="courses-empty" id="coursesHint">Жүктелуде…</p>
      <ul class="course-list" id="coursesList" hidden></ul>
      <div class="sheet-actions">
        <button type="submit" class="primary" id="coursesPlace" disabled>Белгіленгендерді қою</button>
      </div>
    </form>
  </dialog>

```

## 4. Код

`  // ───────── Жаңа күн ─────────` жолын табыңыз да, **оның алдына** мынаны қойыңыз:

```js
  // ───────── Ем курстары ─────────
  var coursesData = [];

  function openCourses() {
    if (!state.day) return;
    var sheet = state.day.sheet;
    $('#coursesTitle').textContent = 'Курстағылар, ' + humanDate(state.day.date);
    $('#coursesHint').textContent = 'Жүктелуде…';
    $('#coursesList').hidden = true;
    $('#coursesPlace').disabled = true;
    $('#coursesDialog').showModal();
    call('getActiveCourses', sheet).then(function (list) {
      if (!state.day || state.day.sheet !== sheet) return;
      coursesData = list;
      var todo = list.filter(function (c) { return !c.placed; }).length;
      if (!list.length) {
        $('#coursesHint').textContent = 'Соңғы 14 күнде курсы аяқталмаған пациент табылмады. ' +
          'Тек «курс неше күн» мен «нешінші күн» толтырылған жазбалар есептеледі.';
        return;
      }
      $('#coursesHint').textContent = todo
        ? 'Бүгін келетіндерді белгілеңіз. Әрқайсысы өз уақытына, ол толы болса — ең жақын бос орынға қойылады.'
        : 'Барлығы қойылған.';
      $('#coursesList').innerHTML = list.map(function (c, i) {
        return '<li' + (c.placed ? ' class="done"' : '') + '><label>' +
          '<input type="checkbox" data-i="' + i + '"' + (c.placed ? ' disabled' : ' checked') + '>' +
          '<span><b>' + esc(c.name) + '</b><span class="cl-meta">' + esc(c.proc || 'ем') + ', ' +
          esc(c.day + '/' + c.total) + '-күн' +
          (c.placed ? ', қойылған' : ', соңғы рет ' + esc(humanDate(c.lastDate))) + '</span></span>' +
          '<span class="cl-time">' + esc(c.time) + '</span></label></li>';
      }).join('');
      $('#coursesList').hidden = false;
      $('#coursesPlace').disabled = !todo;
    }).catch(function (err) { $('#coursesHint').textContent = errText(err); });
  }

  function placeSelected(e) {
    e.preventDefault();
    var items = $$('#coursesList input:checked').map(function (b) { return coursesData[Number(b.dataset.i)]; });
    if (!items.length) { toast('Ешкім белгіленбеген.', true); return; }
    var btn = $('#coursesPlace');
    busy(btn, true);
    call('placeCourses', state.day.sheet, items).then(function (res) {
      applyDay(res.day);
      $('#coursesDialog').close();
      var msg = res.placed.length + ' пациент қойылды';
      if (res.skipped.length) {
        msg += '. Қойылмады: ' + res.skipped.map(function (s) { return s.name + ' (' + s.reason + ')'; }).join(', ');
      }
      toast(msg, res.skipped.length > 0);
    }).catch(function (err) { handleWriteError(err, $('#coursesDialog')); })
      .then(function () { busy(btn, false); });
  }

  $('#coursesBtn').onclick = openCourses;
  $('#coursesForm').addEventListener('submit', placeSelected);

```
