'use strict';
// MiguelAngelus Mesa (0.0.3; 0.0.7: subgrupos, retornos de FX e a tela de saída das aux/matrizes e do master) — tela de um canal (entradas, line in e players): pré-amp, filtros, EQ de 5 bandas com o
// gráfico, gate, compressor, de-esser, atraso e envios. Conversões = as mesmas fórmulas do app da própria mesa Ui
// (VtoFREQ, VtoQ, VtoEQGAIN15, VtoTHRESH, VtoRATIO, VtoATTACK, VtoREL, VtoGATE_*, VtoGAIN24…), lidas em 22/11/2026.
(() => {
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const X = () => window.Mixer;
  const mandar = o => window.chrome?.webview?.postMessage(o);
  const br = (x, d = 1) => { const s = x.toFixed(d); return (/^-0[.,]?0*$/.test(s) ? s.slice(1) : s).replace('.', ',').replace('-', '−'); };
  const sinal = (x, d = 1) => (+x.toFixed(d) > 0 ? '+' : '') + br(x, d);

  // ---------- conversões (0–1 da mesa → unidade) ----------
  const desqr = a => 1 - (1 - a) * (1 - a);
  const GANHO24 = [-5, -5, -3, -3, -1, -1, 1, 1, 3, 3, 5, 5, 7, 7, 9, 9, 11, 11, 13, 13, 15, 15, 17, 17, 19, 19, 21, 21, 23, 23, 25, 25, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58];
  const freq = a => 20 * Math.pow(1102.5, a);
  const txtHz = f => f >= 1000 ? br(f / 1000, f >= 10000 ? 1 : 2) + ' kHz' : Math.round(f) + ' Hz';
  const U = {
    ganho24: { txt: a => sinal(GANHO24[Math.min(63, Math.max(0, a * 64 | 0))] - 1, 0) + ' dB' },
    ganhoP: { txt: a => sinal(90 * a - 40) + ' dB' },
    hz: { txt: a => txtHz(freq(a)) },
    hpf: { txt: a => a <= 0 ? 'desligado' : txtHz(freq(a)) },
    lpf: { txt: a => a >= 1 ? 'desligado' : txtHz(freq(a)) },
    eqdb: { txt: a => sinal(30 * a - 15) + ' dB' },
    q: { txt: a => br(0.05 * Math.pow(300, a), 2) },
    limiar: { txt: a => br(-90 + 96 * a) + ' dB' },
    razao: { txt: a => { const r = 1 / Math.max(a, 1e-5); return r > 60 ? '∞ : 1' : br(r, r < 2 ? 2 : 1) + ' : 1'; } },
    ataque: { txt: a => Math.round(Math.pow(400, desqr(a))) + ' ms' },
    soltura: { txt: a => Math.round(10 * Math.pow(200, desqr(a))) + ' ms' },
    gAtaque: { txt: a => br(Math.pow(400, desqr(a))) + ' ms' },
    gSoltura: { txt: a => Math.round(5 * Math.pow(400, desqr(a))) + ' ms' },
    gHold: { txt: a => Math.round(Math.pow(2000, desqr(a))) + ' ms' },
    profund: { txt: a => br(60 * a - 60) + ' dB' },
    saida: { txt: a => sinal(72 * a - 24) + ' dB' },
    dsHz: { txt: a => txtHz(2000 * Math.pow(7.5, a)) },
    pct: { txt: a => Math.round(100 * a) + '%' },
    pan: { txt: a => { const p = Math.round(200 * a - 100); return p === 0 ? 'centro' : p < 0 ? `${-p}% esq.` : `${p}% dir.`; } },
    bip: { txt: a => { const p = Math.round(200 * a - 100); return (p > 0 ? '+' : '') + String(p).replace('-', '−') + '%'; } },   // (0.0.13) graves/médios/agudos da Digitech
    ms: { txt: a => br(a * 1000) + ' ms' },
    fader: { txt: a => X().txtDb(a) + ' dB' },
    hpf20: { txt: a => a <= 0 ? 'desligado' : txtHz(20 * Math.pow(1000, a)) },   // (0.0.7) filtros do EQ gráfico (VtoFREQ20)
    lpf20: { txt: a => a >= 1 ? 'desligado' : txtHz(20 * Math.pow(1000, a)) }
  };

  const C = { t: null, n: 0, arrastando: {} };
  const NOMES_COR = ['Sem cor', 'Preto', 'Vinho', 'Vermelho', 'Laranja', 'Amarelo', 'Verde', 'Azul', 'Roxo', 'Cinza', 'Branco', 'Rosa'];
  const pre = () => C.t === 'm' ? 'm.' : `${C.t}.${C.n}.`;
  // (0.0.7) master com L e R "juntos" (linked): mexer num lado mexe no outro, como o app da mesa
  function parDoMaster(k) {
    let m;
    if ((m = /^m\.eq\.(peak|hpf|lpf)\.([lr])(.*)$/.exec(k)) && v('m.eq.linked') !== '0') return `m.eq.${m[1]}.${m[2] === 'l' ? 'r' : 'l'}${m[3]}`;
    if ((m = /^m\.dyn\.([lr])\.(.+)$/.exec(k)) && v('m.dyn.linked') !== '0') return `m.dyn.${m[1] === 'l' ? 'r' : 'l'}.${m[2]}`;
    return null;
  }
  const def = (k, val) => { X().definirPar(k, val); const k2 = parDoMaster(k); if (k2) X().definir(k2, val); };
  // (0.0.7) atraso: a mesa guarda em SEGUNDOS (entradas até 0,25 s; saídas até 0,5 s) — campo em ms, com o limite
  const campoMs = (k, rot, max) => `<label class="ctl ctl-num" data-k="${esc(k)}" data-max="${max}"><span class="ctl-rot">${esc(rot)}</span><input type="text" inputmode="decimal" maxlength="6" aria-label="${esc(rot)} em milissegundos"><output>ms (até ${max})</output></label>`;
  const v = k => X().val(k), num = k => X().num(k);
  const srcHw = () => { const s = v(pre() + 'src') || ''; const m = /^hw\.(\d+)$/.exec(s); return m ? +m[1] : null; };

  // um controle deslizante: chave, rótulo, unidade
  // (0.0.13) no channel strip o mesmo controle aparece como botão giratório (.knob); o range continua por baixo (teclado, leitor de tela)
  const ctl = (k, rot, u, extra = '') => `<label class="ctl" data-k="${esc(k)}" data-u="${u}" ${extra}><span class="ctl-rot">${esc(rot)}</span>
    <span class="knob" aria-hidden="true"><i></i></span><input type="range" min="0" max="1" step="0.001"><output></output></label>`;
  // (0.0.13) Digitech (amp e caixa simulados; na Ui24R só nos canais 1, 2, 21 e 22): os nomes vêm do próprio app da mesa (E_AMPS2 / E_CABS2)
  const DT_AMPS = { 0: 'Direto (sem amp)', 1: 'Carvin Legacy', 2: 'Matchless Chieftain', 3: 'Fender Blackface Deluxe', 4: 'Fender Blackface Twin', 5: 'Fender Brownface Bassman', 6: 'Fender Tweed Bassman', 7: 'Fender Tweed Champ', 8: 'Fender Tweed Deluxe', 9: 'Gibson GA40', 10: 'Hiwatt Custom 100', 11: 'Laney Supergroup', 12: 'Marshall JCM2000', 13: 'Marshall JCM800', 14: 'Marshall JCM900', 15: 'Marshall JTM45', 16: 'Marshall Master Volume', 17: 'Marshall Plexi', 18: 'Marshall Plexi Jumped', 19: 'Matchless DC30', 20: 'Mesa Dual Rectifier', 21: 'Mesa Mark IIC', 22: 'Mesa Mark IV', 23: 'Mesa Triple Rectifier', 24: 'Orange OR120', 25: 'Peavey 5150 II', 26: 'Randall RG100', 27: 'Roland Jazz Chorus', 28: 'Soldano SLO100', 29: 'Sunn 100S', 30: 'VOX AC15', 31: 'VOX AC30', 32: 'Digitech BlackBass', 33: 'Digitech Blues', 34: 'Digitech Brown Sound', 36: 'Digitech CleanTube', 37: 'Digitech Crunch', 41: 'Digitech GSP2101 CleanTube', 42: 'Digitech GSP2101 SaturatedTube', 43: 'Digitech HiGain', 44: 'Digitech Metal', 45: 'Digitech Monster', 47: 'Digitech Solo', 49: 'Digitech Stoner Rock', 50: 'Digitech Transistor', 51: 'Digitech TweedFace', 52: 'Violão Dreadnought', 53: 'Violão Jumbo' };
  const DT_CABS = { 22: 'Direto (sem caixa)', 0: 'Fender Tweed Champ 1x8', 1: 'Fender Tweed Deluxe 1x12', 2: 'Fender Tweed Bassman 4x10', 3: 'Fender Blonde Bassman 2x12', 4: 'Fender Blackface Deluxe 1x12', 5: 'Fender Blackface Twin 2x12', 6: 'Marshall 4x12', 7: 'Marshall Greenback 4x12', 8: 'Johnson V30 4x12', 9: 'Hiwatt Fane 4x12', 10: 'VHT V30 4x12', 11: 'Vox AC15 1x12', 12: 'Vox AC30 2x12', 13: 'GSP2101 compensação', 14: 'Digitech Bright', 15: 'Digitech Solo', 16: 'Digitech Rock', 17: 'Digitech Alt Rock', 18: 'Digitech Metal', 19: 'Digitech Nu Metal', 20: 'Violão Dreadnought', 21: 'Violão Jumbo' };
  const selK = (k, rot, mapa) => `<label class="selk" data-k="${esc(k)}"><span class="ctl-rot">${esc(rot)}</span><select>${Object.entries(mapa).map(([n, t]) => `<option value="${n}">${esc(t)}</option>`).join('')}</select></label>`;
  const chave = (k, rot, inv = false, extra = '') => `<label class="chv" data-k="${esc(k)}" ${inv ? 'data-inv="1"' : ''} ${extra}><input type="checkbox"> ${esc(rot)}</label>`;

  function montar() {
    if (C.t === 'a' || C.t === 'm') return montarSaida();
    const p = pre(), hw = srcHw(), ui24 = X().modelo !== 'ui12' && X().modelo !== 'ui16';
    const nomeBase = { i: `Entrada ${C.n + 1}`, l: `Line in ${C.n ? 'R' : 'L'}`, p: `Player ${C.n ? 'R' : 'L'}`, s: `Subgrupo ${C.n + 1}`, f: `Retorno FX ${C.n + 1}` }[C.t];
    const src = v(p + 'src') || '';
    const origem = hw != null ? `entrada física ${hw + 1} da mesa` : /^ub\.(\d+)/.test(src) ? `USB ${+src.split('.')[1] + 1} (do computador)` : '';
    const nAux = ui24 ? 10 : X().modelo === 'ui16' ? 6 : 4;
    const envios = [];
    for (let a = 0; a < nAux; a++) if (v(`${p}aux.${a}.value`) !== undefined) envios.push({ k: `${p}aux.${a}.value`, km: `${p}aux.${a}.mute`, kp: `${p}aux.${a}.post`, rot: v(`a.${a}.name`) || `Aux ${a + 1}`, mtz: v(`a.${a}.matrix`) === '1' });
    for (let f = 0; f < 4; f++) if (v(`${p}fx.${f}.value`) !== undefined) envios.push({ k: `${p}fx.${f}.value`, km: `${p}fx.${f}.mute`, rot: `FX ${f + 1}` });
    envios.push(...enviosMatriz());   // (0.0.9) subgrupos também mandam para as matrizes

    $('#canal').innerHTML = `
      <div class="cn-topo">
        <button class="peq" id="cnVoltar" title="Voltar ao mixer">◀ Mixer</button>
        <button class="peq" id="cnAnt" title="Canal anterior">‹</button>
        <div class="cn-titulo"><span class="dica">${esc(nomeBase)}${origem ? ' · ' + esc(origem) : ''}</span>
          <input id="cnNome" maxlength="24" placeholder="(sem nome)" title="Nome do canal na mesa"></div>
        <div class="cn-cores" role="radiogroup" aria-label="Cor do canal">${X().CORES.map((c, i) => `<button class="cor ${i ? '' : 'sem'}" data-cor="${i}" role="radio" title="${NOMES_COR[i]}" style="${c ? `--c:${c}` : ''}">${i ? '' : '✕'}</button>`).join('')}</div>
        <button class="peq" id="cnProx" title="Próximo canal">›</button>
        <span class="espaco"></span>
        <button class="peq" id="cnDesfazer" hidden title="Volta como estava antes do último preset aplicado">↶ Desfazer preset</button>
        ${'ilp'.includes(C.t) ? '<button class="peq" id="cnInstr" title="Filtro, EQ, compressor e gate num ponto de partida para o instrumento ligado neste canal">🎸 Instrumento</button>' : ''}
        ${botaoPreset('ch')}
        <div class="cn-vu" title="Nível do canal (depois do processamento e depois do fader)"><div class="vu"><i></i></div><div class="vu"><i></i></div></div>
        <button class="b-mute peq" id="cnMudo">Mudo</button>
      </div>
      <div class="cs-strip">
        <div class="pn cs-mod cs-ent"><h3 class="rot">${'ilp'.includes(C.t) ? 'Entrada' : 'Canal'}</h3>
          ${hw != null ? '<div class="cs-knobs">' + ctl(`hw.${hw}.gain`, 'Ganho', ui24 ? 'ganho24' : 'ganhoP') + '</div><button class="peq cn-medir" id="cnMedir" title="Mede o som que chega nesta entrada e sugere o ganho certo">🎤 Medir</button>' + chave(`hw.${hw}.phantom`, '48 V', false, 'data-confirma="1" title="Phantom power (só condensador ou direct box ativa)"') + (hw < 2 && v(`hw.${hw}.hiz`) !== undefined ? chave(`hw.${hw}.hiz`, 'Hi-Z', false, 'title="Entrada de instrumento (guitarra, baixo, violão com captador passivo)"') : '') : 'ilp'.includes(C.t) ? '<p class="dica">Fonte digital (sem pré-amp).</p>' : ''}
          ${C.t !== 'i' && v(p + 'gain') !== undefined ? '<div class="cs-knobs">' + ctl(p + 'gain', 'Ganho', 'ganhoP') + '</div>' : ''}
          ${chave(p + 'invert', 'Ø fase', false, 'title="Inverter a fase (polaridade)"')}
          ${v(p + 'delay') !== undefined ? campoMs(p + 'delay', 'Atraso', 250) : ''}
        </div>
        ${C.t === 'i' && C.n < 2 && v(p + 'digitech.enabled') !== undefined ? `<div class="pn cs-mod cs-digi"><h3 class="rot">Digitech <span class="cn-h3d">${chave(p + 'digitech.enabled', 'ligado')}</span></h3>
          ${X().parceiro(C.t, C.n) != null ? '<p class="dica cs-par">Par estéreo: vale para os dois canais. Linha que vem de outra mesa: deixe desligado.</p>' : ''}
          ${selK(p + 'digitech.amp', 'Amplificador', DT_AMPS)}${selK(p + 'digitech.cab', 'Caixa', DT_CABS)}
          <div class="cs-knobs">${ctl(p + 'digitech.gain', 'Drive', 'pct')}${ctl(p + 'digitech.level', 'Volume', 'pct')}${ctl(p + 'digitech.bass', 'Graves', 'bip', 'data-zero="0.5"')}${ctl(p + 'digitech.mid', 'Médios', 'bip', 'data-zero="0.5"')}${ctl(p + 'digitech.treble', 'Agudos', 'bip', 'data-zero="0.5"')}</div>
        </div>` : ''}
        <div class="pn cs-mod cs-filt"><h3 class="rot">Filtros</h3>
          <div class="cs-knobs uma">${ctl(p + 'eq.hpf.freq', 'Passa-altas', 'hpf')}${v(p + 'eq.lpf.freq') !== undefined ? ctl(p + 'eq.lpf.freq', 'Passa-baixas', 'lpf') : ''}</div>
        </div>
        <div class="pn cs-mod cs-gate"><h3 class="rot">Gate <span class="cn-h3d">${botaoPreset('gate')}${chave(p + 'gate.enabled', 'ligado')}</span></h3>
          <div class="cn-gate off" id="cnGate" title="Aceso verde = o gate está deixando o som passar; vermelho = fechado, cortando"><span class="led"></span><span>—</span></div>
          <canvas class="cn-dyn" id="cnGateG" height="150" title="Som que entra (→) e som que sai (↑). Arraste o ponto L para os lados = limiar; o ponto P para cima/baixo = profundidade. O ponto que se mexe é o som de agora."></canvas>
          <div class="cs-knobs">${ctl(p + 'gate.thresh', 'Limiar', 'limiar')}${ctl(p + 'gate.depth', 'Profund.', 'profund')}${ctl(p + 'gate.attack', 'Ataque', 'gAtaque')}${ctl(p + 'gate.hold', 'Retenção', 'gHold')}${ctl(p + 'gate.release', 'Soltura', 'gSoltura')}</div>
        </div>
        <div class="pn cs-mod cs-comp"><h3 class="rot">Compressor <span class="cn-h3d">${botaoPreset('dynch')}${chave(p + 'dyn.bypass', 'ligado', true)}</span></h3>
          <div class="cn-gr" title="Quanto o compressor está abaixando o som agora (0 a 20 dB). O tracinho branco é o maior corte dos últimos segundos."><span class="dica">Redução</span><div class="gr-barra" id="cnGr"><i></i><b></b></div><span id="cnGrTxt" class="gr-txt">—</span></div>
          <canvas class="cn-dyn" id="cnCompG" height="150" title="Som que entra (→) e som que sai (↑). Arraste o ponto L para os lados = limiar; o ponto R para cima/baixo = razão. O ponto que se mexe é o som de agora."></canvas>
          <div class="cs-knobs">${ctl(p + 'dyn.threshold', 'Limiar', 'limiar')}${ctl(p + 'dyn.ratio', 'Razão', 'razao')}${ctl(p + 'dyn.attack', 'Ataque', 'ataque')}${ctl(p + 'dyn.release', 'Soltura', 'soltura')}${ctl(p + 'dyn.outgain', 'Saída', 'saida')}</div>
          ${v(p + 'dyn.softknee') !== undefined ? chave(p + 'dyn.softknee', 'Joelho suave') : ''}
        </div>
        <div class="pn cs-mod cs-eq cn-eq"><h3 class="rot">Equalizador <span class="cn-h3d">${botaoRta()}${botaoPreset('eqch')}${chave(p + 'eq.bypass', 'ligado', true)}</span></h3>
          <canvas id="cnCurva" height="170" title="Arraste os pontos: para os lados = frequência, para cima/baixo = ganho (Shift = só frequência). Rodinha = largura. Duplo clique = 0 dB."></canvas>
          <div class="cs-bandas">${[1, 2, 3, 4, 5].filter(b => v(`${p}eq.b${b}.freq`) !== undefined).map(b => `<div class="banda b${b}"><b>${b}</b>
            ${ctl(`${p}eq.b${b}.gain`, 'Ganho', 'eqdb', 'data-zero="0.5"')}${ctl(`${p}eq.b${b}.freq`, 'Freq.', 'hz')}${ctl(`${p}eq.b${b}.q`, 'Q', 'q')}</div>`).join('')}</div>
        </div>
        ${v(p + 'deesser.enabled') !== undefined ? `<div class="pn cs-mod cs-ds"><h3 class="rot">De-esser <span class="cn-h3d">${chave(p + 'deesser.enabled', 'ligado')}</span></h3>
          <canvas class="cn-dyn" id="cnDsG" height="150" title="Onde o de-esser age (forma aproximada). Arraste o ponto: para os lados = frequência, para cima/baixo = limiar. Com o RTA ligado, aparece o som de agora por trás."></canvas>
          <div class="cs-knobs">${ctl(p + 'deesser.freq', 'Frequência', 'dsHz')}${ctl(p + 'deesser.threshold', 'Limiar', 'pct')}${ctl(p + 'deesser.ratio', 'Razão', 'razao')}</div></div>` : ''}
        <div class="pn cs-mod cs-env cn-envios"><h3 class="rot">Envios</h3>
          ${listaEnvios(envios, 'Sem envios.')}
        </div>
        <div class="pn cs-mod cs-saida"><h3 class="rot">Saída</h3>
          ${v(p + 'pan') !== undefined ? '<div class="cs-knobs uma">' + ctl(p + 'pan', 'Pan', 'pan', 'data-zero="0.5"') + '</div>' : ''}
          ${ctl(p + 'mix', 'Fader', 'fader', 'data-vert="1"')}
        </div>
        ${v(p + 'mgmask') !== undefined ? `<div class="pn cs-mod cn-grupos"><h3 class="rot">${v(p + 'subgroup') !== undefined ? 'Subgrupo, VCA e grupos de mudo' : v(p + 'vca') !== undefined ? 'VCA e grupos de mudo' : 'Grupos de mudo'}</h3>
          ${ui24 && v(p + 'subgroup') !== undefined ? `<label class="ctl-rot">Subgrupo <select id="cnSub"><option value="-1">nenhum (direto no LR)</option>${[0, 1, 2, 3, 4, 5].map(i => `<option value="${i}">${esc(v(`s.${i}.name`) || `Subgrupo ${i + 1}`)}</option>`).join('')}</select></label>
          <p class="dica">No subgrupo, o canal deixa de ir direto para o LR: vai pelo fader do subgrupo (ex.: toda a banda junta).</p>` : ''}
          ${v(p + 'vca') !== undefined ? `<label class="ctl-rot">VCA <select id="cnVca"><option value="-1">nenhum</option>${[0, 1, 2, 3, 4, 5].map(i => `<option value="${i}">${esc(v(`v.${i}.name`) || `VCA ${i + 1}`)}</option>`).join('')}</select></label>
          <p class="dica">O fader do VCA sobe e desce todos os canais dele juntos (ex.: todas as vozes).</p>` : ''}
          <div class="cn-mg">${[0, 1, 2, 3, 4, 5].map(i => `<label class="chv"><input type="checkbox" data-mgbit="${i}"> ${esc(v(`mg.${i}.name`) || `Grupo ${i + 1}`)}</label>`).join('')}</div>
          <p class="dica">Os botões de grupo ficam no Mixer, em 🔇 Mudos e VCA: um clique emudece todos os canais do grupo.</p></div>` : ''}
      </div>`;

    ligarControles();
    $('#cnMudo').onclick = () => { const k = pre() + 'mute'; def(k, v(k) === '1' ? '0' : '1'); atualizar(); };
    const nome = $('#cnNome');
    nome.onchange = () => def(pre() + 'name', nome.value.trim());
    C.ponto = null; ligarCurva($('#cnCurva'));
    C.dPonto = null; ['cnGateG', 'cnCompG', 'cnDsG'].forEach(id => { const cv = $('#' + id); if (cv) ligarDin(cv); });
    ligarTopo(); ligarRta();
    const bm = $('#cnMedir'); if (bm) bm.onclick = e => { e.preventDefault(); abrirMedir(); };
    const bi = $('#cnInstr'); if (bi) bi.onclick = abrirInstr;
    const ss = $('#cnSub'); if (ss) ss.onchange = () => {
      const i = +ss.value;
      // (0.0.14) sem pergunta: se o fader do subgrupo está em −∞, já vai a 0 dB (senão o canal some da frente) e avisa
      if (i >= 0 && +(v(`s.${i}.mix`) || 0) < 0.01) { X().definir(`s.${i}.mix`, String(X().deDb(0))); window.toast?.(`O fader do ${v(`s.${i}.name`) || `Subgrupo ${i + 1}`} estava em −∞: foi para 0 dB.`); }
      def(pre() + 'subgroup', String(i)); atualizar();
    };
    const sv = $('#cnVca'); if (sv) sv.onchange = () => {
      const i = +sv.value;
      if (i >= 0 && +(v(`v.${i}.mix`) || 0) < 0.01) { X().definir(`v.${i}.mix`, String(X().deDb(0))); window.toast?.(`O fader do ${v(`v.${i}.name`) || `VCA ${i + 1}`} estava em −∞: foi para 0 dB.`); }   // (0.0.14) sem pergunta
      def(pre() + 'vca', String(i)); atualizar();
    };
    $$('#canal [data-mgbit]').forEach(c => c.onchange = () => {
      const b = 1 << +c.dataset.mgbit, m = parseInt(v(pre() + 'mgmask') || '0', 10) || 0;
      def(pre() + 'mgmask', String(c.checked ? m | b : m & ~b)); atualizar();
    });
    $$('#canal .cor').forEach(b => b.onclick = () => { def(pre() + 'color', b.dataset.cor); atualizar(); });
    atualizar();
  }

  // (0.0.9) matrizes: na Ui24R qualquer aux pode virar matriz (a.N.matrix = 1); quem alimenta são o master (m.mtx.N),
  // os subgrupos (s.K.mtx.N) e as outras aux (a.K.mtx.N). Destino = índice da aux-matriz.
  const nomeAux = a => v(`a.${a}.name`) || `Aux ${a + 1}`;
  const ehMtz = a => v(`a.${a}.matrix`) === '1';
  function enviosMatriz() {      // da saída/subgrupo aberto PARA as matrizes
    if (C.t === 'a' && ehMtz(C.n)) return [];
    const l = [];
    for (let a = 0; a < 10; a++) {
      if ((C.t === 'a' && a === C.n) || !ehMtz(a) || v(`${pre()}mtx.${a}.value`) === undefined) continue;
      l.push({ k: `${pre()}mtx.${a}.value`, km: `${pre()}mtx.${a}.mute`, rot: nomeAux(a), mtz: true, kpan: v(`a.${a}.stereoIndex`) !== '-1' ? `${pre()}mtx.${a}.pan` : null });
    }
    return l;
  }
  function fontesMatriz(n) {     // o que ENTRA na matriz n
    const l = [], est = v(`a.${n}.stereoIndex`) !== '-1';
    // "em uso" = master, ou com nome, ou já mandando algo; as outras ficam recolhidas (como na camada do Mixer)
    const por = (src, rot, nomeado) => { const k = `${src}mtx.${n}.value`; if (v(k) !== undefined) l.push({ k, km: `${src}mtx.${n}.mute`, rot, kpan: est ? `${src}mtx.${n}.pan` : null, poucoUso: !nomeado && num(k) <= 0.01 }); };
    por('m.', 'Master (LR)', true);
    for (let s = 0; s < 6; s++) por(`s.${s}.`, v(`s.${s}.name`) || `Subgrupo ${s + 1}`, !!v(`s.${s}.name`));
    for (let a = 0; a < 10; a++) if (a !== n && !ehMtz(a)) por(`a.${a}.`, nomeAux(a), !!v(`a.${a}.name`));
    return l;
  }
  const umEnvio = e => `<div class="envio ${e.mtz ? 'mtz' : ''}">${ctl(e.k, e.rot + (e.mtz ? ' (matriz)' : ''), 'fader')}${e.kpan ? ctl(e.kpan, 'Pan', 'pan', 'data-zero="0.5"') : ''}
            <span class="env-bts">${e.kp ? `<span class="dica env-post" data-kp="${esc(e.kp)}"></span>` : ''}<button class="b-mute peq env-mudo" data-km="${esc(e.km)}">M</button></span></div>`;
  const listaEnvios = (l, vazio) => {
    if (!l.length) return `<p class="dica">${vazio}</p>`;
    const usa = l.filter(e => !e.poucoUso), resto = l.filter(e => e.poucoUso);
    return usa.map(umEnvio).join('') + (resto.length ? `<details class="env-resto"${C.restoAberto ? ' open' : ''}><summary class="dica">Outras ${resto.length} (sem nome e em −∞)</summary>${resto.map(umEnvio).join('')}</details>` : '');
  };

  // (0.0.7) liga deslizadores, chaves e campos de ms da tela aberta (canal ou saída)
  function ligarControles() {
    $$('#canal .env-mudo').forEach(b => b.onclick = () => { const k = b.dataset.km; def(k, v(k) === '1' ? '0' : '1'); atualizar(); });
    $$('#canal .env-resto').forEach(d => d.ontoggle = () => { C.restoAberto = d.open; });
    for (const el of $$('#canal .ctl:not(.ctl-num)')) {
      const r = el.querySelector('input'), k = el.dataset.k;
      r.oninput = () => { C.arrastando[k] = Date.now(); def(k, (+r.value).toFixed(4)); mostrarCtl(el); if (k.includes('.eq.')) { curva(); geq(); } if (/\.(gate|dyn|deesser)\./.test(k)) dinGraf(); };
      r.ondblclick = () => { const z = el.dataset.zero ?? (el.dataset.u === 'fader' ? String(X().deDb(0)) : null); if (z == null) return; r.value = z; r.oninput(); };
      ligarRelativo(r);
    }
    for (const el of $$('#canal .chv')) {
      const c = el.querySelector('input'), k = el.dataset.k;
      c.onchange = () => {
        let on = c.checked;
        if (el.dataset.confirma && on && !confirm('Ligar o phantom (48 V) neste canal?\n\nUse só com microfone condensador ou direct box ativa. Abaixe o volume antes: ligar dá um estalo nas caixas.')) { c.checked = false; return; }
        if (el.dataset.matriz && !confirm(on ? `Transformar "${nomeAux(C.n)}" em MATRIZ?\n\nEla deixa de receber os canais e passa a receber só das outras aux, dos subgrupos e do master. O que sai por ela muda na hora.`
          : `Voltar "${nomeAux(C.n)}" a ser uma AUX comum?\n\nEla deixa de receber das aux/subgrupos/master e volta a receber os envios dos canais. O que sai por ela muda na hora.`)) { c.checked = !on; return; }
        def(k, el.dataset.inv ? (on ? '0' : '1') : (on ? '1' : '0'));
        if (k.includes('.eq.')) { curva(); geq(); }
        if (/\.(gate|dyn|deesser)\./.test(k)) dinGraf();
        if (el.dataset.remonta) montar();
      };
    }
    for (const el of $$('#canal .selk')) {   // (0.0.13) listas de escolha (amp e caixa da Digitech): valor inteiro
      const s = el.querySelector('select'), k = el.dataset.k;
      s.onchange = () => { C.arrastando[k] = Date.now(); def(k, String(parseInt(s.value, 10) || 0)); };
    }
    for (const el of $$('#canal .ctl-num')) {
      const r = el.querySelector('input'), k = el.dataset.k, max = +el.dataset.max;
      r.onchange = () => {
        let ms = parseFloat(String(r.value).replace(',', '.')); if (!isFinite(ms) || ms < 0) ms = 0; if (ms > max) ms = max;
        r.value = br(ms, 1).replace(',0', ''); def(k, (ms / 1000).toFixed(6));
      };
    }
  }
  function ligarTopo() {
    $$('#canal .cn-preset').forEach(b => b.onclick = e => { e.preventDefault(); abrirPresets(b.dataset.tp); });
    $('#cnDesfazer').onclick = desfazer;
    $('#cnVoltar').onclick = fechar;
    $('#cnAnt').onclick = () => andar(-1); $('#cnProx').onclick = () => andar(1);
    $$('#canal .cor').forEach(b => b.onclick = () => { def(pre() + 'color', b.dataset.cor); atualizar(); });
  }

  // ---------- (0.0.7) tela de SAÍDA: aux/matriz (a.N) e master (m): EQ gráfico de 31 bandas, filtros, compressor, atraso, fase ----------
  const GEQ_HZ = '20 25 32 40 50 63 80 100 125 160 200 250 315 400 500 630 800 1k 1,25k 1,6k 2k 2,5k 3,15k 4k 5k 6,3k 8k 10k 12,5k 16k 20k'.split(' ');
  const ehMaster = () => C.t === 'm';
  const lado = () => C.lado || 'l';
  const kGeq = i => ehMaster() ? `m.eq.peak.${lado()}.${i}` : `${pre()}eq.peak.${i}`;
  const kFiltro = f => ehMaster() ? `m.eq.${f}.${lado()}` : `${pre()}eq.${f}`;
  const kDyn = s => ehMaster() ? `m.dyn.${lado()}.${s}` : `${pre()}dyn.${s}`;

  function montarSaida() {
    const p = pre(), M = ehMaster(), mtz = !M && v(`${p}matrix`) === '1';
    const nomeBase = M ? 'Master (LR)' : `${mtz ? 'Matriz' : 'Aux'} ${C.n + 1}`;
    const eqJunto = v('m.eq.linked') !== '0', dynJunto = v('m.dyn.linked') !== '0';
    const ladoBts = M && !(eqJunto && dynJunto) ? `<span class="sd-lado" role="group" aria-label="Lado do master">${['l', 'r'].map(s => `<button class="peq ${lado() === s ? 'sel' : ''}" data-lado="${s}">${s === 'l' ? 'Esquerdo (L)' : 'Direito (R)'}</button>`).join('')}</span>` : '';
    const afs = v(p + 'afs.enabled');
    $('#canal').innerHTML = `
      <div class="cn-topo">
        <button class="peq" id="cnVoltar" title="Voltar ao mixer">◀ Mixer</button>
        <button class="peq" id="cnAnt" title="Saída anterior" ${M ? 'disabled' : ''}>‹</button>
        <div class="cn-titulo"><span class="dica">${esc(nomeBase)}</span>
          <input id="cnNome" maxlength="24" placeholder="(sem nome)" title="Nome na mesa"></div>
        <button class="peq" id="cnProx" title="Próxima saída" ${M ? 'disabled' : ''}>›</button>
        <span class="espaco"></span>
        ${ladoBts}
        <button class="peq" id="cnDesfazer" hidden title="Volta como estava antes do último preset aplicado">↶ Desfazer preset</button>
        ${M ? botaoPreset('chm') : ''}
        <div class="cn-vu" title="Nível da saída"><div class="vu"><i></i></div><div class="vu"><i></i></div></div>
        <button class="b-mute peq" id="cnMudo">Mudo</button>
      </div>
      <div class="cn-grade sd-grade">
        <div class="pn cn-card"><h3 class="rot">Saída</h3>
          ${ctl(p + 'mix', 'Volume (fader)', 'fader')}
          ${M ? chave('m.l.invert', 'Inverter fase (L)') + chave('m.r.invert', 'Inverter fase (R)') : v(p + 'invert') !== undefined ? chave(p + 'invert', 'Inverter fase') : ''}
          ${M ? (v('m.delayL') !== undefined ? campoMs('m.delayL', 'Atraso (L)', 500) + campoMs('m.delayR', 'Atraso (R)', 500) : '') : v(p + 'delay') !== undefined ? campoMs(p + 'delay', 'Atraso', 500) : ''}
          ${afs !== undefined ? `<p class="dica">AFS (anti-microfonia): ${afs === '1' ? '<b>ligado</b>' : 'desligado'} — ajuste pelo app da mesa.</p>` : ''}
          ${!M && v(p + 'matrix') !== undefined ? chave(p + 'matrix', 'Usar como matriz', false, 'data-matriz="1" data-remonta="1"') : ''}
          <p class="dica">${M ? 'O som das caixas da frente.' : mtz ? 'Matriz: mistura das aux, dos subgrupos e do master.' : 'Retorno/saída: os envios de cada canal ficam na camada desta aux no Mixer.'}</p>
        </div>
        <div class="pn cn-card cn-envios"><h3 class="rot">${mtz ? 'O que entra nesta matriz' : 'Envios para as matrizes'}</h3>
          ${mtz ? listaEnvios(fontesMatriz(C.n), 'Nada pode entrar nesta matriz.') : listaEnvios(enviosMatriz(), 'Nenhuma aux está como matriz. Para ter uma, abra a aux e ligue "Usar como matriz".')}
          ${mtz ? '<p class="dica">Os canais não entram direto na matriz: entram pelas aux, subgrupos e master acima.</p>' : ''}
        </div>
        <div class="pn cn-card"><h3 class="rot">Compressor <span class="cn-h3d">${M ? chave('m.dyn.linked', 'L e R juntos', false, 'data-remonta="1"') : ''}${botaoPreset(M ? 'dynm' : 'dynaux')}${chave(p + 'dyn.bypass', 'ligado', true)}</span></h3>
          ${ctl(kDyn('threshold'), 'Limiar', 'limiar')}${ctl(kDyn('ratio'), 'Razão', 'razao')}${ctl(kDyn('attack'), 'Ataque', 'ataque')}${ctl(kDyn('release'), 'Soltura', 'soltura')}${ctl(kDyn('outgain'), 'Ganho de saída', 'saida')}
          ${v(kDyn('softknee')) !== undefined ? chave(kDyn('softknee'), 'Joelho suave') : ''}
          ${M && !dynJunto ? `<p class="dica">Editando o lado ${lado() === 'l' ? 'esquerdo' : 'direito'}.</p>` : ''}
        </div>
        <div class="pn cn-card sd-geq"><h3 class="rot">Equalizador gráfico (31 bandas) <span class="cn-h3d">${botaoRta()}${M ? chave('m.eq.linked', 'L e R juntos', false, 'data-remonta="1"') : ''}${botaoPreset(M ? 'eqm' : 'eqaux')}${chave(p + 'eq.bypass', 'ligado', true)}</span></h3>
          <canvas id="sdGeq" height="230" tabindex="0" aria-label="Equalizador gráfico: setas para os lados escolhem a banda, para cima e para baixo mudam o ganho"></canvas>
          <p class="dica cn-curva-dica">Arraste cada banda para cima/baixo (±15 dB) · duplo clique = 0 dB · Shift = fino · setas: ←→ banda, ↑↓ 0,5 dB${M && !eqJunto ? ` · editando o lado ${lado() === 'l' ? 'esquerdo' : 'direito'}` : ''}</p>
          <div class="cn-filtros">${ctl(kFiltro('hpf'), 'Passa-altas', 'hpf20')}${ctl(kFiltro('lpf'), 'Passa-baixas', 'lpf20')}</div>
        </div>
      </div>`;
    ligarControles(); ligarTopo(); ligarRta();
    $('#cnMudo').onclick = () => { const k = p + 'mute'; def(k, v(k) === '1' ? '0' : '1'); atualizar(); };
    const nome = $('#cnNome'); nome.onchange = () => def(p + 'name', nome.value.trim());
    $$('#canal [data-lado]').forEach(b => b.onclick = () => { C.lado = b.dataset.lado; montar(); });
    C.banda = C.banda ?? 15; ligarGeq($('#sdGeq'));
    atualizar();
  }

  function geq() {
    const cv = $('#sdGeq'); if (!cv) return;
    const w = cv.clientWidth; if (!w) return; if (cv.width !== w) cv.width = w;
    const h = cv.height, g = cv.getContext('2d'), est = getComputedStyle(document.querySelector('.app'));
    const ligado = v(pre() + 'eq.bypass') !== '1', bw = w / 31, topo = 8, base = h - 22, y = db => topo + (15 - db) / 30 * (base - topo);
    g.clearRect(0, 0, w, h);
    g.strokeStyle = est.getPropertyValue('--bd'); g.fillStyle = est.getPropertyValue('--su'); g.font = '10px Segoe UI'; g.lineWidth = 1;
    for (const d of [-12, -6, 0, 6, 12]) { g.beginPath(); g.moveTo(0, y(d)); g.lineTo(w, y(d)); g.stroke(); g.fillText((d > 0 ? '+' : '') + d, 2, y(d) - 2); }
    // filtros: área apagada fora da faixa
    const hp = num(kFiltro('hpf')), lp = v(kFiltro('lpf')) === undefined ? 1 : num(kFiltro('lpf')), xf = a => Math.log(20 * Math.pow(1000, a) / 20) / Math.log(1000) * w;
    g.fillStyle = 'rgba(127,176,232,.12)';
    if (hp > 0) g.fillRect(0, topo, xf(hp), base - topo);
    if (lp < 1) g.fillRect(xf(lp), topo, w - xf(lp), base - topo);
    if (C.rta) pintarRta(g, f => (Math.log(f / 20) / Math.log(1000) * 30 + 0.5) * bw, topo, base, w);   // banda i fica em 20·1000^(i/30) Hz
    for (let i = 0; i < 31; i++) {
      const a = num(kGeq(i)), db = 30 * a - 15, x0 = i * bw + 2, ww = Math.max(2, bw - 4), sel = i === C.banda;
      g.fillStyle = !ligado ? est.getPropertyValue('--su') : sel ? '#f0c24a' : Math.abs(db) < 0.05 ? 'rgba(212,169,58,.35)' : '#d4a93a';
      const y0 = y(0), y1 = y(db); g.fillRect(x0, Math.min(y0, y1) - (Math.abs(db) < 0.05 ? 1 : 0), ww, Math.max(2, Math.abs(y1 - y0)));
      g.fillStyle = sel ? est.getPropertyValue('--tx') || '#fff' : est.getPropertyValue('--su'); g.font = (sel ? 'bold ' : '') + '9px Segoe UI'; g.textAlign = 'center';
      if (sel || bw > 26 || i % 2 === 0) g.fillText(GEQ_HZ[i], x0 + ww / 2, h - 6);
      g.textAlign = 'start';
    }
    const a = num(kGeq(C.banda)), db = 30 * a - 15, txt = `${GEQ_HZ[C.banda]}Hz  ${sinal(db)} dB`;
    g.font = '12px Segoe UI'; const tw = g.measureText(txt).width + 12, bx = Math.min(w - tw - 2, Math.max(2, C.banda * bw + bw / 2 - tw / 2));
    g.fillStyle = 'rgba(0,0,0,.75)'; g.fillRect(bx, topo, tw, 20); g.fillStyle = '#fff'; g.fillText(txt, bx + 6, topo + 14);
  }
  function ligarGeq(cv) {
    if (!cv) return;
    const banda = e => { const r = cv.getBoundingClientRect(); return Math.min(30, Math.max(0, Math.floor((e.clientX - r.left) / r.width * 31))); };
    const mexer = (i, a) => { const k = kGeq(i); C.arrastando[k] = Date.now(); def(k, Math.min(1, Math.max(0, a)).toFixed(4)); geq(); };
    let st = null;
    cv.addEventListener('pointerdown', e => { e.preventDefault(); cv.focus({ preventScroll: true }); cv.setPointerCapture(e.pointerId); C.banda = banda(e); st = { y: e.clientY, a: num(kGeq(C.banda)), andou: false }; geq(); });
    cv.addEventListener('pointermove', e => {
      if (!st || !cv.hasPointerCapture(e.pointerId)) return;
      let dy = st.y - e.clientY;
      if (!st.andou) { if (Math.abs(dy) < 4) return; st.andou = true; st.y = e.clientY; dy = 0; }   // zona morta: clicar só escolhe a banda
      const r = cv.getBoundingClientRect(), alt = r.height - 30;
      mexer(C.banda, st.a + dy / alt * (e.shiftKey ? 0.25 : 1));
    });
    const soltar = () => { st = null; }; cv.addEventListener('pointerup', soltar); cv.addEventListener('pointercancel', soltar);
    cv.addEventListener('dblclick', e => { C.banda = banda(e); mexer(C.banda, 0.5); });
    cv.addEventListener('keydown', e => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); C.banda = Math.min(30, Math.max(0, C.banda + (e.key === 'ArrowLeft' ? -1 : 1))); geq(); return; }
      const d = { ArrowUp: 0.5, ArrowDown: -0.5, PageUp: 3, PageDown: -3 }[e.key]; if (d == null) return;
      e.preventDefault(); mexer(C.banda, num(kGeq(C.banda)) + d / 30);
    });
  }

  // (0.0.3) deslizador relativo, como o fader: clicar não pula o valor; arrastar mexe a partir de onde está
  // (zona morta de 4 px; Shift = fino). Teclado: setas ±1%, PageUp/PageDown ±5%. A rodinha continua rolando a página.
  function ligarRelativo(r) {
    let st = null;
    const parar = e => e.preventDefault();
    r.addEventListener('mousedown', parar); r.addEventListener('touchstart', parar, { passive: false });
    r.addEventListener('pointerdown', e => {
      e.preventDefault(); r.focus({ preventScroll: true }); r.setPointerCapture(e.pointerId);
      // (0.0.13) botão giratório: arrastar para cima ou para a direita sobe (180 px = curso todo); fader vertical: para cima
      const ctlEl = r.closest('.ctl'), knob = !!r.closest('.cs-strip') && !r.closest('.cs-env') && !ctlEl.dataset.vert, vert = !!ctlEl.dataset.vert && !!r.closest('.cs-strip');
      st = { x: e.clientX, y: e.clientY, v: +r.value, andou: false, knob, vert, w: knob ? 180 : vert ? (r.getBoundingClientRect().height || 1) : (r.getBoundingClientRect().width || 1) };
      ctlEl.classList.add('mexendo');
    });
    r.addEventListener('pointermove', e => {
      if (!st || !r.hasPointerCapture(e.pointerId)) return;
      const mov = () => st.knob ? (e.clientX - st.x) - (e.clientY - st.y) : st.vert ? -(e.clientY - st.y) : e.clientX - st.x;
      let dx = mov();
      if (!st.andou) { if (Math.abs(dx) < 4) return; st.andou = true; st.x = e.clientX; st.y = e.clientY; dx = 0; }
      const novo = Math.min(1, Math.max(0, st.v + dx / st.w * (e.shiftKey ? 0.25 : 1)));
      if (Math.abs(novo - +r.value) < 0.0005) return;
      r.value = novo; r.oninput();
    });
    const soltar = () => { st = null; r.closest('.ctl')?.classList.remove('mexendo'); };
    r.addEventListener('pointerup', soltar); r.addEventListener('pointercancel', soltar);
    r.addEventListener('keydown', e => {
      const passo = { ArrowRight: .01, ArrowUp: .01, ArrowLeft: -.01, ArrowDown: -.01, PageUp: .05, PageDown: -.05 }[e.key];
      if (passo == null) return; e.preventDefault();
      r.value = Math.min(1, Math.max(0, +r.value + passo * (e.shiftKey ? 0.2 : 1))); r.oninput();
    });
  }

  function mostrarCtl(el) {
    const a = parseFloat(el.querySelector('input').value); el.querySelector('output').textContent = U[el.dataset.u]?.txt(a) ?? a.toFixed(3);
    el.style.setProperty('--a', a);   // (0.0.13) giro do botão no channel strip (−135° a +135°)
    if (el.dataset.zero === '0.5') el.classList.add('bip');
  }

  function atualizar() {
    if ($('#canal').hidden) return;
    const agora = Date.now();
    for (const el of $$('#canal .ctl:not(.ctl-num)')) {
      const k = el.dataset.k; if (C.arrastando[k] && agora - C.arrastando[k] < 800) continue;
      el.querySelector('input').value = num(k); mostrarCtl(el);
    }
    for (const el of $$('#canal .ctl-num')) { const r = el.querySelector('input'); if (document.activeElement !== r) r.value = br(num(el.dataset.k) * 1000, 1).replace(',0', ''); }
    for (const el of $$('#canal .selk')) { const s = el.querySelector('select'), k = el.dataset.k; if (document.activeElement !== s && !(C.arrastando[k] && agora - C.arrastando[k] < 800)) s.value = String(parseInt(v(k) || '0', 10)); el.classList.toggle('desl', v(k.replace(/\.(amp|cab)$/, '.enabled')) === '0'); }
    for (const el of $$('#canal .chv')) { const on = v(el.dataset.k) === '1'; el.querySelector('input').checked = el.dataset.inv ? !on : on; }
    $$('#canal .env-mudo').forEach(b => b.classList.toggle('on', v(b.dataset.km) === '1'));
    $$('#canal .env-post').forEach(s => s.textContent = v(s.dataset.kp) === '1' ? 'pós' : 'pré');
    $('#cnMudo').classList.toggle('on', v(pre() + 'mute') === '1');
    const nome = $('#cnNome'); if (document.activeElement !== nome) nome.value = v(pre() + 'name') || '';
    const cor = +(v(pre() + 'color') || 0);
    $$('#canal .cor').forEach(b => { const s = +b.dataset.cor === cor; b.classList.toggle('sel', s); b.setAttribute('aria-checked', s); });
    const ce = $('#cnNome'); if (ce) ce.style.borderBottom = cor ? `3px solid ${X().CORES[cor]}` : '';
    const ss = $('#cnSub'); if (ss && document.activeElement !== ss) ss.value = v(pre() + 'subgroup') ?? '-1';
    const sv = $('#cnVca'); if (sv && document.activeElement !== sv) sv.value = v(pre() + 'vca') ?? '-1';
    const mm = parseInt(v(pre() + 'mgmask') || '0', 10) || 0; $$('#canal [data-mgbit]').forEach(c => c.checked = !!(mm & (1 << +c.dataset.mgbit)));
    curva(); geq(); dinGraf(); mostrarBotoesPreset();
  }

  // ---------- gráfico do EQ: soma das bandas (pico RBJ) + passa-altas/baixas de 2ª ordem; curva aproximada ----------
  function respostaPico(f, f0, db, q) {
    const A = Math.pow(10, db / 40), w0 = 2 * Math.PI * f0 / 48000, al = Math.sin(w0) / (2 * q), cs = Math.cos(w0);
    const b0 = 1 + al * A, b1 = -2 * cs, b2 = 1 - al * A, a0 = 1 + al / A, a1 = -2 * cs, a2 = 1 - al / A;
    return mag(f, b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0);
  }
  function respostaFiltro(f, f0, altas) {
    const w0 = 2 * Math.PI * f0 / 48000, al = Math.sin(w0) / (2 * 0.707), cs = Math.cos(w0), a0 = 1 + al;
    return altas ? mag(f, (1 + cs) / 2 / a0, -(1 + cs) / a0, (1 + cs) / 2 / a0, -2 * cs / a0, (1 - al) / a0)
                 : mag(f, (1 - cs) / 2 / a0, (1 - cs) / a0, (1 - cs) / 2 / a0, -2 * cs / a0, (1 - al) / a0);
  }
  function mag(f, b0, b1, b2, a1, a2) {
    const w = 2 * Math.PI * f / 48000, c1 = Math.cos(w), s1 = Math.sin(w), c2 = Math.cos(2 * w), s2 = Math.sin(2 * w);
    const nr = b0 + b1 * c1 + b2 * c2, ni = -(b1 * s1 + b2 * s2), dr = 1 + a1 * c1 + a2 * c2, di = -(a1 * s1 + a2 * s2);
    return 10 * Math.log10((nr * nr + ni * ni) / (dr * dr + di * di));
  }
  function curva() {
    const cv = $('#cnCurva'); if (!cv) return;
    const w = cv.clientWidth; if (cv.width !== w) cv.width = w;
    const h = cv.height, g = cv.getContext('2d'), p = pre(), est = getComputedStyle(document.querySelector('.app'));
    const ligado = v(p + 'eq.bypass') !== '1';
    g.clearRect(0, 0, w, h);
    const x = f => Math.log(f / 20) / Math.log(1000) * w, y = db => h / 2 - db / 18 * (h / 2 - 8);
    g.strokeStyle = est.getPropertyValue('--bd'); g.lineWidth = 1; g.fillStyle = est.getPropertyValue('--su'); g.font = '10px Segoe UI';
    for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) { g.beginPath(); g.moveTo(x(f), 0); g.lineTo(x(f), h); g.stroke(); g.fillText(f >= 1000 ? f / 1000 + 'k' : f, x(f) + 2, h - 3); }
    for (const d of [-12, -6, 0, 6, 12]) { g.beginPath(); g.moveTo(0, y(d)); g.lineTo(w, y(d)); g.stroke(); g.fillText((d > 0 ? '+' : '') + d, 2, y(d) - 2); }
    if (C.rta) pintarRta(g, x, 4, h - 14, w);
    const bandas =[1, 2, 3, 4, 5].filter(b => v(`${p}eq.b${b}.freq`) !== undefined).map(b => ({ f: freq(num(`${p}eq.b${b}.freq`)), db: 30 * num(`${p}eq.b${b}.gain`) - 15, q: 0.05 * Math.pow(300, num(`${p}eq.b${b}.q`)), b }));
    const hpf = num(p + 'eq.hpf.freq'), lpfV = v(p + 'eq.lpf.freq'), lpf = lpfV === undefined ? 1 : +lpfV;
    g.beginPath(); g.lineWidth = 2.5; g.strokeStyle = ligado ? '#46c15a' : est.getPropertyValue('--su');
    for (let i = 0; i <= w; i += 2) {
      const f = 20 * Math.pow(1000, i / w);
      let db = 0;
      if (ligado) for (const b of bandas) if (Math.abs(b.db) > 0.05) db += respostaPico(f, b.f, b.db, b.q);
      if (hpf > 0) db += respostaFiltro(f, freq(hpf), true);
      if (lpf < 1) db += respostaFiltro(f, freq(lpf), false);
      const yy = y(Math.max(-18, Math.min(18, db)));
      i ? g.lineTo(i, yy) : g.moveTo(i, yy);
    }
    g.stroke();
    // (0.0.3) pontos que dá para arrastar: as 5 bandas (frequência × ganho; rodinha = largura) e os filtros (só frequência)
    C.pontos = [];
    const sel = C.ponto?.id;
    const ponto = (id, px, py, txt, cor, raio) => {
      C.pontos.push({ id, x: px, y: py });
      g.fillStyle = cor; g.beginPath(); g.arc(px, py, sel === id ? raio + 2.5 : raio, 0, 7); g.fill();
      if (sel === id) { g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.stroke(); }
      g.fillStyle = '#1b1503'; g.font = 'bold 10px Segoe UI'; g.textAlign = 'center'; g.fillText(txt, px, py + 3.5); g.textAlign = 'start';
    };
    const cy = db => y(Math.max(-18, Math.min(18, db)));
    if (hpf > 0) ponto('hpf', x(freq(hpf)), cy(-3), '◢', '#7fb0e8', 8);
    if (lpf < 1 && lpfV !== undefined) ponto('lpf', x(freq(lpf)), cy(-3), '◣', '#7fb0e8', 8);
    if (ligado) for (const b of bandas) ponto('b' + b.b, x(b.f), cy(b.db), b.b, '#d4a93a', 8);
    if (C.ponto) {   // balãozinho com os valores do ponto que está sendo arrastado
      const p = C.pontos.find(q => q.id === C.ponto.id); if (p) {
        const txt = C.ponto.id.startsWith('b') ? (() => { const b = bandas.find(q => 'b' + q.b === C.ponto.id); return `${txtHz(b.f)}  ${sinal(b.db)} dB  Q ${br(b.q, 2)}`; })()
          : txtHz(freq(C.ponto.id === 'hpf' ? hpf : lpf));
        g.font = '12px Segoe UI'; const tw = g.measureText(txt).width + 12, bx = Math.min(w - tw - 2, Math.max(2, p.x - tw / 2)), by = p.y > 40 ? p.y - 34 : p.y + 16;
        g.fillStyle = 'rgba(0,0,0,.75)'; g.fillRect(bx, by, tw, 20); g.fillStyle = '#fff'; g.fillText(txt, bx + 6, by + 14);
      }
    }
  }

  // ---------- (0.0.14) gráficos do gate, do compressor e do de-esser (pedido do usuário, 23/11/2026) ----------
  // Gate e compressor: curva de transferência (som que entra → som que sai), com o ponto do som de agora.
  // De-esser: onde ele age na frequência (forma aproximada: a mesa não manda quanto ele está cortando), com o RTA por trás.
  // Os pontos L/P/R se arrastam como no EQ (zona morta de 4 px; Shift = fino); os botões giratórios continuam iguais.
  const DIN = {
    gate: { min: -80, max: 0 },
    comp: { min: -60, max: 0 },
  };
  function dinGraf() {
    if ($('#canal').hidden) return;
    const est = getComputedStyle(document.querySelector('.app'));
    const cor = { bd: est.getPropertyValue('--bd'), su: est.getPropertyValue('--su') };
    desenharGate($('#cnGateG'), cor); desenharComp($('#cnCompG'), cor); desenharDs($('#cnDsG'), cor);
  }
  function prepCanvas(cv) {
    if (!cv) return null;
    const w = cv.clientWidth; if (!w) return null; if (cv.width !== w) cv.width = w;
    const g = cv.getContext('2d'); g.clearRect(0, 0, w, cv.height);
    return { g, w, h: cv.height };
  }
  // eixos em dB (entra × sai), quadrado centralizado; devolve as funções de posição
  function eixosDb(g, w, h, min, max, cor) {
    const L = 22, T = 6, lado = Math.min(w - L - 6, h - T - 16), x = d => L + (d - min) / (max - min) * lado, y = d => T + (max - d) / (max - min) * lado;
    g.strokeStyle = cor.bd; g.fillStyle = cor.su; g.font = '9.5px Segoe UI'; g.lineWidth = 1;
    const passo = max - min > 60 ? 20 : 12;
    for (let d = max; d >= min; d -= passo) {
      g.beginPath(); g.moveTo(x(d), y(max)); g.lineTo(x(d), y(min)); g.stroke();
      g.beginPath(); g.moveTo(x(min), y(d)); g.lineTo(x(max), y(d)); g.stroke();
      g.textAlign = 'right'; g.fillText(d, L - 3, y(d) + 3); g.textAlign = 'center'; g.fillText(d, x(d), y(min) + 11);
    }
    g.textAlign = 'start';
    g.setLineDash([3, 3]); g.beginPath(); g.moveTo(x(min), y(min)); g.lineTo(x(max), y(max)); g.stroke(); g.setLineDash([]);   // 1:1
    return { x, y, lado, L, T, xDb: px => min + (px - L) / lado * (max - min), yDb: py => max - (py - T) / lado * (max - min) };
  }
  function pontoDin(g, lista, id, px, py, txt, corP) {
    const sel = C.dPonto?.id === id;
    lista.push({ id, x: px, y: py });
    g.fillStyle = corP; g.beginPath(); g.arc(px, py, sel ? 8.5 : 7, 0, 7); g.fill();
    if (sel) { g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.stroke(); }
    g.fillStyle = '#10140c'; g.font = 'bold 9.5px Segoe UI'; g.textAlign = 'center'; g.fillText(txt, px, py + 3.5); g.textAlign = 'start';
  }
  function balaoDin(g, w, px, py, txt) {
    g.font = '11.5px Segoe UI'; const tw = g.measureText(txt).width + 10, bx = Math.min(w - tw - 2, Math.max(2, px - tw / 2)), by = py > 34 ? py - 30 : py + 14;
    g.fillStyle = 'rgba(0,0,0,.78)'; g.fillRect(bx, by, tw, 18); g.fillStyle = '#fff'; g.fillText(txt, bx + 5, by + 13);
  }
  const vivoOk = () => C.vivo && performance.now() - C.vivo.t < 1500 && C.vivo.nivel > -100;

  function desenharGate(cv, cor) {
    const c = prepCanvas(cv); if (!c) return; const { g, w, h } = c, p = pre();
    const { min, max } = DIN.gate, E = eixosDb(g, w, h, min, max, cor);
    const on = v(p + 'gate.enabled') === '1', thr = -90 + 96 * num(p + 'gate.thresh'), dep = 60 * num(p + 'gate.depth') - 60;
    const cl = d => Math.max(min, Math.min(max, d)), sai = d => on && d < thr ? d + dep : d;
    g.save(); g.beginPath(); g.rect(E.L, E.T, E.lado, E.lado); g.clip();
    g.beginPath(); g.lineWidth = 2.5; g.strokeStyle = on ? '#46c15a' : cor.su;
    for (let d = min; d <= max; d += 0.5) { const yy = E.y(cl(sai(d))); d === min ? g.moveTo(E.x(d), yy) : g.lineTo(E.x(d), yy); }
    g.stroke();
    if (on && thr > min && thr < max) { g.strokeStyle = 'rgba(70,193,90,.5)'; g.setLineDash([2, 3]); g.beginPath(); g.moveTo(E.x(thr), E.y(max)); g.lineTo(E.x(thr), E.y(min)); g.stroke(); g.setLineDash([]); }
    if (on && vivoOk()) {   // som de agora: verde passando, vermelho cortado
      const n = cl(C.vivo.nivel), fe = C.vivo.fechado;
      g.fillStyle = fe ? '#e0463c' : '#7dff9a'; g.beginPath(); g.arc(E.x(n), E.y(cl(fe ? n + dep : n)), 4.5, 0, 7); g.fill();
    }
    g.restore();
    C.dPontos = C.dPontos || {}; const lista = C.dPontos.cnGateG = [];
    if (on) {
      pontoDin(g, lista, 'gThr', E.x(cl(thr)), E.y(cl(thr)), 'L', '#46c15a');
      pontoDin(g, lista, 'gDep', E.x(cl(thr)), E.y(cl(thr + dep)), 'P', '#9be3a9');
      if (C.dPonto?.cv === 'cnGateG') { const q = lista.find(z => z.id === C.dPonto.id); if (q) balaoDin(g, w, q.x, q.y, C.dPonto.id === 'gThr' ? `limiar ${br(thr)} dB` : `profundidade ${br(dep)} dB`); }
    } else { g.fillStyle = cor.su; g.font = '11px Segoe UI'; g.fillText('desligado', E.L + 6, E.T + 14); }
  }

  // compressor: curva estática com joelho suave (~10 dB) e o ganho de saída
  function curvaComp(d, thr, r, joelho, og) {
    const k = joelho ? 10 : 0, inc = 1 - 1 / r;
    if (k && Math.abs(d - thr) <= k / 2) return d - inc * Math.pow(d - thr + k / 2, 2) / (2 * k) + og;
    return (d > thr ? thr + (d - thr) / r : d) + og;
  }
  function desenharComp(cv, cor) {
    const c = prepCanvas(cv); if (!c) return; const { g, w, h } = c, p = pre();
    const { min, max } = DIN.comp, E = eixosDb(g, w, h, min, max, cor);
    const on = v(p + 'dyn.bypass') !== '1', thr = -90 + 96 * num(p + 'dyn.threshold'), r = Math.min(100, 1 / Math.max(num(p + 'dyn.ratio'), 1e-5));
    const og = 72 * num(p + 'dyn.outgain') - 24, joelho = v(p + 'dyn.softknee') === '1';
    const cl = d => Math.max(min, Math.min(max, d)), sai = d => on ? curvaComp(d, thr, r, joelho, og) : d;
    g.save(); g.beginPath(); g.rect(E.L, E.T, E.lado, E.lado); g.clip();
    // área do corte (entre a 1:1 com o ganho de saída e a curva), acima do limiar
    if (on && r > 1.01) {
      g.beginPath(); g.moveTo(E.x(Math.max(min, thr)), E.y(cl(sai(Math.max(min, thr)))));
      for (let d = Math.max(min, thr); d <= max; d += 0.5) g.lineTo(E.x(d), E.y(cl(d + og)));
      for (let d = max; d >= Math.max(min, thr); d -= 0.5) g.lineTo(E.x(d), E.y(cl(sai(d))));
      g.closePath(); g.fillStyle = 'rgba(224,70,60,.16)'; g.fill();
    }
    g.beginPath(); g.lineWidth = 2.5; g.strokeStyle = on ? '#e0463c' : cor.su;
    for (let d = min; d <= max; d += 0.5) { const yy = E.y(cl(sai(d))); d === min ? g.moveTo(E.x(d), yy) : g.lineTo(E.x(d), yy); }
    g.stroke();
    if (on && vivoOk()) {   // som de agora: o que entra, e o que sai com a redução que a mesa diz
      const n = cl(C.vivo.nivel), s = cl(n - (C.vivo.gr || 0) + og);
      g.fillStyle = '#ffd36b'; g.beginPath(); g.arc(E.x(n), E.y(s), 4.5, 0, 7); g.fill();
    }
    g.restore();
    C.dPontos = C.dPontos || {}; const lista = C.dPontos.cnCompG = [];
    if (on) {
      pontoDin(g, lista, 'cThr', E.x(cl(thr)), E.y(cl(sai(thr))), 'L', '#e0463c');
      pontoDin(g, lista, 'cRaz', E.x(max) - 2, E.y(cl(sai(max))), 'R', '#f08c84');
      if (C.dPonto?.cv === 'cnCompG') { const q = lista.find(z => z.id === C.dPonto.id); if (q) balaoDin(g, w, q.x, q.y, C.dPonto.id === 'cThr' ? `limiar ${br(thr)} dB` : `razão ${U.razao.txt(num(p + 'dyn.ratio'))}`); }
    } else { g.fillStyle = cor.su; g.font = '11px Segoe UI'; g.fillText('desligado', E.L + 6, E.T + 14); }
  }

  // de-esser: 1 kHz a 20 kHz; a "cova" mostra onde ele age (mais funda com razão maior); linha do limiar
  const dsF = a => 2000 * Math.pow(7.5, a), dsA = f => Math.min(1, Math.max(0, Math.log(f / 2000) / Math.log(7.5)));
  function desenharDs(cv, cor) {
    const c = prepCanvas(cv); if (!c) return; const { g, w, h } = c, p = pre();
    const on = v(p + 'deesser.enabled') === '1', f0 = dsF(num(p + 'deesser.freq')), lim = num(p + 'deesser.threshold'), r = Math.min(20, 1 / Math.max(num(p + 'deesser.ratio'), 1e-5));
    const B = h - 14, T = 6, x = f => Math.log(f / 1000) / Math.log(20) * w, y = db => T + (-db) / 12 * (B - T);
    g.strokeStyle = cor.bd; g.fillStyle = cor.su; g.font = '9.5px Segoe UI'; g.lineWidth = 1;
    for (const f of [2000, 5000, 10000]) { g.beginPath(); g.moveTo(x(f), T); g.lineTo(x(f), B); g.stroke(); g.fillText(f / 1000 + 'k', x(f) + 2, h - 3); }
    for (const d of [0, -6, -12]) { g.beginPath(); g.moveTo(0, y(d)); g.lineTo(w, y(d)); g.stroke(); g.fillText(d, 2, y(d) + (d ? -2 : 10)); }
    if (C.rta) pintarRta(g, x, T, B, w);   // o mesmo RTA que já chega para o EQ: nada a mais pedido à mesa
    const fundo = on ? -Math.min(12, 12 * (1 - 1 / r)) : 0;
    g.beginPath(); g.lineWidth = 2.5; g.strokeStyle = on ? '#d9a7ff' : cor.su;
    for (let i = 0; i <= w; i += 2) {
      const f = 1000 * Math.pow(20, i / w), o = Math.log2(f / f0), db = fundo * Math.exp(-(o * o) / (2 * 0.45 * 0.45));
      i ? g.lineTo(i, y(db)) : g.moveTo(i, y(db));
    }
    g.stroke();
    C.dPontos = C.dPontos || {}; const lista = C.dPontos.cnDsG = [];
    if (on) {
      const yl = T + (1 - lim) * (B - T);   // limiar: em cima = alto (age menos), embaixo = baixo (age mais)
      g.strokeStyle = 'rgba(217,167,255,.55)'; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(0, yl); g.lineTo(w, yl); g.stroke(); g.setLineDash([]);
      pontoDin(g, lista, 'dPt', x(f0), yl, 'S', '#d9a7ff');
      if (C.dPonto?.cv === 'cnDsG') balaoDin(g, w, x(f0), yl, `${txtHz(f0)} · limiar ${Math.round(100 * lim)}%`);
    } else { g.fillStyle = cor.su; g.font = '11px Segoe UI'; g.fillText('desligado', 6, T + 14); }
  }

  function ligarDin(cv) {
    const id = cv.id, p = pre();
    const pos = e => { const r = cv.getBoundingClientRect(); return { px: (e.clientX - r.left) * cv.width / r.width, py: (e.clientY - r.top) * cv.height / r.height }; };
    const perto = (px, py) => { let m = null, d0 = 16 * 16; for (const q of C.dPontos?.[id] || []) { const d = (q.x - px) ** 2 + (q.y - py) ** 2; if (d < d0) { d0 = d; m = q; } } return m; };
    const mexer = (k, a) => { a = Math.min(1, Math.max(0, a)); C.arrastando[k] = Date.now(); def(k, a.toFixed(4)); const el = $$('#canal .ctl').find(c => c.dataset.k === k); if (el) { el.querySelector('input').value = a; mostrarCtl(el); } };
    let x0 = 0, y0 = 0, a0 = {}, andou = false;
    cv.addEventListener('pointerdown', e => {
      const { px, py } = pos(e), q = perto(px, py); if (!q) { if (C.dPonto?.cv === id) { C.dPonto = null; dinGraf(); } return; }
      cv.setPointerCapture(e.pointerId); C.dPonto = { id: q.id, cv: id }; x0 = e.clientX; y0 = e.clientY; andou = false;
      a0 = { thr: num(p + 'gate.thresh'), dep: num(p + 'gate.depth'), cthr: num(p + 'dyn.threshold'), raz: num(p + 'dyn.ratio'), dsf: num(p + 'deesser.freq'), dsl: num(p + 'deesser.threshold') };
      dinGraf();
    });
    cv.addEventListener('pointermove', e => {
      const { px, py } = pos(e);
      if (!C.dPonto || C.dPonto.cv !== id || !cv.hasPointerCapture(e.pointerId)) { cv.style.cursor = perto(px, py) ? 'grab' : 'default'; return; }
      const dx = e.clientX - x0, dy = e.clientY - y0;
      if (!andou) { if (Math.abs(dx) + Math.abs(dy) < 4) return; andou = true; }   // zona morta: clicar só escolhe
      const fino = e.shiftKey ? 0.25 : 1, larg = cv.clientWidth, alt = cv.clientHeight;
      switch (C.dPonto.id) {
        case 'gThr': mexer(p + 'gate.thresh', a0.thr + dx / larg * (80 / 96) * fino); break;           // 80 dB na largura; a escala da mesa tem 96
        case 'gDep': mexer(p + 'gate.depth', a0.dep - dy / alt * (80 / 60) * fino); break;            // para cima = menos corte
        case 'cThr': mexer(p + 'dyn.threshold', a0.cthr + dx / larg * (60 / 96) * fino); break;
        case 'cRaz': {   // para baixo = mais compressão: a razão anda em escala log (1:1 a ∞)
          const r0 = 1 / Math.max(a0.raz, 1e-5), r = Math.min(100, Math.max(1, r0 * Math.pow(2, dy / 40 * fino)));
          mexer(p + 'dyn.ratio', 1 / r); break;
        }
        case 'dPt': mexer(p + 'deesser.freq', dsA(dsF(a0.dsf) * Math.pow(20, dx / larg * fino))); if (!e.shiftKey) mexer(p + 'deesser.threshold', a0.dsl - dy / alt); break;
      }
      dinGraf();
    });
    const soltar = () => { andou = false; };
    cv.addEventListener('pointerup', soltar); cv.addEventListener('pointercancel', soltar);
  }

  // ---------- arrastar no gráfico ----------
  function ligarCurva(cv) {
    const geo = () => { const r = cv.getBoundingClientRect(); return { r, w: cv.width, h: cv.height }; };
    const paraA_f = (px, w) => { const f = 20 * Math.pow(1000, Math.min(1, Math.max(0, px / w))); return Math.min(1, Math.max(0, Math.log(f / 20) / Math.log(1102.5))); };
    const paraA_db = (py, h) => { const db = (h / 2 - py) / (h / 2 - 8) * 18; return Math.min(1, Math.max(0, (Math.max(-15, Math.min(15, db)) + 15) / 30)); };
    const perto = (px, py) => { let m = null, d0 = 18 * 18; for (const p of C.pontos || []) { const d = (p.x - px) ** 2 + (p.y - py) ** 2; if (d < d0) { d0 = d; m = p; } } return m; };
    const pos = e => { const { r, w, h } = geo(); return { px: (e.clientX - r.left) * w / r.width, py: (e.clientY - r.top) * h / r.height, w, h }; };
    const p = pre();
    const mexer = (k, a) => { C.arrastando[k] = Date.now(); X().definirPar(k, a.toFixed(4)); const el = [...document.querySelectorAll('#canal .ctl')].find(c => c.dataset.k === k); if (el) { el.querySelector('input').value = a; mostrarCtl(el); } };
    let x0 = 0, y0 = 0, andou = false;
    cv.addEventListener('pointerdown', e => {
      const { px, py } = pos(e), q = perto(px, py); if (!q) { C.ponto = null; curva(); return; }
      cv.setPointerCapture(e.pointerId); C.ponto = { id: q.id, dx: q.x - px, dy: q.y - py }; x0 = e.clientX; y0 = e.clientY; andou = false; curva();
    });
    cv.addEventListener('pointermove', e => {
      const { px, py, w, h } = pos(e);
      if (!C.ponto || !cv.hasPointerCapture(e.pointerId)) { cv.style.cursor = perto(px, py) ? 'grab' : 'default'; return; }
      if (!andou) { if (Math.abs(e.clientX - x0) + Math.abs(e.clientY - y0) < 4) return; andou = true; }   // zona morta: clicar só escolhe o ponto
      const id = C.ponto.id, fx = px + C.ponto.dx, fy = py + C.ponto.dy;
      if (id === 'hpf' || id === 'lpf') mexer(`${p}eq.${id}.freq`, Math.min(id === 'hpf' ? 1 : 0.999, Math.max(id === 'hpf' ? 0.001 : 0, paraA_f(fx, w))));
      else { mexer(`${p}eq.${id}.freq`, paraA_f(fx, w)); if (!e.shiftKey) mexer(`${p}eq.${id}.gain`, paraA_db(fy, h)); }   // Shift = só a frequência
      curva();
    });
    const soltar = () => { andou = false; };
    cv.addEventListener('pointerup', soltar); cv.addEventListener('pointercancel', soltar);
    cv.addEventListener('wheel', e => {   // rodinha sobre uma banda = largura (Q)
      const { px, py } = pos(e), q = (C.ponto && C.pontos.find(z => z.id === C.ponto.id && (z.x - px) ** 2 + (z.y - py) ** 2 < 40 * 40)) || perto(px, py);
      if (!q || !q.id.startsWith('b')) return; e.preventDefault();
      const k = `${p}eq.${q.id}.q`; C.ponto = { id: q.id, dx: 0, dy: 0 };
      mexer(k, Math.min(1, Math.max(0, num(k) + (e.deltaY < 0 ? 0.02 : -0.02)))); curva();
    }, { passive: false });
    cv.addEventListener('dblclick', e => {   // duplo clique numa banda = volta a 0 dB
      const { px, py } = pos(e), q = perto(px, py); if (!q || !q.id.startsWith('b')) return;
      mexer(`${p}eq.${q.id}.gain`, 0.5); curva();
    });
  }

  function vu() {
    if (!C.t || $('#canal').hidden) return;
    if (MED.dlg?.open) medirAmostra();   // (0.0.11)
    const m = window.Mixer, vv = $$('#canal .cn-vu .vu i');
    const pos = m.vuDe(`${C.t}:${C.n}`), preV = C.t === 'm' ? pos : m.vuPre ? m.vuPre(`${C.t}:${C.n}`) : pos;
    const pct = db => db <= -60 ? 0 : Math.min(100, (db + 60) / 60 * 100);
    if (vv[0]) vv[0].style.height = (100 - pct(preV)) + '%';
    if (vv[1]) vv[1].style.height = (100 - pct(pos)) + '%';
    // (0.0.3) quanto o compressor está cortando e se o gate está fechado (6º byte do medidor, como o app da mesa)
    const b = m.din?.(`${C.t}:${C.n}`); if (b == null) return;
    let x = (b & 127) << 1; x |= (x >> 7) & 1;
    const gr = Math.max(0, (240 - x) / 3), agora = performance.now();
    const compOn = v(pre() + 'dyn.bypass') !== '1', gateOn = v(pre() + 'gate.enabled') === '1', fechado = gateOn && (b & 128) === 0;   // (0.0.14) bit 7 = 1 é gate ABERTO (conferido com som: limiar no mínimo = 1; silêncio abaixo do limiar = 0)
    if (!C.grPico || gr > C.grPico.db || agora - C.grPico.t > 1500) C.grPico = { db: gr, t: agora };
    const el = $('#cnGr'); if (el) {
      const w = db => Math.min(100, db / 20 * 100);   // escala de 0 a 20 dB de redução
      el.querySelector('i').style.width = (compOn ? w(gr) : 0) + '%';
      el.querySelector('b').style.left = (compOn ? w(C.grPico.db) : 0) + '%';
      el.querySelector('b').hidden = !compOn || C.grPico.db < 0.5;
      $('#cnGrTxt').textContent = !compOn ? 'desligado' : gr < 0.5 ? 'sem redução' : `−${br(gr)} dB`;
    }
    const g = $('#cnGate'); if (g) {
      g.className = 'cn-gate ' + (!gateOn ? 'off' : fechado ? 'fechado' : 'aberto');
      g.lastChild.textContent = !gateOn ? 'desligado' : fechado ? 'fechado (cortando)' : 'aberto (passando som)';
    }
    // (0.0.14) o ponto "som de agora" nos gráficos do gate e do compressor
    C.vivo = { nivel: C.t === 'i' && srcHw() != null ? m.vuBruto(srcHw()) : preV, gr, fechado, t: agora };
    if (!C.dPintando) { C.dPintando = true; requestAnimationFrame(() => { C.dPintando = false; dinGraf(); }); }
  }

  // ---------- (0.0.3) presets de canal: guardados no programa, no mesmo formato da mesa ----------
  // (0.0.7) tipos novos: canal inteiro (ch), aux (eqaux/dynaux), master (eqm/dynm/chm) — as mesmas chaves do savePreset do app da mesa.
  // "salvar" = lista tirada do estado (o app da mesa pega todas as chaves eq./dyn./gate. menos enabled/bypass/prmod/prname)
  const rng = n => [...Array(n).keys()];
  const DYN6 = '.dyn.threshold .dyn.ratio .dyn.softknee .dyn.attack .dyn.outgain .dyn.release'.split(' ');
  const FORA = /\.(enabled|bypass|prmod|prname)$/;
  const doEstado = (prefixo, re) => Object.keys(X().estado).filter(k => k.startsWith(prefixo) && re.test(k.slice(prefixo.length)) && !FORA.test(k)).map(k => '.' + k.slice(prefixo.length));
  const PRESET = {
    ch: { rot: 'canal inteiro (EQ, gate e compressor)', pr: ['eq', 'dyn', 'gate'], ok: /^\.(eq|dyn|gate)\./, salvar: () => doEstado(pre(), /^(eq|dyn|gate)\./) },
    eqch: { rot: 'EQ e de-esser', pr: ['eq'], chaves: '.eq.easy .eq.hpf.freq .eq.hpf.slope .eq.lpf.freq .eq.lpf.slope .eq.b1.freq .eq.b1.q .eq.b1.gain .eq.b2.freq .eq.b2.q .eq.b2.gain .eq.b3.freq .eq.b3.q .eq.b3.gain .eq.b4.freq .eq.b4.q .eq.b4.gain .deesser.enabled .deesser.freq .deesser.threshold .deesser.ratio'.split(' ') },
    dynch: { rot: 'compressor', pr: ['dyn'], chaves: DYN6 },
    gate: { rot: 'gate', pr: ['gate'], chaves: '.gate.thresh .gate.attack .gate.release .gate.hold .gate.depth'.split(' ') },
    eqaux: { rot: 'EQ gráfico', pr: ['eq'], chaves: [...rng(31).map(i => `.eq.peak.${i}`), '.eq.lpf', '.eq.hpf'] },
    dynaux: { rot: 'compressor', pr: ['dyn'], chaves: DYN6 },
    eqm: { rot: 'EQ gráfico do master', pr: ['eq'], chaves: ['.eq.linked', ...rng(31).flatMap(i => [`.eq.peak.l.${i}`, `.eq.peak.r.${i}`]), '.eq.lpf.l', '.eq.lpf.r', '.eq.hpf.l', '.eq.hpf.r'] },
    dynm: { rot: 'compressor do master', pr: ['dyn'], chaves: ['.dyn.linked', ...['l', 'r'].flatMap(s => 'threshold ratio softknee attack release outgain'.split(' ').map(c => `.dyn.${s}.${c}`))] },
    chm: { rot: 'master inteiro (EQ, compressor e AFS)', pr: ['eq', 'dyn'], ok: /^\.(eq|dyn|afs|[lr]\.invert)\b/,
      salvar: () => [...'.afs.fmode .afs.cmode .afs.numtotal .afs.numfixed .afs.logic .afs.livelift .afs.sensitivity .l.invert .r.invert'.split(' ').filter(s => v('m' + s) !== undefined), ...doEstado('m.', /^(eq|dyn)\./)] }
  };
  const chavesSalvar = tp => PRESET[tp].salvar ? PRESET[tp].salvar() : PRESET[tp].chaves;
  const chavesAplicar = (tp, valores) => (PRESET[tp].salvar ? Object.keys(valores).filter(s => PRESET[tp].ok.test(s) && !FORA.test(s)) : PRESET[tp].chaves);
  const FV = f => Math.log(f / 20) / Math.log(1102.5), QV = Math.log(20) / Math.log(300);
  const PLANO = {
    eqch: { '.eq.easy': 0, '.eq.hpf.freq': 0, '.eq.hpf.slope': 0, '.eq.lpf.freq': 1, '.eq.lpf.slope': 0,
      '.eq.b1.freq': FV(200), '.eq.b1.q': QV, '.eq.b1.gain': .5, '.eq.b2.freq': FV(1000), '.eq.b2.q': QV, '.eq.b2.gain': .5,
      '.eq.b3.freq': FV(4000), '.eq.b3.q': QV, '.eq.b3.gain': .5, '.eq.b4.freq': FV(10000), '.eq.b4.q': QV, '.eq.b4.gain': .5,
      '.deesser.enabled': 0, '.deesser.freq': .773310034, '.deesser.threshold': .46875, '.deesser.ratio': .4 },
    eqaux: Object.fromEntries([...rng(31).map(i => [`.eq.peak.${i}`, .5]), ['.eq.hpf', 0], ['.eq.lpf', 1]]),   // = resetGraphEQ do app da mesa
    eqm: Object.fromEntries([...rng(31).flatMap(i => [[`.eq.peak.l.${i}`, .5], [`.eq.peak.r.${i}`, .5]]), ['.eq.hpf.l', 0], ['.eq.hpf.r', 0], ['.eq.lpf.l', 1], ['.eq.lpf.r', 1]])
  };
  const P = { tp: null, lista: [], mesa: null, desfazer: null };
  const botaoPreset = tp => `<button class="peq cn-preset" data-tp="${tp}" title="Presets de ${PRESET[tp].rot}">★ <span></span></button>`;
  const nomeCanal = () => ($('#cnNome')?.value || '').trim() || $('.cn-titulo .dica')?.textContent.split(' · ')[0] || 'canal';
  const valoresAtuais = tp => { const val = {}; for (const s of chavesSalvar(tp)) { const x = v(pre() + s.slice(1)); if (x !== undefined && isFinite(+x)) val[s] = +x; } return val; };
  const marcarPreset = (tp, nome) => { for (const pr of PRESET[tp].pr) { def(`${pre()}${pr}.prname`, nome); def(`${pre()}${pr}.prmod`, '0'); } };   // como o app da mesa

  function mostrarBotoesPreset() {
    for (const b of $$('#canal .cn-preset')) {
      const tp = b.dataset.tp, pr = PRESET[tp].pr[0], nome = v(`${pre()}${pr}.prname`) || '', mod = v(`${pre()}${pr}.prmod`) === '1';
      b.querySelector('span').textContent = tp === 'ch' || tp === 'chm' ? (tp === 'ch' ? 'Canal' : 'Master') : nome ? nome + (mod ? ' *' : '') : 'Preset';
      b.title = tp === 'ch' || tp === 'chm' ? `Presets de ${PRESET[tp].rot}` : nome ? `Preset "${nome}"${mod ? ' (mexido depois de carregar)' : ''} — clique para trocar ou guardar` : `Presets de ${PRESET[tp].rot}`;
    }
    const d = $('#cnDesfazer'); if (d) d.hidden = !P.desfazer || P.desfazer.canal !== pre();
  }

  function abrirPresets(tp) {
    P.tp = tp; P.lista = null; P.mesa = null;
    let dlg = $('#cnDlgPreset');
    if (!dlg) { dlg = document.createElement('dialog'); dlg.id = 'cnDlgPreset'; dlg.className = 'pn cn-dlg'; document.querySelector('.app').appendChild(dlg); }
    desenharPresets(); dlg.showModal();
    mandar({ tipo: 'presets', tp }); mandar({ tipo: 'presetsMesa', tp });
  }
  function desenharPresets() {
    const dlg = $('#cnDlgPreset'); if (!dlg) return;
    const tp = P.tp, info = PRESET[tp], atual = v(`${pre()}${info.pr[0]}.prname`) || '';
    dlg.innerHTML = `<h3 class="rot">Presets de ${esc(info.rot)} · ${esc(nomeCanal())}<button class="peq" id="pdFechar">Fechar</button></h3>
      <p class="dica">Aplicar muda o som na hora; dá para desfazer logo em seguida.</p>
      <h4 class="pd-sub">No programa</h4>
      <div class="pd-lista">${P.lista == null ? '<p class="dica">Lendo…</p>' : P.lista.length === 0 ? '<p class="dica">Nenhum preset deste tipo no programa ainda.</p>'
        : P.lista.map((p, i) => `<div class="pd-item ${p.nome === atual ? 'atual' : ''}"><span class="pd-nome">${esc(p.nome)}</span><span class="dica">${esc(p.quando)}</span>
            <button class="peq prim" data-ap="${i}">Aplicar</button><button class="peq" data-pm="${i}" title="Grava uma cópia na memória da mesa (aparece no app da mesa)">⇧ Mesa</button><button class="peq" data-del="${i}" title="Apagar do programa (vai para o histórico)">🗑</button></div>`).join('')}</div>
      <div class="pd-guardar"><input id="pdNome" maxlength="40" placeholder="Nome do preset (ex.: Voz do padre)" value="${esc(tp === 'ch' || tp === 'chm' ? '' : atual)}"><button class="peq" id="pdGuardar">Guardar o atual no programa</button></div>
      <h4 class="pd-sub">Na mesa <span class="dica">(os do app da mesa e os de fábrica)</span></h4>
      <div class="pd-lista">${P.mesa == null ? '<p class="dica">Lendo…</p>' : P.mesa.length === 0 ? '<p class="dica">Nenhum preset deste tipo na mesa.</p>'
        : P.mesa.map((n, i) => `<div class="pd-item"><span class="pd-nome">${esc(n.slice(2))}${n.startsWith('f:') ? ' <span class="dica">· de fábrica</span>' : ''}</span>
            <button class="peq prim" data-map="${i}">Aplicar</button><button class="peq" data-mtr="${i}" title="Guarda uma cópia no programa">⇩ Programa</button></div>`).join('')}</div>
      ${PLANO[tp] ? '<button class="peq" id="pdPlano" title="Volta o EQ ao padrão da mesa">EQ plano (padrão da mesa)</button>' : ''}`;
    $('#pdFechar').onclick = () => dlg.close();
    $$('#cnDlgPreset [data-ap]').forEach(b => b.onclick = () => { const p = P.lista[+b.dataset.ap]; aplicar(tp, p.nome, p.v); });
    $$('#cnDlgPreset [data-del]').forEach(b => b.onclick = () => { const p = P.lista[+b.dataset.del]; if (confirm(`Apagar o preset "${p.nome}" do programa?\n\n(Uma cópia fica no histórico da biblioteca. Não mexe na mesa.)`)) mandar({ tipo: 'apagarPreset', tp, nome: p.nome }); });
    $$('#cnDlgPreset [data-pm]').forEach(b => b.onclick = () => {
      const p = P.lista[+b.dataset.pm], existe = (P.mesa || []).includes('u:' + p.nome);
      if (!confirm(`Gravar o preset "${p.nome}" na memória da mesa?${existe ? '\n\nJá existe um preset com esse nome na mesa: ele será TROCADO.' : ''}\n\nNão muda o som agora; o preset fica disponível também no app da mesa.`)) return;
      const val = {}; for (const s in p.v) if (isFinite(+p.v[s])) val[s] = +p.v[s];
      mandar({ tipo: 'gravarPresetMesa', tp, nome: p.nome, v: val });
    });
    $$('#cnDlgPreset [data-map]').forEach(b => b.onclick = () => mandar({ tipo: 'lerPresetMesa', tp, nome: P.mesa[+b.dataset.map], para: 'aplicar' }));
    $$('#cnDlgPreset [data-mtr]').forEach(b => b.onclick = () => mandar({ tipo: 'lerPresetMesa', tp, nome: P.mesa[+b.dataset.mtr], para: 'trazer' }));
    const pl = $('#pdPlano'); if (pl) pl.onclick = () => aplicar(tp, '', PLANO[tp]);
    $('#pdGuardar').onclick = () => {
      const nome = $('#pdNome').value.trim(); if (!nome) { $('#pdNome').focus(); return; }
      if (P.lista?.some(p => p.nome === nome) && !confirm(`Já existe "${nome}". Trocar pelo ajuste atual de ${nomeCanal()}?\n\n(A versão anterior vai para o histórico.)`)) return;
      mandar({ tipo: 'guardarPreset', tp, nome, v: valoresAtuais(tp) });
      marcarPreset(tp, nome);
    };
  }

  function aplicar(tp, nome, valores) {
    const info = PRESET[tp], p = pre();
    const mudar = chavesAplicar(tp, valores).filter(s => valores[s] !== undefined && isFinite(+valores[s]) && v(p + s.slice(1)) !== undefined);
    if (!mudar.length) { alert('Este preset não tem nada que sirva para este canal.'); return; }
    // (0.0.14) sem "tem certeza?" (pedido do usuário: atrapalha, ainda mais em tela de toque): aplica e oferece ↶ Desfazer
    const antes = {}; for (const s of mudar) antes[s] = v(p + s.slice(1));
    for (const pr of info.pr) { antes[`.${pr}.prname`] = v(`${p}${pr}.prname`) || ''; antes[`.${pr}.prmod`] = v(`${p}${pr}.prmod`) || '0'; }
    P.desfazer = { canal: p, tp, antes, nome };
    for (const s of mudar) X().definirPar(p + s.slice(1), String(+(+valores[s]).toFixed(10)));   // o preset já traz L e R: sem "juntos"
    marcarPreset(tp, nome);
    $('#cnDlgPreset')?.close();
    if (tp === 'chm' || tp === 'eqm' || tp === 'dynm') montar(); else atualizar();
    mostrarBotoesPreset();
    window.toast?.(`${nomeCanal()}: ${nome ? `preset "${nome}"` : 'EQ no padrão'} (${info.rot}). ↶ Desfazer preset volta como estava.`);
  }
  function desfazer() {
    const d = P.desfazer; if (!d || d.canal !== pre()) return;
    for (const s in d.antes) X().definirPar(d.canal + s.slice(1), d.antes[s]);
    P.desfazer = null; if (C.t === 'm') montar(); else atualizar(); mostrarBotoesPreset();
  }
  function presets(m) { if (m.tp !== P.tp) return; P.lista = m.lista || []; desenharPresets(); }
  function presetsMesa(m) { if (m.tp !== P.tp) return; P.mesa = m.lista || []; desenharPresets(); }
  function presetMesa(m) {
    if (m.tp !== P.tp || !$('#cnDlgPreset')?.open) return;
    const nome = String(m.nome || '').slice(2);
    if (m.para === 'aplicar') aplicar(m.tp, nome, m.v || {});
    else if (m.para === 'trazer') {
      if (!Object.keys(m.v || {}).length) { alert('O preset da mesa veio vazio.'); return; }
      if (P.lista?.some(p => p.nome === nome) && !confirm(`Já existe "${nome}" no programa. Trocar pelo da mesa?\n\n(A versão anterior vai para o histórico.)`)) return;
      mandar({ tipo: 'guardarPreset', tp: m.tp, nome, v: m.v });
    }
  }
  // ---------- (0.0.11) MEDIR O GANHO: o músico toca/fala ~10 s; o programa olha o nível depois do pré-amp (antes do
  // EQ e do fader) e sugere quanto mexer no ganho para os picos ficarem perto de −10 dBFS (faixa boa: −16 a −6).
  // Só muda a mesa no clique "Aplicar", com confirmação; "Desfazer" volta o ganho de antes.
  const MED = { dlg: null, amostras: [], ini: 0, rodando: false, pico: -128, res: null, desfazer: null };
  const ALVO_PICO = -10, FAIXA = [-16, -6], DURACAO = 10000;
  const ui24 = () => X().modelo !== 'ui12' && X().modelo !== 'ui16';
  const ganhoDb = a => ui24() ? GANHO24[Math.min(63, Math.max(0, a * 64 | 0))] - 1 : 90 * a - 40;
  function ganhoParaA(db) {   // o passo mais perto da tabela da mesa
    if (!ui24()) return Math.min(1, Math.max(0, (db + 40) / 90));
    let melhor = 0; for (let i = 0; i < 64; i++) if (Math.abs(GANHO24[i] - 1 - db) < Math.abs(GANHO24[melhor] - 1 - db)) melhor = i;
    return (melhor + 0.5) / 64;
  }
  function abrirMedir() {
    const hw = srcHw(); if (hw == null) return;
    if (!MED.dlg) { MED.dlg = document.createElement('dialog'); MED.dlg.className = 'pn cn-dlg'; document.querySelector('.app').appendChild(MED.dlg); }
    MED.hw = hw; MED.canal = pre(); MED.amostras = []; MED.rodando = false; MED.res = null; MED.pico = -128;
    desenharMedir(); MED.dlg.showModal();
  }
  function desenharMedir() {
    const d = MED.dlg, ga = num(`hw.${MED.hw}.gain`), r = MED.res;
    d.innerHTML = `<h3 class="rot">Medir o ganho · ${esc(nomeCanal())}<button class="peq" id="mdFechar">Fechar</button></h3>
      <p class="dica" style="max-width:520px">Peça para tocar ou falar <b>como na celebração</b> (na parte mais forte). O programa olha o som que chega da entrada física ${MED.hw + 1}, depois do pré-amp e antes do EQ e do fader. Ganho agora: <b>${sinal(ganhoDb(ga), 0)} dB</b>.</p>
      <div class="md-medidor"><div class="md-faixa" style="left:${(FAIXA[0] + 60) / 60 * 100}%;width:${(FAIXA[1] - FAIXA[0]) / 60 * 100}%"></div><i id="mdNivel"></i><b id="mdPico"></b></div>
      <div class="md-escala">${[-60, -40, -20, -10, 0].map(d => `<span style="left:${(d + 60) / 60 * 100}%">${d ? sinal(d, 0) : '0 dBFS'}</span>`).join('')}</div>
      <p id="mdTxt" class="md-txt">${MED.rodando ? 'Medindo…' : r ? '' : 'Quando estiverem tocando/falando, clique em Começar.'}</p>
      ${r ? `<div class="md-res ${r.cls}">${r.html}</div>` : ''}
      <div class="md-bts">
        <button class="${r ? '' : 'prim'}" id="mdComecar" ${MED.rodando ? 'disabled' : ''}>${r ? 'Medir de novo' : 'Começar (10 s)'}</button>
        ${r && r.novoA != null ? `<button class="prim" id="mdAplicar">Aplicar: ganho ${sinal(r.deDb, 0)} → ${sinal(r.paraDb, 0)} dB</button>` : ''}
        ${MED.desfazer && MED.desfazer.hw === MED.hw ? `<button id="mdDesfazer">↶ Voltar o ganho para ${sinal(ganhoDb(MED.desfazer.a), 0)} dB</button>` : ''}
      </div>
      <p class="dica" style="max-width:520px">O ganho do pré-amp muda o canal em <b>todas</b> as saídas (caixas, retornos e a live). Mexa nele de preferência antes da celebração.</p>`;
    $('#mdFechar').onclick = () => { MED.rodando = false; d.close(); };
    $('#mdComecar').onclick = () => { MED.amostras = []; MED.pico = -128; MED.res = null; MED.ini = Date.now(); MED.rodando = true; desenharMedir(); };
    const ap = $('#mdAplicar'); if (ap) ap.onclick = aplicarGanho;
    const de = $('#mdDesfazer'); if (de) de.onclick = () => { X().definir(`hw.${MED.desfazer.hw}.gain`, String(MED.desfazer.a)); MED.desfazer = null; MED.res = null; desenharMedir(); atualizar(); };
  }
  function medirAmostra() {
    const db = X().vuBruto(MED.hw), agora = Date.now();
    const w = db <= -60 ? 0 : Math.min(100, (db + 60) / 60 * 100);
    const ni = $('#mdNivel'); if (ni) { ni.style.width = w + '%'; ni.className = db > -3 ? 'pico' : db > FAIXA[1] ? 'alto' : ''; }
    if (!MED.rodando) return;
    MED.amostras.push(db); MED.pico = Math.max(MED.pico, db);
    const pk = $('#mdPico'); if (pk) pk.style.left = (MED.pico <= -60 ? 0 : Math.min(100, (MED.pico + 60) / 60 * 100)) + '%';
    const falta = Math.ceil((DURACAO - (agora - MED.ini)) / 1000), t = $('#mdTxt'); if (t) t.textContent = `Medindo… ${Math.max(0, falta)} s`;
    if (agora - MED.ini >= DURACAO) { MED.rodando = false; concluirMedida(); }
  }
  function concluirMedida() {
    const s = MED.amostras.filter(x => x > -60).sort((a, b) => a - b), ga = num(`hw.${MED.hw}.gain`), atual = ganhoDb(ga);
    const r = MED.res = { deDb: atual, novoA: null };
    if (s.length < 15) { r.cls = 'aviso'; r.html = 'Quase não chegou som nesta entrada. Confira o cabo, o microfone (phantom, se for condensador) e se estão tocando/falando.'; return desenharMedir(); }
    const pico = s[Math.min(s.length - 1, Math.floor(s.length * 0.98))], tipico = s[Math.floor(s.length * 0.6)], estourou = MED.pico >= -1;
    // (0.0.14) achado no teste de 23/11: nas entradas com Digitech, o medidor fica DEPOIS do amp simulado, que com drive
    // entrega sempre o mesmo nível — o 🎤 pedia "subir" sem fim (a guitarra foi de +22,6 a +56,5 dB). Com Digitech ligado: não sugere.
    if (C.t === 'i' && v(`i.${C.n}.digitech.enabled`) === '1') {
      r.cls = 'aviso'; r.html = `Picos em <b>${br(pico, 0)} dBFS</b>, mas com o <b>Digitech ligado</b> este medidor mostra o som depois do amplificador simulado, não o que chega no pré-amp.<br>Para acertar o ganho: desligue o Digitech, meça, aplique e ligue de novo. O volume da guitarra depois do amp se acerta no <b>Volume</b> do Digitech.`;
      return desenharMedir();
    }
    // (0.0.14) se o último "Aplicar" subiu o ganho e o nível quase não subiu junto, algo depois do pré-amp está segurando o som: não sobe mais
    const ult = MED.ultimo; MED.ultimo = { hw: MED.hw, ganho: atual, pico };
    if (ult && ult.hw === MED.hw && atual - ult.ganho >= 6 && pico - ult.pico < (atual - ult.ganho) / 3) {
      r.cls = 'aviso'; r.html = `Picos em <b>${br(pico, 0)} dBFS</b>. O ganho subiu ${br(atual - ult.ganho, 0)} dB desde a última medida, mas o som só subiu ${br(Math.max(0, pico - ult.pico), 0)} dB: algo depois do pré-amp está segurando o nível (amp simulado, compressor) ou o cabo/instrumento mudou.<br>Não vou sugerir subir mais. Confira e meça de novo.`;
      return desenharMedir();
    }
    let delta = estourou ? Math.min(ALVO_PICO - MED.pico, -8) : ALVO_PICO - pico;
    delta = Math.max(-20, Math.min(20, delta));
    const txtPico = `Picos em <b>${br(pico, 0)} dBFS</b> (nível normal ${br(tipico, 0)} dBFS${estourou ? ', <b>chegou a estourar</b>' : ''}).`;
    if (!estourou && pico >= FAIXA[0] && pico <= FAIXA[1]) { r.cls = 'ok'; r.html = `${txtPico}<br>✓ Está na faixa boa. Não precisa mexer no ganho.`; return desenharMedir(); }
    const novoA = ganhoParaA(atual + delta), novoDb = ganhoDb(novoA);
    if (Math.abs(novoDb - atual) < 1) { r.cls = 'ok'; r.html = `${txtPico}<br>O ganho já está no passo mais perto do ideal.`; return desenharMedir(); }
    r.novoA = novoA; r.paraDb = novoDb; r.cls = estourou || delta < 0 ? 'aviso' : 'sobe';
    r.html = `${txtPico}<br>Sugestão: <b>${delta > 0 ? 'subir' : 'baixar'} ${br(Math.abs(novoDb - atual), 0)} dB</b> no ganho, para os picos ficarem perto de ${sinal(ALVO_PICO, 0)} dBFS.` +
      (novoDb >= (ui24() ? 55 : 48) ? '<br>⚠ Ganho muito alto: o som está chegando fraco demais. Vale aproximar o microfone ou ver o cabo.' : '');
    desenharMedir();
  }
  function aplicarGanho() {
    const r = MED.res; if (!r || r.novoA == null) return;
    // (0.0.14) o próprio botão já diz o que vai fazer ("Aplicar: ganho +X → +Y dB"); sem segunda pergunta; "↶ Voltar o ganho" desfaz
    MED.desfazer = { hw: MED.hw, a: num(`hw.${MED.hw}.gain`) };
    X().definir(`hw.${MED.hw}.gain`, r.novoA.toFixed(6));
    MED.res = null; desenharMedir(); atualizar();
    const t = $('#mdTxt'); if (t) t.textContent = `Ganho mudado para ${sinal(r.paraDb, 0)} dB. Meça de novo para conferir.`;
  }

  // ---------- (0.0.11) PONTO DE PARTIDA POR INSTRUMENTO: filtro, EQ, compressor e gate iniciais, em unidades de gente
  // (Hz, dB, ms), convertidos para a escala 0–1 da mesa. São pontos de partida genéricos — depois o ouvido manda.
  const invQ = d => 1 - Math.sqrt(Math.max(0, 1 - Math.min(1, Math.max(0, d))));   // inverso do "desqr" da mesa
  const A = {
    hz: f => FV(f), db: g => (g + 15) / 30, q: q => Math.log(q / 0.05) / Math.log(300),
    lim: d => (d + 90) / 96, raz: r => 1 / r, atq: ms => invQ(Math.log(ms) / Math.log(400)), sol: ms => invQ(Math.log(ms / 10) / Math.log(200)),
    out: d => (d + 24) / 72, gAtq: ms => invQ(Math.log(Math.max(1, ms)) / Math.log(400)), gHold: ms => invQ(Math.log(Math.max(1, ms)) / Math.log(2000)),
    gSol: ms => invQ(Math.log(ms / 5) / Math.log(400)), prof: d => (d + 60) / 60
  };
  // b: [freq Hz, ganho dB, Q]; comp: [limiar dB, razão, ataque ms, soltura ms, ganho de saída dB] ou null; gate: [limiar, profundidade, ataque, retenção, soltura] ou null
  const INSTR = [
    { id: 'fala', nome: 'Voz falada', ex: 'padre, leitores, comentarista, ambão', alvo: 'Tira o grave que embola (sopro, mesa, pé do microfone) e dá clareza às palavras; compressor segura quem fala alto e quem fala baixo.',
      hpf: 100, b: [[250, -2, 1.2], [1000, 0, 1], [3000, 2, 1], [10000, 1, 0.7]], comp: [-22, 3, 10, 150, 3], gate: null, ds: true },
    { id: 'canto', nome: 'Voz cantada', ex: 'solista, salmista, vocal', alvo: 'Limpa o grave, um pouco de presença e brilho; compressor suave para a voz ficar na frente sem sumir nas partes baixas.',
      hpf: 90, b: [[300, -2, 1], [1000, 0, 1], [4000, 2, 1], [11000, 1.5, 0.7]], comp: [-20, 3, 15, 200, 2], gate: null, ds: true },
    { id: 'coral', nome: 'Coral (microfone de ambiente do coro)', ex: 'condensador na frente do coro', alvo: 'Corta grave e o "boxe" da sala; leve presença; compressão bem leve para não achatar a dinâmica do coro.',
      hpf: 120, b: [[250, -2, 1], [1000, 0, 1], [3500, 1.5, 1], [10000, 1, 0.7]], comp: [-18, 2, 20, 250, 1], gate: null, ds: false },
    { id: 'violao', nome: 'Violão', ex: 'captador ou microfone', alvo: 'Tira o "boom" do corpo, deixa as cordas aparecerem; compressor leve para as batidas não saltarem.',
      hpf: 80, b: [[200, -3, 1.2], [800, -1, 1], [5000, 2, 1], [10000, 1, 0.7]], comp: [-18, 2.5, 20, 200, 2], gate: null, ds: false },
    { id: 'teclado', nome: 'Teclado / piano', ex: 'saída de linha (direct box)', alvo: 'Quase plano: o teclado já sai equalizado. Só tira o subgrave e segura um pouco os picos.',
      hpf: 40, b: [[200, 0, 1], [1000, 0, 1], [4000, 0, 1], [10000, 0, 0.7]], comp: [-14, 2, 20, 250, 1], gate: null, ds: false },
    { id: 'baixo', nome: 'Contrabaixo', ex: 'direct box ou amplificador', alvo: 'Firmeza no grave sem embolar com o bumbo e o violão; compressor mais firme para as notas ficarem iguais.',
      hpf: 35, b: [[80, 2, 1], [250, -3, 1.2], [800, 0, 1], [3000, 1, 1]], comp: [-20, 4, 15, 180, 3], gate: null, ds: false },
    { id: 'perc', nome: 'Percussão (cajón, bateria leve)', ex: 'microfone perto', alvo: 'Corta o médio "de caixa de papelão", realça o ataque; gate fecha entre as batidas para não pegar a igreja toda.',
      hpf: 50, b: [[100, 2, 1], [400, -3, 1.2], [1000, 0, 1], [5000, 2, 1]], comp: [-16, 3, 5, 120, 2], gate: [-50, -20, 1, 50, 150], ds: false },
    { id: 'sopro', nome: 'Flauta / sopro', ex: 'microfone de instrumento', alvo: 'Tira o grave de manuseio e um pouco do agudo áspero; compressão leve.',
      hpf: 150, b: [[300, -1, 1], [1000, 0, 1], [3000, 1, 1], [8000, -1, 1]], comp: [-18, 2, 15, 200, 1], gate: null, ds: false },
    { id: 'amb', nome: 'Ambiente / assembleia', ex: 'microfone que capta a igreja (para a live)', alvo: 'Só o essencial: corta grave e um pouco do "embolado"; sem compressor nem gate para soar natural.',
      hpf: 150, b: [[300, -3, 1], [1000, 0, 1], [4000, 0, 1], [8000, -1, 1]], comp: null, gate: null, ds: false },
    { id: 'linha', nome: 'Notebook / celular (playback)', ex: 'música gravada, vídeo', alvo: 'Plano: a música gravada já vem mixada. Só tira o subgrave que não serve na igreja.',
      hpf: 30, b: [[200, 0, 1], [1000, 0, 1], [4000, 0, 1], [10000, 0, 0.7]], comp: null, gate: null, ds: false }
  ];
  function valoresInstr(x) {
    const o = { '.eq.bypass': 0, '.eq.hpf.freq': A.hz(x.hpf), '.eq.lpf.freq': 1 };
    x.b.forEach(([f, g, q], i) => { o[`.eq.b${i + 1}.freq`] = A.hz(f); o[`.eq.b${i + 1}.gain`] = A.db(g); o[`.eq.b${i + 1}.q`] = A.q(q); });
    if (x.comp) { const [l, r, at, so, out] = x.comp; Object.assign(o, { '.dyn.bypass': 0, '.dyn.threshold': A.lim(l), '.dyn.ratio': A.raz(r), '.dyn.attack': A.atq(at), '.dyn.release': A.sol(so), '.dyn.outgain': A.out(out), '.dyn.softknee': 1 }); }
    else o['.dyn.bypass'] = 1;
    if (x.gate) { const [l, p, at, h, so] = x.gate; Object.assign(o, { '.gate.enabled': 1, '.gate.thresh': A.lim(l), '.gate.depth': A.prof(p), '.gate.attack': A.gAtq(at), '.gate.hold': A.gHold(h), '.gate.release': A.gSol(so) }); }
    else o['.gate.enabled'] = 0;
    o['.deesser.enabled'] = x.ds ? 1 : 0;
    for (const k in o) o[k] = Math.min(1, Math.max(0, o[k]));
    return o;
  }
  function resumoInstr(x) {
    const b = x.b.filter(([, g]) => Math.abs(g) >= 0.5).map(([f, g]) => `${g > 0 ? '+' : '−'}${br(Math.abs(g), 1).replace(',0', '')} dB em ${txtHz(f)}`);
    return [`corta abaixo de ${txtHz(x.hpf)}`, b.length ? 'EQ: ' + b.join(', ') : 'EQ plano',
      x.comp ? `compressor ${br(x.comp[1], 1).replace(',0', '')}:1 a partir de ${sinal(x.comp[0], 0)} dB` : 'sem compressor', x.gate ? 'gate ligado' : 'sem gate'].join(' · ');
  }
  function abrirInstr() {
    let d = $('#cnDlgInstr');
    if (!d) { d = document.createElement('dialog'); d.id = 'cnDlgInstr'; d.className = 'pn cn-dlg'; document.querySelector('.app').appendChild(d); }
    d.innerHTML = `<h3 class="rot">Ponto de partida por instrumento · ${esc(nomeCanal())}<button class="peq" id="inFechar">Fechar</button></h3>
      <p class="dica" style="max-width:640px">Escolha o que está ligado neste canal. O programa põe filtro, EQ, compressor e gate num ponto de partida comum para esse instrumento — depois ajuste no ouvido. <b>Não mexe no ganho nem no volume.</b> Dá para desfazer logo em seguida.</p>
      <div class="in-lista">${INSTR.map(x => `<button class="in-item" data-in="${x.id}"><b>${esc(x.nome)}</b><span class="dica">${esc(x.ex)}</span><span class="in-alvo">${esc(x.alvo)}</span><span class="in-res">${esc(resumoInstr(x))}</span></button>`).join('')}</div>`;
    $('#inFechar').onclick = () => d.close();
    $$('#cnDlgInstr [data-in]').forEach(b => b.onclick = () => aplicarInstr(INSTR.find(x => x.id === b.dataset.in), d));
    d.showModal();
  }
  function aplicarInstr(x, dlg) {
    const p = pre(), vals = valoresInstr(x), mudar = Object.keys(vals).filter(s => v(p + s.slice(1)) !== undefined);
    if (!mudar.length) return;
    // (0.0.14) sem "tem certeza?": o resumo já aparece no botão; ↶ Desfazer preset volta como estava
    const antes = {}; for (const s of mudar) antes[s] = v(p + s.slice(1));
    P.desfazer = { canal: p, tp: 'instr', antes, nome: x.nome };
    for (const s of mudar) X().definirPar(p + s.slice(1), String(+vals[s].toFixed(6)));
    dlg.close(); atualizar(); curva(); mostrarBotoesPreset();
    window.toast?.(`${nomeCanal()}: ponto de partida de "${x.nome}". ↶ Desfazer preset volta como estava.`);
  }

  // ---------- (0.0.9) RTA (analisador): a mesa manda ~30×/s 122 faixas (20,6 Hz a 22,35 kHz, escala log) do canal que
  // o operador escolheu. A mesa analisa UM canal por vez: o programa devolve o que estava ao desligar/sair.
  const alvoRta = () => C.t === 'm' ? 'm' : `${C.t}.${C.n}`;
  const botaoRta = () => `<button class="peq cn-rta ${C.rta ? 'sel' : ''}" title="Analisador: mostra por trás do gráfico quanto som há em cada frequência (a mesa analisa um canal por vez)">RTA</button><button class="peq cn-rtah ${C.rtaHold ? 'sel' : ''}" ${C.rta ? '' : 'hidden'} title="Guarda a forma de agora numa linha cinza, para comparar depois de mexer">Congelar</button>`;
  function ligarRta() {
    $$('#canal .cn-rta').forEach(b => b.onclick = e => { e.preventDefault(); C.rta = !C.rta; if (!C.rta) { C.rtaDados = null; C.rtaHold = null; } mandar({ tipo: 'rta', alvo: C.rta ? alvoRta() : '' }); montar(); });
    $$('#canal .cn-rtah').forEach(b => b.onclick = e => { e.preventDefault(); C.rtaHold = C.rtaHold ? null : (C.rtaDados ? C.rtaDados.slice() : null); b.classList.toggle('sel', !!C.rtaHold); curva(); geq(); });
    C.rtaDados = null;
    if (C.rta) mandar({ tipo: 'rta', alvo: alvoRta() });
  }
  const LRTA = f => Math.log(f / 20) / Math.log(1102.5);
  function rta(m) {
    if (!C.rta || $('#canal').hidden || m.alvo !== alvoRta()) return;
    let s; try { s = atob(m.d || ''); } catch { return; }
    const ant = C.rtaDados, novo = new Array(s.length);
    for (let i = 0; i < s.length; i++) { const e = 0.004167508166392142 * s.charCodeAt(i); novo[i] = ant && ant.length === s.length ? Math.max(e, ant[i] - 0.025) : e; }   // cai devagar, como um medidor
    C.rtaDados = novo; C.rtaEm = Date.now();
    if (!C.rtaPintando) { C.rtaPintando = true; requestAnimationFrame(() => { C.rtaPintando = false; curva(); geq(); dinGraf(); }); }
    clearTimeout(C.rtaFim); C.rtaFim = setTimeout(() => { C.rtaDados = null; curva(); geq(); dinGraf(); }, 1200);
  }
  // desenha o espectro: xDeF(frequência) → x; topo/base = faixa útil do gráfico
  function pintarRta(g, xDeF, topo, base, w) {
    const um = (d, preencher) => {
      if (!d || d.length < 2) return;
      const n = d.length, u0 = LRTA(20.6), du = LRTA(22350.6) / (n - 1), yy = e => base - Math.min(1.05, Math.max(0, e)) * (base - topo);
      g.beginPath(); g.moveTo(Math.max(0, xDeF(20.6)), base);
      for (let i = 0; i < n; i++) { const x = xDeF(20 * Math.pow(1102.5, u0 + i * du)); if (x > w + 4) break; g.lineTo(x, yy(d[i])); }
      if (preencher) { g.lineTo(w, base); g.closePath(); g.fillStyle = 'rgba(110,180,255,.16)'; g.fill(); g.strokeStyle = 'rgba(110,180,255,.65)'; g.lineWidth = 1.2; g.stroke(); }
      else { g.strokeStyle = 'rgba(200,200,200,.55)'; g.lineWidth = 1.2; g.setLineDash([4, 3]); g.stroke(); g.setLineDash([]); }
    };
    g.save(); g.beginPath(); g.rect(0, topo, w, base - topo); g.clip();
    um(C.rtaHold, false); um(C.rtaDados, true);
    g.restore();
  }

  function andar(d) {
    const ui = X().modelo, max = { i: X().nCanais(), l: 2, p: 2, s: 6, f: 4, a: ui === 'ui12' ? 4 : ui === 'ui16' ? 6 : 10, m: 1 }[C.t] || 1;
    C.n = (C.n + d + max) % max; C.rtaHold = null; montar();
  }
  function abrir(t, n) {
    if (C.t !== t || C.n !== n) { C.banda = null; C.rtaHold = null; }   // (0.0.9) a linha congelada é do canal em que foi tirada
    C.t = t; C.n = n;
    $('#canal').hidden = false; $('.mx-corpo').hidden = true; $('.mx-topo').hidden = true; $('#mxExplica').hidden = true;
    montar();
  }
  function fechar() {
    if (C.rta) mandar({ tipo: 'rta', alvo: '' });   // devolve à mesa o canal que estava no RTA (a preferência fica para a próxima)
    C.rtaDados = null;
    $('#canal').hidden = true; $('.mx-corpo').hidden = false; $('.mx-topo').hidden = false; $('#mxExplica').hidden = false;
    window.Mixer?.aoFecharCanal?.();
  }

  window.Canal = { abrir, fechar, vu, presets, presetsMesa, presetMesa, rta, refazer: () => { if (!$('#canal').hidden) montar(); } };
  X()?.aoMudar.push(muds => {
    if ($('#canal').hidden) return;
    if (C.t === 'm' && ('m.eq.linked' in muds || 'm.dyn.linked' in muds)) { montar(); return; }
    for (const k in muds) if (k.startsWith(pre()) || k.startsWith('hw.') || k.startsWith('a.')) { atualizar(); return; }
  });
  window.addEventListener('resize', () => { curva(); geq(); });
})();
