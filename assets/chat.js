/* АвтоБатя. Чат на сайте: кнопка в углу, окно, файлы, смайлики.
   Разговаривает только со своей серверной функцией, сторонних скриптов нет. */
(function () {
  'use strict';

  var CFG = window.AUTOBATYA_CHAT || {};
  var API = (CFG.endpoint || '').replace(/\/+$/, '');

  // Те же пределы стоят на сервере, здесь они только чтобы предупредить
  // клиента до отправки, а не после впустую потраченной минуты.
  var MAX_FILES = 6;
  var MAX_FILE_BYTES = 25 * 1024 * 1024;
  var root = document.getElementById('chat');
  if (!API || !root) return;                 // не настроено, кнопку не показываем

  var els = {
    btn: document.getElementById('chat-btn'),
    badge: document.getElementById('chat-badge'),
    btnLabel: document.getElementById('chat-btn-label'),
    panel: document.getElementById('chat-panel'),
    close: document.getElementById('chat-close'),
    log: document.getElementById('chat-log'),
    chips: document.getElementById('chat-chips'),
    contact: document.getElementById('chat-contact'),
    contactInput: document.getElementById('chat-contact-input'),
    form: document.getElementById('chat-form'),
    input: document.getElementById('chat-input'),
    send: document.getElementById('chat-send'),
    fileBtn: document.getElementById('chat-file-btn'),
    file: document.getElementById('chat-file'),
    emojiBtn: document.getElementById('chat-emoji-btn'),
    emoji: document.getElementById('chat-emoji'),
    note: document.getElementById('chat-note')
  };

  var KEY_ID = 'ab-chat-id', KEY_SECRET = 'ab-chat-secret', KEY_LAST = 'ab-chat-last';
  var state = {
    id: null, secret: null, lastId: 0,
    open: false, busy: false, unread: 0,
    pending: [], starting: null, timer: null, seen: {}
  };

  try {
    state.id = localStorage.getItem(KEY_ID);
    state.secret = localStorage.getItem(KEY_SECRET);
    state.lastId = parseInt(localStorage.getItem(KEY_LAST) || '0', 10) || 0;
  } catch (e) { /* приватный режим браузера, живём без памяти */ }

  root.classList.add('on');

  /* ---------------- сеть ---------------- */
  function api(action, data) {
    var body = Object.assign({ action: action }, data || {});
    return fetch(API, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) {
      return r.json().catch(function () { return { ok: false, error: 'Сервер не ответил' }; });
    });
  }

  function remember() {
    try {
      localStorage.setItem(KEY_ID, state.id);
      localStorage.setItem(KEY_SECRET, state.secret);
    } catch (e) { /* не страшно */ }
  }

  function ensureChat() {
    if (state.id && state.secret) return Promise.resolve(true);
    if (state.starting) return state.starting;
    state.starting = api('start', { contact: els.contactInput.value }).then(function (r) {
      state.starting = null;
      if (!r.ok) { note(r.error || 'Чат недоступен', true); return false; }
      state.id = r.chatId; state.secret = r.secret; state.lastId = 0;
      remember();
      return true;
    }, function () { state.starting = null; note('Нет связи с чатом', true); return false; });
    return state.starting;
  }

  function forget() {
    state.id = null; state.secret = null; state.lastId = 0; state.seen = {};
    try { localStorage.removeItem(KEY_ID); localStorage.removeItem(KEY_SECRET); localStorage.removeItem(KEY_LAST); } catch (e) {}
  }

  /* ---------------- отрисовка ---------------- */
  function two(n) { return n < 10 ? '0' + n : '' + n; }
  function timeOf(iso) {
    var d = new Date(iso);
    return isNaN(d.getTime()) ? '' : two(d.getHours()) + ':' + two(d.getMinutes());
  }
  function isImage(t) { return /^image\//.test(t || ''); }

  function addMessage(m) {
    if (state.seen[m.id]) return;
    state.seen[m.id] = true;
    var box = document.createElement('div');
    box.className = 'msg msg--' + (m.author === 'shop' ? 'shop' : 'user');

    if (m.body) {
      var p = document.createElement('span');
      p.textContent = m.body;
      p.style.whiteSpace = 'pre-wrap';
      box.appendChild(p);
    }
    if (m.files && m.files.length) {
      var wrap = document.createElement('div');
      wrap.className = 'msg__files';
      m.files.forEach(function (f) {
        var a = document.createElement('a');
        a.href = f.url || '#';
        a.target = '_blank';
        a.rel = 'noopener';
        if (isImage(f.type) && f.url) {
          var img = document.createElement('img');
          img.src = f.url;
          img.alt = f.name || 'Вложение';
          img.loading = 'lazy';
          a.appendChild(img);
        } else {
          var doc = document.createElement('span');
          doc.className = 'msg__doc';
          doc.textContent = f.name || 'Файл';
          a.appendChild(doc);
        }
        wrap.appendChild(a);
      });
      box.appendChild(wrap);
    }
    var t = document.createElement('span');
    t.className = 'msg__time';
    t.textContent = timeOf(m.created_at);
    box.appendChild(t);

    els.log.appendChild(box);
    if (m.id > state.lastId) {
      state.lastId = m.id;
      try { localStorage.setItem(KEY_LAST, String(state.lastId)); } catch (e) {}
    }
  }

  function scrollDown() { els.log.scrollTop = els.log.scrollHeight; }

  function note(text, isError) {
    els.note.textContent = text || '';
    els.note.classList.toggle('err', !!isError);
    if (text) setTimeout(function () {
      if (els.note.textContent === text) { els.note.textContent = ''; els.note.classList.remove('err'); }
    }, 6000);
  }

  function setBadge(n) {
    state.unread = n;
    if (n > 0) {
      els.badge.hidden = false;
      els.badge.textContent = n > 9 ? '9+' : String(n);
      els.btnLabel.textContent = 'Открыть чат, новых сообщений: ' + n;
    } else {
      els.badge.hidden = true;
      els.btnLabel.textContent = state.open ? 'Закрыть чат' : 'Открыть чат с мастерской';
    }
  }

  /* ---------------- опрос ---------------- */
  function poll(markRead) {
    if (!state.id || !state.secret) return Promise.resolve();
    return api('poll', { chatId: state.id, secret: state.secret, since: state.lastId, read: !!markRead })
      .then(function (r) {
        if (!r.ok) {
          if (r.error === 'Диалог не найден') forget();
          return;
        }
        var atBottom = els.log.scrollHeight - els.log.scrollTop - els.log.clientHeight < 60;
        var fresh = 0;
        (r.messages || []).forEach(function (m) {
          addMessage(m);
          if (m.author === 'shop') fresh++;
        });
        if (fresh && (atBottom || markRead)) scrollDown();
        if (markRead) setBadge(0);
        else if (typeof r.unread === 'number') setBadge(r.unread);
      }, function () { /* сеть моргнула, попробуем в следующий раз */ });
  }

  function startTimer() {
    stopTimer();
    var every = state.open ? 6000 : 60000;
    state.timer = setInterval(function () {
      if (document.hidden) return;
      poll(state.open);
    }, every);
  }
  function stopTimer() { if (state.timer) { clearInterval(state.timer); state.timer = null; } }

  /* ---------------- открытие и закрытие ---------------- */
  function openChat() {
    if (state.open) return;
    state.open = true;
    root.classList.add('open');
    els.panel.hidden = false;
    els.btn.setAttribute('aria-expanded', 'true');
    setBadge(0);
    startTimer();
    poll(true).then(scrollDown);
    setTimeout(function () { els.input.focus(); }, 60);
  }
  function closeChat() {
    if (!state.open) return;
    state.open = false;
    root.classList.remove('open');
    els.panel.hidden = true;
    els.emoji.hidden = true;
    els.emojiBtn.setAttribute('aria-expanded', 'false');
    els.btn.setAttribute('aria-expanded', 'false');
    setBadge(state.unread);
    if (state.id) startTimer(); else stopTimer();
    els.btn.focus();
  }

  els.btn.addEventListener('click', function () { state.open ? closeChat() : openChat(); });
  els.close.addEventListener('click', closeChat);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && state.open) closeChat();
  });

  /* ---------------- файлы ---------------- */
  function human(size) {
    if (size > 1048576) return (size / 1048576).toFixed(1) + ' МБ';
    if (size > 1024) return Math.round(size / 1024) + ' КБ';
    return size + ' Б';
  }

  function drawChips() {
    els.chips.textContent = '';
    els.chips.hidden = state.pending.length === 0;
    state.pending.forEach(function (f, i) {
      var chip = document.createElement('span');
      chip.className = 'chip-file';
      chip.appendChild(document.createTextNode(f.name + ' · ' + human(f.size)));
      var x = document.createElement('button');
      x.type = 'button';
      x.setAttribute('aria-label', 'Убрать ' + f.name);
      x.textContent = '×';
      x.addEventListener('click', function () { state.pending.splice(i, 1); drawChips(); });
      chip.appendChild(x);
      els.chips.appendChild(chip);
    });
  }

  // Подпись без самоочистки: пока идёт загрузка, она должна висеть.
  function noteSticky(text) {
    els.note.textContent = text;
    els.note.classList.remove('err');
  }

  // Отправляем через XMLHttpRequest, а не fetch, только ради одного:
  // он умеет докладывать, сколько байтов уже ушло.
  function putWithProgress(url, file, onSent) {
    return new Promise(function (resolve) {
      var xhr = new XMLHttpRequest();
      xhr.open('PUT', url, true);
      if (file.type) xhr.setRequestHeader('content-type', file.type);
      if (xhr.upload) {
        xhr.upload.onprogress = function (e) {
          if (e.lengthComputable) onSent(e.loaded);
        };
      }
      xhr.onload = function () {
        onSent(file.size);
        resolve(xhr.status >= 200 && xhr.status < 300);
      };
      xhr.onerror = function () { resolve(false); };
      xhr.send(file);
    });
  }

  function uploadOne(file, onSent) {
    return ensureChat().then(function (ok) {
      if (!ok) return null;
      return api('upload-url', {
        chatId: state.id, secret: state.secret,
        name: file.name, type: file.type, size: file.size
      });
    }).then(function (r) {
      if (!r || !r.ok) { note((r && r.error) || 'Файл не принят', true); return null; }
      return putWithProgress(r.uploadUrl, file, onSent).then(function (up) {
        if (!up) { note('Файл не загрузился', true); return null; }
        return { path: r.path, name: file.name, size: file.size, type: file.type };
      });
    });
  }

  els.fileBtn.addEventListener('click', function () { els.file.click(); });
  els.file.addEventListener('change', function () {
    var list = Array.prototype.slice.call(els.file.files || []);
    els.file.value = '';
    if (!list.length) return;
    if (state.pending.length + list.length > MAX_FILES) {
      note('Не больше шести файлов за раз', true); return;
    }
    var take = list.filter(function (f) {
      if (f.size > MAX_FILE_BYTES) { note('Файл ' + f.name + ' больше 25 МБ', true); return false; }
      return true;
    });
    if (!take.length) return;

    // Показываем ход загрузки: на телефоне большой файл идёт минуту,
    // и без этого кажется, что чат завис.
    var total = take.reduce(function (s, f) { return s + f.size; }, 0);
    var sent = take.map(function () { return 0; });
    function showProgress() {
      var done = sent.reduce(function (a, b) { return a + b; }, 0);
      var pct = total ? Math.min(100, Math.round(done / total * 100)) : 100;
      noteSticky(pct < 100 ? 'Отправляю файлы, ' + pct + '%. Не закрывайте окно' : 'Файлы отправлены');
    }
    showProgress();

    var jobs = take.map(function (f, i) {
      return uploadOne(f, function (bytes) { sent[i] = bytes; showProgress(); });
    });
    Promise.all(jobs).then(function (done) {
      done.filter(Boolean).forEach(function (f) { state.pending.push(f); });
      drawChips();
      if (state.pending.length) note('');
    });
  });

  /* ---------------- смайлики ---------------- */
  var EMOJI = ['🙂','😀','😅','😉','👍','🙏','🤝','👋','💪','🔥',
               '🚗','🚙','🛻','🔧','🔩','🛠️','⚙️','🔋','⛽','🛞',
               '🧰','📅','🕐','📞','💬','📷','📎','📍','✅','❗',
               '❓','🤔','😐','😕','😢','😡','💰','⚡','🚨','👌'];
  (function buildEmoji() {
    EMOJI.forEach(function (e) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = e;
      b.setAttribute('aria-label', 'Смайлик ' + e);
      b.addEventListener('click', function () {
        var i = els.input.selectionStart != null ? els.input.selectionStart : els.input.value.length;
        els.input.value = els.input.value.slice(0, i) + e + els.input.value.slice(i);
        els.input.focus();
        els.input.selectionStart = els.input.selectionEnd = i + e.length;
        grow();
        els.emoji.hidden = true;                       // палитра закрывается после выбора
        els.emojiBtn.setAttribute('aria-expanded', 'false');
      });
      els.emoji.appendChild(b);
    });
  })();
  els.emojiBtn.addEventListener('click', function () {
    var show = els.emoji.hidden;
    els.emoji.hidden = !show;
    els.emojiBtn.setAttribute('aria-expanded', show ? 'true' : 'false');
  });
  document.addEventListener('click', function (e) {
    if (els.emoji.hidden) return;
    if (els.emoji.contains(e.target) || els.emojiBtn.contains(e.target)) return;
    els.emoji.hidden = true;
    els.emojiBtn.setAttribute('aria-expanded', 'false');
  });

  /* ---------------- отправка ---------------- */
  function grow() {
    els.input.style.height = 'auto';
    els.input.style.height = Math.min(120, els.input.scrollHeight) + 'px';
  }
  els.input.addEventListener('input', grow);
  els.input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
  });
  els.form.addEventListener('submit', function (e) { e.preventDefault(); submit(); });

  function submit() {
    if (state.busy) return;
    var text = els.input.value.trim();
    var files = state.pending.slice();
    if (!text && !files.length) return;

    state.busy = true;
    els.send.disabled = true;
    ensureChat().then(function (ok) {
      // Диалог не открылся, причину уже написали в подписи под полем.
      // Помечаем ошибку, чтобы общий обработчик её не затёр.
      if (!ok) { var stop = new Error('нет диалога'); stop.quiet = true; throw stop; }
      return api('send', {
        chatId: state.id, secret: state.secret,
        body: text, files: files,
        contact: els.contactInput ? els.contactInput.value : ''
      });
    }).then(function (r) {
      if (!r.ok) { note(r.error || 'Не отправилось', true); return; }
      els.input.value = '';
      grow();
      state.pending = [];
      drawChips();
      els.contact.hidden = true;
      note('');
      return poll(true).then(scrollDown);
    }).catch(function (e) {
      if (!(e && e.quiet)) note('Нет связи, попробуйте ещё раз', true);
    }).then(function () {
      state.busy = false;
      els.send.disabled = false;
    });
  }

  /* ---------------- запуск ---------------- */
  if (state.id && state.secret) {
    els.contact.hidden = true;
    poll(false);
    startTimer();
  }
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && state.id) poll(state.open);
  });
})();
