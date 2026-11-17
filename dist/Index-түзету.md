# Index.html — 2 түзету

## 1-түзету: күнді жүктеу (кесте бірден шығады)

`Index.html` ішінен мына жолдан басталатын бөлікті табыңыз:

```
  function loadBoot() {
```

…және `applyDay` функциясының соңына дейін (`// ───────── Жоғарғы панель ─────────` жолына дейін) өшіріп, орнына мынаны қойыңыз:

```js
  // Ашылған күндерді браузер жадында сақтаймыз: күн ауыстырғанда кесте бірден шығады,
  // ал жаңа деректі сервер артынан жеткізеді.
  var dayCache = {};

  function loadBoot() {
    return call('getBootstrap').then(function (boot) {
      state.boot = boot;
      if (boot.todayDay) {
        boot.todayDay.fresh = Date.now();
        dayCache[boot.todayDay.sheet] = boot.todayDay;
      }
    });
  }

  function loadDay(iso, opts) {
    opts = opts || {};
    state.date = iso;
    renderHeader();
    var sheet = sheetFor(iso);
    if (!sheet) {
      state.day = null;
      renderDay();
      return Promise.resolve();
    }
    var cached = dayCache[sheet];
    if (cached && !opts.silent) {
      state.day = cached;
      renderDay();
      if (cached.fresh && Date.now() - cached.fresh < 10000) return Promise.resolve();
    } else if (!cached && !opts.silent) {
      $('main').classList.add('loading');
    }
    return call('getDay', sheet).then(function (day) {
      day.fresh = Date.now();
      dayCache[sheet] = day;
      if (state.date !== iso) return; // пайдаланушы басқа күнге өтіп кетті
      state.day = day;
      renderDay();
    }).catch(function (err) {
      if (!opts.silent && !cached) toast(errText(err), true);
    }).then(function () { $('main').classList.remove('loading'); });
  }

  function applyDay(day) {
    if (!day) return;
    day.fresh = Date.now();
    dayCache[day.sheet] = day;
    if (day.date === state.date) { state.day = day; renderDay(); }
  }

```

## 2-түзету: «Келді / Келмеді» белгісі бірден көрінеді

Мына функцияны табыңыз:

```js
  function setAttendance(row, value) {
    var s = findSlot(row);
    var next = s.attended === value ? '' : value;
    call('setAttendance', state.day.sheet, row, next, s.prev).then(applyDay)
      .catch(function (err) { handleWriteError(err); });
  }
```

…және толық мынамен ауыстырыңыз:

```js
  var attPending = {};
  function setAttendance(row, value) {
    var s = findSlot(row);
    if (!s || attPending[row]) return;
    var next = s.attended === value ? '' : value;
    var old = s.attended;
    attPending[row] = true;
    s.attended = next;
    renderDay(); // белгі серверді күтпей бірден көрінеді
    call('setAttendance', state.day.sheet, row, next, s.prev).then(applyDay)
      .catch(function (err) { s.attended = old; renderDay(); handleWriteError(err); })
      .then(function () { delete attPending[row]; });
  }
```
