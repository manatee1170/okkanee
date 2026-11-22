/* =========================================================
   家計簿 — アプリの動き
   ---------------------------------------------------------
   1. データの読み書き（ブラウザの localStorage に保存）
   2. 便利な関数（日付・金額の表示など）
   3. 各画面の表示（ホーム / 履歴 / レポート / 設定）
   4. 入力シート
   5. バックアップ（書き出し・読み込み）
   6. ボタン操作のまとめ
   ========================================================= */
(() => {
  'use strict';

  const { svg: iconSVG, ICONS, ICON_ORDER } = window.Icons;

  /* ---------- 1. データの読み書き ---------- */

  const STORAGE_KEY = 'kakeibo:data:v1';

  // [名前, アイコン, 色]。色は iPhone の標準色（システムカラー）の名前
  const DEFAULT_CATEGORIES = [
    ['食費', 'food', 'orange'], ['日用品', 'bag', 'mint'], ['交通', 'train', 'blue'], ['交際', 'people', 'pink'],
    ['趣味', 'star', 'purple'], ['住まい', 'house', 'brown'], ['医療', 'cross', 'teal'], ['その他', 'dots', 'gray'],
  ];
  const DEFAULT_PAYMENTS = [
    ['現金', 'cash', 'green'], ['JALカード', 'plane', 'red'], ['dカード', 'card', 'indigo'], ['Olive', 'card', 'mint'],
    ['PayPay', 'phone', 'pink'], ['交通系IC', 'wave', 'cyan'],
  ];
  // 選べる色（style.css の --sys-○○ と対応）
  const COLORS = ['red', 'orange', 'yellow', 'green', 'mint', 'teal', 'cyan', 'blue', 'indigo', 'purple', 'pink', 'brown', 'gray'];
  // 古いデータから引き継ぐときの対応表
  const DEFAULTS_BY_NAME = Object.fromEntries(
    [...DEFAULT_CATEGORIES, ...DEFAULT_PAYMENTS].map(([name, icon, color]) => [name, { icon, color }])
  );

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function defaultData() {
    return {
      version: 1,
      entries: [],
      categories: DEFAULT_CATEGORIES.map(([name, icon, color]) => ({ id: uid(), name, icon, color })),
      payments: DEFAULT_PAYMENTS.map(([name, icon, color]) => ({ id: uid(), name, icon, color })),
      meta: { lastPaymentId: null, lastBackupAt: null },
    };
  }

  // 読み込んだデータの形を整える（壊れた記録は取り除く）
  function normalize(d) {
    const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
    const items = (arr, fallback) => (Array.isArray(arr) ? arr : [])
      .filter((x) => x && typeof x.id === 'string' && typeof x.name === 'string')
      .map((x, i) => ({
        id: x.id,
        name: x.name,
        icon: ICONS[x.icon] ? x.icon : (DEFAULTS_BY_NAME[x.name]?.icon || fallback),
        color: COLORS.includes(x.color) ? x.color : (DEFAULTS_BY_NAME[x.name]?.color || COLORS[(i * 5) % COLORS.length]),
        ...(x.archived ? { archived: true } : {}),
      }));
    return {
      version: 1,
      entries: (Array.isArray(d.entries) ? d.entries : [])
        .filter((e) => e && Number.isFinite(e.amount) && e.amount > 0 && isDate(e.date))
        .map((e) => ({
          id: typeof e.id === 'string' ? e.id : uid(),
          amount: Math.round(e.amount),
          categoryId: String(e.categoryId || ''),
          paymentId: String(e.paymentId || ''),
          date: e.date,
          memo: typeof e.memo === 'string' ? e.memo : '',
          createdAt: Number(e.createdAt) || Date.now(),
        })),
      categories: items(d.categories, 'tag'),
      payments: items(d.payments, 'card'),
      meta: {
        lastPaymentId: d.meta?.lastPaymentId ?? null,
        lastBackupAt: d.meta?.lastBackupAt ?? null,
      },
    };
  }

  function load() {
    let raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) { /* 保存領域が使えない */ }
    if (raw) {
      try {
        const d = normalize(JSON.parse(raw));
        if (d.categories.length && d.payments.length) return d;
      } catch (e) {
        // 読めないデータは消さずに別の場所へ退避しておく
        try { localStorage.setItem(STORAGE_KEY + ':broken:' + Date.now(), raw); } catch (_) {}
      }
    }
    return defaultData();
  }

  let data = load();

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      toast('保存できませんでした');
    }
  }

  // 「このサイトのデータを消さないで」とブラウザにお願いする
  if (navigator.storage && navigator.storage.persist) {
    navigator.storage.persist().catch(() => {});
  }

  /* ---------- 2. 便利な関数 ---------- */

  const $ = (sel) => document.querySelector(sel);
  const WEEK = ['日', '月', '火', '水', '木', '金', '土'];

  const pad = (n) => String(n).padStart(2, '0');
  function today() {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  const monthOf = (dateStr) => dateStr.slice(0, 7);
  function addMonths(mk, n) {
    let [y, m] = mk.split('-').map(Number);
    m += n;
    y += Math.floor((m - 1) / 12);
    m = (((m - 1) % 12) + 12) % 12 + 1;
    return `${y}-${pad(m)}`;
  }
  function monthLabel(mk) {
    const [y, m] = mk.split('-').map(Number);
    return `${y}年${m}月`;
  }
  function dayLabel(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const w = WEEK[new Date(y, m - 1, d).getDay()];
    if (dateStr === today()) return '今日';
    return `${m}月${d}日（${w}）`;
  }
  function shortDate(dateStr) {
    const [, m, d] = dateStr.split('-').map(Number);
    return `${m}/${d}`;
  }
  const yen = (n) => '¥' + n.toLocaleString('ja-JP');
  const yenHTML = (n) => `<span class="yen">¥</span>${n.toLocaleString('ja-JP')}`;
  const sum = (list) => list.reduce((s, e) => s + e.amount, 0);
  function shortYen(n) {
    if (n >= 10000) return (n / 10000).toLocaleString('ja-JP', { maximumFractionDigits: 1 }) + '万';
    return n.toLocaleString('ja-JP');
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  const UNKNOWN = { name: '不明', icon: 'dots', color: 'gray' };
  const findCategory = (id) => data.categories.find((c) => c.id === id) || UNKNOWN;
  const findPayment = (id) => data.payments.find((p) => p.id === id) || UNKNOWN;
  const activeCategories = () => data.categories.filter((c) => !c.archived);
  const activePayments = () => data.payments.filter((p) => !p.archived);

  const entriesInMonth = (mk) => data.entries.filter((e) => monthOf(e.date) === mk);

  function byDateDesc(a, b) {
    return a.date < b.date ? 1 : a.date > b.date ? -1 : b.createdAt - a.createdAt;
  }

  // 「ジャンル別」「支払い方法別」に合計して、多い順に並べる（色は各項目の色）
  function breakdown(entries, key) {
    const map = new Map();
    for (const e of entries) {
      const id = key === 'category' ? e.categoryId : e.paymentId;
      map.set(id, (map.get(id) || 0) + e.amount);
    }
    const find = key === 'category' ? findCategory : findPayment;
    return [...map.entries()]
      .map(([id, amount]) => ({ ...find(id), id, amount }))
      .sort((a, b) => b.amount - a.amount);
  }

  let toastTimer;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2000);
  }

  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isStandalone = window.navigator.standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches;

  /* ---------- 3. 各画面の表示 ---------- */

  const ui = {
    view: 'home',
    historyMonth: monthOf(today()),
    historySort: 'date',
    chartMonth: monthOf(today()),
    payDetail: null,        // ホームで詳細を開いている支払い方法のid
    editKind: null,        // 設定で並び替え中のリスト（'category' / 'payment' / null）
  };

  const SVG_LINE = (d, w = 2.4) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;
  const ICON_CHEV_L = SVG_LINE('M15 5l-7 7 7 7');
  const ICON_CHEV_R = SVG_LINE('M9 5l7 7-7 7');
  const ICON_GRIP = SVG_LINE('M4 8h16M4 12h16M4 16h16', 2);   // 並び替えのつまみ（≡）

  const colorVar = (key) => `var(--sys-${COLORS.includes(key) ? key : 'gray'})`;
  // アイコンのタイル。色を渡すと、設定アプリのような「色の四角＋白いアイコン」
  const tile = (icon, color) => color
    ? `<span class="tile solid" style="--tint:${colorVar(color)}">${iconSVG(icon)}</span>`
    : `<span class="tile">${iconSVG(icon)}</span>`;

  // showPayment: 支払い方法名を出すか（支払い方法の詳細画面では不要）
  function entryRow(e, showDate = true, showPayment = true) {
    const c = findCategory(e.categoryId);
    const p = findPayment(e.paymentId);
    const sub = [showPayment && p.name, e.memo].filter(Boolean).map(esc).join('・');
    return `
      <button class="entry-row" data-action="edit-entry" data-id="${esc(e.id)}">
        ${tile(c.icon, c.color)}
        <span class="entry-main">
          <span class="entry-title">${esc(c.name)}</span>
          ${sub ? `<span class="entry-sub">${sub}</span>` : ''}
        </span>
        <span class="entry-right">
          <span class="entry-amt">${yen(e.amount)}</span>
          ${showDate ? `<span class="entry-date">${shortDate(e.date)}</span>` : ''}
        </span>
      </button>`;
  }

  function breakdownRows(list, total) {
    return list.map((b) => `
      <div class="bd-row">
        ${tile(b.icon, b.color || 'gray')}
        <span class="bd-name">${esc(b.name)}</span>
        <span class="bd-right">
          <div class="bd-amt">${yen(b.amount)}</div>
          <div class="bd-pct">${total ? Math.round((b.amount / total) * 100) : 0}%</div>
        </span>
      </div>`).join('');
  }

  function segmented(name, current, options) {
    return `<div class="segmented" role="group">${options.map(([value, label]) =>
      `<button data-action="seg" data-seg="${name}" data-value="${value}" aria-pressed="${value === current}">${label}</button>`
    ).join('')}</div>`;
  }

  // リング（ジャンルごとに色分け。多い順に12時の位置から時計回り）
  // ドーナツ部分の描画（大きさ違いのリングで共通。座標は 220×220 の中）
  function donut(segments, total, { R = 86, W = 24, GAP = 3, CORNER = 4 } = {}) {
    const Ro = R + W / 2, Ri = R - W / 2;      // 外側と内側の半径
    const pt = (r, a) => `${(110 + r * Math.cos(a)).toFixed(2)} ${(110 + r * Math.sin(a)).toFixed(2)}`;

    // 角を少し丸めた扇形（ドーナツの一切れ）を描く
    function slice(a0, a1, color) {
      const s = (r) => a0 + GAP / 2 / r;       // すき間の幅が内側・外側で同じになるように
      const e = (r) => a1 - GAP / 2 / r;
      const c = Math.max(0, Math.min(CORNER, ((e(Ri) - s(Ri)) * Ri) / 2, W / 2));
      if (e(Ri) - s(Ri) <= 0) {                // とても小さい項目は細い線にする
        const m = (a0 + a1) / 2;
        return `<path d="M${pt(Ri, m)} L${pt(Ro, m)}" stroke="${color}" stroke-width="${GAP / 2}"/>`;
      }
      const large = e(Ro) - s(Ro) > Math.PI ? 1 : 0;
      const d = [
        `M${pt(Ro - c, s(Ro - c))}`,
        `Q${pt(Ro, s(Ro))} ${pt(Ro, s(Ro) + c / Ro)}`,
        `A${Ro} ${Ro} 0 ${large} 1 ${pt(Ro, e(Ro) - c / Ro)}`,
        `Q${pt(Ro, e(Ro))} ${pt(Ro - c, e(Ro - c))}`,
        `L${pt(Ri + c, e(Ri + c))}`,
        `Q${pt(Ri, e(Ri))} ${pt(Ri, e(Ri) - c / Ri)}`,
        `A${Ri} ${Ri} 0 ${large} 0 ${pt(Ri, s(Ri) + c / Ri)}`,
        `Q${pt(Ri, s(Ri))} ${pt(Ri + c, s(Ri + c))}`,
        'Z',
      ].join(' ');
      return `<path d="${d}" fill="${color}"/>`;
    }

    let angle = -Math.PI / 2;                  // 12時の位置から時計回り
    const arcs = segments.length === 1
      ? `<circle cx="110" cy="110" r="${R}" fill="none" stroke="${colorVar(segments[0].color)}" stroke-width="${W}"/>`
      : segments.map((s) => {
          const a1 = angle + (s.amount / total) * Math.PI * 2;
          const p = slice(angle, a1, colorVar(s.color));
          angle = a1;
          return p;
        }).join('');
    return `<circle cx="110" cy="110" r="${R}" fill="none" stroke="var(--fill)" stroke-width="${W}"/>${total ? arcs : ''}`;
  }

  function ring(segments, total, label, size = '') {
    const digits = String(total).length;
    // 読み上げ用の説明（見た目ではなく中身を伝える）
    const a11y = `${label} ${total.toLocaleString('ja-JP')}円。` +
      segments.map((s) => `${s.name} ${s.amount.toLocaleString('ja-JP')}円`).join('、');
    return `
      <div class="ring-wrap ${size}">
        <svg viewBox="0 0 220 220" role="img" aria-label="${esc(a11y)}">
          ${donut(segments, total)}
        </svg>
        <div class="ring-center" aria-hidden="true">
          <div class="ring-label">${esc(label)}</div>
          <div class="ring-amount ${digits > 6 ? 'small' : digits > 5 ? 'mid' : ''}">${yenHTML(total)}</div>
        </div>
      </div>`;
  }

  // 支払い方法カードの小さいリング（ホームと同じくジャンル別。小さくても見えるよう太め）
  function miniRing(segments, total) {
    return `<svg class="mini-ring" viewBox="0 0 220 220" aria-hidden="true">
      ${donut(segments, total, { R: 92, W: 26, GAP: 6, CORNER: 5 })}
    </svg>`;
  }

  // 今週（月曜はじまり）の初日
  function weekStart() {
    const d = new Date();
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  // 記録を日付ごとにまとめて表示（showTotal: 日ごとの合計を出すか）
  function dayGroups(entries, showTotal, showPayment = true) {
    const groups = [];
    for (const e of [...entries].sort(byDateDesc)) {
      const g = groups[groups.length - 1];
      if (g && g.date === e.date) g.items.push(e);
      else groups.push({ date: e.date, items: [e] });
    }
    return groups.map((g) => `
      <div class="day-head"><span>${dayLabel(g.date)}</span>${showTotal ? `<span class="num">${yen(sum(g.items))}</span>` : ''}</div>
      <div class="card list with-icon">${g.items.map((e) => entryRow(e, false, showPayment)).join('')}</div>`).join('');
  }

  // 今月のリング＋右に今日・今週
  function summaryCard(monthList, weekList, todayStr) {
    return `
      <div class="card ring-card">
        <div class="ring-pair">
          ${ring(breakdown(monthList, 'category'), sum(monthList), '今月', 'main')}
          <dl class="ring-side">
            <div><dt>今日</dt><dd>${yenHTML(sum(weekList.filter((e) => e.date === todayStr)))}</dd></div>
            <div><dt>今週</dt><dd>${yenHTML(sum(weekList))}</dd></div>
          </dl>
        </div>
      </div>`;
  }

  function renderHome() {
    const mk = monthOf(today());
    const list = entriesInMonth(mk);
    const total = sum(list);
    const from = weekStart(), to = today();
    let week = data.entries.filter((e) => e.date >= from && e.date <= to);

    // 支払い方法の詳細画面（カードをタップしたとき）
    const detail = ui.payDetail && data.payments.find((p) => p.id === ui.payDetail);
    if (ui.payDetail && !detail) ui.payDetail = null;
    $('#home-back').hidden = !detail;
    $('#home-title').textContent = detail ? detail.name : 'ホーム';
    if (ui.view === 'home') $('#navbar-title').textContent = detail ? detail.name : 'ホーム';
    if (detail) {
      const mine = list.filter((e) => e.paymentId === detail.id);
      week = week.filter((e) => e.paymentId === detail.id);
      const t = sum(mine);
      let h = summaryCard(mine, week, to);
      if (!mine.length) {
        h += `<div class="card empty">今月はまだ使っていません</div>`;
      } else {
        h += `<div class="card list with-icon">${breakdownRows(breakdown(mine, 'category'), t)}</div>
          <div class="section-head"><h2>今月の記録</h2></div>
          ${dayGroups(mine, false, false)}`;
      }
      $('#home-content').innerHTML = h;
      return;
    }

    let html = '';

    // しばらくバックアップしていなければ、やさしくお知らせ
    const last = data.meta.lastBackupAt;
    const days = last ? (Date.now() - last) / 86400000 : Infinity;
    if (data.entries.length >= 10 && days > 30) {
      html += `<button class="banner" data-action="tab" data-view="settings">
        ${tile('book')}
        <span>そろそろ<b>バックアップ</b>しておきましょう</span>
      </button>`;
    }

    html += summaryCard(list, week, to);

    if (!list.length) {
      html += `<div class="card empty">右下の ＋ から記録してみましょう</div>`;
    } else {
      html += `<div class="card list with-icon">${breakdownRows(breakdown(list, 'category'), total)}</div>`;

      // 支払い方法ごとの今月の合計（2列のカード）
      const pays = breakdown(list, 'payment');
      html += `
        <div class="section-head"><h2>支払い方法</h2></div>
        <div class="pay-grid">
          ${pays.map((p) => `
            <button class="card pay-card" style="--tint:${colorVar(p.color)}" data-action="open-pay" data-id="${esc(p.id)}"
              aria-label="${esc(p.name)} 今月 ${p.amount.toLocaleString('ja-JP')}円。詳しく見る">
              <span class="pay-head" aria-hidden="true">
                <span class="pay-name">${esc(p.name)}</span>
                <span class="pay-chev">${ICON_CHEV_R}</span>
              </span>
              <span class="pay-body" aria-hidden="true">
                ${miniRing(breakdown(list.filter((e) => e.paymentId === p.id), 'category'), p.amount)}
                <span class="pay-amt ${String(p.amount).length > 5 ? 'small' : ''}">${yenHTML(p.amount)}</span>
              </span>
            </button>`).join('')}
        </div>`;
    }

    const recent = [...data.entries].sort(byDateDesc).slice(0, 5);
    if (recent.length) {
      html += `
        <div class="section-head">
          <button class="head-link" data-action="tab" data-view="history" aria-label="最近の記録、すべて表示">
            <h2>最近の記録</h2>${ICON_CHEV_R}
          </button>
        </div>
        <div class="card list with-icon">${recent.map((e) => entryRow(e)).join('')}</div>`;
    }

    $('#home-content').innerHTML = html;
  }

  function latestMonth() {
    const nowMk = monthOf(today());
    return data.entries.reduce((m, e) => (monthOf(e.date) > m ? monthOf(e.date) : m), nowMk);
  }
  function earliestMonth() {
    const nowMk = monthOf(today());
    return data.entries.reduce((m, e) => (monthOf(e.date) < m ? monthOf(e.date) : m), nowMk);
  }

  function renderHistory() {
    const mk = ui.historyMonth;
    const list = entriesInMonth(mk);
    const cats = breakdown(list, 'category');

    let html = `
      <div class="month-nav">
        <button class="round-btn" data-action="month" data-step="-1" aria-label="前の月" ${mk <= earliestMonth() ? 'disabled' : ''}>${ICON_CHEV_L}</button>
        <span class="label">${monthLabel(mk)}</span>
        <button class="round-btn" data-action="month" data-step="1" aria-label="次の月" ${mk >= latestMonth() ? 'disabled' : ''}>${ICON_CHEV_R}</button>
      </div>
      <div class="card ring-card hist-ring">
        ${ring(cats, sum(list), '合計')}
        ${cats.length ? `<div class="legend">${cats.map((c) =>
          `<span class="legend-item"><i style="background:${colorVar(c.color)}"></i>${esc(c.name)}</span>`).join('')}</div>` : ''}
      </div>
      ${segmented('historySort', ui.historySort, [['date', '日付順'], ['amount', '金額順']])}`;

    if (!list.length) {
      html += `<div class="card empty">この月の記録はありません</div>`;
    } else if (ui.historySort === 'amount') {
      const sorted = [...list].sort((a, b) => b.amount - a.amount || byDateDesc(a, b));
      html += `<div class="card list with-icon">${sorted.map((e) => entryRow(e)).join('')}</div>`;
    } else {
      html += dayGroups(list, true);
    }

    $('#history-content').innerHTML = html;
  }

  // グラフの目盛りをきりのいい数にする
  function niceMax(v) {
    if (v <= 0) return 10000;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    for (const s of [1, 2, 2.5, 5, 10]) if (s * p >= v) return s * p;
    return 10 * p;
  }

  function renderReport() {
    if (!data.entries.length) {
      $('#report-content').innerHTML = `<div class="card empty">記録がたまると、ここに月ごとのまとめが表示されます</div>`;
      return;
    }

    const nowMk = monthOf(today());

    // 直近12か月の棒グラフ（ヘルスケア風）
    const chartMonths = [];
    for (let i = 11; i >= 0; i--) {
      const mk = addMonths(nowMk, -i);
      chartMonths.push({ mk, total: sum(entriesInMonth(mk)) });
    }
    if (!chartMonths.some((m) => m.mk === ui.chartMonth)) ui.chartMonth = nowMk;
    const selected = chartMonths.find((m) => m.mk === ui.chartMonth);

    // 平均は「記録がある、先月までの月」で計算
    const first = earliestMonth();
    const pastMonths = chartMonths.filter((m) => m.mk < nowMk && m.mk >= first);
    const avg = pastMonths.length ? Math.round(pastMonths.reduce((s, m) => s + m.total, 0) / pastMonths.length) : 0;

    const max = niceMax(Math.max(...chartMonths.map((m) => m.total), avg));
    const pct = (v) => (v / max) * 100;

    let html = `
      <div class="card chart-card">
        <div class="chart-head">
          <div class="label">${ui.chartMonth === nowMk ? '今月' : monthLabel(ui.chartMonth)}</div>
          <div class="value">${yenHTML(selected.total)}</div>
        </div>
        <div class="chart">
          ${[1, 0.5, 0].map((f) => `<div class="gridline" style="top:${(1 - f) * 100}%"><span>${f ? shortYen(max * f) : '0'}</span></div>`).join('')}
          ${avg ? `<div class="avg" style="bottom:${pct(avg)}%"></div>` : ''}
          <div class="cols">
            ${chartMonths.map((m) => `
              <button class="col ${m.mk === ui.chartMonth ? 'selected' : ''}" data-action="chart-month" data-mk="${m.mk}" aria-label="${monthLabel(m.mk)} ${yen(m.total)}">
                <span class="colbar" style="height:${pct(m.total)}%${m.total ? '' : ';min-height:0'}"></span>
              </button>`).join('')}
          </div>
        </div>
        <div class="chart-x">
          ${chartMonths.map((m) => `<span class="${m.mk === ui.chartMonth ? 'selected' : ''}">${Number(m.mk.slice(5))}</span>`).join('')}
        </div>
        ${avg ? `<div class="chart-legend"><i></i>月の平均 ${yen(avg)}</div>` : ''}
      </div>`;

    // 月ごとのまとめ（タップで内訳）
    const months = [];
    for (let mk = latestMonth(); mk >= first; mk = addMonths(mk, -1)) {
      const list = entriesInMonth(mk);
      if (list.length) months.push({ mk, list, total: sum(list) });
    }
    html += `<div class="section-head"><h2>月ごとのまとめ</h2></div>`;
    html += `<div class="card list">` + months.map((m) => `
      <details class="month-card">
        <summary>
          <span class="mc-name">${m.mk === nowMk ? '今月' : monthLabel(m.mk)}</span>
          <span class="mc-total">${yen(m.total)}</span>
          ${ICON_CHEV_R.replace('<svg', '<svg class="chev"')}
        </summary>
        <div class="mc-inner">
          <div class="sub-title">ジャンル</div>
          <div class="list with-icon">${breakdownRows(breakdown(m.list, 'category'), m.total)}</div>
          <div class="sub-title">支払い方法</div>
          <div class="list with-icon">${breakdownRows(breakdown(m.list, 'payment'), m.total)}</div>
        </div>
      </details>`).join('') + `</div>`;

    $('#report-content').innerHTML = html;
  }

  function settingsList(kind) {
    const list = kind === 'category' ? activeCategories() : activePayments();

    // 「編集」中：右の ≡ をつかんで上下に動かす（上下キーでも動かせる）
    if (ui.editKind === kind) {
      return list.map((x) => `
        <div class="set-row editing" data-id="${esc(x.id)}">
          <span class="name">${tile(x.icon, x.color)}<span>${esc(x.name)}</span></span>
          <button class="icon-btn grip" data-kind="${kind}" data-id="${esc(x.id)}"
            aria-label="${esc(x.name)}を並べ替え。上下キーで移動">${ICON_GRIP}</button>
        </div>`).join('');
    }

    return list.map((x) => `
      <div class="set-row">
        <button class="name" data-action="edit-item" data-kind="${kind}" data-id="${esc(x.id)}">
          ${tile(x.icon, x.color)}<span>${esc(x.name)}</span>
        </button>
        <span class="chev" aria-hidden="true">${ICON_CHEV_R}</span>
      </div>`).join('') + `
      <button class="action-row" data-action="add-item" data-kind="${kind}">${kind === 'category' ? 'ジャンル' : '支払い方法'}を追加…</button>`;
  }

  function groupHead(kind, title) {
    const editing = ui.editKind === kind;
    return `<div class="group-head">
      <span>${title}</span>
      <button class="link-btn" data-action="toggle-edit" data-kind="${kind}">${editing ? '完了' : '並べ替え'}</button>
    </div>`;
  }

  function renderSettings() {
    const last = data.meta.lastBackupAt;
    const lastText = last
      ? new Date(last).toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' })
      : 'なし';

    let html = '';
    if (isIOS && !isStandalone) {
      html += `<div class="banner">${tile('phone')}
        <span>共有ボタン →<b>「ホーム画面に追加」</b>で、アプリとして使えます</span></div>`;
    }
    html += `
      ${groupHead('category', 'ジャンル')}
      <div class="card list with-icon" data-list="category">${settingsList('category')}</div>

      ${groupHead('payment', '支払い方法')}
      <div class="card list with-icon" data-list="payment">${settingsList('payment')}</div>

      <div class="group-title">バックアップ</div>
      <div class="card list">
        <button class="action-row" data-action="export-json">バックアップを書き出す</button>
        <button class="action-row" data-action="import-json">バックアップから復元</button>
        <button class="action-row" data-action="export-csv">CSVで書き出す</button>
      </div>
      <p class="footnote">前回のバックアップ：${lastText}<br>
        書き出したファイルは「ファイル」アプリや iCloud Drive に保存できます。機種変更のときは、新しい端末で「復元」してください。</p>

      <div class="group-spacer"></div>
      <div class="card list">
        <button class="action-row danger" data-action="reset-all">すべてのデータを削除</button>
      </div>`;

    $('#settings-content').innerHTML = html;
  }

  function renderAll() {
    renderHome();
    renderHistory();
    renderReport();
    renderSettings();
  }

  const TITLES = { home: 'ホーム', history: '履歴', report: 'レポート', settings: '設定' };

  function showView(view) {
    ui.view = view;
    document.body.dataset.view = view;
    for (const v of Object.keys(TITLES)) {
      $('#view-' + v).hidden = v !== view;
    }
    document.querySelectorAll('.tab').forEach((t) => {
      if (t.dataset.view === view) t.setAttribute('aria-current', 'page');
      else t.removeAttribute('aria-current');
    });
    $('#navbar-title').textContent = view === 'home' ? $('#home-title').textContent : TITLES[view];
    $('#fab').hidden = !(view === 'home' || view === 'history');
    window.scrollTo(0, 0);
    onScroll();
  }

  // 大きなタイトルが隠れたら、上に小さなタイトルバーを出す
  function onScroll() {
    document.body.classList.toggle('scrolled', window.scrollY > 70);
  }
  window.addEventListener('scroll', onScroll, { passive: true });

  /* ---------- 4. 入力シート ---------- */

  const draft = { id: null, categoryId: null, paymentId: null };
  const amountInput = $('#amount-input');
  let openSheetEl = null;

  function openSheet(el) {
    openSheetEl = el;
    el.classList.add('open');
    $('#backdrop').classList.add('open');
    document.body.classList.add('sheet-open');
  }
  function closeSheet() {
    if (!openSheetEl) return;
    document.activeElement?.blur();
    openSheetEl.classList.remove('open');
    $('#backdrop').classList.remove('open');
    document.body.classList.remove('sheet-open');
    openSheetEl = null;
  }

  function renderChips() {
    // 削除済みのジャンルでも、編集中の記録が使っていれば表示する
    const cats = data.categories.filter((c) => !c.archived || c.id === draft.categoryId);
    const pays = data.payments.filter((p) => !p.archived || p.id === draft.paymentId);
    $('#category-chips').innerHTML = cats.map((c) => `
      <button class="cat-chip" data-action="pick-category" data-id="${esc(c.id)}" aria-pressed="${c.id === draft.categoryId}">
        ${iconSVG(c.icon)}<span>${esc(c.name)}</span>
      </button>`).join('');
    $('#payment-chips').innerHTML = pays.map((p) => `
      <button class="pay-chip" data-action="pick-payment" data-id="${esc(p.id)}" aria-pressed="${p.id === draft.paymentId}">
        ${iconSVG(p.icon)}<span>${esc(p.name)}</span>
      </button>`).join('');
    updateSaveState();
  }

  function parseAmount() {
    return parseInt(amountInput.value.replace(/[^\d]/g, ''), 10) || 0;
  }

  function updateSaveState() {
    const ok = parseAmount() > 0 && draft.categoryId && draft.paymentId;
    $('#save-entry').classList.toggle('disabled', !ok);
  }

  function openEntry(id = null) {
    const e = id ? data.entries.find((x) => x.id === id) : null;
    draft.id = e ? e.id : null;
    draft.categoryId = e ? e.categoryId : null;
    const lastPay = activePayments().find((p) => p.id === data.meta.lastPaymentId);
    draft.paymentId = e ? e.paymentId : (lastPay ? lastPay.id : activePayments()[0]?.id || null);

    $('#entry-title').textContent = e ? '記録を編集' : '記録する';
    amountInput.value = e ? e.amount.toLocaleString('ja-JP') : '';
    $('#date-input').value = e ? e.date : today();
    $('#memo-input').value = e ? e.memo : '';
    $('#delete-entry').hidden = !e;
    renderChips();
    openSheet($('#entry-sheet'));
    if (!e) amountInput.focus(); // 新規のときはすぐ金額を入力できるように
  }

  amountInput.addEventListener('input', () => {
    const digits = amountInput.value.replace(/[^\d]/g, '').replace(/^0+/, '').slice(0, 9);
    amountInput.value = digits ? Number(digits).toLocaleString('ja-JP') : '';
    updateSaveState();
  });
  $('#memo-input').addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') ev.target.blur();
  });

  function saveEntry() {
    const amount = parseAmount();
    if (!amount) { toast('金額を入力してください'); amountInput.focus(); return; }
    if (!draft.categoryId) { toast('ジャンルを選んでください'); return; }
    if (!draft.paymentId) { toast('支払い方法を選んでください'); return; }

    const fields = {
      amount,
      categoryId: draft.categoryId,
      paymentId: draft.paymentId,
      date: $('#date-input').value || today(),
      memo: $('#memo-input').value.trim(),
    };

    if (draft.id) {
      const e = data.entries.find((x) => x.id === draft.id);
      if (e) Object.assign(e, fields);
    } else {
      data.entries.push({ id: uid(), ...fields, createdAt: Date.now() });
    }
    data.meta.lastPaymentId = draft.paymentId;
    persist();
    closeSheet();
    renderAll();
    toast(draft.id ? '更新しました' : '記録しました');
  }

  function deleteEntry() {
    if (!draft.id) return;
    if (!confirm('この記録を削除しますか？')) return;
    data.entries = data.entries.filter((e) => e.id !== draft.id);
    persist();
    closeSheet();
    renderAll();
    toast('削除しました');
  }

  /* ジャンル・支払い方法の編集 */
  const itemDraft = { kind: null, id: null, icon: 'tag', color: 'gray' };
  const listKey = (kind) => (kind === 'category' ? 'categories' : 'payments');
  const kindLabel = (kind) => (kind === 'category' ? 'ジャンル' : '支払い方法');
  const COLOR_NAMES = {
    red: '赤', orange: 'オレンジ', yellow: '黄', green: '緑', mint: 'ミント', teal: 'ティール', cyan: 'シアン',
    blue: '青', indigo: 'インディゴ', purple: '紫', pink: 'ピンク', brown: '茶', gray: 'グレー',
  };

  function renderIconPicker() {
    $('#color-picker').innerHTML = COLORS.map((c) => `
      <button class="color-pick" data-action="pick-color" data-color="${c}" style="--tint:${colorVar(c)}" aria-pressed="${c === itemDraft.color}" aria-label="${COLOR_NAMES[c]}"></button>`).join('');
    $('#icon-picker').innerHTML = ICON_ORDER.map((k) => `
      <button class="icon-pick" data-action="pick-icon" data-icon="${k}" aria-pressed="${k === itemDraft.icon}" aria-label="${k}"
        style="--tint:${colorVar(itemDraft.color)}">${iconSVG(k)}</button>`).join('');
  }

  function openItem(kind, id = null) {
    const item = id ? data[listKey(kind)].find((x) => x.id === id) : null;
    itemDraft.kind = kind;
    itemDraft.id = item ? item.id : null;
    itemDraft.icon = item ? item.icon : (kind === 'category' ? 'tag' : 'card');
    itemDraft.color = item ? item.color : 'gray';
    $('#item-title').textContent = item ? `${kindLabel(kind)}を編集` : `${kindLabel(kind)}を追加`;
    $('#item-name').value = item ? item.name : '';
    $('#delete-item').hidden = !item;
    renderIconPicker();
    openSheet($('#item-sheet'));
    if (!item) $('#item-name').focus();
  }

  function saveItem() {
    const name = $('#item-name').value.trim();
    if (!name) { toast('名前を入力してください'); return; }
    const list = data[listKey(itemDraft.kind)];
    const dup = list.find((x) => !x.archived && x.name === name && x.id !== itemDraft.id);
    if (dup) { toast('同じ名前がすでにあります'); return; }

    if (itemDraft.id) {
      const item = list.find((x) => x.id === itemDraft.id);
      if (item) Object.assign(item, { name, icon: itemDraft.icon, color: itemDraft.color });
    } else {
      // 削除済みの項目の後ろではなく、表示中の項目の最後に追加
      const active = list.filter((x) => !x.archived);
      const archived = list.filter((x) => x.archived);
      data[listKey(itemDraft.kind)] = [...active, { id: uid(), name, icon: itemDraft.icon, color: itemDraft.color }, ...archived];
    }
    persist();
    closeSheet();
    renderAll();
    toast('保存しました');
  }

  function deleteItem() {
    const { kind, id } = itemDraft;
    const key = listKey(kind);
    const active = data[key].filter((x) => !x.archived);
    if (active.length <= 1) { toast('最後のひとつは削除できません'); return; }
    const field = kind === 'category' ? 'categoryId' : 'paymentId';
    const used = data.entries.filter((e) => e[field] === id).length;
    const msg = used
      ? `この${kindLabel(kind)}は${used}件の記録で使われています。\n削除しても、過去の記録には名前が残ります。削除しますか？`
      : `この${kindLabel(kind)}を削除しますか？`;
    if (!confirm(msg)) return;
    if (used) {
      // 過去の記録のために、見えなくするだけ
      data[key].find((x) => x.id === id).archived = true;
    } else {
      data[key] = data[key].filter((x) => x.id !== id);
    }
    persist();
    closeSheet();
    renderAll();
    toast('削除しました');
  }

  // 並び順を変える（from番目を to番目へ）
  function reorderItem(kind, id, to) {
    const key = listKey(kind);
    const active = data[key].filter((x) => !x.archived);
    const archived = data[key].filter((x) => x.archived);
    const from = active.findIndex((x) => x.id === id);
    if (from < 0 || to < 0 || to >= active.length || to === from) return false;
    const [moved] = active.splice(from, 1);
    active.splice(to, 0, moved);
    data[key] = [...active, ...archived];
    persist();
    renderSettings();
    return true;
  }

  // ≡ をつかんで上下にドラッグ（指でもマウスでも）
  document.addEventListener('pointerdown', (ev) => {
    const grip = ev.target.closest('.grip');
    if (!grip) return;
    ev.preventDefault();
    const row = grip.closest('.set-row');
    const box = row.parentElement;
    const rows = [...box.querySelectorAll('.set-row')];
    const from = rows.indexOf(row);
    const h = row.offsetHeight;
    const startY = ev.clientY;
    let to = from;
    row.classList.add('dragging');
    grip.setPointerCapture(ev.pointerId);

    const onMove = (e) => {
      const dy = Math.max(-from * h, Math.min((rows.length - 1 - from) * h, e.clientY - startY));
      row.style.transform = `translateY(${dy}px)`;
      to = from + Math.round(dy / h);
      rows.forEach((r, i) => {
        if (r === row) return;
        let shift = 0;
        if (from < to && i > from && i <= to) shift = -h;
        if (from > to && i < from && i >= to) shift = h;
        r.style.transform = shift ? `translateY(${shift}px)` : '';
      });
    };
    const onUp = () => {
      grip.removeEventListener('pointermove', onMove);
      grip.removeEventListener('pointerup', onUp);
      grip.removeEventListener('pointercancel', onUp);
      if (!reorderItem(grip.dataset.kind, grip.dataset.id, to)) {
        row.classList.remove('dragging');
        rows.forEach((r) => { r.style.transform = ''; });
      }
    };
    grip.addEventListener('pointermove', onMove);
    grip.addEventListener('pointerup', onUp);
    grip.addEventListener('pointercancel', onUp);
  });

  // 指を使わない人向け：≡ にフォーカスして上下キーで移動
  document.addEventListener('keydown', (ev) => {
    const grip = ev.target.closest?.('.grip');
    if (!grip || (ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown')) return;
    ev.preventDefault();
    const { kind, id } = grip.dataset;
    const rows = [...grip.closest('.list').querySelectorAll('.set-row')];
    const i = rows.indexOf(grip.closest('.set-row'));
    if (reorderItem(kind, id, i + (ev.key === 'ArrowUp' ? -1 : 1))) {
      document.querySelector(`.grip[data-kind="${kind}"][data-id="${CSS.escape(id)}"]`)?.focus();
    }
  });

  /* ---------- 5. バックアップ ---------- */

  // iPhoneでは共有シート（「ファイルに保存」など）、パソコンではダウンロード
  async function saveFile(filename, content, mime) {
    const blob = new Blob([content], { type: mime });
    const touch = window.matchMedia('(pointer: coarse)').matches;
    if (touch && navigator.canShare && window.File) {
      const file = new File([blob], filename, { type: mime });
      if (navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file] });
          return true;
        } catch (e) {
          if (e.name === 'AbortError') return false; // キャンセルされた
        }
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  }

  async function exportJSON() {
    const payload = { app: 'kakeibo', exportedAt: new Date().toISOString(), ...data };
    const ok = await saveFile(`kakeibo-backup-${today()}.json`, JSON.stringify(payload, null, 2), 'application/json');
    if (ok) {
      data.meta.lastBackupAt = Date.now();
      persist();
      renderAll();
      toast('書き出しました');
    }
  }

  async function exportCSV() {
    const cell = (v) => {
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = [['日付', '金額', 'ジャンル', '支払い方法', 'メモ']];
    for (const e of [...data.entries].sort((a, b) => -byDateDesc(a, b))) {
      rows.push([e.date, e.amount, findCategory(e.categoryId).name, findPayment(e.paymentId).name, e.memo]);
    }
    // 先頭の ﻿ は Excel で文字化けしないための印
    const csv = '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n');
    const ok = await saveFile(`kakeibo-${today()}.csv`, csv, 'text/csv');
    if (ok) toast('書き出しました');
  }

  const importInput = $('#import-file');
  importInput.addEventListener('change', async () => {
    const file = importInput.files[0];
    importInput.value = '';
    if (!file) return;
    let incoming;
    try {
      const obj = JSON.parse(await file.text());
      if (!obj || !Array.isArray(obj.entries) || !Array.isArray(obj.categories) || !Array.isArray(obj.payments)) {
        throw new Error('format');
      }
      incoming = normalize(obj);
      if (!incoming.categories.length || !incoming.payments.length) throw new Error('format');
    } catch (e) {
      alert('このファイルは読み込めませんでした。\n家計簿のバックアップファイル（.json）を選んでください。');
      return;
    }
    const msg = `バックアップから復元します。\n\n今のデータ：${data.entries.length}件\nファイルのデータ：${incoming.entries.length}件\n\n今のデータはファイルの内容に置き換わります。よろしいですか？`;
    if (!confirm(msg)) return;
    data = incoming;
    persist();
    ui.historyMonth = monthOf(today());
    renderAll();
    toast('復元しました');
  });

  function resetAll() {
    if (!confirm('すべての記録と設定を削除します。\n元に戻すことはできません。よろしいですか？')) return;
    if (!confirm('本当に削除しますか？\n必要なら先にバックアップを書き出してください。')) return;
    data = defaultData();
    persist();
    renderAll();
    toast('すべて削除しました');
  }

  /* ---------- 6. ボタン操作のまとめ ---------- */

  document.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-action]');
    if (!el || el.disabled) return;
    const { action, id, kind } = el.dataset;

    switch (action) {
      case 'tab':
        // ホームのタブをもう一度押したら、詳細からホームに戻る（iPhoneと同じ動き）
        if (el.dataset.view === 'home' && ui.payDetail) { ui.payDetail = null; renderHome(); }
        showView(el.dataset.view);
        break;
      case 'open-pay': ui.payDetail = id; renderHome(); window.scrollTo(0, 0); onScroll(); break;
      case 'close-pay': ui.payDetail = null; renderHome(); window.scrollTo(0, 0); onScroll(); break;
      case 'new-entry': openEntry(); break;
      case 'edit-entry': openEntry(id); break;
      case 'close-sheet': closeSheet(); break;
      case 'save-entry': saveEntry(); break;
      case 'delete-entry': deleteEntry(); break;
      case 'pick-category': draft.categoryId = id; renderChips(); break;
      case 'pick-payment': draft.paymentId = id; renderChips(); break;
      case 'pick-icon': itemDraft.icon = el.dataset.icon; renderIconPicker(); break;
      case 'seg':
        ui[el.dataset.seg] = el.dataset.value;
        renderHistory();
        break;
      case 'pick-color': itemDraft.color = el.dataset.color; renderIconPicker(); break;
      case 'month':
        ui.historyMonth = addMonths(ui.historyMonth, Number(el.dataset.step));
        renderHistory();
        break;
      case 'chart-month': ui.chartMonth = el.dataset.mk; renderReport(); break;
      case 'edit-item': openItem(kind, id); break;
      case 'add-item': openItem(kind); break;
      case 'save-item': saveItem(); break;
      case 'delete-item': deleteItem(); break;
      case 'toggle-edit':
        ui.editKind = ui.editKind === kind ? null : kind;
        renderSettings();
        break;
      case 'export-json': exportJSON(); break;
      case 'export-csv': exportCSV(); break;
      case 'import-json': importInput.click(); break;
      case 'reset-all': resetAll(); break;
    }
  });

  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') closeSheet();
  });

  // 別のタブで変更されたら反映（パソコンで複数タブを開いたとき用）
  window.addEventListener('storage', (ev) => {
    if (ev.key === STORAGE_KEY) { data = load(); renderAll(); }
  });

  // 日付が変わったまま開きっぱなしでも、戻ってきたら表示を更新
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') renderAll();
  });

  renderAll();
  showView('home');

  // オフラインでも開けるようにする（https か localhost のときだけ）
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
