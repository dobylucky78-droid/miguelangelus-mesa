'use strict';
// MiguelAngelus Mesa (0.0.2; 0.0.5: pan, pares estéreo, grupos de mudo e VCA) — tela do Mixer: faders, mudo, solo e medidores, por camada:
//   "Mix principal" (o LR), uma camada por aux (retornos dos músicos: os faders viram os ENVIOS para aquela aux),
//   as matrizes (aux marcadas como matriz na mesa: recebem das outras aux, dos subgrupos e do master) e os FX.
// O fader da Ui vai de 0 a 1 (posição do fader); 0 dB ≈ 0,7637 e 1 = +10 dB (medido na Ui24R).
(() => {
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const mandar = o => window.chrome?.webview?.postMessage(o);

  // ---------- curva do fader (0.0.3: a fórmula exata da própria mesa, no lugar da tabela medida) ----------
  const vtoLin = a => 2.676529517952372E-4 * Math.exp(a * (23.90844819639692 + a * (-26.23877598214595 + (12.195249692570245 - .4878099877028098 * a) * a))) * (a < .055 ? Math.sin(28.559933214452666 * a) : 1);
  function paraDb(f) { if (f < 0.001) return -Infinity; const l = vtoLin(f); return l < 1e-10 ? -Infinity : 20 * Math.log10(l); }
  function deDb(db) { let a = 0.001, b = 1; for (let i = 0; i < 40; i++) { const m = (a + b) / 2; if (paraDb(m) < db) a = m; else b = m; } return (a + b) / 2; }
  const ZERO_DB = deDb(0);
  const txtDb = f => { let d = paraDb(f); if (d === -Infinity) return '−∞'; d = Math.round(d * 10) / 10; if (d === 0) return '0,0'; return (d > 0 ? '+' : '') + d.toFixed(1).replace('.', ',').replace('-', '−'); };
  // marcas na régua do fader
  const MARCAS = [10, 5, 0, -5, -10, -20, -30, -40, -60];

  // ---------- estado ----------
  const M = { vistas: [], vista: 'todos', v: {}, modelo: '', camada: 'lr', vu: null, pronta: false, mexendo: {}, pendente: {}, atualiza: new Map() };
  // (0.0.13) seção escolhida na barra da esquerda e se a barra está aberta (só conveniência deste computador)
  const guarda = { ler: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } }, por: (k, x) => { try { localStorage.setItem(k, x); } catch { } } };
  M.sec = guarda.ler('mx.sec', 'canais'); M.ladoAberto = guarda.ler('mx.lado', '1') === '1';
  const SECOES = {
    canais: { tit: 'Canais', expl: 'Mix principal: o volume de cada canal nas caixas da frente (LR). Clique no nome de um canal para abrir o channel strip.' },
    aux: { tit: 'Retornos', expl: 'Escolha o retorno: os faders viram os envios de cada canal para ele. À direita, o volume geral dessa saída.' },
    fx: { tit: 'Efeitos', expl: 'Escolha o efeito: os faders são os envios de cada canal para ele. À direita, o retorno do efeito.' },
    vistas: { tit: 'Vistas', expl: 'Listas de canais que você monta (ex.: Vozes, Banda). Duplo clique numa vista para editar; arraste a tira pelo ⠿ para mudar a ordem.' },
    mudos: { tit: 'Mudos e VCA', expl: 'Um clique num grupo emudece todos os canais dele. Os VCA e subgrupos mostram os canais de cada um.' },
    saidas: { tit: 'Saídas', expl: 'Clique numa saída para abrir o EQ gráfico, o compressor e o atraso dela. As matrizes mostram o que entra nelas.' },
    rta: { tit: 'RTA', expl: 'Escolha a saída para ver o analisador (RTA) por cima do EQ gráfico. Num canal, o botão RTA fica no equalizador.' }
  };
  const secDaCamada = c => c === 'lr' ? 'canais' : c.startsWith('aux:') ? 'aux' : c.startsWith('fx:') ? 'fx' : c.startsWith('mtx:') ? 'saidas' : 'canais';
  const val = k => M.v[k];
  const num = k => { const x = parseFloat(M.v[k]); return isNaN(x) ? 0 : x; };
  const QTD = () => M.modelo === 'ui12' ? { i: 8, l: 2, p: 2, f: 4, s: 0, v: 0, a: 4 } : M.modelo === 'ui16' ? { i: 12, l: 2, p: 2, f: 4, s: 0, v: 0, a: 6 } : { i: 20, l: 2, p: 2, f: 4, s: 6, v: 6, a: 10 };
  const nCanais = () => M.modelo === 'ui12' ? 8 : M.modelo === 'ui16' ? 12 : 24;
  const nome = (t, n) => val(`${t}.${n}.name`) || '';
  const NOMES = { i: n => `${n + 1}`, l: n => n ? 'Line R' : 'Line L', p: n => n ? 'Player R' : 'Player L', f: n => `FX ${n + 1}`, s: n => `Sub ${n + 1}`, v: n => `VCA ${n + 1}`, a: n => `Aux ${n + 1}` };
  const ehMatriz = a => val(`a.${a}.matrix`) === '1';

  // ---------- camadas ----------
  function camadas() {
    const q = QTD(), c = [{ id: 'lr', txt: 'Mix principal', dica: 'Os faders do mix principal (LR): o som das caixas da frente.' }];
    for (let a = 0; a < q.a; a++) c.push({ id: (ehMatriz(a) ? 'mtx:' : 'aux:') + a, txt: nome('a', a) || `Aux ${a + 1}`, matriz: ehMatriz(a) });
    for (let f = 0; f < q.f; f++) c.push({ id: 'fx:' + f, txt: `FX ${f + 1}`, fx: true });
    return c;
  }

  // cada tira: {k: chave do fader, km: mudo, ks: solo, rot, sub, vu: () => dB, grupo, usada}
  function tiras() {
    const q = QTD(), [tipo, nn] = M.camada.split(':'), alvo = +nn, l0 = [];
    const canal = (t, n, grupo) => ({ t, n, rot: nome(t, n), num: NOMES[t](n), grupo, ks: `${t}.${n}.solo`, kNome: `${t}.${n}.name` });
    const l = { push: x => l0.push(x) };
    const emUso = (t, n) => nome(t, n) !== '' || num(`${t}.${n}.mix`) > 0.01;
    const fontes = [['i', nCanais(), 'Entradas'], ['l', q.l, 'Line in'], ['p', q.p, 'Player']];
    if (tipo === 'lr') {
      for (const [t, qt, g] of [...fontes, ['f', q.f, 'Retornos de FX'], ['s', q.s, 'Subgrupos'], ['v', q.v, 'VCA'], ['a', q.a, 'Aux (master de cada saída)']])
        for (let n = 0; n < qt; n++) l.push({ ...canal(t, n, g), k: `${t}.${n}.mix`, km: `${t}.${n}.mute`, usada: emUso(t, n), ks: t === 'v' || t === 'a' ? `${t}.${n}.solo` : `${t}.${n}.solo` });
    } else if (tipo === 'aux') {
      for (const [t, qt, g] of [...fontes, ['f', q.f, 'Retornos de FX']])
        for (let n = 0; n < qt; n++) {
          const k = `${t}.${n}.aux.${alvo}.value`;
          if (val(k) === undefined) continue;
          l.push({ ...canal(t, n, g), k, km: `${t}.${n}.aux.${alvo}.mute`, kPost: `${t}.${n}.aux.${alvo}.post`, usada: emUso(t, n) || num(k) > 0.01 });
        }
    } else if (tipo === 'mtx') {
      for (let a = 0; a < q.a; a++) { const k = `a.${a}.mtx.${alvo}.value`; if (a !== alvo && val(k) !== undefined) l.push({ ...canal('a', a, 'Aux'), k, km: `a.${a}.mtx.${alvo}.mute`, usada: nome('a', a) !== '' || num(k) > 0.01 }); }
      for (let s = 0; s < q.s; s++) { const k = `s.${s}.mtx.${alvo}.value`; if (val(k) !== undefined) l.push({ ...canal('s', s, 'Subgrupos'), k, km: `s.${s}.mtx.${alvo}.mute`, usada: nome('s', s) !== '' || num(k) > 0.01 }); }
      if (val(`m.mtx.${alvo}.value`) !== undefined) l.push({ t: 'm', n: 0, rot: 'Master', num: 'LR', grupo: 'Master', k: `m.mtx.${alvo}.value`, km: `m.mtx.${alvo}.mute`, usada: true });
    } else if (tipo === 'fx') {
      for (const [t, qt, g] of [...fontes, ['s', q.s, 'Subgrupos']])
        for (let n = 0; n < qt; n++) { const k = `${t}.${n}.fx.${alvo}.value`; if (val(k) !== undefined) l.push({ ...canal(t, n, g), k, km: `${t}.${n}.fx.${alvo}.mute`, usada: emUso(t, n) || num(k) > 0.01 }); }
    }
    // (0.0.5) par estéreo (stereoIndex 0 e 1 em canais vizinhos) vira uma tira só; o da direita sai da lista
    const fim = [];
    for (const x of l0) {
      const p = parceiro(x.t, x.n);
      if (p === x.n - 1) continue;
      if (p === x.n + 1) { x.par = p; x.num = x.t === 'i' ? `${x.n + 1}-${x.n + 2}` : x.t === 'l' ? 'Line L-R' : 'Player L-R'; x.rot = x.rot || nome(x.t, p); x.usada = x.usada || nome(x.t, p) !== '' || num(x.k.replace(`${x.t}.${x.n}.`, `${x.t}.${p}.`)) > 0.01; }
      if (tipo === 'lr' && 'ilp'.includes(x.t) && x.t.length === 1 && !x.par) x.kPan = `${x.t}.${x.n}.pan`;
      fim.push(x);
    }
    return fim;
  }
  function parceiro(t, n) {
    if (!('ilp'.includes(t) && t.length === 1)) return null;
    const si = i => val(`${t}.${i}.stereoIndex`);
    if (si(n) === '0' && si(n + 1) === '1') return n + 1;
    if (si(n) === '1' && n > 0 && si(n - 1) === '0') return n - 1;
    return null;
  }
  // a mesma chave no canal da direita do par (o app da mesa também manda para os dois)
  function chavePar(k) {
    const m = /^([ilp])\.(\d+)\.(.+)$/.exec(k || ''); if (!m || /^(pan|name|stereoIndex)$/.test(m[3])) return null;
    const p = parceiro(m[1], +m[2]); return p === +m[2] + 1 ? `${m[1]}.${p}.${m[3]}` : null;
  }
  function definirPar(k, v) { definir(k, v); const k2 = chavePar(k); if (k2) definir(k2, v); }

  // ---------- (0.0.5) grupos de mudo e VCA ----------
  const BIT_TUDO = 23, BIT_FX = 22;
  const mg = () => parseInt(val('mgmask') || '0', 10) || 0;
  function mudoPorGrupo(t, n) {
    if (t === 'm') return false;
    const g = mg(), meu = parseInt(val(`${t}.${n}.mgmask`) || '0', 10) || 0;
    if (val(`${t}.${n}.forceunmute`) === '1') return false;
    if (g & (1 << BIT_TUDO)) return true;
    if (t === 'f' && (g & (1 << BIT_FX))) return true;
    if (meu & g & 63) return true;
    const vca = parseInt(val(`${t}.${n}.vca`) ?? '-1', 10);
    if (vca >= 0 && ((parseInt(val(`v.${vca}.mgmask`) || '0', 10) & g & 63) || val(`v.${vca}.mute`) === '1')) return true;
    return false;
  }
  const todasTiras = () => { const q = QTD(), r = []; for (const [t, qt] of [['i', nCanais()], ['l', q.l], ['p', q.p], ['f', q.f], ['s', q.s], ['a', q.a], ['v', q.v]]) for (let n = 0; n < qt; n++) r.push([t, n]); return r; };
  function membros(bit) {
    const b = 1 << bit, r = [];
    for (const [t, n] of todasTiras()) if ((parseInt(val(`${t}.${n}.mgmask`) || '0', 10) & b)) {
      r.push([t, n]);
      if (t === 'v') for (let i = 0; i < nCanais(); i++) if (val(`i.${i}.vca`) === String(n)) r.push(['i', i]);
    }
    return r;
  }
  function grupo(bit, ligar) {
    const g = mg();
    if (ligar) { for (const [t, n] of membros(bit)) definir(`${t}.${n}.forceunmute`, '0'); definir('mgmask', String(g | (1 << bit))); }
    else {
      definir('mgmask', String(g & ~(1 << bit)));
      for (const [t, n] of todasTiras()) if (val(`${t}.${n}.forceunmute`) === '1' && !mudoPorGrupo(t, n)) { definir(`${t}.${n}.forceunmute`, '0'); definir(`${t}.${n}.mute`, '0'); }
    }
    render();
  }
  function barraGrupos() {
    const g = mg(), el = $('#mxGrupos'); if (!el) return;
    const bts = [0, 1, 2, 3, 4, 5].map(i => { const vazio = membros(i).length === 0, on = !!(g & (1 << i));
      return `<button class="mg ${on ? 'on' : ''} ${vazio ? 'vazio' : ''}" data-mg="${i}" title="${vazio ? 'Grupo de mudo sem canais (marque os canais na tela de cada canal)' : on ? 'Grupo ligado: os canais dele estão mudos. Clique para soltar.' : 'Clique para emudecer todos os canais deste grupo'}">${esc(val(`mg.${i}.name`) || `G${i + 1}`)}</button>`; }).join('');
    el.innerHTML = `<span class="dica">Mudo:</span>${bts}<button class="mg ${g & (1 << BIT_FX) ? 'on' : ''}" data-mg="${BIT_FX}" title="Emudece os retornos de efeito">FX</button><button class="mg tudo ${g & (1 << BIT_TUDO) ? 'on' : ''}" data-mg="${BIT_TUDO}" title="Emudece todos os canais">Tudo</button>`;
    $$('#mxGrupos [data-mg]').forEach(b => b.onclick = () => {
      const bit = +b.dataset.mg, on = !!(mg() & (1 << bit));
      if (!on && bit < 6 && membros(bit).length === 0) { window.toast?.('Esse grupo de mudo não tem canais. Marque os canais na tela de cada canal (clique no nome).'); return; }
      if (!on && bit === BIT_TUDO && !confirm('Emudecer TODOS os canais da mesa agora?')) return;
      grupo(bit, !on);
    });
  }

  // ---------- (0.0.6) subgrupo e VCA marcados na tira; vistas (listas de canais do operador, guardadas no programa) ----------
  function marcas(t) {
    if (!('ilp'.includes(t.t) && t.t.length === 1)) return '';
    const sg = parseInt(val(`${t.t}.${t.n}.subgroup`) ?? '-1', 10), vc = parseInt(val(`${t.t}.${t.n}.vca`) ?? '-1', 10);
    return (sg >= 0 ? ` <span class="tag sg" title="Vai para o ${esc(nome('s', sg) || `Subgrupo ${sg + 1}`)} (não direto para o LR)">S${sg + 1}</span>` : '') +
           (vc >= 0 ? ` <span class="tag vc" title="No ${esc(nome('v', vc) || `VCA ${vc + 1}`)}">V${vc + 1}</span>` : '');
  }
  function membrosSub(s) { const r = new Set(); for (const [t, q] of [['i', nCanais()], ['l', 2], ['p', 2]]) for (let n = 0; n < q; n++) if (val(`${t}.${n}.subgroup`) === String(s)) r.add(`${t}:${n}`); return r; }
  function membrosVca(v) { const r = new Set(); for (const [t, q] of [['i', nCanais()], ['l', 2], ['p', 2]]) for (let n = 0; n < q; n++) if (val(`${t}.${n}.vca`) === String(v)) r.add(`${t}:${n}`); return r; }
  function filtroVista() {
    const v = M.vista;
    if (v === 'todos') return null;
    if (v.startsWith('sg:')) { const s = +v.slice(3), r = membrosSub(s); r.add(`s:${s}`); return r; }
    if (v.startsWith('vc:')) { const s = +v.slice(3), r = membrosVca(s); r.add(`v:${s}`); return r; }
    const x = M.vistas[+v]; if (!x) { M.vista = 'todos'; return null; }
    return new Set(x.Canais);
  }
  function barraVistas() {
    const el = $('#mxVistas'); if (!el) return;
    const q = QTD(), auto = [];
    for (let s = 0; s < q.s; s++) if (membrosSub(s).size) auto.push({ id: 'sg:' + s, txt: nome('s', s) || `Subgrupo ${s + 1}`, dica: 'Os canais que vão para este subgrupo' });
    for (let s = 0; s < q.v; s++) if (membrosVca(s).size) auto.push({ id: 'vc:' + s, txt: nome('v', s) || `VCA ${s + 1}`, dica: 'Os canais deste VCA' });
    if (M.vista !== 'todos' && !auto.some(a => a.id === M.vista) && !M.vistas[+M.vista]) M.vista = 'todos';
    el.innerHTML = `<span class="dica">Vista:</span>
      <button class="cam ${M.vista === 'todos' ? 'sel' : ''}" data-vi="todos">Todos</button>
      ${M.vistas.map((x, i) => `<button class="cam ${M.vista === String(i) ? 'sel' : ''}" data-vi="${i}" title="${x.Canais.length} canal(is) — duplo clique para editar">${esc(x.Nome)}</button>`).join('')}
      ${auto.map(a => `<button class="cam auto ${M.vista === a.id ? 'sel' : ''}" data-vi="${a.id}" title="${a.dica}">${esc(a.txt)}</button>`).join('')}
      <button class="peq" id="mxNovaVista" title="Monte uma lista só com os canais que você quer ver (ex.: Vozes, Banda)">＋ Vista</button>`;
    $$('#mxVistas [data-vi]').forEach(b => {
      b.onclick = () => { M.vista = b.dataset.vi; render(); };
      if (/^\d+$/.test(b.dataset.vi)) b.ondblclick = () => editarVista(+b.dataset.vi);
    });
    $('#mxNovaVista').onclick = () => editarVista(-1);
  }
  // (0.0.8) arrastar a tira pelo número (⠿) muda a ordem da vista do operador e guarda
  function ligarOrdem(vOp) {
    let arrastado = null;
    for (const h of $$('#mxTiras .tr-num[draggable]')) {
      const tira = h.closest('.tira');
      h.addEventListener('dragstart', e => { arrastado = h.dataset.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', arrastado); tira.classList.add('arrastando'); });
      h.addEventListener('dragend', () => { arrastado = null; $$('.tira').forEach(t => t.classList.remove('arrastando', 'alvo-antes', 'alvo-depois')); });
      tira.addEventListener('dragover', e => {
        if (!arrastado) return; e.preventDefault();
        const r = tira.getBoundingClientRect(), depois = e.clientX > r.left + r.width / 2;
        tira.classList.toggle('alvo-depois', depois); tira.classList.toggle('alvo-antes', !depois);
      });
      tira.addEventListener('dragleave', () => tira.classList.remove('alvo-antes', 'alvo-depois'));
      tira.addEventListener('drop', e => {
        e.preventDefault(); const alvo = tira.querySelector('.tr-num')?.dataset.id; if (!arrastado || !alvo || alvo === arrastado) return;
        const depois = tira.classList.contains('alvo-depois'), l = vOp.Canais.filter(c => c !== arrastado);
        l.splice(l.indexOf(alvo) + (depois ? 1 : 0), 0, arrastado);
        vOp.Canais = l; mandar({ tipo: 'vistas', lista: M.vistas }); render();
      });
    }
  }

  function editarVista(i) {
    const x = i >= 0 ? M.vistas[i] : { Nome: '', Canais: [] }, q = QTD(), lista = [];
    for (const [t, qt, g] of [['i', nCanais(), 'Entradas'], ['l', q.l, 'Line in'], ['p', q.p, 'Player'], ['f', q.f, 'Retornos de FX'], ['s', q.s, 'Subgrupos'], ['v', q.v, 'VCA'], ['a', q.a, 'Aux']])
      for (let n = 0; n < qt; n++) { if (parceiro(t, n) === n - 1) continue; lista.push({ id: `${t}:${n}`, g, txt: `${NOMES[t](n)}${nome(t, n) ? ' — ' + nome(t, n) : ''}` }); }
    const txtDe = id => lista.find(c => c.id === id)?.txt || id;
    let sel = x.Canais.filter(id => lista.some(c => c.id === id));   // (0.0.8) a ordem escolhida
    let d = $('#dlgVista'); if (!d) { d = document.createElement('dialog'); d.id = 'dlgVista'; d.className = 'pn dlg dlg-vista'; document.querySelector('.app').appendChild(d); }
    let gAnt = null;
    d.innerHTML = `<h3 class="rot">${i >= 0 ? 'Editar vista' : 'Nova vista'}</h3>
      <input id="vsNome" maxlength="30" placeholder="Nome (ex.: Vozes)" value="${esc(x.Nome)}" style="width:100%">
      <div class="vs-corpo">
        <div class="vs-lista">${lista.map(c => { const cab = c.g !== gAnt ? `<div class="vs-g">${esc(c.g)}</div>` : ''; gAnt = c.g; return cab + `<label class="chv"><input type="checkbox" value="${c.id}" ${sel.includes(c.id) ? 'checked' : ''}> ${esc(c.txt)}</label>`; }).join('')}</div>
        <div class="vs-ordem-cx"><div class="vs-g">Ordem na tela</div><ol class="vs-ordem" id="vsOrdem"></ol>
          <p class="dica">Arraste ou use ▲▼. No mixer, dá também para arrastar a tira pelo ⠿.</p></div>
      </div>
      <p class="dica">Fica guardada no programa (não muda nada na mesa).</p>
      <div class="linha" style="justify-content:flex-end">${i >= 0 ? '<button id="vsApagar">Apagar vista</button>' : ''}<span class="espaco"></span><button id="vsCancelar">Cancelar</button><button class="prim" id="vsSalvar">Salvar</button></div>`;
    const desenharOrdem = () => {
      $('#vsOrdem').innerHTML = sel.length ? sel.map((id, k) => `<li draggable="true" data-id="${id}"><span class="pega">⠿</span><span class="vs-txt">${esc(txtDe(id))}</span>
        <button class="peq" data-sobe="${k}" ${k ? '' : 'disabled'} aria-label="Subir ${esc(txtDe(id))}">▲</button><button class="peq" data-desce="${k}" ${k < sel.length - 1 ? '' : 'disabled'} aria-label="Descer ${esc(txtDe(id))}">▼</button></li>`).join('') : '<li class="dica">Marque os canais à esquerda.</li>';
      const troca = (a, b) => { [sel[a], sel[b]] = [sel[b], sel[a]]; desenharOrdem(); };
      $$('#vsOrdem [data-sobe]').forEach(b => b.onclick = () => troca(+b.dataset.sobe, +b.dataset.sobe - 1));
      $$('#vsOrdem [data-desce]').forEach(b => b.onclick = () => troca(+b.dataset.desce, +b.dataset.desce + 1));
      let arr = null;
      $$('#vsOrdem li[draggable]').forEach(li => {
        li.ondragstart = e => { arr = li.dataset.id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', arr); li.classList.add('arrastando'); };
        li.ondragend = () => { arr = null; desenharOrdem(); };
        li.ondragover = e => { if (!arr) return; e.preventDefault(); const r = li.getBoundingClientRect(); li.classList.toggle('alvo-depois', e.clientY > r.top + r.height / 2); li.classList.toggle('alvo-antes', e.clientY <= r.top + r.height / 2); };
        li.ondragleave = () => li.classList.remove('alvo-antes', 'alvo-depois');
        li.ondrop = e => { e.preventDefault(); const alvo = li.dataset.id; if (!arr || alvo === arr) return; const depois = li.classList.contains('alvo-depois'); sel = sel.filter(c => c !== arr); sel.splice(sel.indexOf(alvo) + (depois ? 1 : 0), 0, arr); arr = null; desenharOrdem(); };
      });
    };
    $$('#dlgVista .vs-lista input').forEach(c => c.onchange = () => { sel = c.checked ? [...sel.filter(s => s !== c.value), c.value] : sel.filter(s => s !== c.value); desenharOrdem(); });
    desenharOrdem();
    d.showModal();
    $('#vsCancelar').onclick = () => d.close();
    $('#vsSalvar').onclick = () => {
      const n = $('#vsNome').value.trim(); if (!n) { $('#vsNome').focus(); return; }
      const canais = sel.slice();
      const nova = { Nome: n, Canais: canais };
      if (i >= 0) M.vistas[i] = nova; else { M.vistas.push(nova); M.vista = String(M.vistas.length - 1); }
      mandar({ tipo: 'vistas', lista: M.vistas }); d.close(); render();
    };
    $('#vsApagar')?.addEventListener('click', () => { if (!confirm(`Apagar a vista "${x.Nome}"?`)) return; M.vistas.splice(i, 1); M.vista = 'todos'; mandar({ tipo: 'vistas', lista: M.vistas }); d.close(); render(); });
  }

  // (0.0.13) seções "Saídas" e "RTA": um botão por saída (master e cada aux/matriz) que abre a tela de saída
  function barraSaidas(sec) {
    const el = $('#mxSaidas'); if (!el) return;
    el.hidden = sec !== 'saidas' && sec !== 'rta';
    if (el.hidden) { el.innerHTML = ''; return; }
    const q = QTD(), l = [{ t: 'm', n: 0, txt: val('m.name') || 'Master (LR)' }];
    for (let a = 0; a < q.a; a++) l.push({ t: 'a', n: a, txt: nome('a', a) || `Aux ${a + 1}`, mtz: ehMatriz(a) });
    el.innerHTML = `<span class="dica">${sec === 'rta' ? 'Analisar:' : 'Abrir:'}</span>` + l.map(s => `<button class="cam ${s.mtz ? 'mtz' : ''}" data-st="${s.t}" data-sn="${s.n}" title="${sec === 'rta' ? 'Abre a saída com o RTA ligado' : 'EQ gráfico, compressor e atraso desta saída'}${s.mtz ? ' (matriz)' : ''}">${esc(s.txt)}</button>`).join('');
    $$('#mxSaidas [data-st]').forEach(b => b.onclick = () => {
      window.Canal?.abrir(b.dataset.st, +b.dataset.sn);
      if (sec === 'rta') setTimeout(() => { const r = document.querySelector('#canal .cn-rta'); if (r && !r.classList.contains('sel')) r.click(); }, 150);
    });
  }
  function escolherSecao(s) {
    if (!SECOES[s]) return;
    M.sec = s; guarda.por('mx.sec', s);
    if (s === 'canais' || s === 'mudos' || s === 'rta') M.camada = 'lr';
    if (s === 'canais' && /^\d+$/.test(M.vista) === false && M.vista !== 'todos') M.vista = 'todos';
    if ($('#canal') && !$('#canal').hidden) window.Canal?.fechar();
    render();
  }
  function abrirLado(on) {
    M.ladoAberto = on; guarda.por('mx.lado', on ? '1' : '0');
    $('#mxRail').classList.toggle('aberto', on); $('#mxMenu').setAttribute('aria-expanded', on);
  }
  $('#mxMenu').onclick = () => abrirLado(!M.ladoAberto);
  $$('#mxLado .mx-sec').forEach(b => { b.onclick = () => escolherSecao(b.dataset.sec); b.title = SECOES[b.dataset.sec]?.expl || ''; });
  abrirLado(M.ladoAberto);

  // (0.0.13) arrastar o fundo da mesa com o mouse para os lados (como no tablet); em cima do fader continua mexendo nele
  (() => {
    const tr = $('#mxTiras'); let st = null;
    const pega = e => e.pointerType === 'mouse' && e.button === 0 && !e.target.closest('.fd,.tr-pan,button,input,select,.tr-nome,.tr-num[draggable],a');
    tr.addEventListener('pointerdown', e => { if (!pega(e)) return; st = { x: e.clientX, s: tr.scrollLeft, andou: false, id: e.pointerId }; });
    tr.addEventListener('pointermove', e => {
      if (!st) return; const dx = e.clientX - st.x;
      if (!st.andou) { if (Math.abs(dx) < 5) return; st.andou = true; try { tr.setPointerCapture(st.id); } catch { } tr.classList.add('puxando'); }
      tr.scrollLeft = st.s - dx;
    });
    const fim = () => { if (st?.andou) tr.classList.remove('puxando'); st = null; };
    tr.addEventListener('pointerup', fim); tr.addEventListener('pointercancel', fim);
  })();

  function master() {
    const [tipo, nn] = M.camada.split(':'), a = +nn;
    if (tipo === 'lr') return { t: 'm', n: 0, rot: val('m.name') || 'Master', num: 'LR', k: 'm.mix', km: 'm.mute', ks: null };
    if (tipo === 'fx') return { t: 'f', n: a, rot: nome('f', a) || `Retorno FX ${a + 1}`, num: `FX ${a + 1}`, k: `f.${a}.mix`, km: `f.${a}.mute`, ks: `f.${a}.solo` };
    return { t: 'a', n: a, rot: nome('a', a) || `Aux ${a + 1}`, num: tipo === 'mtx' ? `Matriz ${a + 1}` : `Aux ${a + 1}`, k: `a.${a}.mix`, km: `a.${a}.mute`, ks: `a.${a}.solo` };
  }

  // ---------- desenho ----------
  function render() {
    const ok = M.pronta && Object.keys(M.v).length > 0;
    const noCanal = !!$('#canal') && !$('#canal').hidden;
    if (!ok && noCanal) window.Canal?.fechar();
    $('#mxSemMesa').hidden = ok; $('.mx-corpo').hidden = !ok || noCanal; $('.mx-topo').hidden = !ok || noCanal;
    if (!ok) return;
    if (noCanal) window.Canal?.refazer();
    const cs = camadas();
    if (!cs.some(c => c.id === M.camada)) M.camada = 'lr';
    // (0.0.13) a faixa de cima mostra só o que é da seção escolhida na barra da esquerda
    const sec = SECOES[M.sec] ? M.sec : 'canais';
    const daSec = { canais: c => c.id === 'lr', aux: c => c.id.startsWith('aux:'), fx: c => c.id.startsWith('fx:'), saidas: c => c.id.startsWith('mtx:') }[sec];
    const visiveis = daSec ? cs.filter(daSec) : [];
    if (daSec && !daSec({ id: M.camada })) M.camada = visiveis[0]?.id || 'lr';
    if (!daSec && M.camada !== 'lr' && sec !== 'vistas') M.camada = 'lr';
    $$('#mxLado .mx-sec').forEach(b => { const on = b.dataset.sec === sec; b.classList.toggle('sel', on); b.setAttribute('aria-current', on ? 'true' : 'false'); });
    $('#mxTSec').textContent = SECOES[sec].tit;
    $('#mxCamadas').hidden = !visiveis.length || sec === 'canais';
    $('#mxCamadas').innerHTML = visiveis.map(c => `<button role="tab" aria-selected="${c.id === M.camada}" class="cam ${c.id === M.camada ? 'sel' : ''} ${c.matriz ? 'mtz' : ''} ${c.fx ? 'fx' : ''}" data-c="${c.id}" title="${c.matriz ? 'Matriz: recebe das outras aux, dos subgrupos e do master' : c.fx ? 'Envios para o efeito' : c.id === 'lr' ? 'Mix principal' : 'Retorno/saída: os faders viram os envios para esta aux'}">${esc(c.txt)}</button>`).join('');
    $$('#mxCamadas .cam').forEach(b => b.onclick = () => { M.camada = b.dataset.c; render(); });
    $('#mxGrupos').hidden = sec !== 'mudos';
    $('#mxVistas').hidden = !['canais', 'aux', 'vistas', 'mudos'].includes(sec);
    $('#mxVistas').classList.toggle('so-auto', sec === 'mudos');
    $('#mxVistas').classList.toggle('compacta', sec === 'canais' || sec === 'aux');
    $('.mx-souso').hidden = !['canais', 'aux', 'fx'].includes(sec);
    barraSaidas(sec);
    const [tipo] = M.camada.split(':'), mst = master();
    $('#mxExplica').textContent = tipo === 'aux' && sec === 'aux' ? `Os faders são os envios de cada canal para "${mst.rot}". À direita, o volume geral dessa saída.`
      : tipo === 'mtx' ? `"${mst.rot}" é uma matriz: recebe das outras aux, dos subgrupos e do master.`
      : tipo === 'fx' && sec === 'fx' ? `Os faders são os envios de cada canal para o FX ${+M.camada.split(':')[1] + 1}. À direita, o retorno do efeito.`
      : SECOES[sec].expl;
    M.atualiza.clear();
    const soUso = $('#mxSoUso').checked, filtro = filtroVista();
    barraVistas();
    let html = '', grupo = null;
    // (0.0.8) vista do operador: as tiras na ordem que ele escolheu (um bloco só, com o nome da vista)
    const vOp = /^\d+$/.test(M.vista) ? M.vistas[+M.vista] : null;
    let lista = tiras();
    if (vOp) {
      const pos = t => { let i = vOp.Canais.indexOf(`${t.t}:${t.n}`); if (i < 0 && t.par != null) i = vOp.Canais.indexOf(`${t.t}:${t.par}`); return i; };
      lista = lista.filter(t => pos(t) >= 0).sort((a, b) => pos(a) - pos(b)).map(t => ({ ...t, grupo: vOp.Nome, ordem: true }));
    }
    for (const t of lista) {
      if (soUso && !t.usada && !filtro) continue;
      if (filtro && !filtro.has(`${t.t}:${t.n}`) && !(t.par != null && filtro.has(`${t.t}:${t.par}`))) continue;
      if (t.grupo !== grupo) { if (grupo !== null) html += '</div></div>'; grupo = t.grupo; html += `<div class="mx-grupo"><div class="mx-gnome">${esc(grupo)}</div><div class="mx-gtiras">`; }
      html += tiraHtml(t);
    }
    if (grupo !== null) html += '</div></div>';
    barraGrupos();
    $('#mxTiras').innerHTML = html || '<p class="dica" style="padding:12px">Nenhum canal em uso nesta camada. Desmarque "Só os canais em uso" para ver todos.</p>';
    $('#mxMaster').innerHTML = tiraHtml({ ...mst, master: true });
    for (const el of $$('.tira')) ligar(el);
    if (vOp) ligarOrdem(vOp);
    atualizarTudo();
  }

  // (0.0.3) cor do canal: a mesma paleta do app da mesa (i.N.color = 0 sem cor, 1 a 11)
  const CORES = ['', '#111111', '#8B0000', '#FF0000', '#FFA500', '#FFFF00', '#56DE43', '#0091C2', '#9400D3', '#808080', '#FFFFFF', '#FF1493'];
  const corDe = (t, n) => CORES[+(val(`${t}.${n}.color`) || 0)] || '';

  function tiraHtml(t) {
    const regua = MARCAS.map(d => `<i style="bottom:${(deDb(d) * 100).toFixed(2)}%"><span>${d > 0 ? '+' + d : d}</span></i>`).join('');
    return `<div class="tira ${t.master ? 'master' : ''} ${t.par != null ? 'par' : ''} t-${t.t}" data-k="${esc(t.k)}" data-kpan="${esc(t.kPan || '')}" data-vu2="${t.par != null ? `${t.t}:${t.par}` : ''}" data-km="${esc(t.km || '')}" data-ks="${esc(t.ks || '')}" data-kp="${esc(t.kPost || '')}" data-vu="${t.t}:${t.n}">
      <div class="tr-num" ${t.ordem ? `draggable="true" data-id="${t.t}:${t.n}" title="Arraste para mudar a ordem nesta vista"` : ''}>${t.ordem ? '<span class="pega">⠿</span>' : ''}${esc(t.num)}${marcas(t)}</div>
      <div class="tr-nome" title="${esc(t.rot)}" style="${corDe(t.t, t.n) ? `--cor:${corDe(t.t, t.n)}` : ''}">${esc(t.rot) || '&nbsp;'}</div>
      ${t.kPan ? `<div class="tr-pan" tabindex="0" role="slider" aria-label="${esc((t.rot || t.num) + ' — pan')}" title="Pan (arraste para os lados; duplo clique = centro)"><i></i></div>` : t.par != null ? '<div class="tr-est" title="Par estéreo: o fader, o mudo e os envios valem para os dois canais">estéreo</div>' : '<div class="tr-est"></div>'}
      <div class="tr-meio">
        ${!t.master && 'ilp'.includes(t.t) && t.t.length === 1 ? '<div class="tr-din" title="Luz: gate (verde aberto, vermelho cortando). Barra laranja: quanto o compressor está abaixando o som (até 20 dB)."><span class="gl"></span><div class="gr"><i></i></div></div>' : ''}
        <div class="vu"><i></i><b></b></div>
        <div class="fd" tabindex="0" role="slider" aria-label="${esc((t.rot || t.num) + ' — volume')}" aria-valuemin="0" aria-valuemax="1"><div class="regua">${regua}</div><div class="trilho"></div><div class="bot"></div></div>
      </div>
      <div class="tr-db">—</div>
      <div class="tr-bts">${t.km ? '<button class="b-mute" title="Mudo">M</button>' : ''}${t.ks ? '<button class="b-solo" title="Solo (só no fone)">S</button>' : ''}</div>
      ${t.kPost ? '<div class="tr-post" title="Envio antes ou depois do fader do canal"></div>' : ''}
    </div>`;
  }

  // valores na tela
  function mostrar(el) {
    const k = el.dataset.k, f = num(k), mute = el.dataset.km && val(el.dataset.km) === '1', solo = el.dataset.ks && val(el.dataset.ks) === '1';
    el.querySelector('.bot').style.bottom = `calc(${(f * 100).toFixed(2)}% - 11px)`;
    el.querySelector('.fd').setAttribute('aria-valuenow', f.toFixed(3));
    el.querySelector('.fd').setAttribute('aria-valuetext', txtDb(f) + ' dB');
    el.querySelector('.tr-db').textContent = txtDb(f);
    const [tt, nn2] = el.dataset.vu.split(':'), principal = el.dataset.km === `${tt}.${nn2}.mute`;
    const porGrupo = principal && !mute && mudoPorGrupo(tt, +nn2);
    el.classList.toggle('mudo', !!mute); el.classList.toggle('mudo-grupo', porGrupo);
    el.classList.toggle('liberado', principal && val(`${tt}.${nn2}.forceunmute`) === '1');
    const pn = el.querySelector('.tr-pan'); if (pn) { const a = num(el.dataset.kpan), pp = Math.round(200 * a - 100); pn.querySelector('i').style.left = `calc(${(a * 100).toFixed(1)}% - 3px)`; pn.title = `Pan: ${pp === 0 ? 'centro' : pp < 0 ? -pp + '% esquerda' : pp + '% direita'} (arraste; duplo clique = centro)`; }
    el.querySelector('.b-mute')?.classList.toggle('on', !!mute || porGrupo);
    el.querySelector('.b-solo')?.classList.toggle('on', !!solo);
    const p = el.querySelector('.tr-post'); if (p) p.textContent = val(el.dataset.kp) === '1' ? 'pós-fader' : 'pré-fader';
  }
  function atualizarTudo() { for (const el of $$('.tira')) mostrar(el); }

  // ---------- mexer: fader relativo (não pula), duplo clique = 0 dB, rodinha = passo fino ----------
  function definir(k, v) {
    M.v[k] = v; M.mexendo[k] = Date.now();
    M.pendente[k] = v;
    // (0.0.6) mudança de estrutura feita por esta tela (subgrupo, VCA, cor, nome…): redesenha o mixer — já, ou ao fechar a tela do canal
    if (/\.(name|matrix|stereoIndex|color|vca|subgroup|mgmask)$/.test(k) || k === 'mgmask') { if ($('#canal') && !$('#canal').hidden) M.sujo = true; else render(); }
  }
  setInterval(() => {   // no máximo uma mensagem a cada 40 ms por parâmetro
    const p = M.pendente; M.pendente = {};
    for (const k in p) mandar({ tipo: 'definir', k, v: String(p[k]) });
  }, 40);

  function ligar(el) {
    const fd = el.querySelector('.fd'), k = el.dataset.k;
    let y0 = 0, v0 = 0, arrastando = false;
    fd.addEventListener('pointerdown', e => {
      fd.setPointerCapture(e.pointerId); arrastando = true; y0 = e.clientY; v0 = num(k); el.classList.add('mexendo');
    });
    fd.addEventListener('pointermove', e => {
      if (!arrastando) return;
      // (0.0.3) zona morta de 4 px: um clique ou toque com a mão tremendo não muda o volume
      const dy = y0 - e.clientY; if (!el.classList.contains('andou')) { if (Math.abs(dy) < 4) return; el.classList.add('andou'); y0 = e.clientY; return; }
      const h = fd.getBoundingClientRect().height, fino = e.shiftKey ? 0.25 : 1;
      const v = Math.min(1, Math.max(0, v0 + dy / h * fino));
      definirPar(k, v.toFixed(4)); mostrar(el);
    });
    const soltar = () => { arrastando = false; el.classList.remove('mexendo', 'andou'); };
    fd.addEventListener('pointerup', soltar); fd.addEventListener('pointercancel', soltar);
    fd.addEventListener('dblclick', () => { definirPar(k, num(k) > 0.001 && Math.abs(num(k) - ZERO_DB) < 0.002 ? '0' : String(ZERO_DB)); mostrar(el); });
    fd.addEventListener('wheel', e => { e.preventDefault(); const db = paraDb(num(k)); const novo = e.deltaY < 0 ? (db === -Infinity ? -60 : db + 0.5) : db - 0.5; definirPar(k, (novo < -61 ? 0 : Math.min(1, deDb(novo))).toFixed(4)); mostrar(el); }, { passive: false });
    fd.addEventListener('keydown', e => {
      const passo = { ArrowUp: 0.5, ArrowDown: -0.5, PageUp: 3, PageDown: -3 }[e.key]; if (!passo) return;
      e.preventDefault(); const db = paraDb(num(k)); const novo = (db === -Infinity ? -61.6 : db) + passo; definirPar(k, (novo < -61 ? 0 : Math.min(1, deDb(novo))).toFixed(4)); mostrar(el);
    });
    el.querySelector('.b-mute')?.addEventListener('click', () => {
      const km = el.dataset.km, [tt, n2] = el.dataset.vu.split(':'), principal = km === `${tt}.${n2}.mute`;
      // mudo pelo grupo: o M "libera" só este canal (como o app da mesa: forceunmute); clicar de novo devolve ao grupo
      if (principal && val(km) !== '1' && (mudoPorGrupo(tt, +n2) || val(`${tt}.${n2}.forceunmute`) === '1')) {
        definirPar(`${tt}.${n2}.forceunmute`, val(`${tt}.${n2}.forceunmute`) === '1' ? '0' : '1'); mostrar(el); return;
      }
      definirPar(km, val(km) === '1' ? '0' : '1'); mostrar(el);
    });
    el.querySelector('.b-solo')?.addEventListener('click', () => { const ks = el.dataset.ks; definirPar(ks, val(ks) === '1' ? '0' : '1'); mostrar(el); });
    const pn = el.querySelector('.tr-pan');
    if (pn) {
      const kp = el.dataset.kpan; let x0 = 0, a0 = 0, vai = false, andou = false;
      pn.addEventListener('pointerdown', e => { e.preventDefault(); pn.setPointerCapture(e.pointerId); x0 = e.clientX; a0 = num(kp); vai = true; andou = false; });
      pn.addEventListener('pointermove', e => { if (!vai) return; const dx = e.clientX - x0; if (!andou) { if (Math.abs(dx) < 4) return; andou = true; x0 = e.clientX; return; }
        definir(kp, Math.min(1, Math.max(0, a0 + dx / (pn.clientWidth * 1.5) * (e.shiftKey ? 0.25 : 1))).toFixed(4)); mostrar(el); });
      const fim = () => { vai = false; }; pn.addEventListener('pointerup', fim); pn.addEventListener('pointercancel', fim);
      pn.addEventListener('dblclick', () => { definir(kp, '0.5'); mostrar(el); });
      pn.addEventListener('keydown', e => { const d = { ArrowLeft: -.05, ArrowRight: .05 }[e.key]; if (d == null) return; e.preventDefault(); definir(kp, Math.min(1, Math.max(0, num(kp) + d)).toFixed(4)); mostrar(el); });
    }
  }

  // ---------- medidores ----------
  const pct = db => db <= -60 ? 0 : Math.min(100, (db + 60) / 60 * 100);
  function vuDe(chave) {
    const v = M.vu; if (!v) return -128;
    const [t, n] = chave.split(':'); const i = +n;
    switch (t) {
      case 'i': return v.e?.[i] ?? -128; case 'l': return v.l?.[i] ?? -128; case 'p': return v.p?.[i] ?? -128;
      case 'f': return v.f?.[i] ?? -128; case 's': return v.s?.[i] ?? -128; case 'a': return v.a?.[i] ?? -128;
      case 'm': return Math.max(v.m?.[0] ?? -128, v.m?.[1] ?? -128);
      default: return -128;
    }
  }
  const picos = new Map();
  function desenharVu() {
    const agora = performance.now();
    for (const el of $$('.tira')) {
      const db = el.dataset.vu2 ? Math.max(vuDe(el.dataset.vu), vuDe(el.dataset.vu2)) : vuDe(el.dataset.vu), bar = el.querySelector('.vu i'), pk = el.querySelector('.vu b');
      bar.style.height = (100 - pct(db)) + '%';
      bar.parentElement.classList.toggle('clip', db >= -1);
      let p = picos.get(el.dataset.vu);
      if (!p || db > p.db || agora - p.t > 1500) { p = { db, t: agora }; picos.set(el.dataset.vu, p); }
      pk.style.bottom = pct(p.db) + '%'; pk.hidden = p.db <= -60;
      // (0.0.7) redução do compressor e luz do gate também na tira (6º byte do medidor, como na tela do canal)
      const dn = el.querySelector('.tr-din'); if (dn) {
        const [t, n] = el.dataset.vu.split(':'), canais = [[t, +n]]; if (el.dataset.vu2) canais.push([t, +el.dataset.vu2.split(':')[1]]);
        let gr = 0, fechado = false; const compOn = val(`${t}.${n}.dyn.bypass`) !== '1', gateOn = val(`${t}.${n}.gate.enabled`) === '1';
        for (const [tt, nn] of canais) { const b = window.Mixer.din(`${tt}:${nn}`); if (b == null) continue; let x = (b & 127) << 1; x |= (x >> 7) & 1; gr = Math.max(gr, (240 - x) / 3); if (!(b & 128)) fechado = true; }   // (0.0.14) bit 7 = 1 é gate aberto
        dn.querySelector('.gr i').style.height = (compOn ? Math.min(100, gr / 20 * 100) : 0) + '%';
        dn.querySelector('.gl').className = 'gl ' + (!gateOn ? '' : fechado ? 'fechado' : 'aberto');
      }
    }
  }

  // ---------- (0.0.3) clicar no nome abre a tela do canal ----------
  document.addEventListener('click', e => {
    const nomeEl = e.target.closest('.tr-nome'); if (!nomeEl) return;
    const tira = nomeEl.closest('.tira'), [t, n] = tira.dataset.vu.split(':');
    // (0.0.7) entradas, line, player, subgrupos e retornos de FX: tela do canal; aux/matriz e master: tela de saída
    if ('ilpsfam'.includes(t) && t.length === 1) window.Canal?.abrir(t, +n);
    else if (t === 'v' && !tira.classList.contains('master')) { M.vista = 'vc:' + n; render(); }   // (0.0.6) VCA: mostra os canais dele
  });

  // ---------- mensagens ----------
  window.Mixer = {
    // (0.0.3) para a tela do canal: o mesmo estado e o mesmo envio (com o mesmo limite de 40 ms)
    din: ch => { const [t, n] = ch.split(':'); const a = t === 'i' ? M.vu?.de : t === 'p' ? M.vu?.dp : t === 'l' ? M.vu?.dl : null; return a?.[+n]; },
    vuBruto: n => M.vu?.eb?.[n] ?? -128,   // (0.0.11) nível depois do pré-amp, antes do EQ (para medir o ganho)
    CORES, corDe, chavePar, definirPar, parceiro, mudoPorGrupo, val, num, definir, paraDb, deDb, txtDb, vuDe, nCanais, vuPre: ch => { const [t, n] = ch.split(':'); return t === 'i' ? (M.vu?.ep?.[+n] ?? -128) : vuDe(ch); }, get modelo() { return M.modelo; }, get estado() { return M.v; },
    aoMudar: [],
    aoFecharCanal() { if (M.sujo) { M.sujo = false; render(); } },
    set vistas(l) { M.vistas = Array.isArray(l) ? l : []; if (M.pronta) render(); },
    mesa(m) {
      const antes = M.pronta; M.pronta = m.pronta;
      if (antes !== M.pronta) { if (!M.pronta) M.v = {}; render(); }
    },
    mensagem(m) {
      if (m.tipo === 'mixerEstado') { M.v = m.v; M.modelo = m.modelo; render(); return; }
      if (m.tipo === 'valores') {
        let refazer = false;
        for (const k in m.v) {
          if (M.mexendo[k] && Date.now() - M.mexendo[k] < 800) continue;   // é o que estou mexendo agora: não briga
          if ((/\.(name|matrix|stereoIndex|color|vca|subgroup)$/.test(k) || k === 'mgmask' || /\.mgmask$/.test(k))  && M.v[k] !== m.v[k]) refazer = true;
          M.v[k] = m.v[k];
        }
        if (refazer) render(); else atualizarTudo();
        window.Mixer.aoMudar.forEach(f => f(m.v));
        return;
      }
      if (m.tipo === 'vu') { M.vu = m; requestAnimationFrame(desenharVu); window.Canal?.vu(); }
    }
  };
  $('#mxSoUso').onchange = render;
})();
