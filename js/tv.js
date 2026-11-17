/* EAFC Andenne – écran du hall
 * Lit data.json (publié depuis /admin) et l'affiche. Aucun serveur, aucune base de données.
 */
(function () {
  'use strict';

  var PREVIEW = /[?&]preview\b/.test(location.search);
  var DAYS = ['', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
  var DEFAULT_SETTINGS = {
    theme: 'light',
    slideDuration: 12,
    scheduleTitle: 'Cours du jour',
    scheduleFooter: "Un doute ? L'accueil est là pour vous orienter.",
    scheduleEmpty: "Plus de cours aujourd'hui.",
    hideFinished: true,
    showTomorrow: true,
    scheduleRows: 5,
    schedulePageSeconds: 10,
    tickerLabel: 'Infos',
    tickerSpeed: 110,
    refreshMinutes: 2
  };
  var DEFAULT_SIGNS = [{ id: 'g1', text: 'Secrétariat', arrow: 'right', active: true }];
  var ARROW_ANGLE = { right: 0, downright: 45, down: 90, downleft: 135, left: 180, upleft: -135, up: -90, upright: -45 };
  var WELCOME = {
    id: '_welcome', layout: 'announce', color: 'teal', tag: 'Bienvenue',
    title: "Bienvenue à l'*EAFC Andenne*", text: 'Enseignement pour adultes et formation continue'
  };

  var data = null;
  var images = {};          // aperçu admin : chemin -> dataURL (images pas encore en ligne)
  var focusId = null;       // aperçu admin : annonce à afficher en continu
  var lastRaw = '';
  var keys = { slides: '', schedule: '', ticker: '', theme: '', signs: '' };
  var slideList = [], slideIdx = 0, shownId = null, slideTimer = null;
  var schedPage = 0, lastSchedHtml = null, autoRows = null;

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  // *mot* = mot en couleur ; retour à la ligne conservé
  function rich(s) { return esc(s).replace(/\*([^*]+)\*/g, '<em class="hl">$1</em>').replace(/\n/g, '<br>'); }
  function imgSrc(p) { return images[p] || p; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function isoDate(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function mins(t) { var p = String(t || '').split(':'); return (+p[0] || 0) * 60 + (+p[1] || 0); }
  function weekday(d) { return d.getDay() || 7; }

  /* ---------- Mise à l'échelle 1920x1080 ---------- */
  function fit() {
    var s = Math.min(window.innerWidth / 1920, window.innerHeight / 1080);
    $('stage').style.transform = 'translate(-50%,-50%) scale(' + s + ')';
  }

  /* ---------- Horloge ---------- */
  function tickClock() {
    var n = new Date();
    $('clock-time').textContent = pad(n.getHours()) + ':' + pad(n.getMinutes());
    var d = n.toLocaleDateString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    $('clock-date').textContent = d.charAt(0).toUpperCase() + d.slice(1);
  }

  /* ---------- QR code ---------- */
  function qrSvg(text) {
    try {
      if (qrcode.stringToBytesFuncs && qrcode.stringToBytesFuncs['UTF-8']) qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];
      var q = qrcode(0, 'M'); q.addData(text); q.make();
      return q.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
    } catch (e) { return ''; }
  }

  /* ---------- Données ---------- */
  function normalize(d) {
    d = d && typeof d === 'object' ? d : {};
    var s = {}, k;
    for (k in DEFAULT_SETTINGS) s[k] = DEFAULT_SETTINGS[k];
    for (k in (d.settings || {})) if (d.settings[k] !== '' && d.settings[k] != null) s[k] = d.settings[k];
    if (!Array.isArray(s.signs)) s.signs = DEFAULT_SIGNS;
    return {
      settings: s,
      slides: Array.isArray(d.slides) ? d.slides : [],
      courses: Array.isArray(d.courses) ? d.courses : [],
      ticker: Array.isArray(d.ticker) ? d.ticker : []
    };
  }

  function apply(raw) {
    data = normalize(raw);
    var st = data.settings;
    var themeKey = st.theme;
    if (themeKey !== keys.theme) {
      keys.theme = themeKey;
      var dark = st.theme === 'dark';
      $('stage').classList.toggle('theme-dark', dark);
      document.body.classList.toggle('dark', dark);
      $('logo').src = dark ? 'assets/logo-white.png' : 'assets/logo.png';
    }
    var gk = JSON.stringify(st.signs);
    if (gk !== keys.signs) { keys.signs = gk; renderSigns(); }
    var tk = JSON.stringify([data.ticker, st.tickerLabel, st.tickerSpeed]);
    if (tk !== keys.ticker) { keys.ticker = tk; renderTicker(); }
    var sk = JSON.stringify([data.courses, st.scheduleTitle, st.scheduleFooter, st.scheduleEmpty, st.hideFinished, st.showTomorrow, st.scheduleRows]);
    if (sk !== keys.schedule) { keys.schedule = sk; schedPage = 0; autoRows = null; renderSchedule(); }
    var slk = JSON.stringify([data.slides, st.slideDuration, focusId, Object.keys(images)]);
    if (slk !== keys.slides) { keys.slides = slk; buildSlides(); }
  }

  /* ---------- À la une ---------- */
  function visibleSlides() {
    if (focusId) {
      for (var i = 0; i < data.slides.length; i++) if (data.slides[i].id === focusId) return [data.slides[i]];
    }
    var t = isoDate(new Date());
    var list = data.slides.filter(function (s) {
      return s.active !== false && (!s.start || s.start <= t) && (!s.end || s.end >= t);
    });
    return list.length ? list : [WELCOME];
  }

  function slideHtml(s) {
    var layout = s.layout || 'classic';
    var tagRow = (s.tag || s.kicker) ? '<div class="s-tagrow">' +
      (s.tag ? '<span class="s-tag">' + esc(s.tag) + '</span>' : '') +
      (s.kicker ? '<span class="s-kicker">' + esc(s.kicker) + '</span>' : '') + '</div>' : '';
    var body = '<div class="s-body">' + tagRow +
      (s.title ? '<h1 class="s-title">' + rich(s.title).replace(/(\S)-(?=\S)/g, '$1\u2011') + '</h1>' : '') +
      (s.text ? '<p class="s-text">' + rich(s.text) + '</p>' : '') +
      ((s.footerLabel || s.footerText) ? '<div class="s-foot">' +
        (s.footerLabel ? '<span class="s-foot-label">' + esc(s.footerLabel) + '</span>' : '') +
        (s.footerText ? '<span class="s-foot-text">' + rich(s.footerText) + '</span>' : '') + '</div>' : '') +
      '</div>';
    var qr = s.qr ? '<div class="s-qr">' + qrSvg(s.qr) + (s.qrLabel ? '<span>' + esc(s.qrLabel) + '</span>' : '') + '</div>' : '';
    var img = s.image ? '<img src="' + esc(imgSrc(s.image)) + '" alt="">' : '<div class="s-empty">Ajoutez une image</div>';
    switch (layout) {
      case 'image': return body + '<div class="s-media">' + img + qr + '</div>';
      case 'poster':
        return s.image
          ? '<div class="s-poster-bg"></div><img class="s-poster-img" src="' + esc(imgSrc(s.image)) + '" alt="' + esc(s.title || '') + '">' + qr
          : '<div class="s-empty">Ajoutez une affiche</div>' + qr;
      case 'announce': return body + qr;
      default:
        return body + '<div class="s-side' + (s.qr ? ' has-qr' : '') + '"><i class="sh sh-quarter"></i><i class="sh sh-tri"></i><i class="sh sh-ring"></i>' + qr + '</div>';
    }
  }

  function buildSlides() {
    clearTimeout(slideTimer);
    slideList = visibleSlides();
    var box = $('slides');
    box.innerHTML = '';
    slideList.forEach(function (s) {
      var el = document.createElement('div');
      el.className = 'slide layout-' + (s.layout || 'classic') + ' color-' + (s.color || 'teal') + (s.fit === 'cover' ? ' fit-cover' : '');
      el.innerHTML = slideHtml(s);
      var bg = el.querySelector('.s-poster-bg');
      if (bg) bg.style.backgroundImage = 'url("' + imgSrc(s.image).replace(/"/g, '%22') + '")';
      box.appendChild(el);
    });
    $('dots').innerHTML = slideList.length > 1 ? slideList.map(function () { return '<span class="dot"><i class="fill"></i></span>'; }).join('') : '';
    fitAll();
    var i = 0;
    for (var k = 0; k < slideList.length; k++) if (slideList[k].id === shownId) i = k;
    show(i);
  }

  // Réduit la taille du titre/texte si le contenu déborde
  function fitSlide(el) {
    var body = el.querySelector('.s-body');
    if (!body) return;
    var t = el.querySelector('.s-title'), p = el.querySelector('.s-text');
    if (t) t.style.fontSize = '';
    if (p) p.style.fontSize = '';
    var ts = t ? parseFloat(getComputedStyle(t).fontSize) : 0;
    var ps = p ? parseFloat(getComputedStyle(p).fontSize) : 0;
    var guard = 0;
    // 1) titre jusqu'à 84px, 2) texte jusqu'à 28px, 3) titre jusqu'à 48px, 4) texte jusqu'à 22px
    while ((body.scrollHeight > body.clientHeight + 1 || (t && t.scrollWidth > t.clientWidth + 1)) && guard++ < 60) {
      if (t && (ts > 84 || t.scrollWidth > t.clientWidth + 1) && ts > 40) { ts -= 4; t.style.fontSize = ts + 'px'; }
      else if (p && ps > 28) { ps -= 2; p.style.fontSize = ps + 'px'; }
      else if (t && ts > 48) { ts -= 4; t.style.fontSize = ts + 'px'; }
      else if (p && ps > 22) { ps -= 2; p.style.fontSize = ps + 'px'; }
      else break;
    }
  }
  function fitAll() { Array.prototype.forEach.call(document.querySelectorAll('#slides .slide'), fitSlide); }

  function duration(s) { return Math.max(3, +s.duration || +data.settings.slideDuration || 12); }

  function show(i) {
    slideIdx = i;
    var els = document.querySelectorAll('#slides .slide');
    for (var k = 0; k < els.length; k++) els[k].classList.toggle('active', k === i);
    var s = slideList[i];
    shownId = s.id;
    $('main').classList.toggle('wide', !!s.wide);
    var dur = duration(s);
    var dots = document.querySelectorAll('#dots .dot');
    for (var d = 0; d < dots.length; d++) {
      var on = d === i, f = dots[d].firstChild;
      dots[d].classList.toggle('on', on);
      f.style.transition = 'none'; f.style.width = '0';
      if (on) { void f.offsetWidth; f.style.transition = 'width ' + dur + 's linear'; f.style.width = '100%'; }
    }
    clearTimeout(slideTimer);
    if (!focusId) slideTimer = setTimeout(next, dur * 1000);
  }

  function next() {
    if (slideIdx + 1 < slideList.length) return show(slideIdx + 1);
    // fin de cycle : on revérifie les dates (une annonce peut commencer / se terminer)
    var ids = visibleSlides().map(function (s) { return s.id; }).join();
    if (ids !== slideList.map(function (s) { return s.id; }).join()) { shownId = null; buildSlides(); }
    else show(0);
  }

  /* ---------- Cours du jour ---------- */
  function coursesFor(date, fromMinute) {
    var wd = weekday(date), iso = isoDate(date);
    return data.courses.filter(function (c) {
      if (!c || !c.name || !Array.isArray(c.days) || c.days.indexOf(wd) < 0) return false;
      if (c.from && c.from > iso) return false;
      if (c.to && c.to < iso) return false;
      if (fromMinute != null && c.end && mins(c.end) <= fromMinute) return false;
      return true;
    }).sort(function (a, b) { return mins(a.start) - mins(b.start) || String(a.name).localeCompare(b.name); });
  }

  function renderSchedule(paging) {
    var st = data.settings, now = new Date(), nowM = now.getHours() * 60 + now.getMinutes();
    var list = coursesFor(now, st.hideFinished ? nowM : null);
    var label = 'Aujourd’hui';
    var isTomorrow = false;
    if (!list.length && st.showTomorrow) {
      for (var add = 1; add <= 7 && !list.length; add++) {
        var d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + add);
        list = coursesFor(d, null);
        if (list.length) { isTomorrow = true; label = add === 1 ? 'Demain' : DAYS[weekday(d)].replace(/^./, function (c) { return c.toUpperCase(); }); }
      }
    }
    var per = autoRows || Math.max(1, +st.scheduleRows || 5);
    var pages = Math.max(1, Math.ceil(list.length / per));
    if (schedPage >= pages) schedPage = 0;
    var items = list.slice(schedPage * per, schedPage * per + per);

    $('sched-title').textContent = st.scheduleTitle;
    $('sched-meta').textContent = label + (pages > 1 ? ' · ' + (schedPage + 1) + '/' + pages : '');

    var html = '';
    if (!items.length) {
      html = '<div class="sched-empty">' + rich(st.scheduleEmpty) + '</div>';
    } else {
      items.forEach(function (c) {
        var running = !isTomorrow && c.start && c.end && mins(c.start) <= nowM && nowM < mins(c.end);
        var badge = '';
        if (c.status === 'cancelled') badge = '<span class="badge b-cancel">Annulé</span>';
        else if (c.status === 'changed') badge = '<span class="badge b-change">Modifié</span>';
        else if (running) badge = '<span class="badge b-now">En cours</span>';
        var sub = c.note || c.kind || '';
        html += '<div class="row' + (running && c.status !== 'cancelled' ? ' now' : '') + (c.status === 'cancelled' ? ' cancelled' : '') + '">' +
          '<span class="r-time">' + esc(c.start || '') + (c.end ? '<span class="r-end">→ ' + esc(c.end) + '</span>' : '') + '</span>' +
          '<span class="r-info"><span class="r-name">' + esc(c.name) + '</span>' +
          ((badge || sub) ? '<span class="r-kind">' + badge + esc(sub) + '</span>' : '') + '</span>' +
          (c.room ? '<span class="r-room">' + esc(c.room) + '</span>' : '<span></span>') +
          '</div>';
      });
    }
    var listEl = $('sched-list');
    if (paging) {
      lastSchedHtml = html;
      listEl.classList.add('fading');
      setTimeout(function () { listEl.innerHTML = html; listEl.classList.remove('fading'); }, 400);
    } else if (html !== lastSchedHtml) {
      lastSchedHtml = html;
      listEl.innerHTML = html;
    }
    // trop de lignes pour la hauteur (noms longs) : on réduit le nombre de cours par page
    if (!paging && listEl.scrollHeight > listEl.clientHeight + 2 && per > 2) {
      autoRows = per - 1; lastSchedHtml = null;
      return renderSchedule(false);
    }
    $('sched-foot-text').textContent = st.scheduleFooter || '';
    $('sched-foot').classList.toggle('empty', !st.scheduleFooter);
    return pages;
  }

  var schedTick = 0;
  function scheduleLoop() {
    if (!data) return;
    schedTick++;
    var every = Math.max(4, +data.settings.schedulePageSeconds || 10);
    var pagesNow = renderSchedule(false);          // suit l'heure (cours terminés, « en cours »)
    if (pagesNow > 1 && schedTick % every === 0) { schedPage = (schedPage + 1) % pagesNow; renderSchedule(true); }
  }

  /* ---------- Panneau d'orientation ---------- */
  function renderSigns() {
    var list = data.settings.signs.filter(function (g) { return g && g.active !== false && String(g.text || '').trim(); }).slice(0, 3);
    var box = $('signs');
    box.classList.toggle('many', list.length > 1);
    box.innerHTML = list.map(function (g) {
      var a = ARROW_ANGLE.hasOwnProperty(g.arrow) ? ARROW_ANGLE[g.arrow] : 0;
      var first = Math.abs(a) > 90;   // flèche vers la gauche : placée avant le texte
      return '<div class="sign' + (first ? ' arrow-first' : '') + '">' +
        '<span class="sign-text">' + esc(g.text) + '</span>' +
        '<span class="sign-arrow" aria-hidden="true"><svg viewBox="0 0 24 24" style="transform:rotate(' + a + 'deg)"><g class="nudge"><path d="M4 12h15M13 5l7 7-7 7" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></g></svg></span>' +
        '</div>';
    }).join('');
  }

  /* ---------- Bandeau ---------- */
  function renderTicker() {
    var msgs = data.ticker.filter(function (t) { return t && t.active !== false && String(t.text || '').trim(); });
    $('stage').classList.toggle('no-ticker', !msgs.length);
    if (!msgs.length) return;
    $('ticker-label').textContent = data.settings.tickerLabel || 'Infos';
    var unit = msgs.map(function (m) { return '<span class="t-item">' + rich(m.text) + '</span><span class="t-sep">◆</span>'; }).join('');
    var track = $('ticker-track');
    var chunk = unit, n = 1;
    track.innerHTML = '<div class="t-chunk">' + chunk + '</div>';
    while (track.firstChild.offsetWidth < 1800 && n < 12) { chunk += unit; n++; track.firstChild.innerHTML = chunk; }
    track.innerHTML = '<div class="t-chunk">' + chunk + '</div><div class="t-chunk" aria-hidden="true">' + chunk + '</div>';
    var w = track.firstChild.offsetWidth;
    track.style.animation = 'none'; void track.offsetWidth;
    track.style.animation = '';
    track.style.animationDuration = (w / Math.max(30, +data.settings.tickerSpeed || 110)) + 's';
  }

  /* ---------- Chargement ---------- */
  function load() {
    fetch('data.json?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.text(); })
      .then(function (txt) {
        if (txt !== lastRaw) { lastRaw = txt; apply(JSON.parse(txt)); }
      })
      .catch(function (e) { console.warn('data.json indisponible', e); if (!data) apply({}); })
      .then(function () {
        var m = data ? Math.max(1, +data.settings.refreshMinutes || 2) : 2;
        setTimeout(load, m * 60000);
      });
  }

  /* ---------- Démarrage ---------- */
  fit();
  window.addEventListener('resize', fit);
  tickClock();
  setInterval(tickClock, 1000);
  setInterval(scheduleLoop, 1000);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { if (data) { fitAll(); renderTicker(); } });

  if (PREVIEW) {
    document.body.classList.add('preview');
    window.addEventListener('message', function (e) {
      if (e.origin !== location.origin || !e.data || e.data.type !== 'eafc-preview') return;
      images = e.data.images || {};
      focusId = e.data.focusId || null;
      if (focusId) shownId = focusId;
      apply(e.data.data);
    });
    if (window.parent !== window) window.parent.postMessage({ type: 'eafc-preview-ready' }, location.origin);
    apply({});
  } else {
    load();
    // Rechargement complet chaque nuit à 4h (prend en compte une mise à jour du site)
    var started = Date.now();
    setInterval(function () {
      var n = new Date();
      if (n.getHours() === 4 && n.getMinutes() === 0 && Date.now() - started > 3600000) location.reload();
    }, 60000);
  }
})();
