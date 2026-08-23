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
    kick();
  }

  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      heroOnScreen = entries[0].isIntersecting;
      if (heroOnScreen) kick();
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

    function done(idx, ok) {
      loadedCount++;
      active--;
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
      while (active < 6 && ptr < order.length) {
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

    pump();
    setTimeout(function () { if (!heroReady) failVideo(); }, 20000);
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
    if (!scrubOn) return;
    scrubOn = false;
    window.removeEventListener('scroll', onHeroScroll);
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
  }

  function applyHeroMode() {
    var gated = MQLS.some(function (m) { return m.matches; });
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

  function markSequence(items, p) {
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var on = p > it.d + 0.04;
      if (on !== it.on) {
        it.on = on;
        it.el.classList.toggle('on', on);
      }
    }
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

  function setLit(p) {
    if (Math.abs(p - lit) < 0.006) return;
    lit = p;
    if (lightSec) lightSec.style.setProperty('--lit', p.toFixed(3));
    markSequence(checkItems, p);
  }

  function driveScrollScenes() {
    if (lightSec) setLit(smoothstep(sectionProgress(lightSec, 0.86, 0.3), 0, 1));
    if (priceList) markByLine(priceItems, 0.82);
  }

  /* ----------------------------------------------------------
     8б. Сварка по краям страницы: вспышка и сноп искр
     ---------------------------------------------------------- */
  var sparkWraps = [].slice.call(document.querySelectorAll('.sparks'));
  var sparkCtx = [];
  var sparkSize = [];
  var parts = [];
  var flashes = [];
  var nextBurst = [0, 0];
  var sparksOn = false;
  var sparkRaf = null;
  var sparkLast = 0;
  var srand = rng(90210);
  var servicesSec = document.getElementById('services');

  function sparksAllowed() {
    return sparkWraps.length > 0 &&
      !reduceQuery.matches &&
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

  // один разряд: короткая вспышка и сноп искр из точки
  function burst(side) {
    var sz = sparkSize[side];
    if (!sz) return;
    var x = sz.w * (0.28 + srand() * 0.5);
    var y = sz.h * (0.12 + srand() * 0.62);
    flashes.push({ side: side, x: x, y: y, life: 1, r: 34 + srand() * 30 });

    var n = 16 + Math.round(srand() * 16);
    for (var i = 0; i < n; i++) {
      var ang = (-0.35 + srand() * 1.9) * Math.PI;   // веером, больше вниз и в стороны
      var sp = 110 + srand() * 340;
      parts.push({
        side: side, x: x, y: y, px: x, py: y,
        vx: Math.cos(ang) * sp * (0.5 + srand() * 0.8),
        vy: Math.abs(Math.sin(ang)) * sp * 0.55 - 60 - srand() * 90,
        life: 1, decay: 0.32 + srand() * 0.38,
        size: 0.9 + srand() * 1.5,
        hot: srand() < 0.4
      });
    }
    // редкие длинные искры, которые улетают дальше всех
    if (srand() < 0.5) {
      for (var j = 0; j < 3; j++) {
        parts.push({
          side: side, x: x, y: y, px: x, py: y,
          vx: (srand() - 0.5) * 150, vy: -140 - srand() * 120,
          life: 1, decay: 0.22 + srand() * 0.16, size: 1.4 + srand(), hot: true
        });
      }
    }
  }

  function sparkTick(now) {
    var dt = Math.min(0.05, (now - (sparkLast || now)) / 1000);
    sparkLast = now;

    for (var side = 0; side < sparkCtx.length; side++) {
      if (now > nextBurst[side]) {
        burst(side);
        nextBurst[side] = now + 2000 + srand() * 4200;
      }
      var sz = sparkSize[side];
      var g = sparkCtx[side];
      if (!g || !sz) continue;
      g.clearRect(0, 0, sz.w, sz.h);
      g.globalCompositeOperation = 'lighter';
    }

    // вспышки
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
      p.vy += 700 * dt;              // тяжесть
      p.vx *= (1 - 1.1 * dt);        // сопротивление воздуха
      p.vy *= (1 - 0.5 * dt);
      p.x += p.vx * dt;
      p.y += p.vy * dt;

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
      gp.moveTo(p.x - p.vx * 0.05, p.y - p.vy * 0.05);   // хвост по направлению полёта
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
      nextBurst[0] = t + 250;
      nextBurst[1] = t + 1400;
      sparkLast = 0;
      if (sparkRaf === null) sparkRaf = requestAnimationFrame(sparkTick);
    } else {
      stopSparks();
    }
  }

  /* ----------------------------------------------------------
     8в. Мини-карта: наклон за мышкой и разворот по клику
     ---------------------------------------------------------- */
  (function miniMap() {
    var map = document.getElementById('minimap');
    if (!map) return;
    var card = map.querySelector('.minimap__card');
    var toggle = map.querySelector('.minimap__toggle');
    var link = map.querySelector('.minimap__link');
    var hint = document.getElementById('minimap-hint');
    var open = false;
    var tiltRaf = null;
    var wantRx = 0, wantRy = 0, showRx = 0, showRy = 0;

    function canTilt() {
      return !reduceQuery.matches && !matchMedia('(pointer: coarse)').matches;
    }

    function tiltTick() {
      showRx += (wantRx - showRx) * 0.18;
      showRy += (wantRy - showRy) * 0.18;
      card.style.setProperty('--rx', showRx.toFixed(2) + 'deg');
      card.style.setProperty('--ry', showRy.toFixed(2) + 'deg');
      if (Math.abs(wantRx - showRx) > 0.02 || Math.abs(wantRy - showRy) > 0.02) {
        tiltRaf = requestAnimationFrame(tiltTick);
      } else {
        tiltRaf = null;
      }
    }
    function kickTilt() {
      if (tiltRaf === null) tiltRaf = requestAnimationFrame(tiltTick);
    }

    map.addEventListener('mousemove', function (e) {
      if (!canTilt()) return;
      var r = card.getBoundingClientRect();
      var dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
      var dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
      wantRy = clamp(dx, -1, 1) * 8;
      wantRx = clamp(dy, -1, 1) * -8;
      kickTilt();
    });
    map.addEventListener('mouseleave', function () {
      wantRx = 0; wantRy = 0;
      kickTilt();
    });

    function setOpen(next) {
      open = next;
      map.classList.toggle('open', open);
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
      toggle.querySelector('.sr-only').textContent = open ? 'Свернуть карту проезда' : 'Развернуть карту проезда';
      if (link) link.setAttribute('tabindex', open ? '0' : '-1');
      if (hint) hint.textContent = open ? 'Нажмите ещё раз, чтобы свернуть' : 'Нажмите на карту, чтобы развернуть';
    }

    toggle.addEventListener('click', function () { setOpen(!open); });
    if (link) link.addEventListener('click', function (e) { e.stopPropagation(); });
  })();

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
    markSequence(priceItems, 1);
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
      if (e.matches) pinToFinalStates(); else applyHeroMode();
    });
  } else {
    reduceQuery.addListener(function (e) {
      if (e.matches) pinToFinalStates(); else applyHeroMode();
    });
  }

  /* ----------------------------------------------------------
     10. Пуск
     ---------------------------------------------------------- */
  document.addEventListener('visibilitychange', function () {
    document.body.classList.toggle('paused', document.hidden);
    updateSparks();
  });

  if (reduceQuery.matches) {
    pinToFinalStates();
  } else {
    applyHeroMode();
  }
  onPageScroll();
})();
