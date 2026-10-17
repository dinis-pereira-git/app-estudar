// Ecrãs da app:
// capa → disciplina (testes por período + livros) → teste (páginas da matéria) → estudar / testar → resultado.
// Também: livro (todas as páginas), gerir testes (pai) e painel.
const App = (() => {
  const $app = document.getElementById('app');
  const $relogio = document.getElementById('relogio');
  const $ampliar = document.getElementById('ampliar');
  const $sair = document.getElementById('sair');
  const A = Armazenamento;
  const { SUPABASE_URL, SUPABASE_KEY, BUCKET } = window.CONFIG;
  // "?local" no endereço força o modo local (útil para testar no PC do pai sem login).
  const forcarLocal = new URLSearchParams(location.search).has('local');
  const db = SUPABASE_URL && SUPABASE_KEY && !forcarLocal ? supabase.createClient(SUPABASE_URL, SUPABASE_KEY) : null;

  const disciplinas = {};    // id → { id, nome, nomeCompleto, icone, livros: [ids] }
  const livros = {};         // id → { id, titulo, descricao, disciplina, paginas, perguntas, url(ficheiro) }
  let contexto = null;       // { livro, pagina } enquanto estuda uma página (conta tempo por página)
  let teste = null;          // teste em curso
  let pronto = false;        // matéria e progresso carregados

  const DIFICULDADES = {
    facil:   { nome: 'Fácil',   desc: 'Sobretudo o que está destacado no livro', estrelas: '★' },
    medio:   { nome: 'Médio',   desc: 'Perceber e relacionar ideias',             estrelas: '★★' },
    dificil: { nome: 'Difícil', desc: 'Deduzir o que não está escrito',            estrelas: '★★★' },
    misto:   { nome: 'Misto',   desc: 'Um pouco de tudo',                          estrelas: '★ ★★ ★★★' },
  };
  const NIVEL = { 1: '★', 2: '★★', 3: '★★★' };

  // ---------- utilitários ----------
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmt = seg => {
    const m = Math.round(seg / 60);
    if (seg < 60) return seg > 0 ? '<1 min' : '0 min';
    return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min` : `${m} min`;
  };
  const pct = (a, b) => (b ? Math.round((100 * a) / b) : 0);
  const dataCurta = iso => new Date(iso).toLocaleString('pt-PT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const render = html => { $app.innerHTML = html; window.scrollTo(0, 0); };

  const pagina = (lid, n) => livros[lid].paginas.find(p => p.numero === n);
  const img = (lid, pg) => livros[lid].url(pg.imagem);
  const avaliacao = id => A.estado.avaliacoes.find(a => String(a.id) === String(id));
  const nomeAvaliacao = a => `${a.periodo}.º Período · ${a.nome}`;
  const paginasDaAvaliacao = a => (livros[a.livro]?.paginas || []).map(p => p.numero).filter(n => n >= a.de && n <= a.ate);
  const avaliacoesDe = did => A.estado.avaliacoes.filter(a => a.disciplina === did)
    .sort((x, y) => x.periodo - y.periodo || String(x.data || '9999').localeCompare(String(y.data || '9999')));

  function quandoE(data) {
    if (!data) return 'Sem data';
    const dt = new Date(data + 'T12:00');
    const dias = Math.round((dt - new Date(A.hoje() + 'T12:00')) / 86400000);
    const texto = dt.toLocaleDateString('pt-PT', { weekday: 'short', day: 'numeric', month: 'long' });
    const falta = dias > 1 ? `faltam ${dias} dias` : dias === 1 ? 'é amanhã!' : dias === 0 ? 'é hoje!' : 'já foi';
    return `${texto} · ${falta}`;
  }

  function proximaAvaliacao(did) {
    return avaliacoesDe(did).filter(a => a.data && a.data >= A.hoje()).sort((x, y) => x.data.localeCompare(y.data))[0];
  }

  function melhorNota(filtro) {
    const ts = A.estado.testes.filter(filtro);
    return ts.length ? Math.max(...ts.map(t => t.percent)) : null;
  }
  const melhorNotaPagina = (lid, n) => melhorNota(t => t.livro === lid && t.tipo === 'pagina' && t.pagina === n);

  function progressoAvaliacao(a) {
    const pags = paginasDaAvaliacao(a);
    const estudadas = pags.filter(n => A.infoPagina(a.livro, n).estudada).length;
    return { total: pags.length, estudadas };
  }

  function ampliar(src) {
    $ampliar.innerHTML = `<img src="${src}" alt="Página ampliada"><button class="fechar" aria-label="Fechar">✕</button>`;
    $ampliar.hidden = false;
  }
  $ampliar.addEventListener('click', () => { $ampliar.hidden = true; });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') $ampliar.hidden = true; });
  $app.addEventListener('click', e => { const z = e.target.closest('[data-ampliar]'); if (z) ampliar(z.dataset.ampliar); });

  // ---------- tempo de estudo ativo ----------
  // Só conta quando a janela está visível e houve interação no último minuto.
  // O painel e a gestão de testes não contam (o pai pode estar só a consultar).
  let ultimaInteracao = Date.now();
  ['mousemove', 'keydown', 'click', 'scroll', 'touchstart', 'wheel'].forEach(ev =>
    addEventListener(ev, () => { ultimaInteracao = Date.now(); }, { passive: true }));
  const atualizarRelogio = () => { $relogio.textContent = `⏱ Hoje: ${fmt(A.estado.tempoPorDia[A.hoje()] || 0)}`; };
  setInterval(() => {
    const naoConta = /^#\/(painel|gerir)/.test(location.hash);
    if (pronto && !naoConta && document.visibilityState === 'visible' && Date.now() - ultimaInteracao < 60000) {
      A.adicionarTempo(5, contexto?.livro, contexto?.pagina);
      atualizarRelogio();
    }
  }, 5000);

  // ---------- rotas ----------
  function rota() {
    const [ecra = '', a, b, c] = (location.hash || '#/').slice(2).split('/');
    contexto = null;
    document.querySelectorAll('.barra nav a').forEach(el => {
      const alvo = el.getAttribute('href').slice(2);
      el.classList.toggle('ativo', alvo === 'painel' ? ecra === 'painel' : ecra !== 'painel');
    });
    if (ecra === 'd' && disciplinas[a]) return ecraDisciplina(a);
    if (ecra === 'l' && livros[a]) return ecraLivro(a);
    if (ecra === 't' && avaliacao(a)) return ecraAvaliacao(avaliacao(a));
    if (ecra === 'estudar' && livros[a]) return ecraEstudar(a, +b, c && avaliacao(c));
    if (ecra === 'testar' && avaliacao(a)) return ecraDificuldade(avaliacao(a), b === 'global' ? null : +b);
    if (ecra === 'gerir' && disciplinas[a]) return ecraGerir(a, b);
    if (ecra === 'teste' && teste) return ecraPergunta();
    if (ecra === 'resultado' && teste?.registo) return ecraResultado();
    if (ecra === 'painel') return ecraPainel();
    ecraCapa();
  }

  // ---------- capa ----------
  function ecraCapa() {
    const cartoes = Object.values(disciplinas).map(d => {
      const prox = proximaAvaliacao(d.id);
      return `
        <a class="disc-cartao" href="#/d/${d.id}">
          <span class="disc-icone">${d.icone || '📘'}</span>
          <b class="disc-nome">${esc(d.nome)}</b>
          <span class="muted">${esc(d.nomeCompleto)}</span>
          <span class="disc-prox">${prox ? `📅 ${esc(nomeAvaliacao(prox))}<br><small>${quandoE(prox.data)}</small>` : '<small class="muted">Sem testes marcados</small>'}</span>
        </a>`;
    }).join('');
    render(`
      <section class="capa">
        <h1>Olá, Leonor! 👋</h1>
        <p class="muted">O que vamos estudar hoje?</p>
        <div class="disciplinas">${cartoes}</div>
      </section>`);
  }

  // ---------- disciplina ----------
  function ecraDisciplina(did) {
    const d = disciplinas[did];
    const avs = avaliacoesDe(did);
    const porPeriodo = [1, 2, 3].map(p => {
      const lista = avs.filter(a => a.periodo === p);
      if (!lista.length) return '';
      return `
        <h3>${p}.º Período</h3>
        <div class="testes-grelha">${lista.map(a => {
          const { total, estudadas } = progressoAvaliacao(a);
          const nota = melhorNota(t => String(t.avaliacao) === String(a.id) && t.tipo === 'global');
          return `
            <a class="teste-cartao" href="#/t/${a.id}">
              <b>${esc(a.nome)}</b>
              <span>📅 ${quandoE(a.data)}</span>
              <span class="muted">${esc(livros[a.livro]?.titulo || a.livro)} · págs. ${a.de}–${a.ate}</span>
              <div class="progresso"><div style="width:${pct(estudadas, total)}%"></div></div>
              <span class="muted">${estudadas} de ${total} páginas estudadas${nota != null ? ` · melhor teste global: ${nota}%` : ''}</span>
            </a>`;
        }).join('')}</div>`;
    }).join('');

    const livrosHtml = d.livros.map(lid => {
      const l = livros[lid];
      return `
        <a class="livro-cartao" href="#/l/${lid}">
          <span class="livro-capa">📕</span>
          <span><b>${esc(l.titulo)}</b><br><span class="muted">${esc(l.descricao || '')} · ${l.paginas.length} páginas · ${l.perguntas.length} perguntas</span></span>
        </a>`;
    }).join('');

    render(`
      <section class="cartao">
        <a href="#/" class="voltar">← Início</a>
        <h1>${d.icone || ''} ${esc(d.nome)} <span class="muted titulo-sub">${esc(d.nomeCompleto)}</span></h1>
        <div class="seccao-topo"><h2>Testes</h2><a class="btn" href="#/gerir/${did}">⚙️ Gerir testes</a></div>
        ${porPeriodo || `<p class="muted">Ainda não há testes marcados. <a href="#/gerir/${did}/novo">Criar o primeiro teste</a>.</p>`}
        <h2>Livros</h2>
        <div class="livros">${livrosHtml}</div>
      </section>`);
  }

  // ---------- lista de páginas (usada no teste e no livro) ----------
  function linhaPagina(lid, pg, a) {
    const info = A.infoPagina(lid, pg.numero);
    const nota = melhorNotaPagina(lid, pg.numero);
    const nPerg = livros[lid].perguntas.filter(q => q.pagina === pg.numero).length;
    return `
      <li class="pag-linha">
        <img src="${img(lid, pg)}" alt="" class="mini" data-ampliar="${img(lid, pg)}">
        <div class="pag-info">
          <b>Página ${pg.numero}</b> <span class="muted">· ${esc(pg.titulo)}</span>
          <div class="estado">
            ${info.estudada ? '<span class="chip ok">✓ Estudada</span>' : '<span class="chip">Por estudar</span>'}
            ${nota != null ? `<span class="chip ${nota >= 70 ? 'ok' : 'aviso'}">Melhor nota: ${nota}%</span>` : ''}
            <span class="muted">${nPerg} perguntas</span>
          </div>
        </div>
        <div class="acoes">
          <a class="btn" href="#/estudar/${lid}/${pg.numero}${a ? '/' + a.id : ''}">📖 Estudar</a>
          ${a ? `<a class="btn prim" href="#/testar/${a.id}/${pg.numero}">✏️ Testar</a>` : ''}
        </div>
      </li>`;
  }

  // ---------- um teste da escola ----------
  function ecraAvaliacao(a) {
    const l = livros[a.livro];
    if (!l) return render(`<section class="cartao"><a href="#/d/${a.disciplina}" class="voltar">← Voltar</a><h1>Livro não encontrado</h1></section>`);
    const pags = paginasDaAvaliacao(a);
    const { total, estudadas } = progressoAvaliacao(a);
    render(`
      <section class="cartao">
        <a href="#/d/${a.disciplina}" class="voltar">← ${esc(disciplinas[a.disciplina]?.nome || 'Voltar')}</a>
        <h1>${esc(nomeAvaliacao(a))}</h1>
        <p class="muted">📅 ${quandoE(a.data)} · 📕 ${esc(l.titulo)}, páginas ${a.de} a ${a.ate}</p>
        <div class="progresso"><div style="width:${pct(estudadas, total)}%"></div></div>
        <p class="muted">${estudadas} de ${total} páginas estudadas. Estuda e testa página a página; no fim faz o teste global.</p>
        <ol class="pag-lista">${pags.map(n => linhaPagina(a.livro, pagina(a.livro, n), a)).join('')}</ol>
        <div class="global">
          <div><b>Teste global</b><br><span class="muted">Todas as páginas deste teste (${a.de} a ${a.ate}), com perguntas de vários níveis.</span></div>
          <a class="btn prim grande" href="#/testar/${a.id}/global">🏁 Fazer teste global</a>
        </div>
      </section>`);
  }

  // ---------- livro inteiro ----------
  function ecraLivro(lid) {
    const l = livros[lid];
    render(`
      <section class="cartao">
        <a href="#/d/${l.disciplina}" class="voltar">← ${esc(disciplinas[l.disciplina].nome)}</a>
        <h1>📕 ${esc(l.titulo)}</h1>
        <p class="muted">${esc(l.descricao || '')}. Aqui podes ler qualquer página. Para fazer testes, abre um dos testes da disciplina.</p>
        <ol class="pag-lista">${l.paginas.map(pg => linhaPagina(lid, pg, null)).join('')}</ol>
      </section>`);
  }

  // ---------- estudar uma página ----------
  function ecraEstudar(lid, n, a) {
    const l = livros[lid], pg = pagina(lid, n);
    if (!pg) return ecraLivro(lid);
    contexto = { livro: lid, pagina: n };
    const i = l.paginas.indexOf(pg);
    const sufixo = a ? '/' + a.id : '';
    const ant = l.paginas[i - 1], seg = l.paginas[i + 1];
    const info = A.infoPagina(lid, n);
    const dentro = a && paginasDaAvaliacao(a).includes(n);
    const voltar = a ? `<a href="#/t/${a.id}" class="voltar">← ${esc(nomeAvaliacao(a))}</a>` : `<a href="#/l/${lid}" class="voltar">← ${esc(l.titulo)}</a>`;

    render(`
      <section class="estudar">
        <div class="estudar-topo">
          ${voltar}
          <h1>Página ${n} · ${esc(pg.titulo)}</h1>
        </div>
        <div class="estudar-corpo">
          <figure class="pagina-grande">
            <img src="${img(lid, pg)}" alt="Página ${n} do livro" data-ampliar="${img(lid, pg)}">
            <figcaption class="muted">Clica na página para a ver em grande.</figcaption>
          </figure>
          <aside class="lado">
            <div class="cartao">
              <h2>🎬 Vídeo-resumo</h2>
              ${pg.video ? `<video controls src="${l.url(pg.video)}"></video>` : '<p class="muted">Ainda não há vídeo para esta página.</p>'}
            </div>
            <div class="cartao">
              <h2>Quando acabares de ler</h2>
              <button class="btn ${info.estudada ? '' : 'prim'}" id="estudei" ${info.estudada ? 'disabled' : ''}>${info.estudada ? '✓ Já estudaste esta página' : '✓ Já estudei esta página'}</button>
              ${dentro ? `<a class="btn prim" href="#/testar/${a.id}/${n}">✏️ Testar esta página</a>` : ''}
              <p class="muted">Tempo nesta página: ${fmt(info.segundos)}</p>
            </div>
            <div class="navegar">
              ${ant ? `<a class="btn" href="#/estudar/${lid}/${ant.numero}${sufixo}">← Pág. ${ant.numero}</a>` : '<span></span>'}
              ${seg ? `<a class="btn" href="#/estudar/${lid}/${seg.numero}${sufixo}">Pág. ${seg.numero} →</a>` : ''}
            </div>
          </aside>
        </div>
      </section>`);
    document.getElementById('estudei').onclick = () => { A.marcarEstudada(lid, n); ecraEstudar(lid, n, a); };
  }

  // ---------- escolher dificuldade ----------
  function ecraDificuldade(a, alvo) {
    const paginas = paginasDaAvaliacao(a);
    const anteriores = alvo == null ? [] : paginas.filter(p => p < alvo);
    const titulo = alvo == null ? `Teste global · páginas ${a.de} a ${a.ate}` : `Testar a página ${alvo}`;
    const explica = alvo == null
      ? 'Perguntas de todas as páginas deste teste.'
      : anteriores.length
        ? `A maior parte das perguntas é da página ${alvo}, e algumas são das páginas anteriores (${anteriores.join(', ')}) para não te esqueceres.`
        : `Todas as perguntas são da página ${alvo}.`;

    render(`
      <section class="cartao centro">
        <a href="#/t/${a.id}" class="voltar">← ${esc(nomeAvaliacao(a))}</a>
        <h1>${titulo}</h1>
        <p>${explica}</p>
        <h2>Escolhe a dificuldade</h2>
        <div class="dificuldades">
          ${Object.entries(DIFICULDADES).map(([k, d]) => `
            <button class="dif" data-dif="${k}">
              <span class="estrelas">${d.estrelas}</span>
              <b>${d.nome}</b>
              <span class="muted">${d.desc}</span>
            </button>`).join('')}
        </div>
      </section>`);

    $app.querySelectorAll('[data-dif]').forEach(bt => bt.onclick = () => {
      if (alvo != null) A.marcarEstudada(a.livro, alvo);
      const dificuldade = bt.dataset.dif;
      teste = {
        avaliacao: a, livro: a.livro, alvo, paginas, dificuldade, inicio: new Date().toISOString(),
        perguntas: Motor.gerar({ perguntas: livros[a.livro].perguntas, historico: A.estado.historico, paginas, alvo, dificuldade }),
        indice: 0, respostas: [], ajuda: false, respondida: null,
      };
      location.hash = '#/teste';
    });
  }

  // ---------- pergunta ----------
  function ecraPergunta() {
    const q = teste.perguntas[teste.indice];
    const pg = pagina(teste.livro, q.pagina);
    const r = teste.respondida;
    const total = teste.perguntas.length;

    const opcoes = q.opcoes.map((o, i) => {
      let cls = '';
      if (r != null) cls = i === q.correta ? 'certa' : i === r ? 'errada' : 'apagada';
      return `<button class="opcao ${cls}" data-op="${i}" ${r != null ? 'disabled' : ''}><span class="letra">${'abcd'[i]})</span> ${esc(o)}</button>`;
    }).join('');

    const blocoPagina = `
      <div class="ajuda-pagina">
        <img src="${img(teste.livro, pg)}" alt="Página ${q.pagina}" data-ampliar="${img(teste.livro, pg)}">
        <div><b>📍 Procura na página ${q.pagina}:</b><br>${esc(q.onde)}<br><span class="muted">Clica na página para a ver em grande.</span></div>
      </div>`;

    let feedback = '';
    if (r != null) {
      const certa = r === q.correta;
      feedback = `
        <div class="feedback ${certa ? 'bom' : 'mau'}">
          <h3>${certa ? (teste.ajuda ? '👍 Certo, com ajuda!' : '🎉 Muito bem!') : '💪 Não faz mal, vamos ver onde está.'}</h3>
          ${certa ? '' : `<p><b>Resposta certa:</b> ${esc(q.opcoes[q.correta])}</p>`}
          <p>${esc(q.explicacao)}</p>
          ${certa ? '' : blocoPagina}
          <button class="btn prim grande" id="seguinte">${teste.indice + 1 < total ? 'Seguinte →' : 'Ver resultado 🏁'}</button>
        </div>`;
    } else if (teste.ajuda) {
      feedback = `<div class="feedback ajuda">${blocoPagina}</div>`;
    }

    render(`
      <section class="cartao teste">
        <div class="teste-topo">
          <span>Pergunta ${teste.indice + 1} de ${total}</span>
          <span class="nivel n${q.nivel}" title="Nível de dificuldade">${NIVEL[q.nivel]}</span>
        </div>
        <div class="progresso"><div style="width:${pct(teste.indice, total)}%"></div></div>
        <h2 class="enunciado">${esc(q.pergunta)}</h2>
        <div class="opcoes">${opcoes}</div>
        ${r == null && !teste.ajuda ? '<button class="btn ajuda-btn" id="ajuda">💡 Preciso de ajuda</button>' : ''}
        ${feedback}
      </section>`);

    $app.querySelectorAll('[data-op]').forEach(bt => bt.onclick = () => responder(+bt.dataset.op));
    document.getElementById('ajuda')?.addEventListener('click', () => { teste.ajuda = true; ecraPergunta(); });
    document.getElementById('seguinte')?.addEventListener('click', seguinte);
  }

  function responder(i) {
    const q = teste.perguntas[teste.indice];
    teste.respondida = i;
    teste.respostas.push({ id: q.id, pagina: q.pagina, nivel: q.nivel, certa: i === q.correta, ajuda: teste.ajuda });
    ecraPergunta();
  }

  function seguinte() {
    if (teste.registo) return; // evita gravar o mesmo teste duas vezes (duplo clique)
    teste.indice++;
    teste.ajuda = false;
    teste.respondida = null;
    if (teste.indice < teste.perguntas.length) return ecraPergunta();

    // Certa sem ajuda = 1 ponto; certa com ajuda = meio ponto.
    const pontos = teste.respostas.reduce((s, r) => s + (r.certa ? (r.ajuda ? 0.5 : 1) : 0), 0);
    const porNivel = {};
    teste.respostas.forEach(r => { const n = porNivel[r.nivel] ||= { certas: 0, total: 0 }; n.total++; if (r.certa && !r.ajuda) n.certas++; });
    const a = teste.avaliacao;
    teste.registo = {
      data: new Date().toISOString(), disciplina: a.disciplina, livro: a.livro,
      avaliacao: a.id, avaliacaoNome: nomeAvaliacao(a),
      tipo: teste.alvo == null ? 'global' : 'pagina', pagina: teste.alvo,
      paginas: [teste.paginas[0], teste.paginas[teste.paginas.length - 1]],
      dificuldade: teste.dificuldade, total: teste.respostas.length, pontos,
      percent: pct(pontos, teste.respostas.length), porNivel, respostas: teste.respostas,
    };
    A.registarTeste(teste.registo);
    location.hash = '#/resultado';
  }

  // ---------- resultado ----------
  function ecraResultado() {
    const t = teste.registo;
    const mensagem = t.percent >= 90 ? '🌟 Excelente!' : t.percent >= 70 ? '😀 Muito bem!' : t.percent >= 50 ? '🙂 Estás quase lá!' : '💪 Vale a pena rever esta matéria.';
    const erradas = teste.perguntas.filter((q, i) => !teste.respostas[i].certa || teste.respostas[i].ajuda);

    render(`
      <section class="cartao centro">
        <h1>${mensagem}</h1>
        <div class="nota ${t.percent >= 70 ? 'bom' : t.percent >= 50 ? 'medio' : 'mau'}">${t.percent}%</div>
        <p>${t.pontos} pontos em ${t.total} perguntas · Dificuldade: ${DIFICULDADES[t.dificuldade].nome}</p>
        <div class="niveis">
          ${[1, 2, 3].filter(n => t.porNivel[n]).map(n => `<span class="chip">${NIVEL[n]} ${t.porNivel[n].certas}/${t.porNivel[n].total}</span>`).join('')}
        </div>
        ${erradas.length ? `
          <h2>Para rever</h2>
          <ul class="rever">
            ${erradas.map(q => `<li><b>${esc(q.pergunta)}</b><br>✔ ${esc(q.opcoes[q.correta])}<br><span class="muted">📍 Página ${q.pagina}: ${esc(q.onde)}</span></li>`).join('')}
          </ul>` : '<p>Acertaste tudo sem ajuda! 🎉</p>'}
        <div class="linha-botoes">
          <a class="btn prim" href="#/testar/${t.avaliacao}/${t.pagina ?? 'global'}">🔁 Repetir</a>
          ${t.pagina ? `<a class="btn" href="#/estudar/${t.livro}/${t.pagina}/${t.avaliacao}">📖 Rever a página</a>` : ''}
          <a class="btn" href="#/t/${t.avaliacao}">Voltar ao teste</a>
        </div>
      </section>`);
  }

  // ---------- gerir testes (pai) ----------
  function ecraGerir(did, editar) {
    const d = disciplinas[did];
    const avs = avaliacoesDe(did);
    const lista = avs.length ? `
      <table>
        <thead><tr><th>Teste</th><th>Data</th><th>Matéria</th><th></th></tr></thead>
        <tbody>${avs.map(a => `
          <tr>
            <td><b>${esc(nomeAvaliacao(a))}</b></td>
            <td>${a.data ? new Date(a.data + 'T12:00').toLocaleDateString('pt-PT') : '—'}</td>
            <td>${esc(livros[a.livro]?.titulo || a.livro)}, págs. ${a.de}–${a.ate}</td>
            <td class="acoes-tabela"><a class="btn" href="#/gerir/${did}/${a.id}">Editar</a> <button class="btn" data-apagar="${a.id}">Apagar</button></td>
          </tr>`).join('')}</tbody>
      </table>` : '<p class="muted">Ainda não há testes.</p>';

    let formulario = '';
    if (editar) {
      const a = editar === 'novo' ? null : avaliacao(editar);
      const periodo = a?.periodo || 1;
      const v = a || {
        periodo, nome: `${avs.filter(x => x.periodo === periodo).length + 1}.º Teste`, data: '',
        livro: d.livros[0], de: livros[d.livros[0]].paginas[0].numero, ate: livros[d.livros[0]].paginas.at(-1).numero,
      };
      formulario = `
        <form id="form-teste" class="form-teste cartao">
          <h2>${a ? 'Editar teste' : 'Novo teste'}</h2>
          <div class="campos">
            <label>Período<select name="periodo">${[1, 2, 3].map(p => `<option value="${p}" ${p === v.periodo ? 'selected' : ''}>${p}.º Período</option>`).join('')}</select></label>
            <label>Nome<input name="nome" required value="${esc(v.nome)}" placeholder="1.º Teste"></label>
            <label>Data do teste<input name="data" type="date" value="${esc(v.data || '')}"></label>
            <label>Livro<select name="livro">${d.livros.map(lid => `<option value="${lid}" ${lid === v.livro ? 'selected' : ''}>${esc(livros[lid].titulo)}</option>`).join('')}</select></label>
            <label>Da página<select name="de"></select></label>
            <label>À página<select name="ate"></select></label>
          </div>
          <p class="erro" id="erro-form" hidden></p>
          <div class="linha-botoes esquerda">
            <button class="btn prim">Guardar</button>
            <a class="btn" href="#/gerir/${did}">Cancelar</a>
          </div>
        </form>`;
      setTimeout(() => prepararFormulario(did, a, v), 0);
    }

    render(`
      <section class="cartao">
        <a href="#/d/${did}" class="voltar">← ${esc(d.nome)}</a>
        <div class="seccao-topo"><h1>Gerir testes de ${esc(d.nome)}</h1>${editar ? '' : `<a class="btn prim" href="#/gerir/${did}/novo">➕ Novo teste</a>`}</div>
        <p class="muted">Para cada teste da escola, indica o período, a data e as páginas do livro que saem.</p>
        ${formulario}
        ${lista}
      </section>`);

    $app.querySelectorAll('[data-apagar]').forEach(bt => bt.onclick = async () => {
      const a = avaliacao(bt.dataset.apagar);
      if (!confirm(`Apagar "${nomeAvaliacao(a)}"? Os resultados já feitos ficam guardados no painel.`)) return;
      try { await A.apagarAvaliacao(a.id); ecraGerir(did); } catch (e) { alert('Não foi possível apagar: ' + e.message); }
    });
  }

  function prepararFormulario(did, a, v) {
    const f = document.getElementById('form-teste');
    if (!f) return;
    const preencherPaginas = (de, ate) => {
      const nums = livros[f.livro.value].paginas.map(p => p.numero);
      const opts = sel => nums.map(n => `<option value="${n}" ${n === sel ? 'selected' : ''}>${n}</option>`).join('');
      f.de.innerHTML = opts(de ?? nums[0]);
      f.ate.innerHTML = opts(ate ?? nums.at(-1));
    };
    preencherPaginas(v.de, v.ate);
    f.livro.onchange = () => preencherPaginas();
    f.onsubmit = async e => {
      e.preventDefault();
      const de = +f.de.value, ate = +f.ate.value;
      try {
        await A.guardarAvaliacao({
          id: a?.id, disciplina: did, periodo: +f.periodo.value, nome: f.nome.value.trim(),
          data: f.data.value, livro: f.livro.value, de: Math.min(de, ate), ate: Math.max(de, ate),
        });
        location.hash = `#/gerir/${did}`;
      } catch (erro) {
        const $e = document.getElementById('erro-form');
        $e.textContent = 'Não foi possível guardar: ' + erro.message;
        $e.hidden = false;
      }
    };
  }

  // ---------- painel ----------
  function ecraPainel() {
    const e = A.estado;
    const hoje = A.hoje();
    const dias = [...Array(7)].map((_, i) => { const d = new Date(); d.setDate(d.getDate() - 6 + i); return d.toLocaleDateString('sv'); });
    const tempoSemana = dias.reduce((s, d) => s + (e.tempoPorDia[d] || 0), 0);
    const tempoTotal = Object.values(e.tempoPorDia).reduce((s, v) => s + v, 0);
    const maxDia = Math.max(60, ...dias.map(d => e.tempoPorDia[d] || 0));
    const media = e.testes.length ? Math.round(e.testes.reduce((s, t) => s + t.percent, 0) / e.testes.length) : null;

    const porNivel = { 1: { c: 0, t: 0 }, 2: { c: 0, t: 0 }, 3: { c: 0, t: 0 } };
    e.testes.forEach(t => t.respostas.forEach(r => { porNivel[r.nivel].t++; if (r.certa && !r.ajuda) porNivel[r.nivel].c++; }));

    const todasPerguntas = Object.values(livros).flatMap(l => l.perguntas);
    const dificeis = Object.entries(e.historico).filter(([, h]) => h.erradas > 0)
      .sort((a, b) => (b[1].erradas - b[1].certas) - (a[1].erradas - a[1].certas)).slice(0, 5)
      .map(([qid, h]) => ({ q: todasPerguntas.find(q => q.id === qid), h })).filter(x => x.q);

    const testesEscola = A.estado.avaliacoes.map(a => {
      const { total, estudadas } = progressoAvaliacao(a);
      const feitos = e.testes.filter(t => String(t.avaliacao) === String(a.id));
      const nota = melhorNota(t => String(t.avaliacao) === String(a.id) && t.tipo === 'global');
      return `<tr><td><b>${esc(disciplinas[a.disciplina]?.nome || a.disciplina)}</b> · ${esc(nomeAvaliacao(a))}</td><td>${a.data ? new Date(a.data + 'T12:00').toLocaleDateString('pt-PT') : '—'}</td>
        <td>${estudadas}/${total}</td><td>${feitos.length}</td><td>${nota != null ? nota + '%' : '—'}</td></tr>`;
    }).join('');

    const tabelasPaginas = Object.values(livros).map(l => `
      <h3>${esc(disciplinas[l.disciplina].nome)} · ${esc(l.titulo)}</h3>
      <table>
        <thead><tr><th>Página</th><th>Estudada</th><th>Tempo</th><th>Testes</th><th>Melhor nota</th></tr></thead>
        <tbody>${l.paginas.map(pg => {
          const info = A.infoPagina(l.id, pg.numero);
          const nTestes = e.testes.filter(t => t.livro === l.id && t.pagina === pg.numero).length;
          const nota = melhorNotaPagina(l.id, pg.numero);
          return `<tr><td>${pg.numero} · ${esc(pg.titulo)}</td><td>${info.estudada ? '✓' : '—'}</td><td>${fmt(info.segundos)}</td><td>${nTestes}</td><td>${nota != null ? nota + '%' : '—'}</td></tr>`;
        }).join('')}</tbody>
      </table>`).join('');

    render(`
      <section class="cartao">
        <h1>Painel de estudo</h1>
        <div class="kpis">
          <div class="kpi"><span>Hoje</span><b>${fmt(e.tempoPorDia[hoje] || 0)}</b></div>
          <div class="kpi"><span>Últimos 7 dias</span><b>${fmt(tempoSemana)}</b></div>
          <div class="kpi"><span>Total</span><b>${fmt(tempoTotal)}</b></div>
          <div class="kpi"><span>Testes feitos</span><b>${e.testes.length}</b></div>
          <div class="kpi"><span>Média dos testes</span><b>${media != null ? media + '%' : '—'}</b></div>
        </div>

        <h2>Tempo de estudo (últimos 7 dias)</h2>
        <div class="barras">
          ${dias.map(d => `<div class="barra-dia"><div class="b" style="height:${pct(e.tempoPorDia[d] || 0, maxDia)}%" title="${fmt(e.tempoPorDia[d] || 0)}"></div>
            <span>${new Date(d + 'T12:00').toLocaleDateString('pt-PT', { weekday: 'short' })}</span><small>${fmt(e.tempoPorDia[d] || 0)}</small></div>`).join('')}
        </div>

        <h2>Testes da escola</h2>
        ${testesEscola ? `<table>
          <thead><tr><th>Teste</th><th>Data</th><th>Páginas estudadas</th><th>Treinos feitos</th><th>Melhor global</th></tr></thead>
          <tbody>${testesEscola}</tbody></table>` : '<p class="muted">Ainda não há testes marcados.</p>'}

        <h2>Acertos por nível</h2>
        <div class="niveis">
          ${[1, 2, 3].map(n => `<span class="chip">${NIVEL[n]} ${porNivel[n].t ? pct(porNivel[n].c, porNivel[n].t) + '%' : '—'} <small class="muted">(${porNivel[n].c}/${porNivel[n].t})</small></span>`).join('')}
        </div>

        <h2>Páginas</h2>
        ${tabelasPaginas}

        <h2>Últimos treinos</h2>
        ${e.testes.length ? `<table>
          <thead><tr><th>Data</th><th>Teste da escola</th><th>Treino</th><th>Dificuldade</th><th>Nota</th></tr></thead>
          <tbody>${[...e.testes].reverse().slice(0, 15).map(t => `<tr><td>${dataCurta(t.data)}</td>
            <td>${esc(t.avaliacaoNome || '—')}</td>
            <td>${t.tipo === 'global' ? `Global (págs. ${t.paginas[0]}–${t.paginas[1]})` : `Página ${t.pagina}`}</td>
            <td>${DIFICULDADES[t.dificuldade].nome}</td><td><b>${t.percent}%</b> <small class="muted">(${t.pontos}/${t.total})</small></td></tr>`).join('')}</tbody>
        </table>` : '<p class="muted">Ainda não há treinos.</p>'}

        <h2>Perguntas que custam mais</h2>
        ${dificeis.length ? `<ul class="rever">${dificeis.map(({ q, h }) => `<li><b>${esc(q.pergunta)}</b><br><span class="muted">Página ${q.pagina} · ${NIVEL[q.nivel]} · ${h.erradas} vez(es) errada ou com ajuda, ${h.certas} certa(s)</span></li>`).join('')}</ul>` : '<p class="muted">Ainda não há dados.</p>'}

        <p><button class="btn" id="exportar">⬇️ Guardar cópia do progresso</button></p>
      </section>`);
    document.getElementById('exportar').onclick = A.exportar;
  }

  // ---------- entrar ----------
  function ecraLogin(mensagem = '') {
    render(`
      <section class="cartao centro login">
        <h1>👋 Olá!</h1>
        <p>Entra com a tua conta para estudar.</p>
        <form id="login">
          <label>Email<input type="email" id="email" autocomplete="username" required></label>
          <label>Palavra-passe<input type="password" id="pass" autocomplete="current-password" required></label>
          ${mensagem ? `<p class="erro">${esc(mensagem)}</p>` : ''}
          <button class="btn prim grande">Entrar</button>
        </form>
      </section>`);
    document.getElementById('login').onsubmit = async e => {
      e.preventDefault();
      const { error } = await db.auth.signInWithPassword({
        email: document.getElementById('email').value.trim(),
        password: document.getElementById('pass').value,
      });
      if (error) return ecraLogin('Email ou palavra-passe errados.');
      location.hash = '#/';
      iniciar();
    };
  }

  $sair.onclick = async () => { A.enviarTempo(); await db.auth.signOut(); location.reload(); };

  // ---------- arranque ----------
  // Com Supabase: a matéria vem do espaço privado, com links temporários para as imagens.
  // Em modo local: vem das pastas ao lado da app.
  async function lerJson(caminho) {
    if (!db) return (await fetch('../' + caminho)).json();
    const { data, error } = await db.storage.from(BUCKET).download(caminho);
    if (error) throw error;
    return JSON.parse(await data.text());
  }

  async function carregarLivro(info, disciplina) {
    const bancos = await Promise.all(info.bancos.map(lerJson));
    const paginas = bancos.flatMap(b => b.paginas.map(p => ({ ...p, capitulo: b.capitulo })));
    const perguntas = bancos.flatMap(b => b.perguntas);
    let url = f => '../' + info.base + f;
    if (db) {
      const caminhos = paginas.flatMap(p => [p.imagem, p.video].filter(Boolean)).map(f => info.base + f);
      const assinados = await db.storage.from(BUCKET).createSignedUrls(caminhos, 60 * 60 * 12);
      if (assinados.error) throw assinados.error;
      const urls = Object.fromEntries(assinados.data.map(s => [s.path, s.signedUrl]));
      url = f => urls[info.base + f];
    }
    return { ...info, disciplina, paginas: paginas.sort((a, b) => a.numero - b.numero), perguntas, url };
  }

  async function iniciar() {
    if (db) {
      const { data } = await db.auth.getSession();
      if (!data.session) return ecraLogin();
      $sair.hidden = false;
    }
    try {
      await A.iniciar(db);
      const catalogo = await (await fetch('catalogo.json')).json();
      for (const d of catalogo.disciplinas) {
        disciplinas[d.id] = { ...d, livros: d.livros.map(l => l.id) };
        for (const l of d.livros) livros[l.id] = await carregarLivro(l, d.id);
      }
    } catch (erro) {
      render(`<section class="cartao"><h1>Não consegui carregar a matéria</h1><p class="muted">${esc(erro.message)}</p></section>`);
      return;
    }
    pronto = true;
    addEventListener('hashchange', rota);
    atualizarRelogio();
    rota();
  }

  iniciar();
})();
