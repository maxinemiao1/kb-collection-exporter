// ==UserScript==
// @name         全能收藏导出器（小红书 / B站 / 百度网盘）v2.0
// @namespace    http://workbuddy.ai/
// @version      2.0
// @description  在小红书收藏页 / B站收藏夹 / 百度网盘 导出收藏为 JSON（本地生成，Cookie 不出浏览器）。带实时条数显示与「停止并导出」按钮。
// @author       王经理 (WorkBuddy)
// @match        https://www.xiaohongshu.com/*
// @match        https://edith.xiaohongshu.com/*
// @match        https://space.bilibili.com/*
// @match        https://www.bilibili.com/*
// @match        https://pan.baidu.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const host = location.hostname;
  const isXHS = /xiaohongshu/.test(host);
  const isBili = /bilibili/.test(host);
  const isPan = /pan\.baidu/.test(host);
  if (!isXHS && !isBili && !isPan) return;

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function download(data, filename) {
    const b = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(b);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { document.body.removeChild(a); }, 0);
    return data.count;
  }

  // 滚动加载到底；stopFn() 返回 true 时立即中断；tickFn() 每滚一次回调（用于刷新条数）
  function scrollDown(stopFn, tickFn) {
    return (async function () {
      let lh = 0, s = 0;
      for (let i = 0; i < 600; i++) {
        if (stopFn()) break;
        window.scrollTo(0, document.body.scrollHeight);
        await sleep(700);
        const h = document.body.scrollHeight;
        if (h === lh) { s++; if (s >= 2) break; } else { s = 0; }
        lh = h;
        if (tickFn) tickFn();
      }
    })();
  }

  // 统一按钮：空闲态「📥 导出」→ 运行中「⏹ 停止 (N条)」→ 点停止则中断并导出已抓部分
  // run(ctrl) 为异步抓取逻辑，需自行调用 scrollDown(ctrl.stop, ctrl.tick) 并 return 条数
  function makeExporter(color, idleText, tipBase, run) {
    const st = { running: false, stopped: false };
    const btn = document.createElement('div');
    btn.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:99999;background:' + color +
      ';color:#fff;padding:10px 16px;border-radius:24px;font:14px/1.4 -apple-system,"PingFang SC",sans-serif;' +
      'cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.25);user-select:none;';
    btn.textContent = idleText;
    const tip = document.createElement('div');
    tip.style.cssText = 'position:fixed;right:16px;bottom:56px;z-index:99999;background:#222;color:#fff;' +
      'padding:6px 12px;border-radius:10px;font:12px/1.4 -apple-system,"PingFang SC",sans-serif;' +
      'max-width:280px;box-shadow:0 4px 14px rgba(0,0,0,.25);display:none;white-space:pre-line;';
    function mount() {
      if (!document.body.contains(btn)) { document.body.appendChild(btn); document.body.appendChild(tip); }
    }
    if (document.body) mount(); else window.addEventListener('load', mount);

    const ctrl = {
      stop: function () { return st.stopped; },
      tick: function () {}
    };
    btn.addEventListener('click', async function () {
      if (!st.running) {
        st.running = true; st.stopped = false;
        btn.textContent = '⏹ 停止 (0 条)';
        tip.style.display = 'block';
        tip.textContent = tipBase + '\n已抓 0 条（点按钮可随时停止并导出）';
        ctrl.tick = function () { btn.textContent = '⏹ 停止 (' + (window.__capLen || 0) + ' 条)'; };
        const c = await run(ctrl);
        st.running = false;
        btn.textContent = '📥 再导一次 (' + c + ')';
        tip.textContent = '✅ 已导出 ' + c + ' 条，把 JSON 发给王主管即可。';
        setTimeout(function () { tip.style.display = 'none'; }, 6000);
      } else {
        st.stopped = true;
        btn.textContent = '⏳ 正在导出已抓到的…';
      }
    });
  }

  function hookFetch(matcher, walker) {
    const of = window.fetch;
    window.fetch = function () {
      const a = arguments;
      const u = typeof a[0] === 'string' ? a[0] : (a[0] && a[0].url) || '';
      return of.apply(this, a).then(function (r) {
        try {
          if (matcher.test(u)) r.clone().json().then(function (d) { walker(d); }).catch(function () {});
        } catch (e) {}
        return r;
      });
    };
  }

  // ===================== 小红书 =====================
  if (isXHS) {
    const cap = [], seen = new Set();
    function pushN(n) {
      if (!n) return;
      const id = String(n.note_id || n.id || '');
      if (!id || seen.has(id)) return;
      seen.add(id);
      let cover = n.cover || '';
      if (!cover && n.cover_info && n.cover_info.url) cover = n.cover_info.url;
      let liked = n.liked_count || '';
      if (!liked && n.interact_info) liked = n.interact_info.liked_count || '';
      let user = '';
      if (n.user) user = n.user.nickname || n.user.username || '';
      cap.push({
        id: id,
        title: n.title || n.display_title || '',
        desc: n.desc || n.description || '',
        user: user,
        cover: cover,
        liked: liked,
        url: 'https://www.xiaohongshu.com/explore/' + id,
        time: n.time || n.create_time || ''
      });
    }
    function walk(o) {
      if (!o || typeof o !== 'object') return;
      if (Array.isArray(o)) { o.forEach(walk); return; }
      if (o.note_id || (o.id && (o.title || o.desc))) pushN(o);
      for (const k in o) if (o[k] && typeof o[k] === 'object') walk(o[k]);
    }
    function dom() {
      document.querySelectorAll('section.notes-item, a.cover, .note-item, .cover').forEach(function (card) {
        const a = card.tagName === 'A' ? card : card.querySelector('a');
        if (!a) return;
        const href = a.getAttribute('href') || '';
        const m = href.match(/\/explore\/([A-Za-z0-9]+)/) || href.match(/\/discovery\/item\/([A-Za-z0-9]+)/);
        if (!m) return;
        const id = m[1];
        if (seen.has(id)) return;
        const t = card.querySelector('.title, .content, .footer .title');
        const img = card.querySelector('img');
        pushN({ id: id, title: t ? t.textContent.trim() : '', cover: img ? img.src : '', desc: '' });
      });
    }
    hookFetch(/note|collect|feed|v1\//, walk);
    makeExporter('#ff2e4d', '📥 导出收藏', '小红书：正在滚动加载收藏…', async function (ctrl) {
      window.__capLen = cap.length;
      const _push = pushN;
      await scrollDown(ctrl.stop, function () { window.__capLen = cap.length; });
      dom();
      window.__capLen = cap.length;
      return download({ source: 'xiaohongshu_collect', exportedAt: new Date().toISOString(), count: cap.length, notes: cap }, 'xiaohongshu_collect_' + Date.now() + '.json');
    });
  }

  // ===================== B站 =====================
  else if (isBili) {
    const cap = [], seen = new Set();
    function push(n) {
      if (!n) return;
      const id = n.bvid || n.aid || n.id || '';
      if (!id || seen.has('' + id)) return;
      seen.add('' + id);
      let author = '';
      if (n.upper) author = n.upper.name || '';
      else if (n.owner) author = n.owner.name || '';
      let play = '';
      if (n.cnt_info) play = n.cnt_info.play || '';
      else if (n.stat) play = n.stat.view || '';
      cap.push({
        id: '' + id,
        title: n.title || '',
        desc: n.intro || n.description || '',
        author: author,
        cover: n.cover || (n.pic || ''),
        url: n.bvid ? ('https://www.bilibili.com/video/' + n.bvid) : ('https://www.bilibili.com/video/av' + id),
        play: play,
        time: n.fav_time || n.pubdate || ''
      });
    }
    function walk(o) {
      if (!o || typeof o !== 'object') return;
      if (Array.isArray(o)) { o.forEach(walk); return; }
      if (o.bvid || o.aid || (o.id && (o.title || o.intro))) push(o);
      for (const k in o) if (o[k] && typeof o[k] === 'object') walk(o[k]);
    }
    function dom() {
      document.querySelectorAll('a[href*="/video/BV"], .small-item, .video-list a').forEach(function (el) {
        const a = el.tagName === 'A' ? el : el.querySelector('a');
        if (!a) return;
        const m = (a.getAttribute('href') || '').match(/\/video\/(BV[0-9A-Za-z]+)/);
        if (!m) return;
        const bv = m[1];
        if (seen.has(bv)) return;
        const t = el.querySelector('.title, .small-item__title');
        const img = el.querySelector('img');
        push({ bvid: bv, title: t ? t.textContent.trim() : '', cover: img ? img.src : '' });
      });
    }
    hookFetch(/fav|x\/v3\/fav|x\/v2\/history|watchlater/, walk);
    makeExporter('#fb7299', '📥 导出B站收藏', 'B站：正在滚动加载收藏夹…', async function (ctrl) {
      window.__capLen = cap.length;
      await scrollDown(ctrl.stop, function () { window.__capLen = cap.length; });
      dom();
      window.__capLen = cap.length;
      return download({ source: 'bilibili_fav', exportedAt: new Date().toISOString(), count: cap.length, notes: cap }, 'bilibili_fav_' + Date.now() + '.json');
    });
  }

  // ===================== 百度网盘 =====================
  else if (isPan) {
    const cap = [], seen = new Set();
    function push(n) {
      if (!n) return;
      const id = n.fs_id || n.path || n.server_filename || '';
      if (!id || seen.has('' + id)) return;
      seen.add('' + id);
      const size = n.size || 0;
      cap.push({
        id: '' + id,
        name: n.server_filename || n.filename || '',
        path: n.path || '',
        isDir: !!n.isdir,
        size: size,
        sizeText: size ? (size / 1024 / 1024).toFixed(2) + ' MB' : '',
        md5: n.md5 || '',
        mtime: n.server_mtime ? new Date(n.server_mtime * 1000).toISOString() : '',
        url: n.path ? ('https://pan.baidu.com' + n.path) : ''
      });
    }
    function walk(o) {
      if (!o || typeof o !== 'object') return;
      if (Array.isArray(o)) { o.forEach(walk); return; }
      if (o.list && Array.isArray(o.list)) { o.list.forEach(push); return; }
      if (o.server_filename || o.fs_id) push(o);
      for (const k in o) if (o[k] && typeof o[k] === 'object') walk(o[k]);
    }
    function dom() {
      document.querySelectorAll('li[db-id], .file-item, [data-id]').forEach(function (el) {
        const nEl = el.querySelector('.file-name, .title, span');
        const name = nEl ? nEl.textContent.trim() : (el.getAttribute('title') || '');
        if (!name) return;
        const id = el.getAttribute('db-id') || el.getAttribute('data-id') || name;
        if (seen.has(id)) return;
        seen.add(id);
        const isDir = (el.className || '').indexOf('dir') >= 0;
        push({ id: id, name: name, path: '', isDir: isDir, size: 0 });
      });
    }
    hookFetch(/pan\.baidu\.com\/api\/(list|filemetas)/, walk);
    makeExporter('#2e7fff', '📥 导出网盘清单', '网盘：正在滚动加载文件清单…', async function (ctrl) {
      window.__capLen = cap.length;
      await scrollDown(ctrl.stop, function () { window.__capLen = cap.length; });
      dom();
      window.__capLen = cap.length;
      return download({ source: 'baidu_pan_list', note: '仅文件索引清单，未下载任何文件内容', exportedAt: new Date().toISOString(), count: cap.length, files: cap }, 'baidu_pan_' + Date.now() + '.json');
    });
  }
})();
