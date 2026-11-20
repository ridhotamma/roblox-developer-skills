// Reference-driven item icon. Workflow that produced it:
//   rart refs "hamburger" --out refs            -> emoji sets show how designers simplify a burger (stacked layers,
//                                                 domed bun with seeds, wavy lettuce, cheese corners drooping)
//   rart trace refs/burger-cc0.jpg --colors 6   -> the real thing (CC0 photo by Evan-Amos, Wikimedia Commons):
//                                                 width/height 1.22; bun dome ~38% of the height; filling ~35%;
//                                                 bottom bun ~22%; the top bun is slightly wider than the filling.
//   rart palette refs/burger-cc0.jpg            -> bun #c79467 / #bc7338, patty #613a21: pushed brighter and more
//                                                 saturated for a stylised icon (photos are always duller than game art)
// Stylisation: one patty instead of two (reads at 48 px), proportions kept, details reduced to seeds + lettuce frill.
export default (k) => {
  const cx = 256, W = 400;                       // overall width; height ~ W / 1.22 = 328 -> y from 92 to 420
  const bunTop = k.smooth([[cx - W / 2, 236], [cx - W * 0.46, 170], [cx - W * 0.3, 112], [cx, 92], [cx + W * 0.3, 112], [cx + W * 0.46, 170], [cx + W / 2, 236], [cx + W * 0.45, 250], [cx, 254], [cx - W * 0.45, 250]]);
  const lettuce = (() => { const pts = []; for (let i = 0; i <= 14; i++) { const x = cx - W * 0.52 + (i / 14) * W * 1.04; pts.push([x, 262 + (i % 2 ? 22 : 0)]); } return `M${cx - W * 0.5} 244 ` + pts.map(p => `L${p[0].toFixed(1)} ${p[1]}`).join('') + `L${cx + W * 0.5} 244Z`; })();
  const seeds = [[-90, 150], [-30, 128], [40, 136], [100, 160], [-120, 200], [-50, 186], [20, 196], [90, 208], [150, 214]].map(([dx, y], i) => `<ellipse cx="${cx + dx}" cy="${y}" rx="11" ry="6.5" transform="rotate(${-25 + i * 9} ${cx + dx} ${y})" fill="#fff4d6"/>`).join('');
  return {
    name: 'Burger', kind: 'item', light: 'tl', outline: { width: 14, color: 'auto' },
    refs: [{ file: 'refs/burger-cc0.jpg', note: 'Big Mac, CC0, Evan-Amos (Wikimedia Commons)', url: 'https://commons.wikimedia.org/wiki/File:Big_Mac_hamburger.jpg', license: 'CC0' }],
    layers: [
      { name: 'bottomBun', svg: k.path(k.rrect(cx - W * 0.46, 340, W * 0.92, 80, 34), '#e3a35c'), shade: 'toon' },
      { name: 'patty', svg: k.path(k.rrect(cx - W * 0.5, 284, W, 66, 33), '#7a4529'), shade: { style: 'toon', depth: 30 }, cast: { dy: 8, blur: 5 } },
      { name: 'cheese', svg: k.path(`M${cx - W * 0.5} 276 H${cx + W * 0.5} L${cx + W * 0.42} 318 L${cx + W * 0.3} 292 L${cx + W * 0.06} 332 L${cx - W * 0.12} 294 L${cx - W * 0.36} 326 L${cx - W * 0.44} 292 Z`, '#ffc928'), shade: { style: 'toon', depth: 16 }, cast: { dy: 6, blur: 4 } },
      { name: 'lettuce', svg: k.path(lettuce, '#62c94a'), shade: { style: 'toon', depth: 14 }, cast: { dy: 6, blur: 4 } },
      { name: 'topBun', svg: k.path(bunTop, '#eba659'), shade: { style: 'toon' }, cast: { dy: 10, blur: 6 } },
      { name: 'seeds', clip: 'topBun', svg: seeds },
    ],
  };
};
