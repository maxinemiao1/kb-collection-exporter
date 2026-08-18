// ==UserScript==
// @name         全能收藏导出器（小红书 / B站 / 百度网盘）v3.0
// @namespace    http://workbuddy.ai/
// @version      3.0
// @description  导出收藏为 JSON。v3 关键升级：小红书在已登录浏览器里逐条抓正文 desc（仅列表接口返回的内容是空的，必须再请求详情接口）。带实时条数 + 中途停止。B站/网盘保持原样（其接口本身返回 desc/路径）。
// @author       王经理 (WorkBuddy)
// @match        https://www.xiaohongshu.com/*
// @match        https://edith.xiaohongshu.com/*
// @match        https://space.bilibili.com/*
// @match        https://www.bilibili.com/*
// @match        https://pan.baidu.com/*
// @grant        none
// @run-at       document-idle
// @downloadURL  https://raw.githubusercontent.com/maxinemiao1/kb-collection-exporter/main/collection-exporter.user.js
// @updateURL    https://raw.githubusercontent.com/maxinemiao1/kb-collection-exporter/main/collection-exporter.user.js
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
      'max-width:300px;box-shadow:0 4px 14px rgba(0,0,0,.25);display:none;white-space:pre-line;';
    function mount() {
      if (!document.body.contains(btn)) { document.body.appendChild(btn); document.body.appendChild(tip); }
    }
    if (document.body) mount(); else window.addEventListener('load', mount);

    btn.addEventListener('click', async function () {
      if (!st.running) {
        st.running = true; st.stopped = false;
        btn.textContent = '⏹ 停止 (0)';
        tip.style.display = 'block';
        const ctrl = {
          stop: function () { return st.stopped; },
          setBtn: function (t) { btn.textContent = t; },
          setTip: function (t) { tip.textContent = t; },
          finalTip: ''   // run 可填入"抓不到正文"等警告，结束时不覆盖
        };
        const c = await run(ctrl);
        st.running = false;
        btn.textContent = '📥 再导一次 (' + c + ')';
        tip.textContent = ctrl.finalTip || ('✅ 已导出 ' + c + ' 条，把 JSON 发给王主管即可。');
        setTimeout(function () { tip.style.display = 'none'; }, 9000);
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
          if (matcher.test(u)) r.clone().json().then(function (d) { walker(d); });
        } catch (e) {}
        return r;
      });
    };
  }

  // ===================== 小红书 v3：阶段1抓列表 + 阶段2逐条抓正文 =====================
  if (isXHS) {
    const cap = [], seen = new Set();
    function pushN(n) {
      if (!n) return;
      const id = String(n.note_id || n.id || '');
      if (!id || seen.has(id)) return;
      seen.add(id);
      cap.push({
        id: id,
        title: n.title || n.display_title || '',
        desc: n.desc || n.description || '',
        user: (n.user && (n.user.nickname || n.user.username)) || '',
        cover: n.cover || ((n.cover_info && n.cover_info.url) || ''),
        liked: n.liked_count || ((n.interact_info && n.interact_info.liked_count) || ''),
        url: 'https://www.xiaohongshu.com/explore/' + id,
        time: n.time || n.create_time || '',
        tags: Array.isArray(n.tag_list) ? n.tag_list.map(function(t){ return t.name || t; }).filter(Boolean) : []
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

    // 阶段2：逐条拉详情，把 desc/tags/interact 补全
    // 双保险：1) 试详情 API；2) API 没拿到 desc 就抓帖子页 HTML 的 og:description
    function unesc(s) {
      return (s || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }
    // 在 __INITIAL_STATE__ 里递归找 note_id 匹配且有 desc 的对象（结构随版本变，用递归最稳）
    function findNote(obj, id) {
      if (!obj || typeof obj !== 'object') return null;
      if (Array.isArray(obj)) { for (let i = 0; i < obj.length; i++) { const r = findNote(obj[i], id); if (r) return r; } return null; }
      if (obj.note_id && String(obj.note_id) === id && typeof obj.desc === 'string' && obj.desc.trim()) return obj;
      for (const k in obj) { const r = findNote(obj[k], id); if (r) return r; }
      return null;
    }
    async function enrichOne(id) {
      // 1) 详情 API（需要登录 cookie；可能因缺签名头失败）
      try {
        const r = await fetch('/api/sns/web/v1/feed', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            source_note_id: id,
            image_formats: ['jpg', 'webp', 'avif'],
            extra: { need_body_topic: '1' }
          })
        });
        const d = await r.json();
        const items = (d && d.data && d.data.items) || [];
        const item = items.find(function (it) { return it && it.note && String(it.note.note_id) === id; });
        if (item && item.note && item.note.desc) {
          const n = item.note;
          return {
            desc: n.desc,
            title: n.title || '',
            time: n.time || 0,
            liked: (n.interact_info && n.interact_info.liked_count) || '',
            user: (n.user && n.user.nickname) || '',
            tags: Array.isArray(n.tag_list) ? n.tag_list.map(function (t) { return t && (t.name || t); }).filter(Boolean) : [],
            images: Array.isArray(n.image_list) ? n.image_list.map(function (im) { return im.url || im; }).filter(Boolean) : []
          };
        }
      } catch (e) { /* 继续走 fallback */ }

      // 2) Fallback：抓 explore 页面 HTML。
      //    小红书现在多数不注入 og:description（防爬），但 SSR 一定在 window.__INITIAL_STATE__ 里放完整 note（含 desc）。
      try {
        const r = await fetch('/explore/' + id, { credentials: 'include' });
        const html = await r.text();

        // 2a) __INITIAL_STATE__（最可靠，含完整正文）。
        //     注意：用整个 <script> 块抓取，再 JSON.parse；不能用 (\{...*\})，嵌套 JSON 会提前在第一个 } 截断。
        const sm = html.match(/<script[^>]*>\s*window\.__INITIAL_STATE__\s*=\s*([\s\S]*?)<\/script>/i);
        if (sm) {
          try {
            const state = JSON.parse(sm[1].trim().replace(/;\s*$/, ''));
            const note = findNote(state, id);
            if (note && note.desc) {
              return {
                desc: unesc(note.desc),
                title: unesc(note.title || ''),
                time: note.time || note.create_time || 0,
                liked: (note.interact_info && note.interact_info.liked_count) || '',
                user: (note.user && (note.user.nickname || note.user.username)) || '',
                tags: Array.isArray(note.tag_list) ? note.tag_list.map(function (t) { return t && (t.name || t); }).filter(Boolean) : [],
                images: Array.isArray(note.image_list) ? note.image_list.map(function (im) { return im.url || im; }).filter(Boolean) : []
              };
            }
          } catch (e) { /* JSON 解析失败，继续 2b */ }
        }

        // 2b) og:description 兜底（部分页面仍有）
        const om = html.match(/<meta[^>]*property\s*=\s*["']og:description["'][^>]*>/i);
        let og = '';
        if (om) { const c = om[0].match(/content\s*=\s*["']([^"']*)["']/i); if (c) og = c[1]; }
        const ogTitle = (html.match(/<meta[^>]*property\s*=\s*["']og:title["'][^>]*content\s*=\s*["']([^"']*)["']/i) || [])[1] || '';
        const desc = unesc(og), title = unesc(ogTitle);
        if (desc || title) return { desc: desc, title: title, time: 0, liked: '', user: '', tags: [], images: [] };
      } catch (e) { /* 放弃这条 */ }

      return null;
    }
    async function enrichDetails(ctrl) {
      const ids = cap.map(function (c) { return c.id; });
      for (let i = 0; i < ids.length; i++) {
        if (ctrl.stop()) break;
        const id = ids[i];
        ctrl.setBtn('⏹ 抓详情 ' + (i + 1) + '/' + ids.length);
        ctrl.setTip('小红书：阶段2 抓正文…\n' + (i + 1) + '/' + ids.length + '（点按钮可随时停）');
        const got = await enrichOne(id);
        if (got) {
          const entry = cap.find(function (c) { return c.id === id; });
          if (entry) {
            if (got.desc) entry.desc = got.desc;
            if (got.title) entry.title = got.title;
            if (got.time) entry.time = got.time;
            if (got.liked) entry.liked = got.liked;
            if (got.user) entry.user = got.user;
            if (got.tags && got.tags.length) entry.tags = got.tags;
            if (got.images && got.images.length) entry.images = got.images;
          }
        }
        await sleep(350); // 礼貌节流，避免触发反爬
      }
    }

    makeExporter('#ff2e4d', '📥 导出收藏', '小红书：阶段1 滚动抓取列表…', async function (ctrl) {
      await scrollDown(ctrl.stop, null);
      dom();
      ctrl.setBtn('⏹ 阶段1 已抓 ' + cap.length + '，准备抓详情…');
      ctrl.setTip('小红书：阶段1 完成，共 ' + cap.length + ' 条。\n开始阶段2 抓正文（已登录的浏览器才会有正文）。\n点按钮可随时停止并导出当前内容。');
      await enrichDetails(ctrl);
      const filled = cap.filter(function (c) { return (c.desc || '').trim(); }).length;
      if (filled === 0 && cap.length > 0) {
        ctrl.finalTip = '⚠️ 抓到 ' + cap.length + ' 条，但一条正文都没拿到。\n小红书把这台浏览器的详情接口挡住了。\n请改用：在收藏页点进任意一篇帖子→等正文加载→再点导出；或联系王主管换更硬的方案。';
      }
      return download({
        source: 'xiaohongshu_collect',
        exportedAt: new Date().toISOString(),
        count: cap.length,
        notes: cap.map(function (c) {
          return {
            id: c.id, title: c.title, desc: c.desc || '',
            tags: c.tags, user: c.user, cover: c.cover,
            images: c.images || [], liked: c.liked,
            url: c.url, time: c.time
          };
        })
      }, 'xiaohongshu_collect_' + Date.now() + '.json');
    });
  }

  // ===================== B站：接口本身带 intro/desc，保持原逻辑 =====================
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
      await scrollDown(ctrl.stop, null);
      ctrl.setBtn('⏹ 停止 (' + cap.length + ')');
      dom();
      return download({ source: 'bilibili_fav', exportedAt: new Date().toISOString(), count: cap.length, notes: cap }, 'bilibili_fav_' + Date.now() + '.json');
    });
  }

  // ===================== 百度网盘：清单不需要正文，保持原逻辑 =====================
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
      await scrollDown(ctrl.stop, null);
      ctrl.setBtn('⏹ 停止 (' + cap.length + ')');
      dom();
      return download({ source: 'baidu_pan_list', note: '仅文件索引清单，未下载任何文件内容', exportedAt: new Date().toISOString(), count: cap.length, files: cap }, 'baidu_pan_' + Date.now() + '.json');
    });
  }
})();