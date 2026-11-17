/* EAFC Andenne – administration de l'affichage du hall
 * Les données sont dans data.json, à la racine du dépôt GitHub.
 * « Publier » écrit ce fichier (et les images) directement dans le dépôt via l'API GitHub.
 */
(function () {
  'use strict';

  var CFG_KEY = 'eafc-affichage-github';
  var DRAFT_KEY = 'eafc-affichage-brouillon';
  var DAYS = [null, 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
  var DAYS_SHORT = [null, 'L', 'Ma', 'Me', 'J', 'V', 'S', 'D'];
  var PANEL = { teal: '#088C98', magenta: '#E4097F', dark: '#111111' };
  var SHAPE = { teal: '#E4097F', magenta: '#088C98', dark: '#E4097F' };
  var LAYOUTS = [
    { id: 'classic', name: 'Classique', desc: 'Texte + panneau coloré (et QR code)' },
    { id: 'image', name: 'Texte + photo', desc: 'Texte à gauche, photo à droite' },
    { id: 'poster', name: 'Affiche', desc: 'Une image entière (affiche Canva…)' },
    { id: 'announce', name: 'Annonce', desc: 'Gros titre sur fond coloré' }
  ];
  var COLORS = [
    { id: 'teal', name: 'Bleu canard', css: 'linear-gradient(135deg,#088C98 60%,#E4097F 60%)' },
    { id: 'magenta', name: 'Magenta', css: 'linear-gradient(135deg,#E4097F 60%,#088C98 60%)' },
    { id: 'dark', name: 'Noir', css: 'linear-gradient(135deg,#111 60%,#E4097F 60%)' }
  ];
  var DEFAULT_SETTINGS = {
    theme: 'light', slideDuration: 12, scheduleTitle: 'Cours du jour',
    scheduleFooter: "Un doute ? L'accueil est là pour vous orienter.",
    scheduleEmpty: "Plus de cours aujourd'hui.", hideFinished: true, showTomorrow: true,
    scheduleRows: 5, schedulePageSeconds: 10, tickerLabel: 'Infos', tickerSpeed: 110, refreshMinutes: 2
  };

  var S = {
    data: null, sha: null, dirty: false, tab: 'slides', sel: null,
    day: (new Date().getDay() || 7), images: {}, pending: {},
    cfg: loadCfg(), connected: false, pvReady: false, access: null, mk: null
  };

  /* ---------- Outils ---------- */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function uid(p) { return (p || 'x') + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function plain(s) { return String(s || '').replace(/\*/g, '').replace(/\n/g, ' '); }
  function mins(t) { var p = String(t || '').split(':'); return (+p[0] || 0) * 60 + (+p[1] || 0); }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  var ICON = {
    up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
    down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14M19 12l-7 7-7-7"/></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>',
    del: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>',
    more: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>'
  };

  function toast(msg, kind) {
    var t = $('#toast');
    t.textContent = msg;
    t.className = 'toast show ' + (kind || '');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.className = 'toast'; }, kind === 'err' ? 7000 : 4000);
  }

  function normalize(d) {
    d = d && typeof d === 'object' ? d : {};
    var s = {}, k;
    for (k in DEFAULT_SETTINGS) s[k] = DEFAULT_SETTINGS[k];
    for (k in (d.settings || {})) s[k] = d.settings[k];
    if (!Array.isArray(s.signs)) s.signs = [{ id: 'g1', text: 'Secrétariat', arrow: 'right', active: true }];
    return {
      updatedAt: d.updatedAt || '',
      settings: s,
      slides: Array.isArray(d.slides) ? d.slides : [],
      courses: Array.isArray(d.courses) ? d.courses : [],
      ticker: Array.isArray(d.ticker) ? d.ticker : []
    };
  }

  /* ---------- Connexion GitHub ---------- */
  function loadCfg() {
    var c = {};
    try { c = JSON.parse(sessionStorage.getItem(CFG_KEY) || localStorage.getItem(CFG_KEY) || '{}'); } catch (e) { /* stockage indisponible */ }
    if (!c.owner && /\.github\.io$/i.test(location.hostname)) {
      c.owner = location.hostname.split('.')[0];
      var seg = location.pathname.split('/').filter(Boolean);
      c.repo = seg.length > 1 ? seg[0] : location.hostname;
    }
    c.branch = c.branch || 'main';
    return c;
  }
  // « remember » : garder la session sur cet ordinateur (localStorage) ; sinon jusqu'à la fermeture du navigateur
  function saveCfg() {
    try {
      var keep = S.cfg.remember !== false;
      (keep ? localStorage : sessionStorage).setItem(CFG_KEY, JSON.stringify(S.cfg));
      (keep ? sessionStorage : localStorage).removeItem(CFG_KEY);
    } catch (e) { /* ignore */ }
  }
  function logout() {
    if (S.dirty && !confirm('Des modifications ne sont pas publiées. Se déconnecter quand même ? (Elles restent en brouillon sur cet ordinateur.)')) return;
    try { localStorage.removeItem(CFG_KEY); sessionStorage.removeItem(CFG_KEY); } catch (e) { /* ignore */ }
    S.dirty = false;
    location.reload();
  }

  /* ---------- Codes d'accès (admin/acces.json) ----------
   * Le jeton GitHub est chiffré (AES-256-GCM) avec une clé maîtresse aléatoire.
   * Chaque code d'accès chiffre cette clé maîtresse (clé dérivée du mot de passe par PBKDF2-SHA256).
   * Le fichier public ne contient donc ni jeton ni mot de passe en clair.
   */
  var ITER = 310000;
  function b64(buf) { var b = new Uint8Array(buf), s = ''; for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s); }
  function unb64(s) { var bin = atob(s), a = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return a; }
  function pwKey(pw, salt, iter) {
    return crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveKey']).then(function (k) {
      return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: salt, iterations: iter, hash: 'SHA-256' }, k, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    });
  }
  function rawKey(raw) { return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']); }
  function encrypt(key, bytes) {
    var iv = crypto.getRandomValues(new Uint8Array(12));
    return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, bytes).then(function (ct) { return { iv: b64(iv), ct: b64(ct) }; });
  }
  function decrypt(key, o) {
    return crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(o.iv) }, key, unb64(o.ct)).then(function (b) { return new Uint8Array(b); });
  }

  function fetchAccess() {
    return fetch('acces.json?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; })
      .then(function (a) { return a && Array.isArray(a.users) && a.users.length && a.token ? a : null; });
  }

  function normName(s) { return String(s || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  function tryLogin(name, pw) {
    var A = S.access;
    var candidates = A.users.filter(function (u) { return normName(u.name) === normName(name); });
    return candidates.reduce(function (chain, u) {
      return chain.catch(function () {
        return pwKey(pw, unb64(u.salt), A.iter || ITER).then(function (k) { return decrypt(k, u); })
          .then(function (mk) { return { mk: mk, user: u }; });
      });
    }, Promise.reject(new Error('none'))).then(function (r) {
      return rawKey(r.mk).then(function (k) { return decrypt(k, A.token); }).then(function (tb) {
        return { mk: r.mk, user: r.user, token: new TextDecoder().decode(tb) };
      });
    });
  }

  function showLogin() {
    document.body.classList.add('locked');
    var box = $('#login');
    box.hidden = false;
    $('#setup-form').hidden = true;
    $('#login-form').hidden = false;
    var form = $('#login-form'), err = $('#login-err'), btn = $('#login-btn');
    setTimeout(function () { $('#login-user').focus(); }, 50);
    form.onsubmit = function (e) {
      e.preventDefault();
      var name = $('#login-user').value, pw = $('#login-pw').value;
      if (!name || !pw) return;
      err.textContent = ''; btn.disabled = true; btn.textContent = 'Vérification…';
      tryLogin(name, pw).then(function (r) {
        S.cfg = { owner: S.access.owner, repo: S.access.repo, branch: S.access.branch || 'main', token: r.token, mk: b64(r.mk), user: r.user.name, remember: $('#login-remember').checked };
        saveCfg();
        S.mk = r.mk;
        box.hidden = true; document.body.classList.remove('locked');
        $('#login-pw').value = '';
        load();
      }).catch(function () {
        err.textContent = 'Identifiant ou mot de passe incorrect.';
        $('#login-pw').select();
      }).then(function () { btn.disabled = false; btn.textContent = 'Se connecter'; });
    };
  }

  // Première installation : création du compte administrateur (+ clé GitHub, une seule fois)
  function showSetup() {
    document.body.classList.add('locked');
    $('#login').hidden = false;
    $('#login-form').hidden = true;
    var form = $('#setup-form'), err = $('#setup-err'), btn = $('#setup-btn');
    form.hidden = false;
    $('#setup-owner').value = S.cfg.owner || '';
    $('#setup-repo').value = S.cfg.repo || '';
    $('#setup-branch').value = S.cfg.branch || 'main';
    if (!S.cfg.owner || !S.cfg.repo) $('#setup-adv').open = true;
    setTimeout(function () { $('#setup-user').focus(); }, 50);
    form.onsubmit = function (e) {
      e.preventDefault();
      var name = $('#setup-user').value.trim(), pw = $('#setup-pw').value, pw2 = $('#setup-pw2').value;
      err.textContent = '';
      if (!name) { err.textContent = 'Choisissez un identifiant.'; return; }
      if (pw.length < 10) { err.textContent = 'Le mot de passe doit contenir au moins 10 caractères.'; return; }
      if (pw !== pw2) { err.textContent = 'Les deux mots de passe ne sont pas identiques.'; return; }
      S.cfg.owner = $('#setup-owner').value.trim();
      S.cfg.repo = $('#setup-repo').value.trim();
      S.cfg.branch = $('#setup-branch').value.trim() || 'main';
      S.cfg.token = $('#setup-token').value.trim();
      S.cfg.remember = true;
      btn.disabled = true; btn.textContent = 'Création du compte…';
      testConnection().then(function (r) {
        S.sha = r.sha; S.data = normalize(r.data);
        return createUser(name, pw, true);
      }).then(function () {
        S.cfg.user = name; saveCfg();
        $('#login').hidden = true; document.body.classList.remove('locked');
        load();
        toast('Compte « ' + name + ' » créé. Désormais, l\'admin demandera cet identifiant et ce mot de passe.', 'ok');
      }).catch(function (e2) {
        S.cfg.token = '';
        err.textContent = e2.status === 401 ? 'Clé GitHub refusée (mal copiée ou expirée).'
          : e2.status === 404 ? 'Dépôt introuvable : vérifiez la clé (accès au dépôt, droits « Contents ») ou les paramètres avancés.'
          : (e2.message || 'Erreur inconnue.');
      }).then(function () { btn.disabled = false; btn.textContent = 'Créer le compte administrateur'; });
    };
  }

  function ghGetFile(path) {
    return api(contentsPath(path) + '?ref=' + encodeURIComponent(S.cfg.branch)).then(function (j) {
      return { sha: j.sha, text: b64ToUtf8(j.content) };
    }).catch(function (e) { if (e.status === 404) return null; throw e; });
  }
  function saveAccess(A) {
    return ghGetFile('admin/acces.json').then(function (f) {
      return ghPut('admin/acces.json', utf8ToB64(JSON.stringify(A, null, 2) + '\n'), 'Affichage : codes d\'accès', f && f.sha);
    }).then(function () { S.access = A; });
  }

  // Crée un utilisateur. reset = nouvelle clé maîtresse (premier compte, ou remise à zéro)
  function createUser(name, pw, reset) {
    var A = reset ? { v: 1, iter: ITER, users: [] } : clone(S.access);
    var mk = reset ? crypto.getRandomValues(new Uint8Array(32)) : S.mk;
    var salt = crypto.getRandomValues(new Uint8Array(16));
    return rawKey(mk).then(function (k) {
      return reset ? encrypt(k, new TextEncoder().encode(S.cfg.token)) : null;
    }).then(function (tok) {
      if (tok) A.token = tok;
      A.owner = S.cfg.owner; A.repo = S.cfg.repo; A.branch = S.cfg.branch;
      return pwKey(pw, salt, A.iter || ITER);
    }).then(function (k) { return encrypt(k, mk); }).then(function (o) {
      A.users.push({ id: uid('u'), name: name, created: new Date().toISOString().slice(0, 10), salt: b64(salt), iv: o.iv, ct: o.ct });
      return saveAccess(A);
    }).then(function () {
      S.mk = mk; S.cfg.mk = b64(mk); saveCfg();
    });
  }

  function addAccess() {
    var name = $('#a-name').value.trim(), pw = $('#a-pw').value, pw2 = $('#a-pw2').value;
    if (!S.connected) return toast('Connexion à GitHub impossible pour le moment.', 'err');
    if (!name) return toast('Indiquez un identifiant (par ex. « secretariat »).', 'err');
    if (S.access && S.mk && S.access.users.some(function (u) { return normName(u.name) === normName(name); })) return toast('Cet identifiant existe déjà.', 'err');
    if (pw.length < 10) return toast('Le mot de passe doit contenir au moins 10 caractères.', 'err');
    if (pw !== pw2) return toast('Les deux mots de passe ne sont pas identiques.', 'err');
    var reset = !S.mk;
    if (reset && S.access && !confirm('Cela remplace TOUS les utilisateurs existants par ce nouveau compte. Continuer ?')) return;
    var btn = $('[data-act=acadd]'); btn.disabled = true; btn.textContent = 'Enregistrement…';
    createUser(name, pw, reset).then(function () {
      if (!S.cfg.user) { S.cfg.user = name; saveCfg(); }
      render();
      toast('Utilisateur « ' + name + ' » créé. Il pourra se connecter d\'ici 1 à 2 minutes.', 'ok');
    }).catch(function (e) {
      toast('Impossible de créer l\'utilisateur : ' + e.message, 'err');
      btn.disabled = false; btn.textContent = 'Créer l\'utilisateur';
    });
  }
  function changePassword(id) {
    var pw = $('#pw-new').value, pw2 = $('#pw-new2').value;
    if (pw.length < 10) return toast('Le mot de passe doit contenir au moins 10 caractères.', 'err');
    if (pw !== pw2) return toast('Les deux mots de passe ne sont pas identiques.', 'err');
    var A = clone(S.access), u = A.users.filter(function (x) { return x.id === id; })[0];
    var salt = crypto.getRandomValues(new Uint8Array(16));
    var btn = $('[data-act=acpwsave]'); btn.disabled = true; btn.textContent = 'Enregistrement…';
    pwKey(pw, salt, A.iter || ITER).then(function (k) { return encrypt(k, S.mk); }).then(function (o) {
      u.salt = b64(salt); u.iv = o.iv; u.ct = o.ct; u.changed = new Date().toISOString().slice(0, 10);
      return saveAccess(A);
    }).then(function () {
      S.pwEdit = null; render();
      toast('Mot de passe de « ' + u.name + ' » modifié. Il sera actif d\'ici 1 à 2 minutes ; l\'ancien ne fonctionnera plus.', 'ok');
    }).catch(function (e) {
      toast('Impossible de modifier le mot de passe : ' + e.message, 'err');
      btn.disabled = false; btn.textContent = 'Enregistrer';
    });
  }
  function deleteAccess(id) {
    var A = clone(S.access);
    if (A.users.length <= 1) return toast('Il doit rester au moins un utilisateur.', 'err');
    var u = A.users.filter(function (x) { return x.id === id; })[0];
    if (!confirm('Supprimer l\'utilisateur « ' + u.name + ' » ?')) return;
    A.users = A.users.filter(function (x) { return x.id !== id; });
    saveAccess(A).then(function () { render(); toast('Utilisateur supprimé.', 'ok'); })
      .catch(function (e) { toast('Erreur : ' + e.message, 'err'); });
  }
  // Nouveau jeton GitHub saisi alors que des codes existent : on le rechiffre pour que les codes restent valables
  function updateAccessToken() {
    if (!S.access || !S.mk) return Promise.resolve();
    var A = clone(S.access);
    return rawKey(S.mk).then(function (k) { return encrypt(k, new TextEncoder().encode(S.cfg.token)); }).then(function (tok) {
      A.token = tok; A.owner = S.cfg.owner; A.repo = S.cfg.repo; A.branch = S.cfg.branch;
      return saveAccess(A);
    });
  }

  function api(path, opts) {
    opts = opts || {};
    var url = 'https://api.github.com/repos/' + encodeURIComponent(S.cfg.owner) + '/' + encodeURIComponent(S.cfg.repo) + path;
    return fetch(url, {
      method: opts.method || 'GET',
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': 'Bearer ' + S.cfg.token,
        'X-GitHub-Api-Version': '2022-11-28'
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      cache: 'no-store'
    }).then(function (r) {
      return r.text().then(function (t) {
        var j = null; try { j = t ? JSON.parse(t) : null; } catch (e) { /* texte brut */ }
        if (!r.ok) { var err = new Error((j && j.message) || ('Erreur ' + r.status)); err.status = r.status; throw err; }
        return j;
      });
    });
  }
  function b64ToUtf8(b64) {
    var bin = atob(String(b64).replace(/\s/g, ''));
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder('utf-8').decode(bytes);
  }
  function utf8ToB64(str) {
    var bytes = new TextEncoder().encode(str), bin = '';
    for (var i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  function contentsPath(p) { return '/contents/' + p.split('/').map(encodeURIComponent).join('/'); }

  function ghGetData() {
    return api(contentsPath('data.json') + '?ref=' + encodeURIComponent(S.cfg.branch)).then(function (j) {
      return { sha: j.sha, data: JSON.parse(b64ToUtf8(j.content)) };
    });
  }
  function ghPut(path, b64, message, sha) {
    var body = { message: message, content: b64, branch: S.cfg.branch };
    if (sha) body.sha = sha;
    return api(contentsPath(path), { method: 'PUT', body: body });
  }

  function setConnected(ok) {
    S.connected = ok;
    var c = $('#conn');
    c.textContent = ok ? (S.cfg.user ? 'Connecté : ' + S.cfg.user : 'Connecté à ' + S.cfg.owner + '/' + S.cfg.repo) : 'Non connecté – modifications locales';
    $('#logout').hidden = !S.cfg.token;
    c.classList.toggle('ok', ok);
  }

  function testConnection() {
    if (!S.cfg.owner || !S.cfg.repo || !S.cfg.token) return Promise.reject(new Error('Complétez le compte, le dépôt et le jeton.'));
    return api('').then(function (repo) {
      if (repo.permissions && repo.permissions.push === false) throw new Error("Ce jeton n'a pas le droit d'écrire dans le dépôt.");
      return ghGetData();
    });
  }

  /* ---------- Chargement / brouillon ---------- */
  function saveDraft() {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ data: S.data, sha: S.sha })); } catch (e) { /* quota */ }
  }
  function clearDraft() { try { localStorage.removeItem(DRAFT_KEY); } catch (e) { /* ignore */ } }
  function readDraft() { try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch (e) { return null; } }

  function load() {
    var p;
    if (S.cfg.token && S.cfg.owner && S.cfg.repo) {
      p = ghGetData().then(function (r) { S.sha = r.sha; setConnected(true); return r.data; })
        .catch(function (e) { setConnected(false); toast('Connexion GitHub impossible : ' + e.message, 'err'); return fetchLocal(); });
    } else {
      setConnected(false);
      p = fetchLocal();
    }
    return p.then(function (d) {
      S.data = normalize(d);
      var draft = readDraft();
      if (draft && draft.data && JSON.stringify(normalize(draft.data)) !== JSON.stringify(S.data)) {
        if (confirm('Des modifications non publiées ont été retrouvées sur cet ordinateur. Les reprendre ?')) {
          S.data = normalize(draft.data); markDirty(true);
        } else clearDraft();
      }
      if (S.data.slides[0]) S.sel = S.data.slides[0].id;
      render();
    });
  }
  function fetchLocal() {
    return fetch('../data.json?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : {}; })
      .catch(function () { return {}; });
  }

  function markDirty(v) {
    S.dirty = v !== false;
    $('#dirty').hidden = !S.dirty;
    if (S.dirty) saveDraft(); else clearDraft();
  }
  function changed() { markDirty(true); sendPreview(); }

  /* ---------- Publication ---------- */
  function publish() {
    if (!S.connected) {
      toast("Connectez d'abord votre dépôt GitHub (onglet Connexion).", 'err');
      switchTab('github');
      return;
    }
    var btn = $('#publish');
    btn.disabled = true; btn.textContent = 'Publication…';
    var paths = Object.keys(S.pending);
    var chain = Promise.resolve();
    paths.forEach(function (p) {
      chain = chain.then(function () {
        return ghPut(p, S.pending[p], 'Affichage : ajout image ' + p.split('/').pop()).then(function () { delete S.pending[p]; });
      });
    });
    function putData(retry) {
      S.data.updatedAt = new Date().toISOString();
      var json = JSON.stringify(S.data, null, 2) + '\n';
      return ghPut('data.json', utf8ToB64(json), 'Affichage : mise à jour du contenu', S.sha).then(function (r) {
        S.sha = r.content.sha;
      }).catch(function (e) {
        if (!retry && (e.status === 409 || e.status === 422)) {
          return ghGetData().then(function (r) { S.sha = r.sha; return putData(true); });
        }
        throw e;
      });
    }
    chain.then(function () { return putData(false); }).then(function () {
      markDirty(false);
      toast("Publié ! L'écran du hall se mettra à jour d'ici 1 à 3 minutes.", 'ok');
    }).catch(function (e) {
      toast('La publication a échoué : ' + e.message, 'err');
    }).then(function () {
      btn.disabled = false; btn.textContent = 'Publier';
    });
  }

  /* ---------- Aperçu ---------- */
  var pvTimer = null;
  function sendPreview() {
    clearTimeout(pvTimer);
    pvTimer = setTimeout(function () {
      var f = $('#pv');
      if (!S.pvReady || !f.contentWindow || !S.data) return;
      var focus = S.tab === 'slides' ? S.sel : null;
      f.contentWindow.postMessage({ type: 'eafc-preview', data: S.data, images: S.images, focusId: focus }, location.origin);
      $('#pv-mode').textContent = focus ? 'Annonce sélectionnée' : 'Rotation normale';
    }, 120);
  }
  function scalePreview() {
    var box = $('#pv-frame');
    $('#pv').style.transform = 'scale(' + (box.clientWidth / 1920) + ')';
  }
  window.addEventListener('message', function (e) {
    if (e.origin === location.origin && e.data && e.data.type === 'eafc-preview-ready') { S.pvReady = true; sendPreview(); }
  });

  /* ---------- Vignettes ---------- */
  function thumb(layout, color, image) {
    var p = PANEL[color] || PANEL.teal, sh = SHAPE[color] || SHAPE.teal;
    var img = image ? 'background:#999 url(\'' + String(S.images[image] || '../' + image).replace(/['"()\\]/g, function (c) { return '%' + c.charCodeAt(0).toString(16); }) + '\') center/cover' : 'background:#B9C3C4';
    var bars = function (c1, c2) {
      return '<i style="left:8%;top:22%;width:14%;height:8%;border-radius:4px;background:' + sh + '"></i>' +
        '<i style="left:8%;top:38%;width:44%;height:13%;border-radius:3px;background:' + c1 + '"></i>' +
        '<i style="left:8%;top:58%;width:36%;height:6%;border-radius:3px;background:' + c2 + '"></i>' +
        '<i style="left:8%;top:68%;width:30%;height:6%;border-radius:3px;background:' + c2 + '"></i>';
    };
    var inner;
    switch (layout) {
      case 'image': inner = bars('#111', '#BBB') + '<i style="right:0;top:0;width:44%;height:100%;' + img + '"></i>'; break;
      case 'poster': inner = '<i style="inset:0;background:#222"></i><i style="left:32%;top:6%;width:36%;height:88%;' + img + '"></i>'; break;
      case 'announce': inner = '<i style="inset:0;background:' + p + '"></i>' + bars('#fff', 'rgba(255,255,255,.6)').replace('background:' + sh, 'background:#fff'); break;
      default: inner = bars('#111', '#BBB') + '<i style="right:0;top:0;width:30%;height:100%;background:' + p + '"></i><i style="right:12%;top:10%;width:12%;height:20%;border-radius:0 0 0 100%;background:' + sh + '"></i>';
    }
    return '<span class="thumb" aria-hidden="true">' + inner + '</span>';
  }

  /* ---------- Rendu ---------- */
  function switchTab(t) { S.tab = t; render(); sendPreview(); window.scrollTo(0, 0); }

  function render() {
    $$('.tab').forEach(function (b) { b.classList.toggle('on', b.dataset.tab === S.tab); b.setAttribute('aria-current', b.dataset.tab === S.tab ? 'page' : 'false'); });
    var ed = $('#editor');
    if (!S.data) { ed.innerHTML = '<p>Chargement…</p>'; return; }
    ed.innerHTML = ({ slides: viewSlides, courses: viewCourses, ticker: viewTicker, settings: viewSettings, github: viewGithub }[S.tab])();
  }

  /* ----- À la une ----- */
  function selSlide() {
    for (var i = 0; i < S.data.slides.length; i++) if (S.data.slides[i].id === S.sel) return S.data.slides[i];
    return null;
  }
  function slideMeta(s) {
    var L = LAYOUTS.filter(function (l) { return l.id === (s.layout || 'classic'); })[0];
    var bits = [L ? L.name : ''];
    bits.push((s.duration || S.data.settings.slideDuration) + ' s');
    if (s.start || s.end) bits.push((s.start ? 'du ' + fmtDate(s.start) : '') + (s.end ? ' au ' + fmtDate(s.end) : ''));
    if (s.wide) bits.push('pleine largeur');
    if (s.active === false) bits.push('masquée');
    return bits.join(' · ');
  }
  function fmtDate(iso) { var p = String(iso).split('-'); return p.length === 3 ? p[2] + '/' + p[1] : iso; }

  function viewSlides() {
    var list = S.data.slides.map(function (s, i) {
      return '<li class="slide-item' + (s.id === S.sel ? ' sel' : '') + (s.active === false ? ' off' : '') + '">' +
        '<button type="button" class="si-main" data-act="select" data-id="' + s.id + '">' + thumb(s.layout, s.color, s.image) +
        '<span class="si-txt"><strong>' + esc(plain(s.title) || plain(s.tag) || '(Sans titre)') + '</strong><small>' + esc(slideMeta(s)) + '</small></span></button>' +
        '<label class="switch" title="Afficher sur l\'écran"><input type="checkbox" data-act="toggle" data-id="' + s.id + '"' + (s.active !== false ? ' checked' : '') + ' aria-label="Afficher « ' + esc(plain(s.title) || 'annonce') + ' »"><span class="track"></span></label>' +
        '<button type="button" class="icon" data-act="up" data-id="' + s.id + '" aria-label="Monter"' + (i === 0 ? ' disabled' : '') + '>' + ICON.up + '</button>' +
        '<button type="button" class="icon" data-act="down" data-id="' + s.id + '" aria-label="Descendre"' + (i === S.data.slides.length - 1 ? ' disabled' : '') + '>' + ICON.down + '</button>' +
        '<button type="button" class="icon" data-act="dup" data-id="' + s.id + '" aria-label="Dupliquer">' + ICON.copy + '</button>' +
        '<button type="button" class="icon del" data-act="del" data-id="' + s.id + '" aria-label="Supprimer">' + ICON.del + '</button></li>';
    }).join('');
    return '<div class="panel-head"><h1>À la une</h1><button type="button" class="btn primary sm" data-act="add">+ Nouvelle annonce</button></div>' +
      '<p class="lead">Les annonces actives défilent l\'une après l\'autre dans le grand bloc. Cliquez sur une annonce pour la modifier ; l\'aperçu à droite la montre en direct.</p>' +
      (list ? '<ol class="slide-list">' + list + '</ol>' : '<div class="empty-state">Aucune annonce. L\'écran affiche un message de bienvenue.</div>') +
      slideForm();
  }

  function slideForm() {
    var s = selSlide();
    if (!s) return '';
    var lay = s.layout || 'classic', col = s.color || 'teal';
    var picker = LAYOUTS.map(function (l) {
      return '<label class="lp"><input type="radio" name="layout" value="' + l.id + '" data-f="layout"' + (l.id === lay ? ' checked' : '') + '>' +
        thumb(l.id, col, s.image) + '<b>' + l.name + '</b><small>' + l.desc + '</small></label>';
    }).join('');
    var sw = COLORS.map(function (c) {
      return '<label class="sw"><input type="radio" name="color" value="' + c.id + '" data-f="color"' + (c.id === col ? ' checked' : '') + '><i style="background:' + c.css + '"></i>' + c.name + '</label>';
    }).join('');
    function txt(f, label, opt, ph, cls) {
      return '<div class="field ' + (cls || '') + '"><label for="f-' + f + '">' + label + (opt ? ' <span class="opt">' + opt + '</span>' : '') + '</label>' +
        '<input type="text" id="f-' + f + '" data-f="' + f + '" value="' + esc(s[f]) + '" placeholder="' + esc(ph || '') + '"></div>';
    }
    function area(f, label, opt, ph, cls) {
      return '<div class="field ' + (cls || '') + '"><label for="f-' + f + '">' + label + (opt ? ' <span class="opt">' + opt + '</span>' : '') + '</label>' +
        '<textarea id="f-' + f + '" data-f="' + f + '" rows="' + (f === 'title' ? 2 : 3) + '" placeholder="' + esc(ph || '') + '">' + esc(s[f]) + '</textarea></div>';
    }
    var imgUrl = s.image ? (S.images[s.image] || '../' + s.image) : '';
    return '<section class="card form" data-layout="' + lay + '" aria-labelledby="form-title">' +
      '<h2 id="form-title">Modifier l\'annonce</h2><p class="hint">Astuce : entourez un mot d\'astérisques pour le mettre en couleur, par ex. <code>Aide-soignant*·e*</code>.</p>' +
      '<fieldset><legend>Mise en page</legend><div class="layout-picker">' + picker + '</div></fieldset>' +
      '<div class="grid2"><fieldset><legend>Couleurs</legend><div class="swatches">' + sw + '</div></fieldset>' +
      '<fieldset><legend>Largeur</legend><div class="seg">' +
      '<label><input type="radio" name="wide" value="0" data-f="wide"' + (!s.wide ? ' checked' : '') + '>Normale</label>' +
      '<label><input type="radio" name="wide" value="1" data-f="wide"' + (s.wide ? ' checked' : '') + '>Plein écran</label></div>' +
      '<p class="hint">« Plein écran » masque les cours du jour pendant cette annonce.</p></fieldset></div>' +

      '<div class="only-image"><div class="field"><span class="legend">' + (lay === 'poster' ? 'Affiche' : 'Photo') + '</span><div class="img-box">' +
      '<div class="img-prev" style="' + (imgUrl ? 'background-image:url(' + esc(JSON.stringify(imgUrl)) + ')' : '') + '">' + (imgUrl ? '' : 'Aucune image') + '</div>' +
      '<div class="row-actions"><span class="btn ghost sm file-btn">Choisir une image…<input type="file" accept="image/*" data-act="image" aria-label="Choisir une image"></span>' +
      (s.image ? '<button type="button" class="btn danger sm" data-act="rmimage">Retirer</button>' : '') + '</div></div>' +
      '<p class="hint">JPG ou PNG. Format paysage 16:9 conseillé. L\'image est réduite automatiquement.</p></div>' +
      '<div class="only-poster"><fieldset><legend>Cadrage de l\'affiche</legend><div class="seg">' +
      '<label><input type="radio" name="fit" value="contain" data-f="fit"' + (s.fit !== 'cover' ? ' checked' : '') + '>Image entière</label>' +
      '<label><input type="radio" name="fit" value="cover" data-f="fit"' + (s.fit === 'cover' ? ' checked' : '') + '>Remplir le cadre</label></div></fieldset></div></div>' +

      '<div class="only-text"><div class="grid2">' + txt('tag', 'Étiquette', '(pastille)', 'À la une') + txt('kicker', 'Sur-titre', '(optionnel)', 'Inscriptions ouvertes') + '</div>' +
      area('title', 'Titre', '', 'Aide-soignant*·e*') +
      area('text', 'Texte', '(optionnel)', 'Quelques mots pour présenter…') +
      '<div class="grid2">' + txt('footerLabel', 'Bas – petite ligne', '(optionnel)', 'Infos et inscriptions') + txt('footerText', 'Bas – texte en gras', '(optionnel)', 'À l\'accueil') + '</div></div>' +
      '<div class="only-poster">' + txt('title', 'Nom de l\'affiche', '(pour la liste, non affiché)', 'Portes ouvertes').replace(/f-title/g, 'f-title-poster') + '</div>' +

      '<div class="grid2">' + txt('qr', 'Lien du QR code', '(optionnel)', 'https://eafcandenne.be/…') + txt('qrLabel', 'Texte sous le QR code', '(optionnel)', 'eafcandenne.be') + '</div>' +
      '<div class="grid3">' +
      '<div class="field"><label for="f-duration">Durée d\'affichage <span class="opt">(secondes)</span></label><input type="number" min="3" max="300" id="f-duration" data-f="duration" value="' + esc(s.duration) + '" placeholder="' + esc(S.data.settings.slideDuration) + ' (par défaut)"></div>' +
      '<div class="field"><label for="f-start">Afficher à partir du <span class="opt">(optionnel)</span></label><input type="date" id="f-start" data-f="start" value="' + esc(s.start) + '"></div>' +
      '<div class="field"><label for="f-end">Jusqu\'au <span class="opt">(inclus)</span></label><input type="date" id="f-end" data-f="end" value="' + esc(s.end) + '"></div>' +
      '</div></section>';
  }

  function newSlide() {
    return { id: uid('s'), active: true, layout: 'classic', color: 'teal', wide: false, tag: 'À la une', kicker: '', title: 'Nouvelle *annonce*', text: '', footerLabel: '', footerText: '', qr: '', qrLabel: '', image: '', fit: 'contain', duration: '', start: '', end: '' };
  }

  function moveIn(arr, id, dir) {
    var i = arr.findIndex(function (x) { return x.id === id; }), j = i + dir;
    if (i < 0 || j < 0 || j >= arr.length) return;
    var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }

  /* ----- Planning ----- */
  function viewCourses() {
    var today = new Date().getDay() || 7;
    var week = '';
    for (var d = 1; d <= 7; d++) {
      var items = coursesOf(d);
      week += '<button type="button" class="week-col' + (d === S.day ? ' on' : '') + '" data-act="day" data-day="' + d + '" aria-pressed="' + (d === S.day) + '">' +
        '<h3>' + DAYS[d] + (d === today ? ' •' : '') + '</h3>' +
        (items.length ? items.map(function (c) { return '<div class="wk-item' + (c.status === 'cancelled' ? ' x' : '') + '">' + esc(c.start || '') + ' ' + esc(c.name || '…') + '</div>'; }).join('') : '<small style="color:#999">—</small>') +
        '</button>';
    }
    var list = coursesOf(S.day);
    return '<div class="panel-head"><h1>Planning des cours</h1><button type="button" class="btn primary sm" data-act="addcourse">+ Ajouter un cours le ' + DAYS[S.day].toLowerCase() + '</button></div>' +
      '<p class="lead">Encodez la semaine type une seule fois. Chaque jour, l\'écran affiche les cours du jour, retire ceux qui sont terminés et signale celui « en cours ». Le soir, il annonce les cours du lendemain.</p>' +
      '<div class="week" role="group" aria-label="Choisir le jour">' + week + '</div>' +
      '<h2 style="margin-bottom:12px">' + DAYS[S.day] + ' – ' + list.length + ' cours</h2>' +
      (list.length ? list.map(courseCard).join('') : '<div class="empty-state">Aucun cours le ' + DAYS[S.day].toLowerCase() + '.</div>');
  }
  function coursesOf(day) {
    return S.data.courses.filter(function (c) { return (c.days || []).indexOf(day) >= 0; })
      .sort(function (a, b) { return mins(a.start) - mins(b.start); });
  }
  function courseCard(c) {
    var id = c.id;
    var chips = '';
    for (var d = 1; d <= 7; d++) {
      var on = (c.days || []).indexOf(d) >= 0;
      chips += '<button type="button" class="dc" data-act="cday" data-id="' + id + '" data-day="' + d + '" aria-pressed="' + on + '" aria-label="' + DAYS[d] + '" title="' + DAYS[d] + '">' + DAYS_SHORT[d] + '</button>';
    }
    function f(name, label, type, ph) {
      return '<div class="field"><label for="c-' + name + '-' + id + '">' + label + '</label><input type="' + (type || 'text') + '" id="c-' + name + '-' + id + '" data-c="' + name + '" data-id="' + id + '" value="' + esc(c[name]) + '" placeholder="' + esc(ph || '') + '"></div>';
    }
    var hasPeriod = c.from || c.to;
    return '<div class="course' + (c.status === 'cancelled' ? ' cancelled' : '') + (hasPeriod ? ' open' : '') + '" data-card="' + id + '">' +
      '<div class="course-top">' + f('start', 'Début', 'time') + f('end', 'Fin', 'time') + f('name', 'Formation', 'text', 'Anglais') + f('kind', 'Type / sous-titre', 'text', 'Cours du soir') + f('room', 'Local', 'text', 'A1') + '</div>' +
      '<div class="course-bot"><div><span class="hint" style="display:block;margin:0 0 4px">Jours</span><div class="daychips">' + chips + '</div></div>' +
      '<div class="field"><label for="c-status-' + id + '">Statut</label><select id="c-status-' + id + '" data-c="status" data-id="' + id + '">' +
      '<option value="normal"' + (c.status !== 'cancelled' && c.status !== 'changed' ? ' selected' : '') + '>Normal</option>' +
      '<option value="cancelled"' + (c.status === 'cancelled' ? ' selected' : '') + '>Annulé</option>' +
      '<option value="changed"' + (c.status === 'changed' ? ' selected' : '') + '>Modifié</option></select></div>' +
      '<div class="field grow"><label for="c-note-' + id + '">Message <span class="opt">(remplace le type, ex. « Déplacé au local B3 »)</span></label><input type="text" id="c-note-' + id + '" data-c="note" data-id="' + id + '" value="' + esc(c.note) + '"></div>' +
      '<button type="button" class="icon" data-act="cperiod" data-id="' + id + '" aria-label="Période de validité" title="Période de validité (dates)">' + ICON.more + '</button>' +
      '<button type="button" class="icon" data-act="cdup" data-id="' + id + '" aria-label="Dupliquer">' + ICON.copy + '</button>' +
      '<button type="button" class="icon del" data-act="cdel" data-id="' + id + '" aria-label="Supprimer">' + ICON.del + '</button></div>' +
      '<div class="course-more">' + f('from', 'Valable à partir du', 'date') + f('to', "Jusqu'au", 'date') + '</div>' +
      '</div>';
  }
  function findCourse(id) { return S.data.courses.filter(function (c) { return c.id === id; })[0]; }
  function refreshWeek() {
    var html = viewCourses();
    var tmp = document.createElement('div'); tmp.innerHTML = html;
    $('.week').replaceWith(tmp.querySelector('.week'));
  }

  /* ----- Bandeau ----- */
  function viewTicker() {
    var rows = S.data.ticker.map(function (t, i) {
      return '<div class="tick-row">' +
        '<label class="switch" title="Afficher"><input type="checkbox" data-act="ttoggle" data-id="' + t.id + '"' + (t.active !== false ? ' checked' : '') + ' aria-label="Afficher ce message"><span class="track"></span></label>' +
        '<input type="text" data-t="text" data-id="' + t.id + '" value="' + esc(t.text) + '" aria-label="Message ' + (i + 1) + '" placeholder="Votre message…">' +
        '<button type="button" class="icon" data-act="tup" data-id="' + t.id + '" aria-label="Monter"' + (i === 0 ? ' disabled' : '') + '>' + ICON.up + '</button>' +
        '<button type="button" class="icon" data-act="tdown" data-id="' + t.id + '" aria-label="Descendre"' + (i === S.data.ticker.length - 1 ? ' disabled' : '') + '>' + ICON.down + '</button>' +
        '<button type="button" class="icon del" data-act="tdel" data-id="' + t.id + '" aria-label="Supprimer">' + ICON.del + '</button></div>';
    }).join('');
    return '<div class="panel-head"><h1>Bandeau défilant</h1><button type="button" class="btn primary sm" data-act="tadd">+ Ajouter un message</button></div>' +
      '<p class="lead">Les messages défilent en bas de l\'écran. Sans message actif, le bandeau disparaît. Les <code>*astérisques*</code> mettent un mot en couleur.</p>' +
      (rows || '<div class="empty-state">Aucun message.</div>') +
      '<div class="card" style="margin-top:18px"><div class="grid2">' +
      setField('tickerLabel', 'Libellé du bandeau', 'text') + setField('tickerSpeed', 'Vitesse de défilement', 'number', 'pixels par seconde, 110 par défaut') + '</div></div>';
  }

  /* ----- Réglages ----- */
  function setField(k, label, type, hint) {
    var v = S.data.settings[k];
    return '<div class="field"><label for="s-' + k + '">' + label + '</label>' +
      (type === 'textarea'
        ? '<textarea id="s-' + k + '" data-s="' + k + '" rows="2">' + esc(v) + '</textarea>'
        : '<input type="' + type + '" id="s-' + k + '" data-s="' + k + '" value="' + esc(v) + '">') +
      (hint ? '<p class="hint">' + hint + '</p>' : '') + '</div>';
  }
  function setSwitch(k, label, hint) {
    return '<div class="field"><label class="switch"><input type="checkbox" data-s="' + k + '"' + (S.data.settings[k] ? ' checked' : '') + '><span class="track"></span>' + label + '</label>' +
      (hint ? '<p class="hint" style="margin-top:-6px">' + hint + '</p>' : '') + '</div>';
  }
  var ARROWS = [['right', '→ Droite'], ['left', '← Gauche'], ['up', '↑ Tout droit / en haut'], ['down', '↓ En bas'], ['upright', '↗ Droite en haut'], ['upleft', '↖ Gauche en haut'], ['downright', '↘ Droite en bas'], ['downleft', '↙ Gauche en bas']];
  function viewSigns() {
    var signs = S.data.settings.signs;
    var rows = signs.map(function (g, i) {
      return '<div class="tick-row">' +
        '<label class="switch" title="Afficher"><input type="checkbox" data-act="signtoggle" data-i="' + i + '"' + (g.active !== false ? ' checked' : '') + ' aria-label="Afficher ce panneau"><span class="track"></span></label>' +
        '<input type="text" data-sign="text" data-i="' + i + '" value="' + esc(g.text) + '" aria-label="Texte du panneau ' + (i + 1) + '" placeholder="Secrétariat">' +
        '<select data-sign="arrow" data-i="' + i + '" aria-label="Direction de la flèche" style="width:auto;min-width:200px">' +
        ARROWS.map(function (a) { return '<option value="' + a[0] + '"' + (g.arrow === a[0] ? ' selected' : '') + '>' + a[1] + '</option>'; }).join('') + '</select>' +
        '<button type="button" class="icon del" data-act="signdel" data-i="' + i + '" aria-label="Supprimer ce panneau">' + ICON.del + '</button></div>';
    }).join('');
    return '<section class="card"><h2>Panneau d\'orientation</h2><p class="hint" style="margin-bottom:14px">Affiché en haut de l\'écran, entre le logo et l\'heure. Jusqu\'à 3 panneaux.</p>' +
      (rows || '<p class="hint">Aucun panneau.</p>') +
      (signs.length < 3 ? '<button type="button" class="btn ghost sm" data-act="signadd" style="margin-top:6px">+ Ajouter un panneau</button>' : '') + '</section>';
  }

  function viewSettings() {
    var st = S.data.settings;
    return '<div class="panel-head"><h1>Textes &amp; réglages</h1></div><p class="lead">Tous les textes fixes de l\'écran et son comportement.</p>' + viewSigns() +
      '<section class="card"><h2>Apparence</h2><fieldset><legend>Thème de l\'écran</legend><div class="seg">' +
      '<label><input type="radio" name="theme" value="light" data-s="theme"' + (st.theme !== 'dark' ? ' checked' : '') + '>Clair</label>' +
      '<label><input type="radio" name="theme" value="dark" data-s="theme"' + (st.theme === 'dark' ? ' checked' : '') + '>Sombre</label></div></fieldset>' +
      setField('slideDuration', 'Durée par défaut d\'une annonce (secondes)', 'number') + '</section>' +
      '<section class="card"><h2>Bloc « Cours du jour »</h2>' +
      setField('scheduleTitle', 'Titre du bloc', 'text') +
      setField('scheduleFooter', 'Phrase en bas du bloc', 'text', 'Laissez vide pour la masquer.') +
      setField('scheduleEmpty', 'Message quand il n\'y a plus de cours', 'textarea') +
      setSwitch('hideFinished', 'Retirer automatiquement les cours terminés') +
      setSwitch('showTomorrow', 'Après le dernier cours, afficher ceux du prochain jour de cours') +
      '<div class="grid2">' + setField('scheduleRows', 'Cours par page', 'number', 'Au-delà, les pages alternent.') + setField('schedulePageSeconds', 'Changement de page (secondes)', 'number') + '</div></section>' +
      '<section class="card"><h2>Mise à jour de l\'écran</h2>' + setField('refreshMinutes', 'L\'écran vérifie les nouveautés toutes les (minutes)', 'number') + '</section>';
  }

  /* ----- Accès & connexion ----- */
  function viewGithub() {
    var c = S.cfg;
    var codes;
    var addForm = '<div class="grid3" style="margin-top:14px">' +
      '<div class="field"><label for="a-name">Identifiant</label><input type="text" id="a-name" placeholder="secretariat" autocomplete="off" autocapitalize="off"></div>' +
      '<div class="field"><label for="a-pw">Mot de passe <span class="opt">(10 caractères min.)</span></label><input type="password" id="a-pw" autocomplete="new-password"></div>' +
      '<div class="field"><label for="a-pw2">Confirmer</label><input type="password" id="a-pw2" autocomplete="new-password"></div></div>' +
      '<button type="button" class="btn primary sm" data-act="acadd">Créer l\'utilisateur</button>';
    if (!S.connected) {
      codes = '<p class="hint">Connexion à GitHub impossible pour le moment. Si la clé GitHub a expiré, renouvelez-la dans « Configuration technique » plus bas.</p>';
    } else if (S.access && S.mk) {
      codes = '<div>' + S.access.users.map(function (u) {
        var editing = S.pwEdit === u.id;
        return '<div class="tick-row" style="flex-wrap:wrap"><span style="flex:1;min-width:200px"><strong>' + esc(u.name) + '</strong> <span class="hint" style="display:inline">· ' + (u.changed ? 'modifié le ' + esc(fmtDate(u.changed)) : 'créé le ' + esc(fmtDate(u.created || ''))) + (u.name === c.user ? ' · <em>vous</em>' : '') + '</span></span>' +
          '<button type="button" class="btn ghost sm" data-act="acpw" data-id="' + u.id + '"' + (editing ? ' aria-expanded="true"' : '') + '>Changer le mot de passe</button>' +
          '<button type="button" class="icon del" data-act="acdel" data-id="' + u.id + '" aria-label="Supprimer l\'utilisateur ' + esc(u.name) + '">' + ICON.del + '</button>' +
          (editing ? '<div style="flex-basis:100%;display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap;padding:10px 4px 4px">' +
            '<div class="field" style="margin:0;flex:1;min-width:180px"><label for="pw-new">Nouveau mot de passe <span class="opt">(10 caractères min.)</span></label><input type="password" id="pw-new" autocomplete="new-password"></div>' +
            '<div class="field" style="margin:0;flex:1;min-width:180px"><label for="pw-new2">Confirmer</label><input type="password" id="pw-new2" autocomplete="new-password"></div>' +
            '<button type="button" class="btn primary sm" data-act="acpwsave" data-id="' + u.id + '">Enregistrer</button>' +
            '<button type="button" class="btn ghost sm" data-act="acpwcancel">Annuler</button></div>' : '') +
          '</div>';
      }).join('') + '</div><h3 style="margin:18px 0 0;font-size:16px">Ajouter un utilisateur</h3>' + addForm;
    } else {
      codes = '<p class="hint">Pour repartir de zéro, créez un nouvel utilisateur : il <strong>remplacera tous les autres</strong>.</p>' + addForm;
    }
    return '<div class="panel-head"><h1>Utilisateurs</h1></div>' +
      '<p class="lead">Chaque personne se connecte à l\'admin avec son <strong>identifiant</strong> et son <strong>mot de passe</strong>.</p>' +
      '<section class="card"><h2>Comptes</h2>' + codes +
      '<p class="hint" style="margin-top:14px">Les mots de passe ne sont jamais enregistrés en clair. Supprimer un utilisateur l\'empêche de se connecter.</p></section>' +
      '<details class="card"' + (S.connected ? '' : ' open') + '><summary><h2 style="display:inline">Configuration technique</h2> <span class="hint" style="display:inline">(clé GitHub – à renouveler une fois par an)</span></summary>' +
      '<p class="hint" style="margin:10px 0 16px">' + (S.connected ? '✓ Le site enregistre bien dans <strong>' + esc(c.owner + '/' + c.repo) + '</strong>. Rien à faire ici' : 'L\'admin n\'arrive pas à enregistrer sur GitHub : la clé a sans doute expiré') + '. Quand la clé expire, créez-en une nouvelle et collez-la ici : les identifiants et mots de passe restent valables.</p>' +
      '<div class="grid3">' +
      '<div class="field"><label for="g-owner">Compte GitHub</label><input type="text" id="g-owner" value="' + esc(c.owner) + '" placeholder="eafc-andenne" autocomplete="off"></div>' +
      '<div class="field"><label for="g-repo">Dépôt</label><input type="text" id="g-repo" value="' + esc(c.repo) + '" placeholder="affichage-hall" autocomplete="off"></div>' +
      '<div class="field"><label for="g-branch">Branche</label><input type="text" id="g-branch" value="' + esc(c.branch) + '" placeholder="main" autocomplete="off"></div></div>' +
      '<div class="field"><label for="g-token">Nouvelle clé GitHub</label><input type="password" id="g-token" value="" placeholder="github_pat_…" autocomplete="off"></div>' +
      '<div class="row-actions"><button type="button" class="btn teal" data-act="gconnect">Enregistrer la nouvelle clé</button>' +
      (c.token ? '<button type="button" class="btn ghost" data-act="greload">Recharger depuis GitHub</button>' : '') + '</div>' +
      '<h3 style="margin:22px 0 8px;font-size:16px">Créer la clé</h3><ol class="steps">' +
      '<li>Sur GitHub : <strong>Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token</strong>.</li>' +
      '<li><strong>Resource owner</strong> : l\'organisation qui possède le dépôt. <strong>Repository access</strong> : « Only select repositories » → le dépôt de l\'affichage.</li>' +
      '<li><strong>Permissions → Repository permissions → Contents</strong> : « Read and write ».</li>' +
      '<li>Choisissez une date d\'expiration (par ex. 1 an), générez, copiez le jeton et collez-le ci-dessus.</li></ol></details>' +
      '<section class="card"><h2>Sauvegarde</h2><p class="hint" style="margin-bottom:12px">Téléchargez une copie de tout le contenu, ou restaurez-en une.</p>' +
      '<div class="row-actions"><button type="button" class="btn ghost" data-act="export">Télécharger data.json</button>' +
      '<span class="btn ghost file-btn">Importer un fichier…<input type="file" accept="application/json,.json" data-act="import" aria-label="Importer un fichier data.json"></span></div></section>';
  }

  /* ---------- Événements ---------- */
  document.addEventListener('click', function (e) {
    var tab = e.target.closest('.tab');
    if (tab) return switchTab(tab.dataset.tab);
    var el = e.target.closest('[data-act]');
    if (!el || el.tagName === 'INPUT') return;
    var act = el.dataset.act, id = el.dataset.id, sl = S.data && S.data.slides;
    switch (act) {
      case 'select': S.sel = id; render(); sendPreview(); break;
      case 'add': var n = newSlide(); sl.push(n); S.sel = n.id; render(); changed(); $('#f-title') && $('#f-title').focus(); break;
      case 'up': moveIn(sl, id, -1); render(); changed(); break;
      case 'down': moveIn(sl, id, 1); render(); changed(); break;
      case 'dup':
        var src = sl.filter(function (s) { return s.id === id; })[0], cp = clone(src);
        cp.id = uid('s'); sl.splice(sl.indexOf(src) + 1, 0, cp); S.sel = cp.id; render(); changed(); break;
      case 'del':
        var s0 = sl.filter(function (s) { return s.id === id; })[0];
        if (!confirm('Supprimer l\'annonce « ' + (plain(s0.title) || 'sans titre') + ' » ?')) return;
        S.data.slides = sl.filter(function (s) { return s.id !== id; });
        if (S.sel === id) S.sel = S.data.slides[0] ? S.data.slides[0].id : null;
        render(); changed(); break;
      case 'rmimage': selSlide().image = ''; render(); changed(); break;

      case 'day': S.day = +el.dataset.day; render(); break;
      case 'addcourse':
        var c = { id: uid('c'), days: [S.day], start: '', end: '', name: '', kind: '', room: '', status: 'normal', note: '', from: '', to: '' };
        S.data.courses.push(c); render(); changed();
        var inp = document.getElementById('c-start-' + c.id); if (inp) { inp.scrollIntoView({ block: 'center' }); inp.focus(); }
        break;
      case 'cday':
        var cc = findCourse(id), d = +el.dataset.day, on = cc.days.indexOf(d) >= 0;
        if (on && cc.days.length === 1) { toast('Un cours doit avoir au moins un jour. Utilisez Supprimer pour le retirer.'); return; }
        cc.days = on ? cc.days.filter(function (x) { return x !== d; }) : cc.days.concat(d).sort();
        el.setAttribute('aria-pressed', String(!on));
        refreshWeek(); changed(); break;
      case 'cperiod': el.closest('.course').classList.toggle('open'); break;
      case 'cdup':
        var orig = findCourse(id), dup = clone(orig); dup.id = uid('c');
        S.data.courses.splice(S.data.courses.indexOf(orig) + 1, 0, dup); render(); changed(); break;
      case 'cdel':
        var co = findCourse(id);
        var msg = co.days.length > 1
          ? 'Ce cours a lieu plusieurs jours (' + co.days.map(function (x) { return DAYS[x]; }).join(', ') + '). Le supprimer de toute la semaine ?\n\nAstuce : pour le retirer d\'un seul jour, décochez ce jour.'
          : 'Supprimer le cours « ' + (co.name || 'sans nom') + ' » ?';
        if (!confirm(msg)) return;
        S.data.courses = S.data.courses.filter(function (x) { return x.id !== id; }); render(); changed(); break;

      case 'tadd': S.data.ticker.push({ id: uid('t'), active: true, text: '' }); render(); changed(); var ins = $$('[data-t=text]'); ins[ins.length - 1].focus(); break;
      case 'tup': moveIn(S.data.ticker, id, -1); render(); changed(); break;
      case 'tdown': moveIn(S.data.ticker, id, 1); render(); changed(); break;
      case 'tdel': S.data.ticker = S.data.ticker.filter(function (t) { return t.id !== id; }); render(); changed(); break;

      case 'signadd': S.data.settings.signs.push({ id: uid('g'), text: '', arrow: 'right', active: true }); render(); changed(); var gi = $$('[data-sign=text]'); gi[gi.length - 1].focus(); break;
      case 'signdel': S.data.settings.signs.splice(+el.dataset.i, 1); render(); changed(); break;
      case 'gconnect': connect(); break;
      case 'greload':
        if (S.dirty && !confirm('Abandonner les modifications non publiées et recharger depuis GitHub ?')) return;
        clearDraft(); markDirty(false); load(); break;
      case 'logout': logout(); break;
      case 'acadd': addAccess(); break;
      case 'acdel': deleteAccess(id); break;
      case 'acpw': S.pwEdit = S.pwEdit === id ? null : id; render(); if (S.pwEdit) $('#pw-new').focus(); break;
      case 'acpwcancel': S.pwEdit = null; render(); break;
      case 'acpwsave': changePassword(id); break;
      case 'export': exportJson(); break;
    }
  });

  document.addEventListener('input', function (e) {
    var t = e.target;
    if (t.dataset.f) {                        // champ d'annonce
      var s = selSlide(); if (!s) return;
      var f = t.dataset.f, v = t.value;
      if (t.type === 'radio' && !t.checked) return;
      if (f === 'wide') v = v === '1';
      s[f] = v;
      if (f === 'layout') { $('.form').dataset.layout = v; render(); restoreFocus('input[name=layout]:checked'); }
      else if (f === 'color') { render(); restoreFocus('input[name=color]:checked'); }
      else if (f === 'title' || f === 'tag') {
        var li = $('.slide-item.sel strong'); if (li) li.textContent = plain(s.title) || plain(s.tag) || '(Sans titre)';
      }
      changed();
    } else if (t.dataset.c) {                 // champ de cours
      var c = findCourse(t.dataset.id); if (!c) return;
      c[t.dataset.c] = t.value;
      if (t.dataset.c === 'status') t.closest('.course').classList.toggle('cancelled', t.value === 'cancelled');
      if (['start', 'name', 'status'].indexOf(t.dataset.c) >= 0) refreshWeek();
      changed();
    } else if (t.dataset.t) {                 // message du bandeau
      var m = S.data.ticker.filter(function (x) { return x.id === t.dataset.id; })[0];
      if (m) { m.text = t.value; changed(); }
    } else if (t.dataset.sign) {              // panneau d'orientation
      var g = S.data.settings.signs[+t.dataset.i];
      if (g) { g[t.dataset.sign] = t.value; changed(); }
    } else if (t.dataset.s) {                 // réglage
      var k = t.dataset.s;
      if (t.type === 'radio' && !t.checked) return;
      S.data.settings[k] = t.type === 'checkbox' ? t.checked : (t.type === 'number' ? (t.value === '' ? '' : +t.value) : t.value);
      changed();
    }
  });

  document.addEventListener('change', function (e) {
    var t = e.target;
    if (t.dataset.act === 'toggle') {
      var s = S.data.slides.filter(function (x) { return x.id === t.dataset.id; })[0];
      s.active = t.checked; t.closest('.slide-item').classList.toggle('off', !t.checked);
      var small = t.closest('.slide-item').querySelector('small'); if (small) small.textContent = slideMeta(s);
      changed();
    } else if (t.dataset.act === 'signtoggle') {
      S.data.settings.signs[+t.dataset.i].active = t.checked; changed();
    } else if (t.dataset.act === 'ttoggle') {
      var m = S.data.ticker.filter(function (x) { return x.id === t.dataset.id; })[0];
      m.active = t.checked; changed();
    } else if (t.dataset.act === 'image' && t.files[0]) {
      addImage(t.files[0]);
    } else if (t.dataset.act === 'import' && t.files[0]) {
      importJson(t.files[0]);
    } else if (t.dataset.c && t.type === 'time') {
      render(); restoreFocus('#' + t.id);    // reclasse par heure
    }
  });

  function restoreFocus(sel) { var el = $(sel); if (el) el.focus(); }

  function connect() {
    S.cfg.owner = $('#g-owner').value.trim();
    S.cfg.repo = $('#g-repo').value.trim();
    S.cfg.branch = $('#g-branch').value.trim() || 'main';
    var newTok = $('#g-token').value.trim();
    if (newTok) S.cfg.token = newTok;
    saveCfg();
    testConnection().then(function (r) {
      S.sha = r.sha; setConnected(true);
      updateAccessToken().catch(function (e) { toast('Jeton enregistré, mais la mise à jour des codes a échoué : ' + e.message, 'err'); });
      if (!S.dirty) { S.data = normalize(r.data); if (S.data.slides[0]) S.sel = S.data.slides[0].id; }
      render(); sendPreview();
      toast('Connexion réussie ! Vous pouvez publier.', 'ok');
    }).catch(function (e) {
      setConnected(false);
      var m = e.status === 401 ? 'Jeton refusé (expiré ou mal copié).'
        : e.status === 404 ? 'Dépôt ou fichier data.json introuvable. Vérifiez le compte, le dépôt et les droits du jeton.'
        : e.message;
      toast('Connexion impossible : ' + m, 'err');
    });
  }

  /* ---------- Images ---------- */
  function addImage(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var img = new Image();
      img.onload = function () {
        var max = 1920, w = img.width, h = img.height, r = Math.min(1, max / Math.max(w, h));
        var cv = document.createElement('canvas');
        cv.width = Math.round(w * r); cv.height = Math.round(h * r);
        var ctx = cv.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
        ctx.drawImage(img, 0, 0, cv.width, cv.height);
        var url = cv.toDataURL('image/jpeg', 0.86);
        var name = file.name.replace(/\.[^.]+$/, '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'image';
        var path = 'uploads/' + Date.now() + '-' + name + '.jpg';
        S.images[path] = url;
        S.pending[path] = url.split(',')[1];
        selSlide().image = path;
        render(); changed();
        toast('Image ajoutée. Elle sera envoyée sur GitHub au moment de publier.');
      };
      img.onerror = function () { toast('Ce fichier n\'est pas une image lisible.', 'err'); };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  /* ---------- Import / export ---------- */
  function exportJson() {
    var blob = new Blob([JSON.stringify(S.data, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'data-affichage-' + new Date().toISOString().slice(0, 10) + '.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }
  function importJson(file) {
    var r = new FileReader();
    r.onload = function () {
      try {
        var d = JSON.parse(r.result);
        if (!confirm('Remplacer tout le contenu actuel par ce fichier ? (Rien n\'est publié avant que vous cliquiez sur Publier.)')) return;
        S.data = normalize(d); S.sel = S.data.slides[0] ? S.data.slides[0].id : null;
        render(); changed(); toast('Fichier importé. Vérifiez l\'aperçu puis publiez.');
      } catch (e) { toast('Fichier invalide.', 'err'); }
    };
    r.readAsText(file);
  }

  /* ---------- Démarrage ---------- */
  $('#publish').addEventListener('click', publish);
  window.addEventListener('beforeunload', function (e) { if (S.dirty) { e.preventDefault(); e.returnValue = ''; } });
  window.addEventListener('resize', scalePreview);
  if (window.ResizeObserver) new ResizeObserver(scalePreview).observe($('#pv-frame'));
  scalePreview();
  $('#logout').addEventListener('click', logout);
  if (S.cfg.mk) { try { S.mk = unb64(S.cfg.mk); } catch (e) { S.mk = null; } }
  render();
  document.body.classList.add('locked');
  fetchAccess().then(function (a) {
    S.access = a;
    if (a && !S.cfg.token) showLogin();
    else if (!a && !S.cfg.token) showSetup();
    else { document.body.classList.remove('locked'); load(); }
  });
})();
