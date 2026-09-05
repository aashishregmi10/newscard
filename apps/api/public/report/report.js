/*
 * Campaign report — advertiser view.
 *
 * No framework and no build step on purpose. This page is served by the read
 * API from a static directory; adding a bundler here would mean a second build
 * pipeline for one page, and the page is small enough that the whole thing
 * loads in less than the API call it makes.
 *
 * The token is held in sessionStorage at most, so it dies with the tab, and it
 * never enters the URL.
 */

(function () {
  'use strict';

  var KEY = 'newscard.report.v1';

  var authForm = document.getElementById('auth');
  var campaignInput = document.getElementById('campaign');
  var tokenInput = document.getElementById('token');
  var rememberInput = document.getElementById('remember');
  var openButton = document.getElementById('open');
  var authError = document.getElementById('autherr');
  var reportEl = document.getElementById('report');

  /* ------------------------------------------------------------ formatting */

  function int(n) {
    return (n || 0).toLocaleString('en-US');
  }

  function pct(x) {
    if (x === null || x === undefined) return '—';
    if (x === 0) return '0%';
    return (x * 100).toFixed(x < 0.01 ? 2 : 1) + '%';
  }

  function seconds(s) {
    if (!s && s !== 0) return '—';
    return s.toFixed(1) + 's';
  }

  function shortDate(iso) {
    var d = new Date(iso);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }

  function el(tag, className, text) {
    var n = document.createElement(tag);
    if (className) n.className = className;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }

  function metric(value, label, note) {
    var box = el('div', 'metric');
    box.appendChild(el('div', 'value', value));
    box.appendChild(el('div', 'label', label));
    if (note) box.appendChild(el('div', 'note', note));
    return box;
  }

  function card(title) {
    var c = el('section', 'card');
    if (title) c.appendChild(el('h2', null, title));
    return c;
  }

  /* --------------------------------------------------------------- fetching */

  function loadReport(campaignId, token) {
    return fetch('/v1/ads/campaigns/' + encodeURIComponent(campaignId) + '/report', {
      headers: { Authorization: 'Bearer ' + token },
    }).then(function (res) {
      if (res.status === 401) throw new Error('That campaign ID and token do not match.');
      if (res.status === 400) throw new Error('That campaign ID is not valid.');
      if (!res.ok) throw new Error('The report could not be loaded (' + res.status + ').');
      return res.json();
    });
  }

  /* --------------------------------------------------------------- rendering */

  function renderHeader(r) {
    var c = card();
    var head = el('div', 'head');

    var left = el('div');
    left.appendChild(el('h1', null, r.campaignName));
    left.appendChild(
      el(
        'p',
        'muted',
        r.advertiser +
          ' · ' +
          shortDate(r.period.from) +
          ' to ' +
          shortDate(r.period.to),
      ),
    );
    head.appendChild(left);

    head.appendChild(el('span', 'pill' + (r.status === 'live' ? ' live' : ''), r.status));
    c.appendChild(head);
    return c;
  }

  function renderDelivery(r) {
    var d = r.delivery;
    var c = card('Delivery');

    var grid = el('div', 'grid');
    grid.appendChild(metric(int(d.impressions), 'Impressions', 'Times your ad was shown'));
    grid.appendChild(
      metric(int(d.viewableImpressions), 'Viewable impressions', 'On screen for at least a second'),
    );
    grid.appendChild(
      metric(pct(d.viewabilityRate), 'Viewability', 'Share of impressions that were viewable'),
    );
    c.appendChild(grid);

    // Goal progress. Shown as a bar because "3% of 50,000" is a sentence people
    // have to decode, and a bar is not.
    var goal = el('div');
    goal.style.marginTop = '18px';
    goal.appendChild(
      el(
        'p',
        'muted',
        int(d.impressions) + ' of ' + int(d.goal) + ' bought impressions delivered',
      ),
    );
    var bar = el('div', 'bar');
    var fill = el('span');
    fill.style.width = Math.min(100, (d.completionRate || 0) * 100).toFixed(2) + '%';
    bar.appendChild(fill);
    goal.appendChild(bar);
    goal.appendChild(el('p', 'muted', pct(d.completionRate) + ' of the campaign delivered'));
    c.appendChild(goal);

    return c;
  }

  function renderEngagement(r) {
    var e = r.engagement;
    var c = card('Engagement');
    var grid = el('div', 'grid');
    grid.appendChild(metric(int(e.clicks), 'Clicks', 'Taps on the call to action'));
    grid.appendChild(metric(pct(e.clickThroughRate), 'Click-through rate', 'Clicks ÷ impressions'));
    grid.appendChild(
      metric(pct(e.viewableClickThroughRate), 'Viewable CTR', 'Clicks ÷ viewable impressions'),
    );
    grid.appendChild(
      metric(seconds(e.medianDwellSeconds), 'Median time on card', 'Half of readers spent longer'),
    );
    c.appendChild(grid);
    return c;
  }

  function renderReach(r) {
    var c = card('Reach');
    var grid = el('div', 'grid');
    grid.appendChild(metric(int(r.reach.devices), 'Devices reached', 'Distinct devices, not people'));
    grid.appendChild(
      metric(
        (r.reach.averageFrequency || 0).toFixed(2),
        'Average frequency',
        'Times each device saw the ad',
      ),
    );
    c.appendChild(grid);
    return c;
  }

  function renderCategories(r) {
    if (!r.byCategory || r.byCategory.length === 0) return null;
    var c = card('Where it ran');

    var table = el('table');
    var thead = el('thead');
    var hr = el('tr');
    hr.appendChild(el('th', null, 'Section'));
    hr.appendChild(el('th', 'num', 'Impressions'));
    hr.appendChild(el('th', 'num', 'Clicks'));
    hr.appendChild(el('th', 'num', 'CTR'));
    thead.appendChild(hr);
    table.appendChild(thead);

    var tbody = el('tbody');
    r.byCategory.forEach(function (row) {
      var tr = el('tr');
      tr.appendChild(el('td', null, row.category));
      tr.appendChild(el('td', 'num', int(row.impressions)));
      tr.appendChild(el('td', 'num', int(row.clicks)));
      tr.appendChild(el('td', 'num', row.impressions ? pct(row.clicks / row.impressions) : '—'));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    c.appendChild(table);
    return c;
  }

  /**
   * Daily delivery, drawn as SVG rather than pulled from a charting library —
   * a 30-bar chart does not justify 80 KB of JavaScript on a metered
   * connection, and an external CDN would be blocked by this server's CSP.
   */
  function renderDaily(r) {
    if (!r.daily || r.daily.length === 0) return null;
    var c = card('Day by day');

    var W = 840;
    var H = 160;
    var pad = { top: 10, right: 8, bottom: 22, left: 8 };
    var n = r.daily.length;
    var max = r.daily.reduce(function (m, d) {
      return Math.max(m, d.impressions);
    }, 1);
    var slot = (W - pad.left - pad.right) / n;
    var barW = Math.max(3, Math.min(38, slot * 0.62));

    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'chart');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.setAttribute('preserveAspectRatio', 'xMinYMid meet');

    r.daily.forEach(function (d, i) {
      var x = pad.left + slot * i + (slot - barW) / 2;
      var plot = H - pad.top - pad.bottom;
      var h = (d.impressions / max) * plot;
      var vh = (d.viewable / max) * plot;

      var total = document.createElementNS(svg.namespaceURI, 'rect');
      total.setAttribute('x', x.toFixed(1));
      total.setAttribute('y', (pad.top + plot - h).toFixed(1));
      total.setAttribute('width', barW.toFixed(1));
      total.setAttribute('height', Math.max(1, h).toFixed(1));
      total.setAttribute('rx', '2');
      total.setAttribute('class', 'viewable');
      svg.appendChild(total);

      // Viewable drawn over the total, so the gap between them IS the
      // non-viewable share — the number an advertiser is most often not told.
      var view = document.createElementNS(svg.namespaceURI, 'rect');
      view.setAttribute('x', x.toFixed(1));
      view.setAttribute('y', (pad.top + plot - vh).toFixed(1));
      view.setAttribute('width', barW.toFixed(1));
      view.setAttribute('height', Math.max(1, vh).toFixed(1));
      view.setAttribute('rx', '2');
      svg.appendChild(view);

      var title = document.createElementNS(svg.namespaceURI, 'title');
      title.textContent =
        d.date + ': ' + int(d.impressions) + ' impressions, ' + int(d.viewable) + ' viewable';
      total.appendChild(title);

      // Label every day when there is room, otherwise roughly six of them.
      var step = Math.max(1, Math.ceil(n / 6));
      if (n <= 10 || i % step === 0) {
        var label = document.createElementNS(svg.namespaceURI, 'text');
        label.setAttribute('x', (x + barW / 2).toFixed(1));
        label.setAttribute('y', String(H - 6));
        label.setAttribute('text-anchor', 'middle');
        label.textContent = shortDate(d.date);
        svg.appendChild(label);
      }
    });

    c.appendChild(svg);

    var legend = el('div', 'legend');
    var a = el('span');
    var ai = el('i');
    ai.style.background = 'var(--accent)';
    a.appendChild(ai);
    a.appendChild(document.createTextNode('Viewable impressions'));
    var b = el('span');
    var bi = el('i');
    bi.style.background = '#8fb2ec';
    b.appendChild(bi);
    b.appendChild(document.createTextNode('All impressions'));
    legend.appendChild(a);
    legend.appendChild(b);
    c.appendChild(legend);

    return c;
  }

  /**
   * What the numbers mean, in plain words.
   *
   * This section is the point of the page. A small advertiser told "10,000
   * impressions" and later discovering half were never on screen long enough to
   * be seen does not come back. Saying it first is cheaper than losing them.
   */
  function renderExplainer() {
    var c = card('What these numbers mean');
    var dl = el('dl', 'explain');

    var items = [
      [
        'Impression',
        'Your card was reached in the feed. We count it once per placement — scrolling back up past the same card is not counted again.',
      ],
      [
        'Viewable impression',
        'The card was on screen for at least one second. We report this separately from impressions because the two are not the same thing, and only one of them is a chance to be read.',
      ],
      [
        'Median time on card',
        'The middle value, not the average. One phone left face-up on a desk would drag an average upwards and tell you nothing; the median does not move.',
      ],
      [
        'Devices reached',
        'Distinct devices, which is not the same as distinct people — one person with two phones counts twice, and a shared phone counts once. We do not track individuals, so this is the honest upper bound.',
      ],
      [
        'How often your ad can appear',
        'At most one ad per ten cards, never before the fourth card of a session, and a fixed daily limit per reader. This is a fixed policy rather than a setting, which is why delivery is steady rather than spiky.',
      ],
    ];

    items.forEach(function (pair) {
      dl.appendChild(el('dt', null, pair[0]));
      dl.appendChild(el('dd', null, pair[1]));
    });

    c.appendChild(dl);
    return c;
  }

  function render(r) {
    reportEl.textContent = '';
    [
      renderHeader(r),
      renderDelivery(r),
      renderEngagement(r),
      renderReach(r),
      renderCategories(r),
      renderDaily(r),
      renderExplainer(),
    ].forEach(function (node) {
      if (node) reportEl.appendChild(node);
    });

    var actions = el('div');
    var print = el('button', 'linkish', 'Print or save as PDF');
    print.type = 'button';
    print.addEventListener('click', function () {
      window.print();
    });
    var out = el('button', 'linkish', 'Sign out');
    out.type = 'button';
    out.style.marginLeft = '18px';
    out.addEventListener('click', function () {
      try {
        sessionStorage.removeItem(KEY);
      } catch (e) {
        /* private mode */
      }
      location.reload();
    });
    actions.appendChild(print);
    actions.appendChild(out);
    reportEl.appendChild(actions);

    authForm.hidden = true;
    reportEl.hidden = false;
  }

  /* ----------------------------------------------------------------- wiring */

  function open(campaignId, token, remember) {
    openButton.disabled = true;
    authError.hidden = true;

    loadReport(campaignId, token)
      .then(function (r) {
        if (remember) {
          try {
            sessionStorage.setItem(KEY, JSON.stringify({ campaignId: campaignId, token: token }));
          } catch (e) {
            /* private mode — the report still opens, it just will not persist */
          }
        }
        render(r);
      })
      .catch(function (e) {
        authError.textContent = e.message;
        authError.hidden = false;
      })
      .finally(function () {
        openButton.disabled = false;
      });
  }

  authForm.addEventListener('submit', function (ev) {
    ev.preventDefault();
    open(campaignInput.value.trim(), tokenInput.value.trim(), rememberInput.checked);
  });

  // Restore a session-scoped sign-in so a refresh does not send the advertiser
  // back to the form.
  try {
    var saved = JSON.parse(sessionStorage.getItem(KEY) || 'null');
    if (saved && saved.campaignId && saved.token) {
      campaignInput.value = saved.campaignId;
      open(saved.campaignId, saved.token, true);
    }
  } catch (e) {
    /* nothing saved, or storage unavailable */
  }
})();
