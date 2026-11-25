/**
 * 苹果风交互式双曲线 SVG 面积图公共组件（消除 resize 时的重复配置代码）
 */

export function drawAreaChart(svgId, wrapId, tipId, cfg) {
  const svg = document.getElementById(svgId);
  const wrap = document.getElementById(wrapId);
  const tip = document.getElementById(tipId);
  if (!svg || !wrap || !tip) return;

  const width = wrap.clientWidth || 520;
  const height = 185;
  const padL = 42;
  const padR = 14;
  const padT = 14;
  const padB = 26;
  const cw = width - padL - padR;
  const ch = height - padT - padB;
  const n = cfg.times.length;

  const maxRaw = cfg.maxFixed || Math.max(0.5, ...cfg.seriesA, ...cfg.seriesB) * 1.25;
  const yTicks = [0, maxRaw / 2, maxRaw];

  const xAt = (i) => padL + (n <= 1 ? cw : (i / (n - 1)) * cw);
  const yAt = (v) => padT + ch - (Math.min(v, maxRaw) / maxRaw) * ch;

  const gridLines = yTicks.map((v) => {
    const y = yAt(v).toFixed(1);
    return `
      <line x1="${padL}" y1="${y}" x2="${width - padR}" y2="${y}" stroke="var(--grid-line)" stroke-dasharray="${v === 0 ? '' : '3 4'}" />
      <text x="${padL - 8}" y="${Number(y) + 4}" text-anchor="end" font-size="10.5" fill="var(--muted)" class="num">${cfg.fmtY(v)}</text>
    `;
  }).join('');

  let xLabels = '';
  if (n >= 1) {
    const idxs = n === 1 ? [0] : n === 2 ? [0, 1] : [0, Math.floor((n - 1) / 2), n - 1];
    xLabels = idxs.map((i) => `
      <text x="${xAt(i).toFixed(1)}" y="${height - 6}" text-anchor="${i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}" font-size="10.5" fill="var(--muted)" class="num">${cfg.times[i]}</text>
    `).join('');
  }

  function buildSeries(arr, color, gradId) {
    if (arr.length === 0) return '';
    if (arr.length === 1) {
      return `<circle cx="${xAt(0).toFixed(1)}" cy="${yAt(arr[0]).toFixed(1)}" r="4" fill="${color}" />`;
    }
    const pts = arr.map((v, i) => `${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`);
    const lineD = `M ${pts.join(' L ')}`;
    const areaD = `${lineD} L ${xAt(arr.length - 1).toFixed(1)},${(padT + ch).toFixed(1)} L ${xAt(0).toFixed(1)},${(padT + ch).toFixed(1)} Z`;
    const lastX = xAt(arr.length - 1).toFixed(1);
    const lastY = yAt(arr[arr.length - 1]).toFixed(1);
    return `
      <defs>
        <linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${color}" stop-opacity="0.22" />
          <stop offset="100%" stop-color="${color}" stop-opacity="0.01" />
        </linearGradient>
      </defs>
      <path d="${areaD}" fill="url(#${gradId})" />
      <path d="${lineD}" fill="none" stroke="${color}" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" />
      <circle cx="${lastX}" cy="${lastY}" r="3.8" fill="${color}" stroke="var(--bg-elev)" stroke-width="2" />
    `;
  }

  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.innerHTML = `
    ${gridLines}
    ${xLabels}
    ${buildSeries(cfg.seriesB, cfg.colorB, `${svgId}_gB`)}
    ${buildSeries(cfg.seriesA, cfg.colorA, `${svgId}_gA`)}
    <line id="${svgId}_cursor" x1="0" y1="${padT}" x2="0" y2="${padT + ch}" stroke="var(--border-strong)" stroke-dasharray="3 3" visibility="hidden" />
  `;

  wrap.onmousemove = (ev) => {
    if (n < 1) return;
    const rect = wrap.getBoundingClientRect();
    const mx = ev.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, (mx - padL) / Math.max(1, cw)));
    const idx = n === 1 ? 0 : Math.round(ratio * (n - 1));
    const cx = xAt(idx);
    const cur = document.getElementById(`${svgId}_cursor`);
    if (cur) {
      cur.setAttribute('x1', cx);
      cur.setAttribute('x2', cx);
      cur.setAttribute('visibility', 'visible');
    }
    const hasB = Array.isArray(cfg.seriesB) && cfg.seriesB.length > idx && cfg.labelB;
    tip.innerHTML = `
      <div class="sub-note mb-xs">${cfg.times[idx]}</div>
      <div><span style="color:${cfg.colorA}">●</span> ${cfg.labelA}: <strong>${cfg.fmtTip(cfg.seriesA[idx])}</strong></div>
      ${hasB ? `<div><span style="color:${cfg.colorB}">●</span> ${cfg.labelB}: <strong>${cfg.fmtTip(cfg.seriesB[idx])}</strong></div>` : ''}
    `;
    tip.classList.add('show');
    const left = cx > width * 0.65 ? cx - tip.offsetWidth - 12 : cx + 12;
    tip.style.left = `${Math.max(8, left)}px`;
    tip.style.top = '14px';
  };

  wrap.onmouseleave = () => {
    const cur = document.getElementById(`${svgId}_cursor`);
    if (cur) cur.setAttribute('visibility', 'hidden');
    tip.classList.remove('show');
  };
}

/** 统一渲染总览页两张趋势图（供数据刷新与窗口 resize 复用） */
export function renderOverviewCharts(appState) {
  if (!appState.times.length) return;
  drawAreaChart('cpuMemChart', 'cpuChartWrap', 'cpuTip', {
    times: appState.times,
    seriesA: appState.cpuHist,
    seriesB: appState.memHist,
    colorA: 'var(--blue)',
    colorB: 'var(--purple)',
    labelA: 'CPU',
    labelB: '内存',
    maxFixed: 100,
    fmtY: (v) => `${Math.round(v)}%`,
    fmtTip: (v) => `${v.toFixed(1)}%`,
  });
  drawAreaChart('netChart', 'netChartWrap', 'netTip', {
    times: appState.times,
    seriesA: appState.rxHist,
    seriesB: appState.txHist,
    colorA: 'var(--green)',
    colorB: 'var(--orange)',
    labelA: '下行 RX',
    labelB: '上行 TX',
    maxFixed: null,
    fmtY: (v) => `${v >= 10 ? v.toFixed(0) : v.toFixed(1)}M`,
    fmtTip: (v) => `${v.toFixed(2)} Mbps`,
  });
}
