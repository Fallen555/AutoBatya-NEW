/* АвтоБатя. Покадровый герой на канвасе, появления, свет в боксе. Ванильный JS, без библиотек. */
(function () {
  'use strict';

  var FRAME_COUNT = 246;                 // 192 кадра ролика плюс 54 дорисованных
                                         // на быстрых участках, где их не хватало
  var FRAME_DIR = 'assets/frames/';
  var POSTER_URL = 'assets/hero-poster.jpg';

  var stage = document.getElementById('stage');
  var heroSec = document.getElementById('hero-sec');
  var canvas = document.getElementById('hero');
  var ctx = canvas ? canvas.getContext('2d', { alpha: false }) : null;
  var poster = document.getElementById('poster');
  var ring = document.getElementById('ring');
  var hint = document.getElementById('hint');
  var dust = document.getElementById('dust');
  var nav = document.getElementById('nav');

  var clamp = function (v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); };
  var smoothstep = function (p, e0, e1) {
    var t = clamp((p - e0) / (e1 - e0), 0, 1);
    return t * t * (3 - 2 * t);
  };
  function rng(seed) {
    var s = seed >>> 0;
    return function () { return (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; };
  }
  var reduceQuery = matchMedia('(prefers-reduced-motion: reduce)');
  var connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  var resumeFrames = function () {};
  var denseRequested = false;
  function motionReduced() { return reduceQuery.matches; }
  // В контактах уже есть MAX: плавающая ссылка не должна закрывать карту.
  var contactSection = document.getElementById('contacts');
  var floatingMax = document.querySelector('.maxbtn');
  if (contactSection && floatingMax && 'IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      floatingMax.hidden = entries[0].isIntersecting;
    }).observe(contactSection);
  }
  function saveTraffic() { return !!(connection && (connection.saveData || /^(slow-)?2g$/.test(connection.effectiveType || ''))); }
  function syncMotionPreference() {
    document.documentElement.classList.toggle('effects-off', motionReduced());
  }

  /* ----------------------------------------------------------
     1. Разбор заголовков на слова и буквы
     ---------------------------------------------------------- */
  var rand = rng(20250819);

  function makeWordContent(word, accent) {
    var frag = document.createDocumentFragment();
    var at = accent ? word.indexOf(accent) : -1;
    if (at < 0) {
      frag.appendChild(document.createTextNode(word));
      return frag;
    }
    if (at > 0) frag.appendChild(document.createTextNode(word.slice(0, at)));
    var em = document.createElement('span');
    em.className = 'hl';
    em.textContent = accent;
    frag.appendChild(em);
    var tail = word.slice(at + accent.length);
    if (tail) frag.appendChild(document.createTextNode(tail));
    return frag;
  }

  function buildVisual(text, entrance, spread, accent) {
    var vis = document.createElement('span');
    vis.className = 'vis';
    vis.setAttribute('aria-hidden', 'true');
    var words = text.split(' ');
    var perChar = entrance === 'grid';
    var totalChars = text.replace(/ /g, '').length;
    var charSeen = 0;

    for (var i = 0; i < words.length; i++) {
      var w = document.createElement('span');
      w.className = 'w';
      if (!perChar) {
        w.style.setProperty('--th', ((i / Math.max(1, words.length)) * (entrance === 'depth' ? 0.34 : 0.42)).toFixed(3));
        w.appendChild(makeWordContent(words[i], accent));
        if (i < words.length - 1) w.appendChild(document.createTextNode(' '));
      } else {
        var letters = words[i].split('');
        for (var j = 0; j < letters.length; j++) {
          var c = document.createElement('span');
          c.className = 'c';
          c.textContent = letters[j];
          var th = (charSeen / Math.max(1, totalChars)) * spread + rand() * 0.06;
          c.style.setProperty('--th', th.toFixed(3));
          c.style.setProperty('--jx', (24 + rand() * 34).toFixed(1) + 'px');
          w.appendChild(c);
          charSeen++;
        }
        if (i < words.length - 1) {
          var sp = document.createElement('span');
          sp.className = 'c';
          sp.textContent = ' ';
          w.appendChild(sp);
        }
      }
      vis.appendChild(w);
    }
    return vis;
  }

  function splitInto(el, entrance, spread) {
    var text = el.textContent.trim();
    var accent = el.getAttribute('data-accent') || '';
    el.textContent = '';
    var sr = document.createElement('span');
    sr.className = 'sr-only';
    sr.textContent = text;
    el.appendChild(sr);

    if (entrance === 'blur') {
      var soft = buildVisual(text, entrance, spread, accent);
      soft.classList.add('vis--soft');
      var sharp = buildVisual(text, entrance, spread, accent);
      sharp.classList.add('vis--sharp');
      var holder = document.createElement('span');
      holder.className = 'vis';
      holder.setAttribute('aria-hidden', 'true');
      holder.appendChild(soft);
      holder.appendChild(sharp);
      el.appendChild(holder);
    } else {
      el.appendChild(buildVisual(text, entrance, spread, accent));
    }
  }

  /* ----------------------------------------------------------
     2. Полосы текста
     ---------------------------------------------------------- */
  var bands = [];
  (function setupBands() {
    var nodes = document.querySelectorAll('.band');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var parts = (el.getAttribute('data-band') || '0,1').split(',');
      var a = parseFloat(parts[0]);
      var b = parseFloat(parts[1]);
      var entrance = el.getAttribute('data-entrance') || 'rise';
      var spread = parseFloat(el.getAttribute('data-spread') || '0.45');
      var ramp = parseFloat(el.getAttribute('data-ramp') || '0') || Math.min(0.025, (b - a) * 0.35);
      var title = el.querySelector('.split');
      if (title) splitInto(title, entrance, spread);
      el.setAttribute('inert', '');
      el.setAttribute('aria-hidden', 'true');
      bands.push({
        el: el, a: a, b: b, ramp: ramp,
        first: i === 0, last: i === nodes.length - 1,
        op: -1, k: -1, live: false
      });
    }
  })();

  var loadK = 0;
  var loadStart = 0;

  function updateCaptions(p) {
    for (var i = 0; i < bands.length; i++) {
      var bd = bands[i];
      var f = Math.min(0.02, (bd.b - bd.a) / 3);
      var inEase = bd.first ? 1 : smoothstep(p, bd.a, bd.a + f);
      var outEase = bd.last ? 1 : (1 - smoothstep(p, bd.b - f, bd.b));
      var op = inEase * outEase;
      var k = clamp((p - bd.a) / bd.ramp, 0, 1);
      if (bd.first) k = Math.max(k, loadK);

      if (Math.abs(op - bd.op) > 0.004) {
        bd.op = op;
        bd.el.style.opacity = op.toFixed(3);
        var live = op > 0.55;
        if (live !== bd.live) {
          bd.live = live;
          bd.el.classList.toggle('live', live);
          bd.el.toggleAttribute('inert', !live);
          bd.el.setAttribute('aria-hidden', live ? 'false' : 'true');
        }
      }
      if (Math.abs(k - bd.k) > 0.008) {
        bd.k = k;
        bd.el.style.setProperty('--k', k.toFixed(3));
      }
    }
  }

  /* ----------------------------------------------------------
     3. Кадры: хранилище и отрисовка
     ---------------------------------------------------------- */
  var frames = new Array(FRAME_COUNT);
  var loadedCount = 0;
  var drawnKey = -1;
  var canvasW = 0, canvasH = 0;
  var heroReady = false;

  function frameUrl(i) {
    var s = '' + i;
    while (s.length < 3) s = '0' + s;
    return FRAME_DIR + 'f-' + s + '.webp';
  }

  function sizeCanvas() {
    if (!canvas) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    var w = Math.round(stage.clientWidth * dpr);
    var h = Math.round(stage.clientHeight * dpr);
    if (!w || !h || (w === canvasW && h === canvasH)) return;
    canvasW = canvas.width = w;
    canvasH = canvas.height = h;
    drawnKey = -1;
  }

  function paintImage(img, alpha) {
    var iw = img.naturalWidth, ih = img.naturalHeight;
    var s = Math.max(canvasW / iw, canvasH / ih);
    var dw = iw * s, dh = ih * s;
    if (alpha < 1) ctx.globalAlpha = alpha;
    ctx.drawImage(img, (canvasW - dw) / 2, (canvasH - dh) / 2, dw, dh);
    if (alpha < 1) ctx.globalAlpha = 1;
  }

  function loadedAtOrBelow(i) {
    for (var d = 0; i - d >= 0; d++) if (frames[i - d]) return i - d;
    return -1;
  }
  function loadedAtOrAbove(i) {
    for (var d = 0; i + d < FRAME_COUNT; d++) if (frames[i + d]) return i + d;
    return -1;
  }

  // Кадров всего 192 на весь ход прокрутки, то есть один кадр держится
  // два-три десятка пикселей. Чтобы машина не замирала между ними, поверх
  // нижнего кадра подмешиваем верхний, а долю берём из положения между ними.
  // Пока кадры ещё догружаются, соседа может не быть: тогда смешиваем через
  // разрыв, но не длиннее четырёх кадров, иначе выйдет каша вместо движения.
  var MAX_BLEND_GAP = 4;

  // Насколько широко смешивать соседние кадры: 9 — плавный перелив на весь
  // промежуток, 1 — короткий переход у самой середины. Посчитано по реальной
  // разнице соседних кадров: где она мала, перелив ничего не портит, где
  // велика, полупрозрачное наложение читается как двоение.
  var BLEND_W =
    '9999999999888888888877777666655554567777531111013310000000000122' +
    '3456778999999999999999999999999999999999999999999999988877766655' +
    '3201221000000000000011000000000000000000111222334445566777888876' +
    '455556666677777777777888888888889999999999999999999999';

  function blendWidth(i) {
    var c = BLEND_W.charCodeAt(i);
    return (c >= 48 && c <= 57) ? (c - 48) / 9 : 1;
  }

  function drawFrame(p) {
    if (!ctx || !canvasW) return;
    var t = clamp(p, 0, 1) * (FRAME_COUNT - 1);
    var lo = loadedAtOrBelow(Math.floor(t));
    var hi = loadedAtOrAbove(Math.ceil(t));
    if (lo < 0 && hi < 0) return;
    if (lo < 0) lo = hi;
    if (hi < 0) hi = lo;

    var frac = 0;
    if (hi > lo) {
      if (hi - lo > MAX_BLEND_GAP) {
        // разрыв слишком велик: показываем тот кадр, что ближе
        if (t - lo <= hi - t) hi = lo; else lo = hi;
      } else {
        // Ширина перелива зависит от того, насколько быстро идёт камера.
        // На спокойном участке переливаем весь промежуток, на быстром
        // сжимаем переход к середине, чтобы два далёких кадра не двоились.
        var w = Math.max(blendWidth(lo), 0.01);
        var edge = 0.5 * (1 - w);
        frac = smoothstep(clamp((t - lo) / (hi - lo), 0, 1), edge, 1 - edge);
      }
    }

    var key = lo * 1e6 + hi * 1e3 + Math.round(frac * 100);
    if (key === drawnKey) return;
    drawnKey = key;

    paintImage(frames[lo], 1);
    if (hi !== lo && frac > 0.004) paintImage(frames[hi], frac);
  }

  /* ----------------------------------------------------------
     4. Ход прокрутки героя
     ---------------------------------------------------------- */
  var target = 0, shown = 0, rafId = null, lastTick = 0;
  var heroOnScreen = true;
  var lastSp = -1, lastHint = -1;

  function heroProgress() {
    if (!heroSec.offsetHeight) return 0;
    var r = heroSec.getBoundingClientRect();
    var range = heroSec.offsetHeight - window.innerHeight;
    if (range <= 0) return 0;
    return clamp(-r.top / range, 0, 1);
  }

  function paintProgress(p) {
    if (Math.abs(p - lastSp) > 0.002) {
      lastSp = p;
      stage.style.setProperty('--sp', p.toFixed(3));
    }
    var h = p > 0.02 ? 0 : 1;
    if (h !== lastHint) {
      lastHint = h;
      if (hint) hint.style.setProperty('--hintO', h);
    }
  }

  function tick(now) {
    var dt = Math.min(100, now - (lastTick || now));
    lastTick = now;
    var k = 0.19;
    shown += (target - shown) * (1 - Math.pow(1 - k, dt / 16.667));

    if (loadK < 1 && loadStart) {
      loadK = clamp((now - loadStart) / 1100, 0, 1);
      loadK = loadK * loadK * (3 - 2 * loadK);
    }

    var converged = Math.abs(target - shown) < 0.0004 && loadK >= 1;
    if (converged) {
      shown = target;
      rafId = null;
      lastTick = 0;
    } else {
      rafId = requestAnimationFrame(tick);
    }
    drawFrame(shown);
    updateCaptions(shown);
    paintProgress(shown);
  }

  function kick() {
    if (rafId === null && heroOnScreen && scrubOn) {
      lastTick = 0;
      rafId = requestAnimationFrame(tick);
    }
  }

  function onHeroScroll() {
    target = heroProgress();
    if (target > 0.002 && target < 0.995) denseRequested = true;
    resumeFrames();
    kick();
  }

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      heroOnScreen = entries[0].isIntersecting;
      if (heroOnScreen) { resumeFrames(); kick(); }
    }, { rootMargin: '10px' }).observe(heroSec);
  }

  /* ----------------------------------------------------------
     5. Загрузка кадров: сначала редкая сетка, потом всё остальное
     ---------------------------------------------------------- */
  var heroInited = false;
  var fetchStarted = false;

  function makeScrollChevron() {
    var s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('class', 'chev');
    s.setAttribute('aria-hidden', 'true');
    var p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', 'M5 9l7 7 7-7');
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', 'currentColor');
    p.setAttribute('stroke-width', '2');
    s.appendChild(p);
    return s;
  }

  function failVideo() {
    if (ring && ring.parentNode) ring.replaceWith(makeScrollChevron());
    disableScrub();
    stage.classList.add('video-failed');
  }

  function frameOrder() {
    var order = [], seen = {}, strides = [16, 8, 4, 2, 1], k, i;
    for (k = 0; k < strides.length; k++) {
      for (i = 0; i < FRAME_COUNT; i += strides[k]) {
        if (!seen[i]) { seen[i] = 1; order.push(i); }
      }
    }
    if (!seen[FRAME_COUNT - 1]) order.push(FRAME_COUNT - 1);
    return order;
  }

  function startFrames() {
    if (fetchStarted) return;
    fetchStarted = true;

    var order = frameOrder();
    var firstPass = Math.ceil(FRAME_COUNT / 16);
    var ptr = 0, active = 0, okCount = 0;
    var failed = false;

    function done(idx, ok) {
      loadedCount++;
      active--;
      if (failed) return;
      if (ok) {
        okCount++;
        if (ring) ring.style.setProperty('--ld', Math.round(126 * (1 - okCount / FRAME_COUNT)));
        if (!heroReady && okCount >= firstPass) {
          heroReady = true;
          sizeCanvas();
          stage.classList.add('video-ready');
        }
        if (heroReady) drawFrame(shown);
      }
      if (ptr >= order.length && active === 0 && okCount === 0) failVideo();
      pump();
    }

    function pump() {
      if (failed || !scrubOn || document.hidden || !heroOnScreen) return;
      var limit = denseRequested ? order.length : firstPass;
      while (active < 4 && ptr < limit) {
        (function (idx) {
          active++;
          var img = new Image();
          img.decoding = 'async';
          img.onload = function () { frames[idx] = img; done(idx, true); };
          img.onerror = function () { done(idx, false); };
          img.src = frameUrl(idx);
        })(order[ptr++]);
      }
    }

    resumeFrames = pump;
    pump();
    setTimeout(function () {
      if (!heroReady) { failed = true; failVideo(); }
    }, 20000);
  }

  function initHeroOnce() {
    if (heroInited) return;
    heroInited = true;
    sizeCanvas();
    poster.style.backgroundImage = "url('" + POSTER_URL + "')";
    var img = new Image();
    img.onload = startFrames;
    img.onerror = startFrames;
    img.src = POSTER_URL;
    setTimeout(startFrames, 3000);

    loadStart = performance.now();
    buildDust();
  }

  function buildDust() {
    if (!dust || dust.childNodes.length) return;
    if (matchMedia('(pointer: coarse)').matches) return;
    var r = rng(4242);
    for (var i = 0; i < 16; i++) {
      var d = document.createElement('i');
      d.style.left = (r() * 100).toFixed(1) + '%';
      d.style.top = (40 + r() * 60).toFixed(1) + '%';
      d.style.animationDuration = (16 + r() * 16).toFixed(1) + 's';
      d.style.animationDelay = (-r() * 26).toFixed(1) + 's';
      d.style.opacity = (0.25 + r() * 0.5).toFixed(2);
      dust.appendChild(d);
    }
  }

  /* ----------------------------------------------------------
     6. Пять условий статичного героя, живыми слушателями
     ---------------------------------------------------------- */
  var GATES = [
    '(max-width: 720px)',
    '(orientation: portrait) and (max-width: 1024px)',
    '(orientation: portrait) and (pointer: coarse)',
    '(orientation: landscape) and (pointer: coarse) and (max-height: 560px)',
    '(prefers-reduced-motion: reduce)'
  ];
  var MQLS = GATES.map(function (q) { return matchMedia(q); });
  var scrubOn = false;

  function enableScrub() {
    if (scrubOn) return;
    if (!ctx || stage.classList.contains('video-failed')) return;
    document.documentElement.classList.add('scrub-enabled');
    scrubOn = true;
    initHeroOnce();
    window.addEventListener('scroll', onHeroScroll, { passive: true });
    for (var i = 0; i < bands.length; i++) { bands[i].op = -1; bands[i].k = -1; }
    unpinFinalStates();
    target = heroProgress();
    shown = target;
    sizeCanvas();
    drawFrame(shown);
    updateCaptions(target);
    paintProgress(target);
    onHeroScroll();
  }

  function disableScrub() {
    document.documentElement.classList.remove('scrub-enabled');
    if (!scrubOn) return;
    scrubOn = false;
    window.removeEventListener('scroll', onHeroScroll);
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
  }

  function applyHeroMode() {
    var gated = motionReduced() || saveTraffic() || !ctx || MQLS.some(function (m) { return m.matches; });
    if (gated) disableScrub(); else enableScrub();
  }
  MQLS.forEach(function (m) {
    if (m.addEventListener) m.addEventListener('change', applyHeroMode);
    else m.addListener(applyHeroMode);
  });

  /* ----------------------------------------------------------
     7. Появление секций, провод, шапка
     ---------------------------------------------------------- */
  var reveals = [].slice.call(document.querySelectorAll('.reveal'));
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        var el = e.target;
        el.classList.add('in');
        setTimeout(function () { el.classList.add('done'); }, 1400);
        io.unobserve(el);
      });
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0.15 });
    reveals.forEach(function (el) { io.observe(el); });

    var svcs = [].slice.call(document.querySelectorAll('.svc'));
    var io2 = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        e.target.classList.add('in');
        io2.unobserve(e.target);
      });
    }, { rootMargin: '0px 0px -18% 0px', threshold: 0.2 });
    svcs.forEach(function (el) { io2.observe(el); });

    var flickers = [].slice.call(document.querySelectorAll('.tube, .lamp'));
    var io3 = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { e.target.classList.toggle('off', !e.isIntersecting); });
    }, { rootMargin: '60px' });
    flickers.forEach(function (el) { io3.observe(el); });
  } else {
    reveals.forEach(function (el) { el.classList.add('in', 'done'); });
    [].slice.call(document.querySelectorAll('.svc')).forEach(function (el) { el.classList.add('in'); });
  }

  var wireSvg = document.querySelector('.wire svg');
  var stepsBox = document.querySelector('.steps');
  var lastDraw = -1;
  if (wireSvg) wireSvg.style.setProperty('--len', 420);

  var lastNavSolid = null;
  function onPageScroll() {
    var solid = window.scrollY > 40;
    if (solid !== lastNavSolid) {
      lastNavSolid = solid;
      nav.classList.toggle('solid', solid);
    }
    if (!pinned) driveScrollScenes();
    updateSparks();
    if (wireSvg && stepsBox && !pinned) {
      var r = stepsBox.getBoundingClientRect();
      var d = clamp((window.innerHeight * 0.72 - r.top) / Math.max(1, r.height * 0.86), 0, 1);
      if (Math.abs(d - lastDraw) > 0.01) {
        lastDraw = d;
        wireSvg.style.setProperty('--draw', d.toFixed(3));
      }
    }
  }
  window.addEventListener('scroll', onPageScroll, { passive: true });
  window.addEventListener('resize', function () {
    lastDraw = -1;
    onPageScroll();
    if (scrubOn) {
      sizeCanvas();
      drawFrame(shown);
      onHeroScroll();
    }
  }, { passive: true });

  /* ----------------------------------------------------------
     8. Свет в боксе и прейскурант: всё едет за прокруткой
     ---------------------------------------------------------- */
  var lightSec = document.getElementById('light');
  var priceList = document.getElementById('price-list');
  var lit = -1;
  var neonOn = false;

  var checkItems = [].slice.call(document.querySelectorAll('.checks li')).map(function (el) {
    return { el: el, d: parseFloat(el.style.getPropertyValue('--d') || '0'), on: false };
  });
  var priceItems = [].slice.call(document.querySelectorAll('.price')).map(function (el) {
    return { el: el, d: parseFloat(el.style.getPropertyValue('--d') || '0'), on: false };
  });

  // доля пройденного пути секции: 0, когда её верх на startF экрана, 1, когда дошёл до endF
  function sectionProgress(el, startF, endF) {
    var r = el.getBoundingClientRect();
    var h = window.innerHeight;
    var start = h * startF, finish = h * endF;
    return clamp((start - r.top) / (start - finish), 0, 1);
  }

  // длинный список зажигается построчно: строка загорается, когда пересекает линию на экране
  function markByLine(items, lineFrac) {
    var line = window.innerHeight * lineFrac;
    var i, want = [];
    for (i = 0; i < items.length; i++) want.push(items[i].el.getBoundingClientRect().top < line);
    for (i = 0; i < items.length; i++) {
      if (want[i] !== items[i].on) {
        items[i].on = want[i];
        items[i].el.classList.toggle('on', want[i]);
      }
    }
  }

  // Вывеска зажигается один раз с дрожью, при обратной прокрутке взводится заново.
  // Метку вешаем на всю секцию: по ней идут и трубки, и зарево на стене.
  function setLit(p) {
    if (lightSec) {
      if (!neonOn && p > 0.1) { neonOn = true; lightSec.classList.add('ignite'); }
      else if (neonOn && p < 0.02) { neonOn = false; lightSec.classList.remove('ignite'); }
    }
    if (Math.abs(p - lit) < 0.006) return;
    lit = p;
    if (lightSec) lightSec.style.setProperty('--lit', p.toFixed(3));
  }

  function driveScrollScenes() {
    if (lightSec) setLit(smoothstep(sectionProgress(lightSec, 0.86, 0.34), 0, 1));
    if (checkItems.length) markByLine(checkItems, 0.86);
    if (priceList) markByLine(priceItems, 0.82);
  }

  /* ----------------------------------------------------------
     8б. Сварка по краям страницы

     Сварка — это не фейерверк. Дуга держится на шве секунду с небольшим
     и ползёт вдоль него, а раскалённые капли всё это время летят ВБОК:
     веером вокруг горизонтали, с малым уклоном вниз. Вверх не уходит
     почти ничего — фонтан вверх выдаёт бенгальский огонь, а не металл.
     Капля, чиркнув по металлу, отскакивает и катится дальше вбок; по
     дороге часть капель лопается на мелкие — это характерный треск.
     ---------------------------------------------------------- */
  var sparkWraps = [].slice.call(document.querySelectorAll('.sparks'));
  var sparkCtx = [];
  var sparkSize = [];
  var parts = [];
  var flashes = [];
  var arcs = [null, null];     // дуга на каждой стороне, null — сейчас не варит
  var nextPass = [0, 0];       // когда начнётся следующий проход по шву
  var MAX_PARTS = 320;         // потолок, чтобы длинный проход не завалил кадр
  var sparksOn = false;
  var sparkRaf = null;
  var sparkLast = 0;
  var srand = rng(90210);
  var servicesSec = document.getElementById('services');

  function sparksAllowed() {
    return sparkWraps.length > 0 &&
      !motionReduced() &&
      !matchMedia('(max-width: 1200px)').matches &&
      !document.hidden;
  }

  function sizeSparks() {
    for (var i = 0; i < sparkWraps.length; i++) {
      var c = sparkCtx[i] && sparkCtx[i].canvas;
      if (!c) continue;
      var w = Math.max(1, Math.round(sparkWraps[i].clientWidth));
      var h = Math.max(1, Math.round(window.innerHeight));
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
      sparkSize[i] = { w: w, h: h };
    }
  }

  function initSparks() {
    if (sparkCtx.length || !sparkWraps.length) return;
    for (var i = 0; i < sparkWraps.length; i++) {
      var c = document.createElement('canvas');
      sparkWraps[i].appendChild(c);
      sparkCtx.push(c.getContext('2d'));
    }
    sizeSparks();
    window.addEventListener('resize', sizeSparks, { passive: true });
  }

  // Проход по шву: дуга загорается в точке и ползёт вниз вдоль стыка.
  // Ставим её ближе к внешнему краю полосы — тогда каплям есть куда лететь.
  function startPass(side, now) {
    var sz = sparkSize[side];
    if (!sz) return;
    var inward = side === 0 ? 1 : -1;
    var x = side === 0 ? sz.w * (0.13 + srand() * 0.15) : sz.w * (0.72 + srand() * 0.15);
    var y = sz.h * (0.16 + srand() * 0.56);
    arcs[side] = {
      x: x, y: y, inward: inward,
      until: now + 800 + srand() * 1200,   // длина шва
      next: 0,
      drift: 12 + srand() * 26             // электрод идёт по стыку
    };
    nextPass[side] = arcs[side].until + 2400 + srand() * 4400;
    flashes.push({ side: side, x: x, y: y, life: 1, r: 30 + srand() * 22 });
  }

  // выброс капель из дуги: веер вокруг горизонтали
  function spit(side, arc) {
    var n = 3 + Math.round(srand() * 5);
    for (var i = 0; i < n; i++) {
      if (parts.length >= MAX_PARTS) return;
      // ±35 градусов от горизонта плюс небольшой уклон вниз
      var a = (srand() - 0.5) * 1.22 + 0.13;
      // большая часть летит вглубь полосы, меньшая — за край экрана
      var dir = srand() < 0.76 ? arc.inward : -arc.inward;
      var sp = 300 + srand() * 520;
      parts.push({
        side: side, x: arc.x, y: arc.y, px: arc.x, py: arc.y,
        vx: dir * Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        floor: arc.y + 4 + srand() * 12,                 // плоскость металла под дугой
        bounce: srand() < 0.72 ? 2 : 0,
        pop: srand() < 0.3 ? 0.34 + srand() * 0.26 : 0,  // на какой доле жизни лопнет
        life: 1, decay: 1.5 + srand() * 1.5,
        size: 0.8 + srand() * 1.1,
        hot: srand() < 0.45
      });
    }
  }

  // капля лопнула: мелкие осколки во все стороны, живут совсем недолго
  function popInto(p) {
    var n = 2 + Math.round(srand() * 2);
    for (var i = 0; i < n; i++) {
      if (parts.length >= MAX_PARTS) return;
      var a = srand() * 6.2832;
      var sp = 40 + srand() * 130;
      parts.push({
        side: p.side, x: p.x, y: p.y, px: p.x, py: p.y,
        vx: p.vx * 0.32 + Math.cos(a) * sp,
        vy: p.vy * 0.32 + Math.sin(a) * sp,
        floor: p.floor, bounce: 0, pop: 0,
        life: p.life * 0.75, decay: 3.4 + srand() * 2.2,
        size: 0.55 + srand() * 0.6, hot: false
      });
    }
  }

  function sparkTick(now) {
    var dt = Math.min(0.05, (now - (sparkLast || now)) / 1000);
    sparkLast = now;

    for (var side = 0; side < sparkCtx.length; side++) {
      var sz = sparkSize[side];
      var g = sparkCtx[side];
      if (!g || !sz) continue;
      g.clearRect(0, 0, sz.w, sz.h);
      g.globalCompositeOperation = 'lighter';

      var arc = arcs[side];
      if (arc && now > arc.until) { arcs[side] = null; arc = null; }
      if (!arc && now > nextPass[side]) { startPass(side, now); arc = arcs[side]; }
      if (arc) {
        arc.y += arc.drift * dt;                       // электрод ведут по шву
        if (arc.y > sz.h * 0.88) arc.y = sz.h * 0.88;
        if (now > arc.next) {                          // капли отрываются часто
          spit(side, arc);
          arc.next = now + 34 + srand() * 66;
        }
      }
    }

    // Сама дуга. Она бело-голубая: это свет плазмы, а не пламя. Тёплый
    // ореол вокруг — уже раскалённый металл, он и красит всё оранжевым.
    for (var s2 = 0; s2 < arcs.length; s2++) {
      var ac = arcs[s2];
      var ga = sparkCtx[s2];
      if (!ac || !ga) continue;
      var fk = 0.55 + srand() * 0.45;                  // дуга дрожит, а не горит ровно
      var rr2 = 30 + srand() * 12;
      var gr2 = ga.createRadialGradient(ac.x, ac.y, 0, ac.x, ac.y, rr2 * 2.4);
      gr2.addColorStop(0, 'rgba(228,242,255,' + (0.92 * fk).toFixed(3) + ')');
      gr2.addColorStop(0.16, 'rgba(176,212,255,' + (0.44 * fk).toFixed(3) + ')');
      gr2.addColorStop(0.42, 'rgba(255,186,104,' + (0.2 * fk).toFixed(3) + ')');
      gr2.addColorStop(1, 'rgba(255,116,36,0)');
      ga.fillStyle = gr2;
      ga.beginPath();
      ga.arc(ac.x, ac.y, rr2 * 2.4, 0, 6.2832);
      ga.fill();
      ga.fillStyle = 'rgba(244,250,255,' + (0.9 * fk).toFixed(3) + ')';
      ga.beginPath();
      ga.arc(ac.x, ac.y, 1.5 + srand() * 1.5, 0, 6.2832);
      ga.fill();
    }

    // вспышка в момент розжига
    for (var f = flashes.length - 1; f >= 0; f--) {
      var fl = flashes[f];
      fl.life -= dt * 3.4;
      if (fl.life <= 0) { flashes.splice(f, 1); continue; }
      var gf = sparkCtx[fl.side];
      if (!gf) continue;
      var rr = fl.r * (1.5 - fl.life * 0.5);
      var grd = gf.createRadialGradient(fl.x, fl.y, 0, fl.x, fl.y, rr);
      var a = fl.life * fl.life;
      grd.addColorStop(0, 'rgba(255,246,225,' + (0.9 * a).toFixed(3) + ')');
      grd.addColorStop(0.35, 'rgba(255,190,110,' + (0.45 * a).toFixed(3) + ')');
      grd.addColorStop(1, 'rgba(255,120,40,0)');
      gf.fillStyle = grd;
      gf.beginPath();
      gf.arc(fl.x, fl.y, rr, 0, 6.2832);
      gf.fill();
    }

    // искры
    for (var i = parts.length - 1; i >= 0; i--) {
      var p = parts[i];
      p.life -= dt * p.decay;
      if (p.life <= 0) { parts.splice(i, 1); continue; }
      p.px = p.x; p.py = p.y;
      // Тяжесть умеренная: капля мелкая и очень быстрая, за свою короткую
      // жизнь она успевает лишь слегка провиснуть — траектория читается
      // как штрих вбок, а не как навесная дуга.
      p.vy += 520 * dt;
      p.vx *= (1 - 2.1 * dt);        // воздух гасит в основном горизонталь
      p.vy *= (1 - 1.1 * dt);
      p.x += p.vx * dt;
      p.y += p.vy * dt;

      // Чиркнула по металлу — отскочила и покатилась дальше вбок.
      if (p.bounce > 0 && p.vy > 0 && p.y >= p.floor && p.py < p.floor) {
        p.y = p.floor;
        p.vy = -p.vy * (0.2 + srand() * 0.22);
        p.vx *= 0.78;
        p.bounce--;
      }
      // Треск: капля лопается на несколько мелких.
      if (p.pop && p.life < p.pop) { popInto(p); p.pop = 0; }

      var szp = sparkSize[p.side];
      var gp = sparkCtx[p.side];
      if (!gp || !szp) continue;
      if (p.y > szp.h + 30 || p.x < -40 || p.x > szp.w + 40) { parts.splice(i, 1); continue; }

      var t = p.life;
      var flick = 0.55 + srand() * 0.45;                 // искра дрожит
      var alpha = Math.min(1, t * 1.4) * flick;
      var r = 255;
      var gc = Math.round(120 + 135 * t);
      var b = Math.round(30 + 120 * t * t);
      gp.strokeStyle = 'rgba(' + r + ',' + gc + ',' + b + ',' + alpha.toFixed(3) + ')';
      gp.lineWidth = p.size * (p.hot ? 1.5 : 1);
      gp.lineCap = 'round';
      gp.beginPath();
      gp.moveTo(p.x - p.vx * 0.028, p.y - p.vy * 0.028); // хвост по направлению полёта
      gp.lineTo(p.x, p.y);
      gp.stroke();
      if (p.hot) {
        gp.fillStyle = 'rgba(255,240,210,' + (alpha * 0.8).toFixed(3) + ')';
        gp.beginPath();
        gp.arc(p.x, p.y, p.size * 0.9, 0, 6.2832);
        gp.fill();
      }
    }

    if (sparksOn) sparkRaf = requestAnimationFrame(sparkTick);
    else stopSparks();
  }

  function stopSparks() {
    if (sparkRaf !== null) { cancelAnimationFrame(sparkRaf); sparkRaf = null; }
    parts.length = 0;
    flashes.length = 0;
    arcs[0] = arcs[1] = null;
    sparkLast = 0;
    for (var i = 0; i < sparkCtx.length; i++) {
      var sz = sparkSize[i];
      if (sz) sparkCtx[i].clearRect(0, 0, sz.w, sz.h);
    }
  }

  // сварка включается только после того, как машина прокручена, на блоке услуг
  function updateSparks() {
    var want = false;
    if (sparksAllowed() && servicesSec) {
      want = servicesSec.getBoundingClientRect().top < window.innerHeight * 0.85;
    }
    if (want === sparksOn) return;
    sparksOn = want;
    sparkWraps.forEach(function (w) { w.classList.toggle('live', want); });
    if (want) {
      initSparks();
      sizeSparks();
      var t = performance.now();
      nextPass[0] = t + 300;
      nextPass[1] = t + 1900;   // стороны варят вразнобой, а не хором
      sparkLast = 0;
      if (sparkRaf === null) sparkRaf = requestAnimationFrame(sparkTick);
    } else {
      stopSparks();
    }
  }

  /* ----------------------------------------------------------
     8в. Мини-карта: наклон за мышкой и разворот по клику
     ---------------------------------------------------------- */


  /* ----------------------------------------------------------
     9. Меньше движения, в обе стороны
     ---------------------------------------------------------- */
  var pinned = false;

  function pinToFinalStates() {
    pinned = true;
    reveals.forEach(function (el) { el.classList.add('in', 'done'); });
    [].slice.call(document.querySelectorAll('.svc')).forEach(function (el) { el.classList.add('in'); });
    if (wireSvg) wireSvg.style.setProperty('--draw', 1);
    setLit(1);
    [checkItems, priceItems].forEach(function (items) {
      items.forEach(function (it) { it.on = true; it.el.classList.add('on'); });
    });
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
  }

  function unpinFinalStates() {
    if (!pinned) return;
    pinned = false;
    lastDraw = -1;
    lit = -1;
    onPageScroll();
  }

  if (reduceQuery.addEventListener) {
    reduceQuery.addEventListener('change', function (e) {
      syncMotionPreference();
      if (motionReduced()) { disableScrub(); pinToFinalStates(); } else { unpinFinalStates(); applyHeroMode(); }
    });
  } else {
    reduceQuery.addListener(function (e) {
      syncMotionPreference();
      if (motionReduced()) { disableScrub(); pinToFinalStates(); } else { unpinFinalStates(); applyHeroMode(); }
    });
  }

  /* ----------------------------------------------------------
     10. Пуск
     ---------------------------------------------------------- */
  document.addEventListener('visibilitychange', function () {
    document.body.classList.toggle('paused', document.hidden);
    if (!document.hidden) resumeFrames();
    updateSparks();
  });

  var menu = document.querySelector('.mobile-menu');
  if (menu) {
    menu.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', function () {
        menu.open = false;
        var targetSection = document.getElementById(link.hash.slice(1));
        if (targetSection) { targetSection.setAttribute('tabindex','-1'); targetSection.focus({preventScroll:true}); }
      });
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && menu.open) { menu.open = false; menu.querySelector('summary').focus(); }
    });
    document.addEventListener('click', function (event) { if (!menu.contains(event.target)) menu.open = false; });
  }
  if (connection && connection.addEventListener) connection.addEventListener('change', applyHeroMode);
  syncMotionPreference();
  if (motionReduced()) {
    pinToFinalStates();
  } else {
    applyHeroMode();
  }
  onPageScroll();
})();
