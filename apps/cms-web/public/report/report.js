/*
 * Campaign report — advertiser view.
 *
 * No framework and no build step on purpose. It sits in the editorial site’s
 * `public/`, which Vite copies out untouched; adding a bundler here would mean
 * a second build pipeline for one page, and the page is small enough that the
 * whole thing loads in less than the API call it makes.
 *
 * It moved here from the read API so that every page a person opens is at one
 * address. The fetch below stays relative, which is the whole trick: the
 * editorial origin proxies /v1 to the reader API, so this is same-origin in
 * development and in production, and no CORS is granted anywhere.
 *
 * The token is held in sessionStorage at most, so it dies with the tab, and it
 * never enters the URL.
 */

(function () {
  'use strict';

  var KEY = 'saar.report.v1';

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

  /** Paisa to rupees, grouped the way prices are read in Nepal: Rs 1,50,000. */
  function money(paisa) {
    if (paisa === null || paisa === undefined) return '—';
    var rupees = paisa / 100;
    var whole = rupees === Math.round(rupees);
    return 'Rs ' + rupees.toLocaleString('en-IN', {
      minimumFractionDigits: whole ? 0 : 2,
      maximumFractionDigits: whole ? 0 : 2,
    });
  }

  var PLACEMENT = {
    card: 'Full-card ad — your poster, between stories',
    inline: 'Small ad — beside the share button on stories',
  };

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
          (PLACEMENT[r.placement] || PLACEMENT.card) +
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

    // Goal progress, for a campaign that was sold with a view target. Most are
    // sold by time and have none, and "12 of null" is not a sentence.
    if (d.goal === null || d.goal === undefined) return c;

    // Shown as a bar because "3% of 50,000" is a sentence people have to
    // decode, and a bar is not.
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

  /**
   * What was paid, and what it bought.
   *
   * Advertising is sold by time, and how often an ad is shown depends on its
   * price per day against everyone else running in the same place. So the
   * page says both: the share of voice the price buys, and the share of views
   * it actually received — which should match, and is shown so anyone can
   * check that it does.
   */
  function renderPaid(r) {
    var p = r.paid;
    var v = r.value;
    if (!p) return null;
    var c = card('What you paid for');
    var grid = el('div', 'grid');
    grid.appendChild(
      metric(money(p.pricePaisa), 'Price', p.daysElapsed + ' of ' + p.days + ' days run so far'),
    );
    grid.appendChild(metric(money(p.pricePerDayPaisa), 'Per day', 'The price divided by the days booked'));
    grid.appendChild(
      metric(
        p.shareOfVoiceNow === null ? '—' : pct(p.shareOfVoiceNow),
        'Share of voice now',
        p.shareOfVoiceNow === null
          ? 'Your campaign is not running today'
          : 'Of this placement’s ads, what your price per day buys today',
      ),
    );
    grid.appendChild(
      metric(
        pct(r.delivery.deliveredShare),
        'Share delivered',
        'Of every view in this placement over the period, how many were yours',
      ),
    );
    if (v) {
      grid.appendChild(
        metric(
          money(v.costPerThousandViewsPaisa),
          'Cost per 1,000 views',
          money(v.spentToDatePaisa) + ' of the price has run',
        ),
      );
      grid.appendChild(metric(money(v.costPerClickPaisa), 'Cost per click', 'The price so far ÷ clicks'));
    }
    c.appendChild(grid);
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
        'Share of voice',
        'Ads are sold by time. Your share of a placement is your price per day divided by the total per day of every campaign running there, so paying twice as much per day means being shown twice as often. It changes as other campaigns start and end, which is why it is shown for today.',
      ],
      [
        'Share delivered',
        'Of every view of that placement over the period, the share that was yours. It should track your share of voice; where it is lower, it is usually because your campaign targets a language or section that some readers do not open.',
      ],
      [
        'Cost per 1,000 views',
        'The part of your price for the days that have run, divided by the views so far. The same figure advertisers compare between publications.',
      ],
      [
        'Where a full-card ad appears',
        'Between stories: at most one in every ten cards, never before the fourth card of a session, and a fixed daily limit per reader. This is a fixed policy rather than a setting, which is why delivery is steady rather than spiky.',
      ],
      [
        'Where a small ad appears',
        'On stories themselves, beside the share button, always labelled as an ad. Editors can keep it off a story where an ad would be out of place — a disaster, a death — and publishers can keep it off their reporting.',
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
      renderPaid(r),
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
