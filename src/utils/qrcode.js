/**
 * 纯离线零依赖 ISO/IEC 18004 QR Code (Byte 模式 · ECC Level L · Version 1-16) SVG 生成器
 * 支持最长 586 UTF-8 字节（完整覆盖 VLESS + Reality / SOCKS5 / SS-2022 / HTTP 节点链接），零外网请求
 */

// GF(256) 对数/指数表（本原多项式 x^8 + x^4 + x^3 + x^2 + 1 = 0x11D）
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) GF_EXP[i] = GF_EXP[i - 255];
})();

function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function rsGeneratorPoly(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i += 1) {
    const next = new Array(poly.length + 1).fill(0);
    const factor = GF_EXP[i];
    for (let j = 0; j < poly.length; j += 1) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], factor);
    }
    poly = next;
  }
  return poly;
}

function rsComputeEcc(data, eccLen) {
  const gen = rsGeneratorPoly(eccLen);
  const rem = new Uint8Array(eccLen);
  for (let i = 0; i < data.length; i += 1) {
    const factor = data[i] ^ rem[0];
    rem.copyWithin(0, 1);
    rem[eccLen - 1] = 0;
    if (factor !== 0) {
      for (let j = 0; j < eccLen; j += 1) {
        rem[j] ^= gfMul(gen[j + 1], factor);
      }
    }
  }
  return rem;
}

// ISO/IEC 18004 ECC Level L 表 (V1..V16): [totalDataCodewords, ecPerBlock, blocksGroup1, dataPerG1, blocksGroup2, dataPerG2]
const VER_L = [
  null,
  [19, 7, 1, 19, 0, 0],
  [34, 10, 1, 34, 0, 0],
  [55, 15, 1, 55, 0, 0],
  [80, 20, 1, 80, 0, 0],
  [108, 26, 1, 108, 0, 0],
  [136, 18, 2, 68, 0, 0],
  [156, 20, 2, 78, 0, 0],
  [194, 24, 2, 97, 0, 0],
  [232, 30, 2, 116, 0, 0],
  [274, 18, 2, 68, 2, 69],
  [324, 20, 4, 81, 0, 0],
  [370, 24, 2, 92, 2, 93],
  [428, 26, 4, 107, 0, 0],
  [461, 30, 3, 115, 1, 116],
  [523, 22, 5, 87, 1, 88],
  [589, 24, 5, 98, 1, 99],
];

const ALIGN_POS = [
  [],
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
  [6, 30, 54],
  [6, 32, 58],
  [6, 34, 62],
  [6, 26, 46, 66],
  [6, 26, 48, 70],
  [6, 26, 50, 74],
];

function bchFormatBits(mask) {
  // ECC Level L = 01 (2 bits) + 3-bit mask
  const data = (0b01 << 3) | (mask & 7);
  let rem = data << 10;
  for (let i = 14; i >= 10; i -= 1) {
    if ((rem >> i) & 1) rem ^= 0x537 << (i - 10);
  }
  return ((data << 10) | rem) ^ 0x5412;
}

function bchVersionBits(ver) {
  let rem = ver << 12;
  for (let i = 17; i >= 12; i -= 1) {
    if ((rem >> i) & 1) rem ^= 0x1f25 << (i - 12);
  }
  return (ver << 12) | rem;
}

function chooseVersion(byteLen) {
  for (let v = 1; v < VER_L.length; v += 1) {
    const countBits = v <= 9 ? 8 : 16;
    const capBytes = Math.floor((VER_L[v][0] * 8 - 4 - countBits) / 8);
    if (byteLen <= capBytes) return v;
  }
  throw new Error('链接内容过长，超出离线二维码 V16 (586 字节) 上限');
}

function encodeCodewords(bytes, ver) {
  const [totalData, ecLen, g1Cnt, g1Len, g2Cnt, g2Len] = VER_L[ver];
  const bits = [];
  const pushBits = (val, len) => {
    for (let i = len - 1; i >= 0; i -= 1) bits.push((val >> i) & 1);
  };

  pushBits(0b0100, 4); // Byte mode
  pushBits(bytes.length, ver <= 9 ? 8 : 16);
  for (let i = 0; i < bytes.length; i += 1) pushBits(bytes[i], 8);

  const totalBits = totalData * 8;
  const term = Math.min(4, totalBits - bits.length);
  for (let i = 0; i < term; i += 1) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);

  const dataCw = new Uint8Array(totalData);
  for (let i = 0; i < bits.length / 8; i += 1) {
    let b = 0;
    for (let k = 0; k < 8; k += 1) b = (b << 1) | bits[i * 8 + k];
    dataCw[i] = b;
  }
  let padIdx = bits.length / 8;
  let toggle = 0;
  while (padIdx < totalData) {
    dataCw[padIdx++] = toggle === 0 ? 0xec : 0x11;
    toggle ^= 1;
  }

  const dataBlocks = [];
  const eccBlocks = [];
  let offset = 0;
  for (let i = 0; i < g1Cnt; i += 1) {
    const blk = dataCw.subarray(offset, offset + g1Len);
    offset += g1Len;
    dataBlocks.push(blk);
    eccBlocks.push(rsComputeEcc(blk, ecLen));
  }
  for (let i = 0; i < g2Cnt; i += 1) {
    const blk = dataCw.subarray(offset, offset + g2Len);
    offset += g2Len;
    dataBlocks.push(blk);
    eccBlocks.push(rsComputeEcc(blk, ecLen));
  }

  const out = [];
  const maxDataLen = Math.max(g1Len, g2Len);
  for (let i = 0; i < maxDataLen; i += 1) {
    for (const blk of dataBlocks) {
      if (i < blk.length) out.push(blk[i]);
    }
  }
  for (let i = 0; i < ecLen; i += 1) {
    for (const eb of eccBlocks) out.push(eb[i]);
  }
  return out;
}

function buildMatrix(text) {
  const bytes = new TextEncoder().encode(String(text || ''));
  const ver = chooseVersion(bytes.length);
  const size = ver * 4 + 17;
  const modules = Array.from({ length: size }, () => new Uint8Array(size));
  const isFunc = Array.from({ length: size }, () => new Uint8Array(size));

  const setFunc = (r, c, dark) => {
    if (r < 0 || c < 0 || r >= size || c >= size) return;
    modules[r][c] = dark ? 1 : 0;
    isFunc[r][c] = 1;
  };

  // Finder patterns + separators
  const drawFinder = (tr, tc) => {
    for (let dr = -1; dr <= 7; dr += 1) {
      for (let dc = -1; dc <= 7; dc += 1) {
        const r = tr + dr;
        const c = tc + dc;
        if (r < 0 || c < 0 || r >= size || c >= size) continue;
        const dist = Math.max(Math.abs(dr - 3), Math.abs(dc - 3));
        setFunc(r, c, dist !== 2 && dist !== 4);
      }
    }
  };
  drawFinder(0, 0);
  drawFinder(0, size - 7);
  drawFinder(size - 7, 0);

  // Timing patterns
  for (let i = 8; i < size - 8; i += 1) {
    setFunc(6, i, i % 2 === 0);
    setFunc(i, 6, i % 2 === 0);
  }

  // Alignment patterns
  const centers = ALIGN_POS[ver];
  for (const r of centers) {
    for (const c of centers) {
      if ((r === 6 && c === 6) || (r === 6 && c === size - 7) || (r === size - 7 && c === 6)) continue;
      for (let dr = -2; dr <= 2; dr += 1) {
        for (let dc = -2; dc <= 2; dc += 1) {
          setFunc(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
        }
      }
    }
  }

  // Reserve format info + dark module
  for (let i = 0; i <= 8; i += 1) {
    if (i !== 6) {
      setFunc(8, i, false);
      setFunc(i, 8, false);
    }
  }
  for (let i = 0; i < 8; i += 1) setFunc(8, size - 1 - i, false);
  for (let i = 0; i < 7; i += 1) setFunc(size - 1 - i, 8, false);
  setFunc(size - 8, 8, true);

  // Version info for V >= 7
  if (ver >= 7) {
    const vbits = bchVersionBits(ver);
    for (let i = 0; i < 18; i += 1) {
      const bit = Boolean((vbits >> i) & 1);
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      setFunc(a, b, bit);
      setFunc(b, a, bit);
    }
  }

  // Place data codewords in zigzag columns
  const codewords = encodeCodewords(bytes, ver);
  let bitIdx = 0;
  const totalBits = codewords.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    const upward = ((right + 1) & 2) === 0;
    for (let step = 0; step < size; step += 1) {
      const r = upward ? size - 1 - step : step;
      for (let dx = 0; dx < 2; dx += 1) {
        const c = right - dx;
        if (isFunc[r][c]) continue;
        let bit = 0;
        if (bitIdx < totalBits) {
          bit = (codewords[bitIdx >> 3] >> (7 - (bitIdx & 7))) & 1;
          bitIdx += 1;
        }
        modules[r][c] = bit;
      }
    }
  }

  // Evaluate masks 0..7 using standard balance + run penalty
  const maskPred = (m, r, c) => {
    switch (m) {
      case 0: return (r + c) % 2 === 0;
      case 1: return r % 2 === 0;
      case 2: return c % 3 === 0;
      case 3: return (r + c) % 3 === 0;
      case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
      case 5: return ((r * c) % 2) + ((r * c) % 3) === 0;
      case 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
      default: return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
    }
  };

  const applyFormat = (grid, mask) => {
    const fb = bchFormatBits(mask);
    for (let i = 0; i <= 5; i += 1) grid[8][i] = (fb >> (14 - i)) & 1;
    grid[8][7] = (fb >> 8) & 1;
    grid[8][8] = (fb >> 7) & 1;
    grid[7][8] = (fb >> 6) & 1;
    for (let i = 0; i < 6; i += 1) grid[5 - i][8] = (fb >> (5 - i)) & 1;
    for (let i = 0; i < 7; i += 1) grid[size - 1 - i][8] = (fb >> (14 - i)) & 1;
    for (let i = 0; i < 8; i += 1) grid[8][size - 8 + i] = (fb >> (7 - i)) & 1;
  };

  const scoreGrid = (grid) => {
    let penalty = 0;
    let dark = 0;
    for (let r = 0; r < size; r += 1) {
      let runC = 1;
      for (let c = 0; c < size; c += 1) {
        if (grid[r][c]) dark += 1;
        if (c > 0 && grid[r][c] === grid[r][c - 1]) {
          runC += 1;
          if (runC === 5) penalty += 3;
          else if (runC > 5) penalty += 1;
        } else {
          runC = 1;
        }
        if (r > 0 && c > 0) {
          const v = grid[r][c];
          if (v === grid[r - 1][c] && v === grid[r][c - 1] && v === grid[r - 1][c - 1]) {
            penalty += 3;
          }
        }
      }
    }
    for (let c = 0; c < size; c += 1) {
      let runR = 1;
      for (let r = 1; r < size; r += 1) {
        if (grid[r][c] === grid[r - 1][c]) {
          runR += 1;
          if (runR === 5) penalty += 3;
          else if (runR > 5) penalty += 1;
        } else {
          runR = 1;
        }
      }
    }
    const pctDiff = Math.abs(Math.round((dark * 100) / (size * size)) - 50);
    penalty += Math.floor(pctDiff / 5) * 10;
    return penalty;
  };

  let bestGrid = null;
  let bestScore = Infinity;
  for (let m = 0; m < 8; m += 1) {
    const g = modules.map((row, r) => row.map((v, c) => (isFunc[r][c] ? v : v ^ (maskPred(m, r, c) ? 1 : 0))));
    applyFormat(g, m);
    const sc = scoreGrid(g);
    if (sc < bestScore) {
      bestScore = sc;
      bestGrid = g;
    }
  }
  return { size, grid: bestGrid, version: ver };
}

/** 将任意节点分享链接渲染为高对比度离线 SVG 二维码（含 4-module 白边静区） */
export function renderQrSvg(text, pixelSize = 236) {
  const { size, grid } = buildMatrix(text);
  const margin = 4;
  const vb = size + margin * 2;
  const paths = [];
  for (let r = 0; r < size; r += 1) {
    let c = 0;
    while (c < size) {
      if (grid[r][c]) {
        const start = c;
        while (c < size && grid[r][c]) c += 1;
        paths.push(`M${start + margin},${r + margin}h${c - start}v1h-${c - start}z`);
      } else {
        c += 1;
      }
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${pixelSize}" height="${pixelSize}" viewBox="0 0 ${vb} ${vb}" shape-rendering="crispEdges"><rect width="${vb}" height="${vb}" fill="#ffffff"/><path d="${paths.join('')}" fill="#111111"/></svg>`;
}
