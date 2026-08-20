// ==UserScript==
// @name         XHS收藏诊断器（diagnostic，仅用于抓真实数据结构）
// @namespace    http://workbuddy.ai/
// @version      1.0
// @description  诊断模式：实时显示捕获到的接口数与笔记数；自动滚动收藏列表+逐篇点开帖子触发详情接口，把原始响应全部记录下来；点"下载诊断数据"导出 xhs_diagnostic.json 发给王主管分析。不依赖任何猜测的正文字段。
// @author       王经理 (WorkBuddy)
// @match        https://www.xiaohongshu.com/*
// @match        https://edith.xiaohongshu.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';
  if (!/xiaohongshu/.test(location.hostname)) return;

  const raws = [];          // {url, text}  所有匹配的接口原始响应
  let listBest = 0;         // 列表接口里出现过的笔记数（最多）
  let detailWithDesc = 0;   // 带 desc 正文的详情响应数

  function analyzeNotes(obj) {
    let cnt = 0;
    const idKeys = new Set(), titleKeys = new Set(), descKeys = new Set();
    (function walk(o, d) {
      if (!o || typeof o !== 'object' || d > 9) return;
      if (Array.isArray(o)) { o.forEach(function (x) { walk(x, d + 1); }); return; }
      if (o.note_id !== undefined || o.id !== undefined) {
        cnt++;
        if (o.note_id !== undefined) idKeys.add('note_id');
        if (o.id !== undefined) idKeys.add('id');
        if (o.title !== undefined) titleKeys.add('title');
        if (o.display_title !== undefined) titleKeys.add('display_title');
        if (o.desc !== undefined) descKeys.add('desc');
        if (o.description !== undefined) descKeys.add('description');
      }
      for (const k in o) if (o[k] && typeof o[k] === 'object') walk(o[k], d + 1);
    })(obj, 0);
    return { cnt: cnt, idKeys: [].concat.apply([], [].slice.call(idKeys)), titleKeys: [].concat.apply([], [].slice.call(titleKeys)), descKeys: [].concat.apply([], [].slice.call(descKeys)) };
  }

  function capture(url, text) {
    try {
      if (!/note|collect|feed|user\/self|v1\//.test(url)) return;
      let an = null;
      try { an = analyzeNotes(JSON.parse(text)); } catch (e) {}
      if (an && an.cnt > listBest) listBest = an.cnt;
      if (an && an.descKeys.length && /desc|description/.test(an.descKeys.join(','))) {
        // 粗略判断这条响应里是否真有非空 desc
        try {
          let has = false;
          (function walk(o, d) {
            if (has || !o || typeof o !== 'object' || d > 9) return;
            if (Array.isArray(o)) { o.forEach(function (x) { walk(x, d + 1); }); return; }
            if (typeof o.desc === 'string' && o.desc.trim()) has = true;
            if (typeof o.description === 'string' && o.description.trim()) has = true;
            for (const k in o) if (o[k] && typeof o[k] === 'object') walk(o[k], d + 1);
          })(JSON.parse(text), 0);
          if (has) detailWithDesc++;
        } catch (e) {}
      }
      raws.push({ url: url.slice(0, 220), text: text.length > 300000 ? text.slice(0, 300000) : text });
      updatePanel();
    } catch (e) {}
  }

  const of = window.fetch;
  window.fetch = function () {
    const a = arguments;
    const u = typeof a[0] === 'string' ? a[0] : (a[0] && a[0].url) || '';
    return of.apply(this, a).then(function (r) {
      try { if (/xiaohongshu/.test(u)) r.clone().text().then(function (t) { capture(u, t); }); } catch (e) {}
      return r;
    });
  };

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  const panel = document.createElement('div');
  panel.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:99999;background:#222;color:#fff;padding:10px 12px;border-radius:10px;font:12px/1.5 -apple-system,"PingFang SC",sans-serif;max-width:360px;box-shadow:0 4px 14px rgba(0,0,0,.3);';
  panel.innerHTML = '<b>🔍 XHS 诊断器</b><div id="xhsd-stat" style="white-space:pre-line;margin:4px 0;"></div>' +
    '<button id="xhsd-run" style="margin-right:6px;padding:6px 10px;border:0;border-radius:6px;background:#ff2e4d;color:#fff;cursor:pointer;">开始采集</button>' +
    '<button id="xhsd-dl" style="padding:6px 10px;border:0;border-radius:6px;background:#2e7fff;color:#fff;cursor:pointer;">下载诊断数据</button>';
  function updatePanel() {
    panel.querySelector('#xhsd-stat').textContent =
      '接口响应已记录: ' + raws.length + ' 条\n' +
      '列表最大笔记数: ' + listBest + '\n' +
      '带正文的详情数: ' + detailWithDesc;
  }
  function mount() { if (!document.body.contains(panel)) document.body.appendChild(panel); }
  if (document.body) mount(); else window.addEventListener('load', mount);
  updatePanel();

  panel.querySelector('#xhsd-run').addEventListener('click', async function () {
    this.disabled = true; this.textContent = '采集中…';
    // 阶段1：滚动加载收藏列表（触发列表接口）
    for (let i = 0; i < 400; i++) {
      window.scrollTo(0, document.body.scrollHeight);
      await sleep(500);
    }
    // 阶段2：逐篇点开帖子，触发详情接口（带正文）
    const cards = [].slice.call(document.querySelectorAll('a[href*="/explore/"], a[href*="/discovery/item/"]'));
    const ids = [];
    cards.forEach(function (c) {
      const m = (c.getAttribute('href') || '').match(/\/(explore|discovery\/item)\/([A-Za-z0-9]+)/);
      if (m && ids.indexOf(m[2]) < 0) ids.push(m[2]);
    });
    for (let i = 0; i < ids.length; i++) {
      const sel = 'a[href*="/explore/' + ids[i] + '"], a[href*="/discovery/item/' + ids[i] + '"]';
      const card = document.querySelector(sel);
      if (!card) continue;
      const before = location.href;
      try { card.click(); } catch (e) {}
      await sleep(1500);
      try {
        if (location.href === before) document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
        else history.back();
      } catch (e) {}
      await sleep(800);
      this.textContent = '采集中 ' + (i + 1) + '/' + ids.length;
    }
    this.textContent = '采集完成';
    this.disabled = false;
    updatePanel();
  });

  panel.querySelector('#xhsd-dl').addEventListener('click', function () {
    const data = {
      meta: { url: location.href, time: new Date().toISOString(), note: '请将此文件发给王主管，他会据此写正确的导出脚本' },
      summary: { rawCount: raws.length, listBestNotes: listBest, detailWithDesc: detailWithDesc },
      raws: raws
    };
    const b = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'xhs_diagnostic_' + Date.now() + '.json'; a.click();
  });
})();
