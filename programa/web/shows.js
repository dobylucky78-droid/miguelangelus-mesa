'use strict';
// MiguelAngelus Mesa (0.0.4) — shows, snapshots e cues NA MESA: abrir show, carregar, salvar, criar, e recriar um show
// a partir da biblioteca (pelo pendrive). Tudo que mexe na mesa pede confirmação; antes de carregar, o programa guarda
// como a mesa estava (Biblioteca → "⟲ Antes de carregar"), então dá para voltar.
(() => {
  const S = { sel: null, assin: '', importaveis: null, esperandoImp: false, showPen: null };

  // ---------- confirmação (janela própria, em português, com o botão dizendo o que faz) ----------
  function confirmar(titulo, html, botao, perigo = false) {
    return new Promise(ok => {
      const d = $('#dlgConf');
      $('#dlgConfTit').textContent = titulo; $('#dlgConfTxt').innerHTML = html;
      const b = $('#dlgConfSim'); b.textContent = botao; b.classList.toggle('perigo', perigo);
      d.returnValue = ''; d.showModal();
      d.onclose = () => ok(d.returnValue === 'sim');
    });
  }
  function pedirNome(titulo, html, botao, inicial = '') {
    return new Promise(ok => {
      const d = $('#dlgNome');
      $('#dlgNomeTit').textContent = titulo; $('#dlgNomeTxt').innerHTML = html; $('#dlgNomeSim').textContent = botao;
      const i = $('#dlgNomeIn'); i.value = inicial;
      d.returnValue = ''; d.showModal(); setTimeout(() => { i.focus(); i.select(); }, 30);
      d.onclose = () => ok(d.returnValue === 'sim' ? i.value.replace(/\^/g, '_').trim() : null);
    });
  }
  const naMesa = (acao, extra) => mandar({ tipo: 'naMesa', acao, ...extra });

  // ---------- desenho (só quando algo muda: a mesa manda o estado 2× por segundo) ----------
  function render(forcar) {
    const m = E.mesa, el = $('#shMesa'); if (!el) return;
    if (!m?.pronta) { el.innerHTML = '<p class="dica">Conecte a mesa para ver os shows dela.</p>'; S.assin = ''; return; }
    const guard = new Map((E.bib?.shows || []).map(s => [s.nome, new Set(s.snapshots.map(x => x.nome))]));
    if (!S.sel || !m.shows.some(s => s.nome === S.sel)) S.sel = m.show || m.shows[0]?.nome || null;
    const assin = JSON.stringify([m.shows, m.show, m.snapshot, m.cue, S.sel, [...guard].map(([k, v]) => [k, [...v]]), m.importaveis]);
    if (!forcar && assin === S.assin) return; S.assin = assin;
    const sh = m.shows.find(s => s.nome === S.sel) || { nome: S.sel, snapshots: [], cues: [] }, ehAtual = sh.nome === m.show, g = guard.get(sh.nome) || new Set();
    el.innerHTML = `
      <div class="sh-shows">${m.shows.map(s => `<button class="cam ${s.nome === S.sel ? 'sel' : ''}" data-sh="${esc(s.nome)}" title="${s.nome === m.show ? 'Show aberto na mesa agora' : 'Ver os snapshots deste show'}">${s.nome === m.show ? '● ' : ''}${esc(s.nome)}</button>`).join('')}
        <button class="peq" id="shNovoShow" title="Cria um show novo e vazio na mesa">＋ Novo show</button>
        <button class="peq" id="shImportar" title="A mesa copia um show de um pendrive espetado NELA">📀 Importar do pendrive da mesa</button></div>
      ${ehAtual ? `<p class="dica">● <b>${esc(sh.nome)}</b> é o show aberto na mesa. Snapshot atual: <b>${esc(m.snapshot || '—')}</b>${m.cue ? ` · cue atual: <b>${esc(m.cue)}</b>` : ''}.</p>`
        : `<p class="dica">Este show não está aberto na mesa. <button class="peq" id="shAbrir">Abrir "${esc(sh.nome)}" na mesa</button> (abrir não muda o som; só carregar um snapshot muda).</p>`}
      <div class="sh-colunas">
        <div><h4>Snapshots <span class="dica">(o som inteiro da mesa)</span></h4>
          ${sh.snapshots.map(n => `<div class="sh-item ${ehAtual && n === m.snapshot ? 'atual' : ''}">
              <span class="bk ${g.has(n) ? 'ok' : 'falta'}" title="${g.has(n) ? 'Também guardado no programa' : 'Ainda NÃO guardado no programa'}">${g.has(n) ? '✓' : '!'}</span>
              <span class="sh-nome">${esc(n)}</span>
              <button class="peq prim" data-car="${esc(n)}">Carregar</button>
              <button class="peq" data-sal="${esc(n)}" title="Troca este snapshot pelo som de agora">Salvar por cima</button></div>`).join('') || '<p class="dica">Sem snapshots.</p>'}
          <button class="peq" id="shNovoSnap">＋ Novo snapshot com o som de agora</button>
        </div>
        <div><h4>Cues <span class="dica">(parte do som, ex.: só os retornos)</span></h4>
          ${sh.cues.map(n => `<div class="sh-item ${ehAtual && n === m.cue ? 'atual' : ''}"><span class="sh-nome">${esc(n)}</span>
              <button class="peq prim" data-carc="${esc(n)}">Carregar</button>
              <button class="peq" data-salc="${esc(n)}" title="Troca este cue pelo som de agora">Salvar por cima</button></div>`).join('') || '<p class="dica">Sem cues.</p>'}
          <button class="peq" id="shNovaCue">＋ Novo cue com o som de agora</button>
        </div>
      </div>
      ${S.esperandoImp || m.importaveis ? `<div class="sh-imp pn"><h4>Shows no pendrive espetado na mesa</h4>${
        m.importaveis == null ? '<p class="dica">Perguntando à mesa…</p>' : m.importaveis.length ? m.importaveis.map(x => `<div class="sh-item"><span class="sh-nome">${esc(x)}</span><button class="peq prim" data-imp2="${esc(x)}">Importar para a mesa</button></div>`).join('')
        : '<p class="dica">A mesa não achou shows no pendrive. Ele precisa estar espetado na mesa, em FAT32, com a pasta Exports\\shows (use "Copiar para o pendrive" na Biblioteca).</p>'}
        <button class="peq" id="shImpFechar">Fechar</button></div>` : ''}`;
    ligar(m, sh, ehAtual);
  }

  function ligar(m, sh, ehAtual) {
    $$('#shMesa [data-sh]').forEach(b => b.onclick = () => { S.sel = b.dataset.sh; render(true); });
    $('#shAbrir')?.addEventListener('click', async () => {
      if (await confirmar('Abrir show na mesa', `Abrir o show <b>${esc(sh.nome)}</b> na mesa?<br><span class="dica">O som não muda; muda a lista de snapshots e cues em uso na mesa.</span>`, 'Abrir show')) naMesa('carregarShow', { show: sh.nome });
    });
    $$('#shMesa [data-car]').forEach(b => b.onclick = async () => {
      const n = b.dataset.car;
      if (await confirmar('Carregar snapshot', `Carregar <b>${esc(n)}</b> (show ${esc(sh.nome)}) na mesa?<br><br><b>O som inteiro muda na hora</b> (volumes, EQ, retornos…).
          <br><span class="dica">Antes, o programa guarda como a mesa está agora (Biblioteca → "⟲ Antes de carregar"), para dar para voltar.</span>`, 'Carregar agora', true)) {
        if (!ehAtual) naMesa('carregarShow', { show: sh.nome });
        setTimeout(() => naMesa('carregarSnapshot', { show: sh.nome, nome: n }), ehAtual ? 0 : 900);
      }
    });
    $$('#shMesa [data-carc]').forEach(b => b.onclick = async () => {
      const n = b.dataset.carc;
      if (await confirmar('Carregar cue', `Carregar o cue <b>${esc(n)}</b> (show ${esc(sh.nome)}) na mesa?<br><br><b>Parte do som muda na hora.</b><br><span class="dica">Antes, o programa guarda como a mesa está agora.</span>`, 'Carregar agora', true)) {
        if (!ehAtual) naMesa('carregarShow', { show: sh.nome });
        setTimeout(() => naMesa('carregarCue', { show: sh.nome, nome: n }), ehAtual ? 0 : 900);
      }
    });
    $$('#shMesa [data-sal]').forEach(b => b.onclick = async () => {
      const n = b.dataset.sal;
      if (await confirmar('Salvar por cima', `Trocar o snapshot <b>${esc(n)}</b> (show ${esc(sh.nome)}) pelo som da mesa <b>agora</b>?<br><span class="dica">O que estava nele antes não volta pela mesa; se ele estava guardado no programa, a versão anterior fica no histórico da biblioteca.</span>`, 'Salvar por cima', true))
        naMesa('salvarSnapshot', { show: sh.nome, nome: n });
    });
    $$('#shMesa [data-salc]').forEach(b => b.onclick = async () => {
      const n = b.dataset.salc;
      if (await confirmar('Salvar cue por cima', `Trocar o cue <b>${esc(n)}</b> (show ${esc(sh.nome)}) pelo som da mesa <b>agora</b>?`, 'Salvar por cima', true)) naMesa('salvarCue', { show: sh.nome, nome: n });
    });
    $('#shNovoSnap').onclick = async () => {
      const n = await pedirNome('Novo snapshot', `Guardar o som da mesa agora como um snapshot novo no show <b>${esc(sh.nome)}</b>.`, 'Salvar na mesa');
      if (!n) return;
      if (sh.snapshots.includes(n) && !await confirmar('Já existe', `Já existe <b>${esc(n)}</b>. Trocar pelo som de agora?`, 'Salvar por cima', true)) return;
      naMesa('salvarSnapshot', { show: sh.nome, nome: n });
    };
    $('#shNovaCue').onclick = async () => {
      const n = await pedirNome('Novo cue', `Guardar o som da mesa agora como um cue novo no show <b>${esc(sh.nome)}</b>.`, 'Salvar na mesa');
      if (!n) return;
      if (sh.cues.includes(n) && !await confirmar('Já existe', `Já existe o cue <b>${esc(n)}</b>. Trocar pelo som de agora?`, 'Salvar por cima', true)) return;
      naMesa('salvarCue', { show: sh.nome, nome: n });
    };
    $('#shNovoShow').onclick = async () => {
      const n = await pedirNome('Novo show', 'Criar um show novo e vazio na mesa (o som não muda).', 'Criar na mesa');
      if (!n) return;
      if (m.shows.some(s => s.nome === n)) return toast(`Já existe o show "${n}" na mesa.`);
      naMesa('criarShow', { show: n }); S.sel = n;
    };
    $('#shImportar').onclick = () => { S.esperandoImp = true; naMesa('importaveis'); render(true); };
    $('#shImpFechar')?.addEventListener('click', () => { S.esperandoImp = false; E.mesa.importaveis = null; render(true); });
    $$('#shMesa [data-imp2]').forEach(b => b.onclick = async () => {
      const x = b.dataset.imp2, existe = m.shows.some(s => x.endsWith(s.nome));
      if (await confirmar('Importar show do pendrive', `A mesa vai copiar o show <b>${esc(x)}</b> do pendrive espetado nela.${existe ? '<br><br><b>Atenção:</b> já existe um show com esse nome na mesa; ele pode ser substituído.' : ''}<br><span class="dica">O som não muda.</span>`, 'Importar', existe)) {
        naMesa('importar', { item: x }); S.esperandoImp = false;
      }
    });
  }

  // ---------- Biblioteca: copiar um show guardado para o pendrive (para recriar na mesa) ----------
  function copiarParaPendrive(show) { S.showPen = show; mandar({ tipo: 'pendrivesPc' }); }
  async function pendrivesPc(m) {
    const show = S.showPen; if (!show) return; S.showPen = null;
    if (!m.lista?.length) return toast('Nenhum pendrive ligado neste computador. Espete um (FAT32, até 32 GB) e tente de novo.', 7000);
    const p = m.lista[0];
    const outros = m.lista.length > 1 ? `<br><span class="dica">Há ${m.lista.length} pendrives; vai no primeiro (${esc(m.lista.map(x => x.raiz).join(', '))}).</span>` : '';
    if (await confirmar('Copiar show para o pendrive', `Copiar o show <b>${esc(show)}</b> guardado no programa para o pendrive <b>${esc(p.nome)} (${esc(p.raiz)})</b>, na pasta <b>Exports\\shows</b>.${outros}
        <br><br>Só acrescenta essa pasta; o resto do pendrive não é tocado.<br>Depois: espete o pendrive na mesa e, na aba Mesa, use <b>📀 Importar do pendrive da mesa</b>.`, 'Copiar para o pendrive'))
      mandar({ tipo: 'copiarParaPendrive', show, raiz: p.raiz });
  }

  window.Shows = { render, copiarParaPendrive, pendrivesPc };
})();
