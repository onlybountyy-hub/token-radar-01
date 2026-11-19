// Launch Radar's dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and renders
// four views of one dataset: the ranked board, the signal board, the live-token set the model is
// calibrated from, and the model itself. The scoring function and the farm-plan generator below are
// the model's own arithmetic, so the detail view recomputes a protocol's implied value and plan from
// its snapshot figures and shows whether they match the board the program wrote. No network.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var M = DATA.model;
  var app = document.getElementById('board');
  var state = { tab: 'board', q: '', category: 'all', chain: 'all', set: 'all', signal: 'all', sort: 'implied', dir: -1, selected: null, showAll: false };
  var PAGE_ROWS = 60;

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(n) { return (Math.round(n * 1000) / 1000) + 'x'; }
  function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }

  // ---- the model, mirrored: the same four factors lib/model.ts scores with ----
  function growthPctOf(row) {
    var raw = row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d;
    return clamp(raw, M.growth_floor, M.growth_cap);
  }
  function growthMultOf(row) { return 1 + (growthPctOf(row) / 100) * M.growth_weight; }
  function ageFor(row) { return row.age_days === null || row.age_days === undefined ? DATA.unknown_age_days : row.age_days; }
  function maturityMultOf(row) {
    return M.maturity_base + M.maturity_range * Math.sqrt(clamp(ageFor(row), 0, M.maturity_days) / M.maturity_days);
  }
  function reachMultOf(row) {
    var extra = clamp((row.chains ? row.chains.length : 0) - 1, 0, M.reach_max_extra);
    return 1 + M.reach_per_chain * extra;
  }
  function impliedOf(row) {
    return Math.max(1, Math.round(row.tvl_usd * row.peer_multiple * growthMultOf(row) * maturityMultOf(row) * reachMultOf(row)));
  }
  function scoreOf(row) {
    var size = row.tvl_usd > 1e6 ? clamp(Math.log10(row.tvl_usd / 1e6) / 3.5, 0, 1) : 0;
    var growth = (growthPctOf(row) - M.growth_floor) / (M.growth_cap - M.growth_floor);
    var maturity = clamp(ageFor(row), 0, M.maturity_days) / M.maturity_days;
    var reach = clamp((row.chains ? row.chains.length : 0) - 1, 0, M.reach_max_extra) / M.reach_max_extra;
    return Math.round(100 * (0.45 * size + 0.25 * growth + 0.2 * maturity + 0.1 * reach));
  }
  function calibrationOf(category) {
    for (var i = 0; i < DATA.calibration.length; i++) if (DATA.calibration[i].category === category) return DATA.calibration[i];
    return null;
  }

  // ---- the farm plan, mirrored: the same derivation board.json's steps come from ----
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function secondChainOf(p) { return p.chains && p.chains.length > 1 ? p.chains[1] : chainOf(p); }
  function capitalFor(p) {
    if (p.tvl_usd >= 1e9) return 200;
    if (p.tvl_usd >= 2.5e8) return 120;
    if (p.tvl_usd >= 5e7) return 80;
    return 40;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 45;
    if (age < 365) return 60;
    if (age < 1095) return 45;
    return 30;
  }
  function actionFor(p, capital) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    var chain = chainOf(p);
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC as collateral in ' + name + ' on ' + chain + ', take one small borrow against it, and repay the borrow a week later so the wallet shows on both sides of the market';
    if (c.indexOf('dex') >= 0) return 'Swap $' + capital + ' of USDC for the chain\'s gas token in ' + name + ' on ' + chain + ', then add the same value as liquidity to its busiest stable pool';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Allocate $' + capital + ' of USDC through a ' + name + ' vault on ' + chain + ' and keep the position through one full reallocation cycle';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC from ' + chain + ' to ' + secondChainOf(p) + ' through ' + name + ', then make one small transaction with the bridged funds on the far side';
    if (c.indexOf('derivative') >= 0 || c.indexOf('perpetual') >= 0 || c.indexOf('options') >= 0) return 'Deposit $' + capital + ' of USDC as margin in ' + name + ' on ' + chain + ' and open one small position you can explain, then close it flat instead of letting it ride';
    if (c.indexOf('payment') >= 0 || c.indexOf('card') >= 0) return 'Fund $' + capital + ' in ' + name + ' and make two ordinary payments with it, the way a regular user of the product would';
    if (c.indexOf('rwa') >= 0) return 'Mint $' + capital + ' of ' + name + '\'s yield asset on ' + chain + ' and hold it past one distribution date';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' for the shortest term it sells, and keep the policy to expiry';
    if (c.indexOf('index') >= 0) return 'Buy $' + capital + ' of the ' + name + ' index on ' + chain + ' and hold it rather than trading in and out';
    if (c.indexOf('chain') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' and make one transaction a week inside ' + name + '\'s own apps';
    if (c.indexOf('yield') >= 0 || c.indexOf('farm') >= 0 || c.indexOf('liquidity') >= 0) return 'Deposit $' + capital + ' of USDC into ' + name + '\'s main vault on ' + chain + ' and leave the shares untouched';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + ' Keep the position open and re-check the protocol\'s own page weekly.';
    return s;
  }
  function farmSteps(p) {
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    return [
      { text: 'Set up one fresh wallet for this farm and fund it only with what the plan uses; keep the seed phrase on paper, never in a screenshot or a cloud note', cost: 'about $1 to $3 of gas to fund the wallet and make its first transaction', time: '10 minutes' },
      { text: actionFor(p, capital), cost: '$' + capital + ' of capital and about $' + (capital >= 120 ? 6 : 3) + ' of gas', time: '15 minutes to set up' },
      { text: 'Repeat one small qualifying action every week - a deposit, a swap, a vote or a claim check - so the wallet reads as a user, not a one-day visitor', cost: 'about $1 to $2 of gas a week', time: '10 minutes a week' },
      { text: 'Keep the position open for at least ' + hold + ' days; points seasons and snapshots reward wallets that stay, and a fast in-and-out is the pattern filters remove', cost: 'the $' + capital + ' stays deployed, so size it as money you can afford to leave', time: hold + ' days' },
      { text: 'Check ' + p.name + '\'s own site and its verified social account for a points or rewards page; claim only from a link the protocol itself publishes, and never pay a fee to unlock an airdrop', cost: 'free to check, and any claim fee is a scam signal', time: '10 minutes' },
      { text: 'Keep a farm log - wallet, dates, amounts and transaction hashes - and review the position monthly; withdraw if the protocol\'s TVL falls for three straight weeks', cost: 'nothing but the log itself', time: '5 minutes, then 5 minutes a month' }
    ].map(stepText);
  }

  // ---- signals: plain statements about a row's own figures ----
  var SIGNAL_DEFS = [
    { id: 'whale', label: 'Billion-dollar and tokenless', blurb: 'At least $1B of TVL and still no token on record: the largest launches-in-waiting on the board.', figure: function (r) { return fmtUsd(r.tvl_usd) + ' TVL'; } },
    { id: 'surge', label: 'TVL surging', blurb: 'TVL up at least 20% in seven days. Momentum cuts both ways: it can be a points season starting, or mercenary money passing through.', figure: function (r) { return fmtPct(r.change_7d) + ' in 7d'; } },
    { id: 'overdue', label: 'Years live, still no token', blurb: 'Running at least three years with at least $100M of TVL and no token on record: the overdue shelf.', figure: function (r) { return fmtAge(r.age_days) + ' live'; } },
    { id: 'fresh', label: 'New and already huge', blurb: 'Tracked for six months or less and already holding at least $250M: size arrived before any token did.', figure: function (r) { return fmtAge(r.age_days) + ', ' + fmtUsd(r.tvl_usd); } },
    { id: 'everywhere', label: 'On five or more chains', blurb: 'TVL spread across five or more chains: a wide surface for a launch, and more than one ecosystem watching it.', figure: function (r) { return r.chains.length + ' chains'; } },
    { id: 'cooling', label: 'TVL cooling fast', blurb: 'TVL down at least 20% in seven days. A caution flag, not a verdict: check whether the money left the protocol or the market.', warn: true, figure: function (r) { return fmtPct(r.change_7d) + ' in 7d'; } }
  ];
  function signalDef(id) {
    for (var i = 0; i < SIGNAL_DEFS.length; i++) if (SIGNAL_DEFS[i].id === id) return SIGNAL_DEFS[i];
    return null;
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('tab')) state.tab = params.get('tab');
    if (params.get('q')) state.q = params.get('q');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('set')) state.set = params.get('set');
    if (params.get('signal')) state.signal = params.get('signal');
    if (params.get('p')) state.selected = params.get('p');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.tab !== 'board') params.set('tab', state.tab);
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.set !== 'all') params.set('set', state.set);
    if (state.signal !== 'all') params.set('signal', state.signal);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.set === 'watchlist' && !r.on_watchlist) return false;
      if (state.set === 'early' && r.on_watchlist) return false;
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && (!r.chains || r.chains.indexOf(state.chain) < 0)) return false;
      if (state.signal !== 'all' && r.signals.indexOf(state.signal) < 0) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category || '', (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    var dir = state.dir;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'score') { av = a.launch_score; bv = b.launch_score; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? -1 : a.age_days; bv = b.age_days === null ? -1 : b.age_days; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -dir;
      if (av > bv) return dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name' }, 'Launch ', el('em', { text: 'Radar' }))),
      el('div', { class: 'top-meta' },
        el('span', null, 'Snapshot ', el('span', { class: 'num', text: DATA.as_of })),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', null, 'Model ', el('span', { class: 'num', text: DATA.model_version }))
      )
    );
  }

  function lede() {
    var totalTvl = DATA.rows.reduce(function (n, r) { return n + r.tvl_usd; }, 0);
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', null, DATA.board_size + ' protocols with ', el('span', { class: 'hl', text: 'no token yet' }), ', ranked by what one would be worth'),
        el('p', { text: 'Every protocol here records no token of its own. The radar prices each one from the snapshot itself: what the market already pays for a dollar of TVL in its category, its seven-day growth, how long it has run tokenless, and how many chains it sits on. The watchlist is the floor, not the ceiling: ' + DATA.early_size + ' rows sit below the house\'s $' + Math.round(DATA.floor_usd / 1e6) + 'M line. Implied value is a model\'s claim, not a price and not a launch prediction.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows ranked' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Tokenless TVL tracked' }), el('b', { text: fmtUsd(totalTvl) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live tokens set aside' }), el('b', { text: String(DATA.live_size) }))
      )
    );
  }

  function viewTabs() {
    var defs = [['board', 'Board'], ['signals', 'Signals'], ['live', 'Live tokens'], ['model', 'The model']];
    return el('nav', { class: 'views', 'aria-label': 'Views' }, defs.map(function (d) {
      return el('button', {
        type: 'button', 'aria-pressed': state.tab === d[0] ? 'true' : 'false', text: d[1],
        onclick: function () { state.tab = d[0]; writeHash(); render(); }
      });
    }));
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.flatMap(function (r) { return r.chains || []; }))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search the board', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; state.showAll = false; writeHash(); render(); });
    function select(id, label, values, current, onchange) {
      var s = el('select', { id: id, 'aria-label': label },
        values.map(function (v) { return el('option', { value: v[0], text: v[1], selected: current === v[0] ? 'selected' : null }); }));
      s.addEventListener('change', function () { onchange(s.value); state.showAll = false; writeHash(); render(); });
      return el('div', { class: 'field' }, el('label', { for: id, text: label }), s);
    }
    var seg = el('div', { class: 'seg', role: 'group', 'aria-label': 'Board set' },
      [['all', 'All rows'], ['watchlist', 'Watchlist'], ['early', 'Early radar']].map(function (d) {
        return el('button', {
          type: 'button', 'aria-pressed': state.set === d[0] ? 'true' : 'false', text: d[1],
          onclick: function () { state.set = d[0]; state.showAll = false; writeHash(); render(); }
        });
      }));
    var shown = filteredRows().length;
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      select('category', 'Category', [['all', 'All categories']].concat(categories.map(function (c) { return [c, c]; })), state.category, function (v) { state.category = v; }),
      select('chain', 'Chain', [['all', 'All chains']].concat(chains.map(function (c) { return [c, c]; })), state.chain, function (v) { state.chain = v; }),
      select('signal', 'Signal', [['all', 'Any signal']].concat(SIGNAL_DEFS.map(function (d) { return [d.id, d.label]; })), state.signal, function (v) { state.signal = v; }),
      el('div', { class: 'field' }, el('span', { class: 'lab', text: 'Set' }), seg),
      el('span', { class: 'count', text: shown + ' of ' + DATA.board_size + ' rows shown' })
    );
  }

  function sortHeader(key, label, cls) {
    return el('th', { scope: 'col', class: cls || null },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function flagChips(r) {
    var chips = [];
    if (r.on_watchlist) chips.push(el('span', { class: 'chip watch', text: 'watchlist' }));
    r.signals.forEach(function (id) {
      var d = signalDef(id);
      if (d) chips.push(el('span', { class: 'chip ' + (d.warn ? 'warn' : 'sig'), text: d.label }));
    });
    return chips;
  }

  function boardView() {
    var list = sortedRows(filteredRows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { class: 'sub', text: 'Clear the search or widen a filter to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.signal = 'all'; state.set = 'all'; writeHash(); render(); } })
      ));
    }
    var visible = state.showAll ? list : list.slice(0, PAGE_ROWS);
    var max = 0;
    DATA.rows.forEach(function (r) { if (r.implied_value_usd > max) max = r.implied_value_usd; });
    var tbody = el('tbody');
    visible.forEach(function (r) {
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false', tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'rank', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' · ' + (r.chains && r.chains.length ? r.chains.slice(0, 3).join(', ') + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') : 'chain unrecorded') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: fmtPct(r.change_7d) }),
        el('td', { class: 'num hide-s', text: fmtAge(r.age_days) }),
        el('td', null, el('span', { class: 'score', text: String(r.launch_score) })),
        el('td', null, el('div', null,
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / (max || 1)) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', null, flagChips(r))
      );
      tbody.appendChild(tr);
    });
    var panel = el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols ranked by implied value. The launch score blends size, growth, maturity and reach on fixed scales. Select a row for its model and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age', 'hide-s'),
            sortHeader('score', 'Score'),
            sortHeader('implied', 'Implied value'),
            el('th', { scope: 'col', text: 'Flags' })
          )),
          tbody
        )
      )
    );
    if (!state.showAll && list.length > PAGE_ROWS) {
      panel.appendChild(el('div', { class: 'more-row' },
        el('button', { class: 'button', type: 'button', text: 'Show all ' + list.length + ' rows', onclick: function () { state.showAll = true; render(); } })
      ));
    }
    return panel;
  }

  function signalsView() {
    var grid = el('div', { class: 'sig-grid' });
    SIGNAL_DEFS.forEach(function (d) {
      var rows = DATA.rows.filter(function (r) { return r.signals.indexOf(d.id) >= 0; });
      var card = el('section', { class: 'sig-card' + (d.warn ? ' warn' : '') },
        el('h3', null, d.label, el('span', { class: 'n', text: String(rows.length) })),
        el('p', { text: d.blurb }),
        el('ul', { class: 'sig-list' }, rows.slice(0, 8).map(function (r) {
          return el('li', null, el('button', { type: 'button', onclick: function () { openDetail(r.slug); } },
            el('span', { class: 'r', text: '#' + r.rank }),
            el('span', { text: r.name }),
            el('span', { class: 'v', text: d.figure(r) })
          ));
        }))
      );
      if (rows.length > 8) card.appendChild(el('p', { class: 'sub', text: '+ ' + (rows.length - 8) + ' more on the board under this signal.' }));
      grid.appendChild(card);
    });
    return grid;
  }

  function liveView() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r, i) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'rank', text: String(i + 1) }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + (r.symbol ? ' · ' + r.symbol : '') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num', text: r.mcap_to_tvl === null ? 'n/a' : fmtMult(r.mcap_to_tvl) })
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Already trading: these protocols have a token, so their market cap is a fact, not a model. They never enter the ranking; their market-cap-to-TVL ratios are what price the pre-token board, category by category.' }),
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: '#' }), el('th', { scope: 'col', text: 'Protocol' }),
            el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }),
            el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'MCap / TVL' })
          )),
          tbody
        )
      )
    );
  }

  function modelView() {
    var top = DATA.rows[0];
    var calRows = DATA.calibration.map(function (c) {
      return el('tr', null,
        el('td', { text: c.category }),
        el('td', { class: 'num', text: String(c.peers) }),
        el('td', { class: 'num', text: fmtMult(c.median_ratio) }),
        el('td', { class: 'num', text: fmtMult(c.multiple) })
      );
    });
    calRows.push(el('tr', null,
      el('td', null, el('b', { text: 'All categories (fallback)' })),
      el('td', { class: 'num', text: 'all' }),
      el('td', { class: 'num', text: fmtMult(DATA.global_multiple) }),
      el('td', { class: 'num', text: fmtMult(DATA.global_multiple) })
    ));
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { text: 'One function scores every protocol, from the snapshot\'s own figures only. No name is looked up, no row is hand-placed, and the page carries the same function: open any protocol and it recomputes the number in front of you.' }),
      el('div', { class: 'formula', text: 'implied = round( TVL x peer multiple x (1 + clamp(7d change, ' + M.growth_floor + ', ' + M.growth_cap + ') / 100 x ' + M.growth_weight + ') x (' + M.maturity_base + ' + ' + M.maturity_range + ' x sqrt(age / ' + M.maturity_days + 'd)) x (1 + ' + M.reach_per_chain + ' x extra chains, max ' + M.reach_max_extra + ') )' }),
      el('div', { class: 'cols' },
        el('div', null,
          el('p', null, el('b', { text: 'Peer multiple. ' }), 'What the market already pays for a dollar of TVL in the protocol\'s category: the median market-cap/TVL of that category\'s live-token protocols in this snapshot, shrunk toward the global median (' + fmtMult(DATA.global_multiple) + ') by peer count so a thin category cannot shout, and clamped between ' + M.multiple_min + 'x and ' + M.multiple_max + 'x.'),
          el('p', null, el('b', { text: 'Growth. ' }), 'The seven-day TVL change, clamped to [' + M.growth_floor + '%, +' + M.growth_cap + '%] and weighted at ' + M.growth_weight + ': a doubling week lifts value by at most 60%, a halving cuts it by 30%. An unreported change counts as flat.')
        ),
        el('div', null,
          el('p', null, el('b', { text: 'Maturity. ' }), 'How long the protocol has run with no token, on a square-root curve over ' + M.maturity_days + ' days: the first year counts most. A protocol whose listing day is unrecorded is scored at the board\'s median age, ' + DATA.unknown_age_days + ' days.'),
          el('p', null, el('b', { text: 'Reach. ' }), 'Each chain past the first adds ' + (M.reach_per_chain * 100) + '% up to ' + M.reach_max_extra + ' extra chains: distribution a launch would inherit. The launch score (0-100) blends the same four inputs on fixed scales, at weights 45/25/20/10.')
        )
      ),
      el('h3', { text: 'Worked example: rank 1' }),
      el('p', null, top.name + ': TVL ' + fmtUsd(top.tvl_usd) + ' x multiple ' + fmtMult(top.peer_multiple) + ' x growth ' + (Math.round(growthMultOf(top) * 1000) / 1000) + ' x maturity ' + (Math.round(maturityMultOf(top) * 1000) / 1000) + ' x reach ' + (Math.round(reachMultOf(top) * 1000) / 1000) + ' = ' + fmtUsd(impliedOf(top)) + ', the number the board carries.'),
      el('h3', { text: 'The calibration, from this snapshot' }),
      el('div', { class: 'table-wrap' }, el('table', null,
        el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Category' }), el('th', { scope: 'col', text: 'Live peers' }), el('th', { scope: 'col', text: 'Median MCap/TVL' }), el('th', { scope: 'col', text: 'Multiple used' }))),
        el('tbody', null, calRows)
      )),
      el('p', { class: 'sub', text: 'What this page does not claim: the snapshot records no token for these protocols, which is not proof none exists anywhere; implied value is not a price, a forecast of one, or a prediction that a token will be issued at all. It is the model\'s answer to one question: if this protocol\'s record stayed as it is, what would its token be worth next to the tokens that already trade?' })
    );
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); render(); });

  function openDetail(slug) {
    var row = null;
    DATA.rows.forEach(function (r) { if (r.slug === slug) row = r; });
    if (!row) return;
    state.selected = slug;
    writeHash();
    var recomputed = impliedOf(row);
    var recomputedScore = scoreOf(row);
    var steps = farmSteps(row);
    var cal = calibrationOf(row.category);
    var tvlRank = 1 + DATA.rows.filter(function (r) { return r.tvl_usd > row.tvl_usd; }).length;
    dialog.textContent = '';
    var inner = el('div', { class: 'detail-in' });
    inner.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'kicker', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + ' · launch score ' + row.launch_score }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' · ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'chain unrecorded') + ' · records no token' })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    inner.appendChild(el('p', { class: 'why' },
      el('b', { text: 'Why this rank: ' }),
      '#' + tvlRank + ' by TVL on the board' +
      (row.on_watchlist ? ', on the house watchlist' : ', an early-radar row below the $' + Math.round(DATA.floor_usd / 1e6) + 'M watchlist floor') +
      (cal ? ', priced at the ' + row.category + ' multiple of ' + fmtMult(row.peer_multiple) + ' (median of ' + cal.peers + ' live peer' + (cal.peers === 1 ? '' : 's') + ', shrunk toward the global median)' : ', priced at the global multiple of ' + fmtMult(row.peer_multiple)) +
      (row.signals.length ? ', flagged: ' + row.signals.map(function (id) { var d = signalDef(id); return d ? d.label : id; }).join('; ') : '') + '.'
    ));
    inner.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value, recomputed here' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Peer multiple' }), el('b', { text: fmtMult(row.peer_multiple) })),
        el('div', null, el('span', { text: '7d growth x' + (Math.round(growthMultOf(row) * 1000) / 1000) }), el('b', { text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Maturity x' + (Math.round(maturityMultOf(row) * 1000) / 1000) }), el('b', { text: fmtAge(row.age_days) + ' tokenless' })),
        el('div', null, el('span', { text: 'Reach x' + (Math.round(reachMultOf(row) * 1000) / 1000) }), el('b', { text: (row.chains ? row.chains.length : 0) + ' chains' })),
        el('div', { class: 'total' }, el('span', { text: 'Implied value' }), el('b', { text: fmtUsd(row.implied_value_usd) }))
      ),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ' recomputes this row as ' + fmtUsd(recomputed) + ' and its launch score as ' + recomputedScore + (recomputed === row.implied_value_usd && recomputedScore === row.launch_score ? ': the same numbers the board carries.' : ': which differ from the board, so the data would be stale.') + ' An estimate from the snapshot\'s figures, not a price.' })
    ));
    inner.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    dialog.appendChild(inner);
    if (typeof dialog.showModal === 'function') { if (!dialog.open) dialog.showModal(); }
    else dialog.setAttribute('open', '');
    if (!dialog.isConnected) app.appendChild(dialog);
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(viewTabs());
    if (state.tab === 'board') { shell.appendChild(controls()); shell.appendChild(boardView()); }
    else if (state.tab === 'signals') shell.appendChild(signalsView());
    else if (state.tab === 'live') shell.appendChild(liveView());
    else shell.appendChild(modelView());
    shell.appendChild(el('footer', { class: 'foot', text: 'Source: ' + DATA.source + '. Figures are the snapshot\'s, as of ' + DATA.as_of + '; nothing here is fetched live. Say a protocol records no token, never that it has none.' }));
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
