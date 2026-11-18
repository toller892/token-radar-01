// Token Radar's dashboard, radar-3. It reads window.RADAR (written beside dashboard/ by main.ts)
// and renders the ranked board, a filterable table, a per-protocol detail drawer, a protocol
// comparison view and a CSV export of whatever the filters show. No network: every byte it shows
// is in data.js.
//
// The model in one function: the page recomputes a row from the snapshot figures and checks the
// number board.json carries, so the page's code and the board's data are visibly the same arithmetic.
// The sandbox starts at the model's own constants, so the board it shows first is board.json itself;
// move a slider and the page re-scores every row with the new constants and re-ranks the board.
//
// Beside the implied value each row now carries what radar-3 adds: the nearest live-token
// comparables with the multiple the market pays per dollar of TVL, a confidence score for how
// much of the record the model can stand on, and the risks the record itself warns about.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var board = document.getElementById('board');

  // What the reader is looking at: the filters, the sort, the open protocol, the comparison set.
  var view = {
    query: '',
    category: 'all',
    chain: 'all',
    watchlistOnly: false,
    tab: 'pre-token',
    sortKey: 'implied',
    sortDir: -1,
    openSlug: null,
    compare: [],
  };
  var sandbox = {
    base: DATA.model.base_multiple,
    growth: DATA.model.growth_weight,
    maturity: DATA.model.maturity_floor,
  };
  var sandboxTouched = false;

  // --- small helpers -------------------------------------------------------

  /** One DOM node: `h('div', { cls: 'panel', text: 'hi' }, childA, childB)`. */
  function h(tag, props) {
    var node = document.createElement(tag);
    if (props) {
      for (var key in props) {
        if (!Object.prototype.hasOwnProperty.call(props, key)) continue;
        var value = props[key];
        if (value === null || value === undefined || value === false) continue;
        if (key === 'cls') node.className = value;
        else if (key === 'text') node.textContent = value;
        else if (key === 'html') node.innerHTML = value;
        else if (key.slice(0, 2) === 'on') node.addEventListener(key.slice(2).toLowerCase(), value);
        else node.setAttribute(key, value);
      }
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined || child === false) continue;
      if (Array.isArray(child)) {
        child.forEach(function (c) {
          if (c) node.appendChild(c);
        });
      } else if (typeof child === 'string' || typeof child === 'number') {
        node.appendChild(document.createTextNode(String(child)));
      } else {
        node.appendChild(child);
      }
    }
    return node;
  }

  /** Money with a short scale: $536.1M, $12.4K, $842. */
  var SHORT_SCALES = [
    [1e12, 'T', 2],
    [1e9, 'B', 2],
    [1e6, 'M', 1],
    [1e3, 'K', 0],
  ];
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    for (var i = 0; i < SHORT_SCALES.length; i++) {
      var scale = SHORT_SCALES[i];
      if (Math.abs(n) >= scale[0]) return '$' + (n / scale[0]).toFixed(scale[2]) + scale[1];
    }
    return '$' + Math.round(n);
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
  function fmtMult(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return n.toFixed(2) + 'x';
  }
  function round4(n) {
    return Math.round(n * 1e4) / 1e4;
  }
  function clamp(v, lo, hi) {
    return Math.min(hi, Math.max(lo, v));
  }

  // --- the model, recomputed in the page -----------------------------------

  /** The four multipliers for one row under the model's constants. */
  function scoreRow(row, model) {
    var growth = clamp(row.change_7d === null || row.change_7d === undefined ? 0 : row.change_7d, model.growth_floor, model.growth_cap);
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = row.age_days === null || row.age_days === undefined ? model.unknown_age_days : row.age_days;
    var maturityMult = model.maturity_floor + (clamp(age, 0, model.maturity_days) / model.maturity_days) * model.maturity_range;
    var breadthMult = 1 + model.breadth_step * clamp((row.chains || []).length - 1, 0, model.breadth_cap);
    return { growthPct: growth, growthMult: growthMult, maturityMult: maturityMult, breadthMult: breadthMult, age: age };
  }
  /** The implied value of one row under the model's constants. */
  function impliedOf(row, model) {
    var s = scoreRow(row, model);
    return Math.max(1, Math.round(row.tvl_usd * model.base_multiple * s.growthMult * s.maturityMult * s.breadthMult));
  }
  /** The model's constants as the sandbox has them now. */
  function modelNow() {
    return {
      base_multiple: sandbox.base,
      growth_weight: sandbox.growth,
      growth_floor: DATA.model.growth_floor,
      growth_cap: DATA.model.growth_cap,
      maturity_floor: sandbox.maturity,
      maturity_range: DATA.model.maturity_range,
      maturity_days: DATA.model.maturity_days,
      unknown_age_days: DATA.model.unknown_age_days,
      breadth_step: DATA.model.breadth_step,
      breadth_cap: DATA.model.breadth_cap,
    };
  }

  // --- the farm plan, the same derivation main.ts writes to board.json -----

  function firstChain(p) {
    return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain';
  }
  function secondChain(p) {
    return p.chains && p.chains.length > 1 ? p.chains[1] : null;
  }
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 250;
    if (p.tvl_usd >= 1e9) return 150;
    if (p.tvl_usd >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function mainAction(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return "Stake $" + capital + " of the chain's staking asset through " + name + ' and keep the receipt.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and place one market position on ' + name + '.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
    if (c.indexOf('rwa') >= 0) return "Mint $" + capital + " of the protocol's yield asset on " + chain + ' and hold it.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function followUpAction(p, capital, chain2) {
    var name = p.name;
    var half = Math.max(25, Math.round(capital / 2));
    if (chain2 !== null) return { text: 'Repeat the same position on ' + chain2 + ' with $' + half + ', so the wallet shows activity on two chains.', cost: '$' + half + ' of capital and about $3 of gas', time: '10 minutes' };
    var c = (p.category || '').toLowerCase();
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return { text: 'Borrow $25 against the supply and repay it within the week, so the wallet shows both sides of ' + name + '.', cost: 'about $3 of gas, no new capital', time: '10 minutes' };
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return { text: 'Swap $25 through ' + name + "'s pool and leave the route in the wallet's history.", cost: '$25 of capital and about $3 of gas', time: '5 minutes' };
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) return { text: 'Close the first hedge and open one small position the other way, so the wallet shows two trades.', cost: 'about $3 of gas, no new capital', time: '10 minutes' };
    if (c.indexOf('prediction') >= 0) return { text: 'Place a second market position of $10 on a different outcome, so the wallet shows two markets.', cost: '$10 of capital and about $2 of gas', time: '5 minutes' };
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return { text: 'Deposit $25 into a second ' + name + ' vault, so the wallet holds shares in two vaults.', cost: '$25 of capital and about $3 of gas', time: '10 minutes' };
    return { text: "Use " + name + "'s second feature once, such as a swap, a vote or a stake, and leave it in the wallet's history.", cost: 'about $3 of gas', time: '10 minutes' };
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + " Hold the position and check the protocol's own page.";
    return s;
  }
  function farmSteps(p) {
    var chain = firstChain(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
      { text: mainAction(p, capital, chain), cost: '$' + capital + ' of capital and about $' + (capital >= 150 ? 8 : 4) + ' of gas', time: '15 minutes to set up' },
      followUpAction(p, capital, secondChain(p)),
      { text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.', cost: 'about $2 of gas a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: "Before you withdraw, open " + p.name + "'s own points or rewards page and claim only from the link it publishes.", cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log, then unwind in reverse: claim first, withdraw the second chain, then the main position.', cost: 'nothing but the log, plus gas to unwind', time: '5 minutes to log, 15 to unwind' },
    ].map(stepText);
  }
  /** The farm plan's total capital outlay: the main position plus the follow-up. */
  function farmCapital(p) {
    var capital = capitalFor(p);
    return capital + Math.max(25, Math.round(capital / 2));
  }

  // --- filtering, sorting, comparing ----------------------------------------

  /** Every row re-scored under the sandbox, strongest first, with a display rank. */
  function scoredRows() {
    var model = modelNow();
    var scored = DATA.rows.map(function (r) {
      return { row: r, implied: impliedOf(r, model) };
    });
    scored.sort(function (a, b) {
      if (b.implied !== a.implied) return b.implied - a.implied;
      return a.row.slug < b.row.slug ? -1 : a.row.slug > b.row.slug ? 1 : 0;
    });
    scored.forEach(function (s, i) {
      s.displayRank = i + 1;
    });
    return scored;
  }
  /** The scored rows the current filters keep. */
  function visibleRows() {
    var q = view.query.trim().toLowerCase();
    return scoredRows().filter(function (s) {
      var r = s.row;
      if (view.watchlistOnly && !r.watchlist) return false;
      if (view.category !== 'all' && (r.category || 'Other') !== view.category) return false;
      if (view.chain !== 'all' && (r.chains || []).indexOf(view.chain) < 0) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  /** The visible rows in the reader's chosen order. */
  function orderedRows(list) {
    var key = view.sortKey;
    return list.slice().sort(function (a, b) {
      var av;
      var bv;
      if (key === 'name') {
        av = a.row.name.toLowerCase();
        bv = b.row.name.toLowerCase();
      } else if (key === 'tvl') {
        av = a.row.tvl_usd;
        bv = b.row.tvl_usd;
      } else if (key === 'growth') {
        av = a.row.change_7d === null ? -Infinity : a.row.change_7d;
        bv = b.row.change_7d === null ? -Infinity : b.row.change_7d;
      } else if (key === 'age') {
        av = a.row.age_days === null ? Infinity : a.row.age_days;
        bv = b.row.age_days === null ? Infinity : b.row.age_days;
      } else if (key === 'confidence') {
        av = a.row.confidence === null || a.row.confidence === undefined ? -1 : a.row.confidence;
        bv = b.row.confidence === null || b.row.confidence === undefined ? -1 : b.row.confidence;
      } else {
        av = a.implied;
        bv = b.implied;
      }
      if (av < bv) return -view.sortDir;
      if (av > bv) return view.sortDir;
      return a.row.slug < b.row.slug ? -1 : a.row.slug > b.row.slug ? 1 : 0;
    });
  }
  /** A row by slug, or null. */
  function rowBySlug(slug) {
    for (var i = 0; i < DATA.rows.length; i++) {
      if (DATA.rows[i].slug === slug) return DATA.rows[i];
    }
    return null;
  }
  /** Toggle one protocol in the comparison set, at most three. */
  function toggleCompare(slug) {
    var at = view.compare.indexOf(slug);
    if (at >= 0) {
      view.compare.splice(at, 1);
    } else if (view.compare.length < 3) {
      view.compare.push(slug);
    }
    render();
  }

  /** The visible rows as CSV text: rank, name, category, chains, TVL, 7d, age, implied, confidence. */
  function visibleCsv() {
    var lines = ['rank,name,category,chains,tvl_usd,change_7d,age_days,implied_value_usd,confidence'];
    orderedRows(visibleRows()).forEach(function (s) {
      var r = s.row;
      var cells = [
        sandboxTouched ? s.displayRank : r.rank,
        '"' + r.name.replace(/"/g, '""') + '"',
        '"' + (r.category || 'Other').replace(/"/g, '""') + '"',
        '"' + (r.chains || []).join(';') + '"',
        r.tvl_usd,
        r.change_7d === null ? '' : r.change_7d,
        r.age_days === null ? '' : r.age_days,
        s.implied,
        r.confidence === null || r.confidence === undefined ? '' : r.confidence,
      ];
      lines.push(cells.join(','));
    });
    return lines.join('\n') + '\n';
  }
  /** Offer the visible rows as a downloaded CSV file. */
  function downloadCsv() {
    var blob = new Blob([visibleCsv()], { type: 'text/csv' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'token-radar-board.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1000);
  }

  // --- URL state ------------------------------------------------------------

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) view.query = params.get('q');
    if (params.get('p')) view.openSlug = params.get('p');
    if (params.get('category')) view.category = params.get('category');
    if (params.get('chain')) view.chain = params.get('chain');
    if (params.get('wl') === '1') view.watchlistOnly = true;
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (view.query) params.set('q', view.query);
    if (view.category !== 'all') params.set('category', view.category);
    if (view.chain !== 'all') params.set('chain', view.chain);
    if (view.watchlistOnly) params.set('wl', '1');
    if (view.openSlug) params.set('p', view.openSlug);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  // --- page sections ---------------------------------------------------------

  function topBar() {
    return h('header', { cls: 'top' },
      h('div', { cls: 'brand' },
        h('span', { cls: 'mark' }),
        h('span', { cls: 'brand-name', text: 'Token Radar' })),
      h('div', { cls: 'top-meta' },
        h('span', { text: 'Snapshot ' + DATA.as_of }),
        h('span', { text: 'DefiLlama protocol index' }),
        h('span', { text: DATA.model_version + ' model' })));
  }

  function lede() {
    return h('section', { cls: 'lede' },
      h('div', null,
        h('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        h('p', null,
          'The watchlist is the floor: every protocol with at least ',
          h('b', { text: '$' + Math.round(DATA.floor_usd / 1e6) + 'M' }),
          ' of TVL and no token on record. The radar ranks every other pre-token protocol too — ',
          h('b', { text: String(DATA.early_size) + ' early rows' }),
          ' below the floor — and sets the live-token protocols aside with their market caps. Implied value is a model, not a promise.')),
      h('div', { cls: 'facts' },
        h('div', { cls: 'fact' }, h('span', { text: 'Watchlist covered' }), h('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        h('div', { cls: 'fact' }, h('span', { text: 'Pre-token rows scored' }), h('b', { text: String(DATA.board_size) })),
        h('div', { cls: 'fact' }, h('span', { text: 'Early rows below the floor' }), h('b', { text: String(DATA.early_size) })),
        h('div', { cls: 'fact' }, h('span', { text: 'Live-token protocols set aside' }), h('b', { text: String(DATA.live_size) }))));
  }

  function spotlight() {
    var top = scoredRows().slice(0, 10);
    var max = top.length ? top[0].implied : 1;
    return h('section', { cls: 'panel spot' },
      h('h2', { text: 'Top 10 by implied value' }),
      h('div', { cls: 'spot-grid' }, top.map(function (s) {
        return h('div', { cls: 'spot-row' },
          h('span', { cls: 'rank', text: String(s.displayRank) }),
          h('span', { cls: 'spot-name', text: s.row.name }),
          h('div', { cls: 'bar', 'aria-hidden': 'true' }, h('i', { style: 'width:' + Math.max(3, Math.round((s.implied / max) * 100)) + '%' })),
          h('span', { cls: 'val', text: fmtUsd(s.implied) }));
      })));
  }

  function filterBar() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = h('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: view.query, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () {
      view.query = search.value;
      writeHash();
      render();
    });
    var cat = h('select', { id: 'category', 'aria-label': 'Filter by category' },
      h('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) {
        return h('option', { value: c, text: c, selected: c === view.category ? 'selected' : null });
      }));
    cat.addEventListener('change', function () {
      view.category = cat.value;
      writeHash();
      render();
    });
    var chain = h('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      h('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) {
        return h('option', { value: c, text: c, selected: c === view.chain ? 'selected' : null });
      }));
    chain.addEventListener('change', function () {
      view.chain = chain.value;
      writeHash();
      render();
    });
    var wl = h('label', { cls: 'check' },
      h('input', { type: 'checkbox', checked: view.watchlistOnly ? 'checked' : null, 'aria-label': 'Watchlist only' }),
      'Watchlist only');
    wl.querySelector('input').addEventListener('change', function (e) {
      view.watchlistOnly = e.target.checked;
      writeHash();
      render();
    });
    var pre = h('button', { type: 'button', 'aria-pressed': view.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { view.tab = 'pre-token'; render(); } });
    var live = h('button', { type: 'button', 'aria-pressed': view.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { view.tab = 'live'; render(); } });
    var csv = h('button', { cls: 'button', type: 'button', text: 'Download CSV', onclick: downloadCsv });
    return h('div', { cls: 'controls' },
      h('div', { cls: 'field' }, h('label', { for: 'q', text: 'Search' }), search),
      h('div', { cls: 'field' }, h('label', { for: 'category', text: 'Category' }), cat),
      h('div', { cls: 'field' }, h('label', { for: 'chain', text: 'Chain' }), chain),
      wl,
      h('div', { cls: 'field' }, h('span', { cls: 'sub', text: 'Token status' }), h('div', { cls: 'tabs' }, pre, live)),
      csv,
      h('span', { cls: 'count', text: view.tab === 'pre-token' ? visibleRows().length + ' rows shown' : DATA.live.length + ' live-token protocols' }));
  }

  function sortHead(key, label) {
    return h('th', { scope: 'col' },
      h('button', {
        type: 'button',
        onclick: function () {
          if (view.sortKey === key) view.sortDir = -view.sortDir;
          else {
            view.sortKey = key;
            view.sortDir = -1;
          }
          render();
        },
      },
      label,
      view.sortKey === key ? h('span', { 'aria-hidden': 'true', text: view.sortDir < 0 ? ' v' : ' ^' }) : null));
  }

  /** A confidence meter: a bar and a score, with the note as its title. */
  function confidenceCell(row) {
    var score = row.confidence === null || row.confidence === undefined ? null : row.confidence;
    if (score === null) return h('span', { cls: 'num', text: 'n/a' });
    var tone = score >= 80 ? 'high' : score >= 55 ? 'mid' : 'low';
    return h('span', { cls: 'conf ' + tone, title: row.confidence_note || '' },
      h('i', { style: '--w:' + score + '%' }),
      h('b', { text: String(score) }));
  }

  function boardTable() {
    var list = orderedRows(visibleRows());
    if (list.length === 0) {
      return h('div', { cls: 'panel' }, h('div', { cls: 'empty' },
        h('h2', { text: 'No protocol matches that filter' }),
        h('p', { text: 'Clear the search or pick another category to see the board again.' }),
        h('button', {
          cls: 'button primary',
          type: 'button',
          text: 'Clear filters',
          onclick: function () {
            view.query = '';
            view.category = 'all';
            view.chain = 'all';
            view.watchlistOnly = false;
            writeHash();
            render();
          },
        })));
    }
    var max = list[0].implied || 1;
    var tbody = h('tbody');
    list.forEach(function (s) {
      var r = s.row;
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthCls = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var checked = view.compare.indexOf(r.slug) >= 0;
      var box = h('input', {
        type: 'checkbox',
        checked: checked ? 'checked' : null,
        'aria-label': 'Compare ' + r.name,
        title: checked ? 'Remove from comparison' : 'Add to comparison (up to 3)',
        onclick: function (e) {
          e.stopPropagation();
          toggleCompare(r.slug);
        },
      });
      var tr = h('tr', {
        'data-selected': view.openSlug === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openDetail(r.slug);
          }
        },
      },
      h('td', { cls: 'num', text: String(sandboxTouched ? s.displayRank : r.rank) }),
      h('td', null, h('div', { cls: 'name' },
        h('b', { text: r.name }),
        h('span', { cls: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }),
        r.watchlist ? h('span', null, h('span', { cls: 'tag', text: 'watchlist' })) : null)),
      h('td', { cls: 'num', text: fmtUsd(r.tvl_usd) }),
      h('td', { cls: 'num ' + growthCls, text: growth }),
      h('td', { cls: 'num', text: fmtAge(r.age_days) }),
      h('td', null, h('div', { cls: 'implied' },
        h('div', { cls: 'bar', 'aria-hidden': 'true' }, h('i', { style: 'width:' + Math.max(3, Math.round((s.implied / max) * 100)) + '%' })),
        h('span', { cls: 'num', text: fmtUsd(s.implied) }))),
      h('td', null, confidenceCell(r)),
      h('td', null, h('span', { cls: 'status', text: 'no token' })),
      h('td', { cls: 'compare-cell' }, box));
      tbody.appendChild(tr);
    });
    return h('div', { cls: 'panel' },
      h('div', { cls: 'table-wrap' },
        h('table', null,
          h('caption', { cls: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model and farm plan; tick up to three rows to compare them.' }),
          h('thead', null, h('tr', null,
            sortHead('implied', 'Rank'),
            sortHead('name', 'Protocol'),
            sortHead('tvl', 'TVL'),
            sortHead('growth', '7d'),
            sortHead('age', 'Age'),
            sortHead('implied', 'Implied value'),
            sortHead('confidence', 'Confidence'),
            h('th', { scope: 'col', text: 'Token' }),
            h('th', { scope: 'col', text: 'Compare' }))),
          tbody)));
  }

  function liveTable() {
    var tbody = h('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(h('tr', null,
        h('td', { cls: 'num', text: 'live' }),
        h('td', null, h('div', { cls: 'name' }, h('b', { text: r.name }), h('span', { cls: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        h('td', { cls: 'num', text: fmtUsd(r.tvl_usd) }),
        h('td', { cls: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        h('td', { cls: 'num', text: fmtUsd(r.mcap_usd) }),
        h('td', null, h('span', { cls: 'status live', text: 'already trades' }))));
    });
    return h('div', { cls: 'panel' },
      h('div', { cls: 'table-wrap' },
        h('table', null,
          h('caption', { cls: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          h('thead', null, h('tr', null,
            h('th', { scope: 'col', text: 'Status' }),
            h('th', { scope: 'col', text: 'Protocol' }),
            h('th', { scope: 'col', text: 'TVL' }),
            h('th', { scope: 'col', text: '7d' }),
            h('th', { scope: 'col', text: 'Market cap' }),
            h('th', { scope: 'col', text: 'Token' }))),
          tbody)));
  }

  /** The comparison panel: up to three protocols side by side on the model's own figures. */
  function comparePanel() {
    if (view.compare.length === 0) return null;
    var picked = view.compare.map(rowBySlug).filter(function (r) { return r !== null; });
    var model = modelNow();
    function cell(label, values) {
      return h('tr', null,
        h('th', { scope: 'row', text: label }),
        values.map(function (v) { return h('td', { cls: 'num', text: v }); }));
    }
    var names = picked.map(function (r) { return r.name; });
    var implied = picked.map(function (r) { return fmtUsd(impliedOf(r, model)); });
    var tvl = picked.map(function (r) { return fmtUsd(r.tvl_usd); });
    var growth = picked.map(function (r) { return fmtPct(r.change_7d); });
    var age = picked.map(function (r) { return fmtAge(r.age_days); });
    var conf = picked.map(function (r) { return String(r.confidence === null || r.confidence === undefined ? 'n/a' : r.confidence); });
    var median = picked.map(function (r) { return fmtMult(r.comparable_median_multiple); });
    var capital = picked.map(function (r) { return '$' + farmCapital(r); });
    return h('section', { cls: 'panel compare' },
      h('div', { cls: 'compare-head' },
        h('h2', { text: 'Compare ' + picked.length + ' protocol' + (picked.length === 1 ? '' : 's') }),
        h('button', {
          cls: 'button',
          type: 'button',
          text: 'Clear comparison',
          onclick: function () {
            view.compare = [];
            render();
          },
        })),
      h('div', { cls: 'table-wrap' },
        h('table', null,
          h('thead', null, h('tr', null,
            h('th', { scope: 'col', text: '' }),
            names.map(function (n) { return h('th', { scope: 'col', text: n }); }))),
          h('tbody', null,
            cell('Implied value', implied),
            cell('TVL', tvl),
            cell('Seven-day growth', growth),
            cell('Age with no token', age),
            cell('Confidence', conf),
            cell('Comparable median multiple', median),
            cell('Farm capital to start', capital)))));
  }

  function slider(id, label, min, max, step, value, oninput) {
    var out = h('b', { text: String(value) });
    var input = h('input', { type: 'range', id: id, min: String(min), max: String(max), step: String(step), value: String(value), 'aria-label': label });
    input.addEventListener('input', function () {
      out.textContent = input.value;
      oninput(parseFloat(input.value));
    });
    return h('div', { cls: 'field' }, h('label', { for: id }, h('span', { text: label }), out), input);
  }

  function modelPanel() {
    var m = DATA.model;
    var note = h('div', { cls: 'sandbox-note' },
      h('span', { cls: 'sub', text: 'Move a slider and the board re-ranks live. The sandbox starts at the model above, so the board it shows first is board.json itself.' }),
      h('span', { cls: 'badge', text: 'sandbox: board re-ranked' }),
      h('button', {
        cls: 'button',
        type: 'button',
        text: 'Reset model',
        onclick: function () {
          sandbox = { base: DATA.model.base_multiple, growth: DATA.model.growth_weight, maturity: DATA.model.maturity_floor };
          sandboxTouched = false;
          render();
        },
      }));
    function apply() {
      sandboxTouched = sandbox.base !== DATA.model.base_multiple || sandbox.growth !== DATA.model.growth_weight || sandbox.maturity !== DATA.model.maturity_floor;
      render();
    }
    var panel = h('section', { cls: 'panel model' },
      h('h2', { text: 'How implied value is computed' }),
      h('p', { cls: 'sub', text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked. A protocol reaches the board only when it records no token and is not a wrapped, staked or bridged product of a token that already trades.' }),
      h('div', { cls: 'formula' },
        'implied = round( tvl_usd x ' + m.base_multiple + ' x (1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 x ' + m.growth_weight + ') x (' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' x ' + m.maturity_range + ') x (1 + ' + m.breadth_step + ' x min(chains - 1, ' + m.breadth_cap + ')) )'),
      h('p', { cls: 'sub', text: 'TVL and seven-day growth come from the snapshot. Age is the time since the protocol was first listed, the best record of how long it has run with no token; an unlisted age uses ' + m.unknown_age_days + ' days. Chain breadth is how many chains carry its TVL. Beside the model, each row carries its nearest live-token comparables and a confidence score for how much of its record the model can stand on. The early radar is every other rankable pre-token protocol, and the live-token protocols are set aside with their market caps shown.' }),
      h('div', { cls: 'sandbox' },
        slider('sb-base', 'Base multiple', 0.1, 0.5, 0.01, sandbox.base, function (v) { sandbox.base = v; apply(); }),
        slider('sb-growth', 'Growth weight', 0, 1, 0.05, sandbox.growth, function (v) { sandbox.growth = v; apply(); }),
        slider('sb-maturity', 'Maturity floor', 0.3, 0.8, 0.05, sandbox.maturity, function (v) { sandbox.maturity = v; apply(); })),
      note);
    if (sandboxTouched) note.classList.add('changed');
    return panel;
  }

  var dialog = h('dialog', { cls: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () {
    view.openSlug = null;
    writeHash();
  });

  function factorLine(label, value, mult, maxMult) {
    return h('div', { cls: 'factor' },
      h('div', null, h('span', { text: label }), h('b', { cls: 'num', text: value })),
      h('div', { cls: 'bar', 'aria-hidden': 'true' }, h('i', { style: 'width:' + Math.max(3, Math.round((mult / maxMult) * 100)) + '%' })));
  }

  function openDetail(slug) {
    var row = rowBySlug(slug);
    if (!row) return;
    view.openSlug = slug;
    writeHash();
    dialog.textContent = '';
    var model = modelNow();
    var f = scoreRow(row, model);
    var recomputed = impliedOf(row, model);
    var steps = farmSteps(row);
    var maxMult = Math.max(f.growthMult, f.maturityMult, f.breadthMult);
    dialog.appendChild(h('div', { cls: 'detail-head' },
      h('div', null,
        h('span', { cls: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + (row.watchlist ? ' · watchlist' : ' · early') }),
        h('h2', { id: 'detail-title', text: row.name }),
        h('p', { cls: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })),
      h('button', { cls: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })));
    dialog.appendChild(h('section', { cls: 'detail-section' },
      h('h3', { text: 'Implied value' }),
      h('div', { cls: 'equation' },
        h('div', null, h('span', { text: 'TVL' }), h('b', { cls: 'num', text: fmtUsd(row.tvl_usd) })),
        h('div', null, h('span', { text: 'Seven-day growth' }), h('b', { cls: 'num', text: fmtPct(row.change_7d) })),
        h('div', null, h('span', { text: 'Age with no token' }), h('b', { cls: 'num', text: fmtAge(row.age_days) })),
        h('div', null, h('span', { text: 'Chains carrying TVL' }), h('b', { cls: 'num', text: String((row.chains || []).length) }))),
      h('div', { cls: 'equation', style: 'margin-top:12px' },
        factorLine('Growth multiplier', String(round4(f.growthMult)), f.growthMult, maxMult),
        factorLine('Maturity multiplier', String(round4(f.maturityMult)), f.maturityMult, maxMult),
        factorLine('Breadth multiplier', String(round4(f.breadthMult)), f.breadthMult, maxMult),
        h('div', null, h('span', { text: 'Implied value' }), h('b', { cls: 'num', text: fmtUsd(recomputed) }))),
      h('p', { cls: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. The page recomputes this row as ' + fmtUsd(recomputed) + (recomputed === row.implied_value_usd ? ', the same number board.json carries.' : ' — the sandbox moved, so the board shows a re-ranked value.') + ' This is an estimate, not a price. The protocol records no token; that is DefiLlama\u2019s record, not proof it has none.' })));
    var conf = row.confidence === null || row.confidence === undefined ? null : row.confidence;
    dialog.appendChild(h('section', { cls: 'detail-section' },
      h('h3', { text: 'Confidence and risks' }),
      conf === null
        ? h('p', { cls: 'sub', text: 'No confidence score was recorded for this row.' })
        : h('div', null,
          h('div', { cls: 'conf-line' }, h('span', { text: 'Confidence in the record' }), h('b', { cls: 'num', text: conf + ' / 100' })),
          h('p', { cls: 'sub', text: row.confidence_note || '' })),
      (row.risks && row.risks.length)
        ? h('ul', { cls: 'risks' }, row.risks.map(function (risk) { return h('li', { text: risk }); }))
        : h('p', { cls: 'sub', text: 'No risk warning on this row: the record is complete and the protocol is established.' })));
    var comparables = row.comparables || [];
    dialog.appendChild(h('section', { cls: 'detail-section' },
      h('h3', { text: 'What the market already pays' }),
      comparables.length === 0
        ? h('p', { cls: 'sub', text: 'No live-token protocol is near enough in kind and size to compare with.' })
        : h('div', null,
          h('p', { cls: 'sub', text: 'The nearest tokens that already trade, and what this protocol would be worth at the multiple each one trades at. A second opinion on the model, drawn from the snapshot alone.' }),
          h('table', { cls: 'mini' },
            h('thead', null, h('tr', null,
              h('th', { scope: 'col', text: 'Comparable' }),
              h('th', { scope: 'col', text: 'Market cap' }),
              h('th', { scope: 'col', text: 'Multiple' }),
              h('th', { scope: 'col', text: 'Worth at that multiple' }))),
            h('tbody', null, comparables.map(function (c) {
              return h('tr', null,
                h('td', { text: c.name }),
                h('td', { cls: 'num', text: fmtUsd(c.mcap_usd) }),
                h('td', { cls: 'num', text: fmtMult(c.multiple) }),
                h('td', { cls: 'num', text: fmtUsd(c.implied_usd) }));
            }))),
          row.comparable_median_multiple === null || row.comparable_median_multiple === undefined
            ? null
            : h('p', { cls: 'sub', text: 'Median comparable multiple ' + fmtMult(row.comparable_median_multiple) + ': at that multiple this protocol would be worth ' + fmtUsd(Math.max(1, Math.round(row.tvl_usd * row.comparable_median_multiple))) + '.' }))));
    dialog.appendChild(h('section', { cls: 'detail-section' },
      h('h3', { text: 'Farm plan' }),
      h('p', { cls: 'sub', text: 'Starting capital about $' + farmCapital(row) + ' across the two positions.' }),
      h('ol', { cls: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return h('li', null, h('b', { text: action }), h('span', { cls: 'cost', text: tail }));
      }))));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    board.textContent = '';
    var shell = h('div', { cls: 'shell' });
    shell.appendChild(topBar());
    shell.appendChild(lede());
    shell.appendChild(spotlight());
    shell.appendChild(filterBar());
    shell.appendChild(view.tab === 'pre-token' ? boardTable() : liveTable());
    var compare = comparePanel();
    if (compare) shell.appendChild(compare);
    if (view.tab === 'pre-token') shell.appendChild(modelPanel());
    shell.appendChild(h('p', { cls: 'note', text: 'Method: the snapshot is DefiLlama\u2019s protocol index as fetched ' + DATA.as_of + '. "No token" means the record carries no market cap, no CoinGecko id and no symbol; a protocol on this board may still have a token its record does not carry. Farm steps are a plan, not a promise of any airdrop.' }));
    board.appendChild(shell);
    board.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) board.appendChild(dialog);
    if (view.openSlug) openDetail(view.openSlug);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
