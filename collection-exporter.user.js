// ==UserScript==
// @name         全能收藏导出器（小红书 / B站 / 百度网盘）v3.1
// @namespace    http://workbuddy.ai/
// @version      3.1
// @description  导出收藏为 JSON。v3.1 关键修复：小红书正文改为“监听详情接口响应”(接口由浏览器原生签名，绕过反爬与 DOM 选择器)，点开帖子即自动采集，支持被动累积。带实时条数 + 中途停止。B站/网盘保持原样。
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
    const detailMap = new Map();   // note_id -> 含 desc 的详情对象，来自详情接口响应
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
      const id = o.note_id || o.id;
      if (id) {
        if (o.desc && String(o.desc).trim()) {
          detailMap.set(String(id), o);                 // 详情响应：带正文，存起来后面合并
        } else if (o.title || o.display_title) {
          if (!seen.has(String(id))) pushN(o);          // 列表响应：仅有 note_id+标题，占位（无正文）
        }
      }
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

    // 阶段2：让“浏览器自己”去请求详情接口（带正确签名），我们监听响应拿 desc。
    // 根因复盘：之前 detail 响应其实被 hook 抓到了，但 pushN 的 seen 守卫把已存在条目直接跳过，
    // 且 enrichOne 只信 DOM 抓取(被反爬挡掉)，导致正文“抓到又丢弃”。
    // 现改为：详情响应统一进 detailMap；阶段2 点开卡片触发接口→响应进 detailMap→合并回 cap。
    function findCard(id) {
      const sel = 'a[href*="/explore/' + id + '"], a[href*="/discovery/item/' + id + '"]';
      const a = document.querySelector(sel);
      if (a) return a;
      const all = document.querySelectorAll('a[href*="/explore/"], a[href*="/discovery/item/"]');
      for (let i = 0; i < all.length; i++) { if ((all[i].getAttribute('href') || '').indexOf(id) >= 0) return all[i]; }
      return null;
    }
    async function triggerDetail(id) {
      if (detailMap.has(id)) return true;
      const card = findCard(id);
      if (!card) return false;
      const before = location.href;
      try { card.click(); } catch (e) { return false; }
      for (let i = 0; i < 20; i++) {            // 等详情接口响应被 hook 写入 detailMap，最多 ~8s
        if (detailMap.has(id)) break;
        await sleep(400);
      }
      try {                                       // 关闭弹窗/回退，恢复现场
        if (location.href === before) document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
        else history.back();
      } catch (e) {}
      await sleep(400);
      return detailMap.has(id);
    }
    function mergeDetail(id) {
      const n = detailMap.get(id);
      if (!n) return;
      const e = cap.find(function (c) { return c.id === id; });
      if (!e) return;
      if (n.desc && n.desc.trim()) e.desc = n.desc;
      if (n.title) e.title = n.title;
      if (n.time || n.create_time) e.time = n.time || n.create_time;
      if (n.liked_count || (n.interact_info && n.interact_info.liked_count)) e.liked = n.liked_count || (n.interact_info && n.interact_info.liked_count);
      if (n.user && (n.user.nickname || n.user.username)) e.user = n.user.nickname || n.user.username;
      if (Array.isArray(n.tag_list) && n.tag_list.length) e.tags = n.tag_list.map(function (t) { return t.name || t; }).filter(Boolean);
      if (Array.isArray(n.image_list) && n.image_list.length) e.images = n.image_list.map(function (im) { return im.url || im; }).filter(Boolean);
    }
    async function enrichDetails(ctrl) {
      const ids = cap.map(function (c) { return c.id; });
      for (let i = 0; i < ids.length; i++) {
        if (ctrl.stop()) break;
        const id = ids[i];
        ctrl.setBtn('⏹ 抓详情 ' + (i + 1) + '/' + ids.length);
        ctrl.setTip('小红书：阶段2 逐篇点开触发详情接口…\n' + (i + 1) + '/' + ids.length + '（会自动开/关帖子，别手动操作，点按钮可随时停）');
        if (!detailMap.has(id)) await triggerDetail(id);
        mergeDetail(id);
        await sleep(300);
      }
    }

    makeExporter('#ff2e4d', '📥 导出收藏', '小红书：阶段1 滚动抓取列表…', async function (ctrl) {
      await scrollDown(ctrl.stop, null);
      dom();
      ctrl.setBtn('⏹ 阶段1 已抓 ' + cap.length + '，准备抓详情…');
      ctrl.setTip('小红书：阶段1 完成，共 ' + cap.length + ' 条。\n开始阶段2 抓正文（监听详情接口响应，绕过签名与反爬墙）。\n点按钮可随时停止并导出当前内容。');
      await enrichDetails(ctrl);
      const filled = cap.filter(function (c) { return (c.desc || '').trim(); }).length;
      if (cap.length === 0) {
        ctrl.finalTip = '⚠️ 阶段1 一条都没抓到。\n请确认：① 你在「收藏」列表页（不是首页/发现页）；② 已登录；③ 列表已向下滚动加载出内容；④ 脚本已生效（右下角有红色「📥 导出收藏」按钮）。\n重新刷新页面后再点导出。';
      } else if (filled === 0 && cap.length > 0) {
        ctrl.finalTip = '⚠️ 抓到 ' + cap.length + ' 条，但一条正文都没拿到。\n可能是点开没触发详情接口，或接口路径已变。\n可改“被动采集”：在收藏页逐篇点开帖子(等加载完)→再点“再导一次”，脚本会采集你打开过的帖。';
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