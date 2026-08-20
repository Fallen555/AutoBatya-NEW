/* АвтоБатя. Покадровый герой на канвасе, появления, свет в боксе. Ванильный JS, без библиотек. */
(function () {
  'use strict';

  var FRAME_COUNT = 192;                 // 8 секунд по 24 кадра
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
  var drawnIndex = -1;
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
    drawnIndex = -1;
  }

  function nearestLoaded(want) {
    if (frames[want]) return want;
    for (var d = 1; d < FRAME_COUNT; d++) {
      if (want - d >= 0 && frames[want - d]) return want - d;
      if (want + d < FRAME_COUNT && frames[want + d]) return want + d;
    }
    return -1;
  }

  function drawFrame(p) {
    if (!ctx || !canvasW) return;
    var want = Math.round(clamp(p, 0, 1) * (FRAME_COUNT - 1));
    var idx = nearestLoaded(want);
    if (idx < 0 || idx === drawnIndex) return;
    drawnIndex = idx;
    var img = frames[idx];
    var iw = img.naturalWidth, ih = img.naturalHeight;
    var s = Math.max(canvasW / iw, canvasH / ih);
    var dw = iw * s, dh = ih * s;
    ctx.drawImage(img, (canvasW - dw) / 2, (canvasH - dh) / 2, dw, dh);
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
     8б. Искры по краям страницы
     ---------------------------------------------------------- */
  function buildSparks() {
    var wraps = [].slice.call(document.querySelectorAll('.sparks'));
    if (!wraps.length || wraps[0].childNodes.length) return;
    if (reduceQuery.matches) return;
    if (matchMedia('(max-width: 1200px)').matches) return;
    var r = rng(1409);
    wraps.forEach(function (w) {
      for (var i = 0; i < 11; i++) {
        var sp = document.createElement('i');
        sp.style.left = (10 + r() * 78).toFixed(1) + '%';
        sp.style.height = (7 + r() * 13).toFixed(0) + 'px';
        sp.style.animationDuration = (8 + r() * 9).toFixed(1) + 's';
        sp.style.animationDelay = (-r() * 17).toFixed(1) + 's';
        sp.style.setProperty('--dx', ((r() * 2 - 1) * 26).toFixed(0) + 'px');
        sp.style.opacity = (0.4 + r() * 0.5).toFixed(2);
        w.appendChild(sp);
      }
    });
  }

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
  });

  if (reduceQuery.matches) {
    pinToFinalStates();
  } else {
    applyHeroMode();
  }
  buildSparks();
  onPageScroll();
})();
