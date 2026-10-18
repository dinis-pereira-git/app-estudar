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
  let contaAtual = ''; // email da conta com que se entrou (mostrado no painel)

  const disciplinas = {};    // id → { id, nome, nomeCompleto, icone, livros: [ids] }
  const livros = {};         // id → { id, titulo, descricao, disciplina, paginas, perguntas, url(ficheiro) }
  let contexto = null;       // { livro, pagina } enquanto estuda uma página (conta tempo por página)
  let teste = null;          // teste em curso
  let pronto = false;        // matéria e progresso carregados

  const DIFICULDADES = {
    facil:   { nome: 'Fácil',   desc: 'Só perguntas fáceis: o que está destacado no livro', estrelas: '★' },
    medio:   { nome: 'Médio',   desc: 'Perceber e relacionar ideias, com algumas fáceis',   estrelas: '★★' },
    dificil: { nome: 'Difícil', desc: 'Deduzir e explicar, com médias e fáceis pelo meio',  estrelas: '★★★' },
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
  // O livro inteiro também funciona como "teste" (id "L-<livro>"), para se poder testar logo depois de estudar.
  function avaliacaoLivro(lid) {
    const l = livros[lid];
    if (!l) return null;
    const nums = l.paginas.map(p => p.numero);
    return { id: 'L-' + lid, livro: lid, disciplina: l.disciplina, de: Math.min(...nums), ate: Math.max(...nums), nome: l.titulo, livroInteiro: true };
  }
  const avaliacao = id => String(id).startsWith('L-') ? avaliacaoLivro(String(id).slice(2)) : A.estado.avaliacoes.find(a => String(a.id) === String(id));
  const nomeAvaliacao = a => a.livroInteiro ? `📕 ${a.nome}` : `${a.periodo}.º Período · ${a.nome}`;
  const paginasDaAvaliacao = a => (livros[a.livro]?.paginas || []).map(p => p.numero).filter(n => n >= a.de && n <= a.ate);
  // Uma lição = as páginas de um vídeo (normalmente 2). Estuda-se, marca-se e testa-se lição a lição.
  function licaoDe(lid, n, a) {
    const licao = livros[lid].licoes.find(x => x.paginas.includes(n)) || { titulo: pagina(lid, n)?.titulo || `Página ${n}`, paginas: [n] };
    const dentro = a ? paginasDaAvaliacao(a) : null;
    return { ...licao, nums: licao.paginas.filter(p => pagina(lid, p) && (!dentro || dentro.includes(p))) };
  }
  const licaoEstudada = (lid, nums) => nums.every(p => A.infoPagina(lid, p).estudada);
  const intervalo = nums => nums.length > 1 ? `páginas ${nums[0]} a ${nums.at(-1)}` : `página ${nums[0]}`;
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
    const ts = A.estado.testes.filter(t => t.percent != null && filtro(t));
    return ts.length ? Math.max(...ts.map(t => t.percent)) : null;
  }
  // Respostas que deixam de contar no progresso porque as perguntas mudaram e o pai pediu para repetir.
  // 17/10/2026: opções de escolha múltipla reescritas (a certa era quase sempre a mais longa) → as difíceis repetem-se.
  // Não se apaga nada; só se ignoram as respostas anteriores à data.
  const REPOSICOES = [{ estilo: 'escolha', nivel: 3, ate: '2026-10-17T19:58:00Z' }];
  const anulada = (t, r) => REPOSICOES.some(x => t.data < x.ate && estiloDe(r) === x.estilo && r.nivel === x.nivel);
  const testeAnulado = t => REPOSICOES.some(x => t.data < x.ate && x.estilo === 'escolha' && t.modo === 'rapido' && NIVEL_DE[t.dificuldade] === x.nivel);

  // Conta também os testes antigos, que eram por página.
  const melhorNotaLicao = (lid, nums) => melhorNota(t => t.livro === lid && t.tipo !== 'global' && !testeAnulado(t) && nums.includes(t.pagina));

  // Progressão por níveis: um nível da lição fica "dominado" com 80% ou mais num teste desse nível.
  // A app sugere o nível seguinte (aconselha, não obriga).
  const DOMINIO = 80;
  const NIVEL_DE = { facil: 1, medio: 2, dificil: 3 };
  const DIF_DE = { 1: 'facil', 2: 'medio', 3: 'dificil' };
  function nivelDominado(lid, nums) {
    return A.estado.testes.reduce((max, t) => t.livro === lid && t.tipo !== 'global' && !testeAnulado(t) && nums.includes(t.pagina)
      && t.percent >= DOMINIO && NIVEL_DE[t.dificuldade] > max ? NIVEL_DE[t.dificuldade] : max, 0);
  }
  // Progresso de um teste da escola: lições estudadas, níveis dominados e, ao ritmo atual,
  // quando fica a matéria toda estudada (ritmo = lições acabadas por dia desde o primeiro dia de estudo).
  function progressoTeste(a) {
    const grupos = gruposLicoes(a.livro, paginasDaAvaliacao(a));
    const total = grupos.length;
    const estudadas = grupos.filter(g => licaoEstudada(a.livro, g.nums));
    const pn = Object.values(progressoNiveis(a.livro, paginasDaAvaliacao(a)));
    const totalPerg = pn.reduce((s, c) => s + c.total, 0), certasPerg = pn.reduce((s, c) => s + c.certas, 0);
    const datas = grupos.flatMap(g => g.nums.map(n => A.infoPagina(a.livro, n).data)).filter(Boolean).sort();
    const dia = iso => new Date(iso.slice(0, 10) + 'T12:00');
    const hoje = dia(A.hoje());
    const falta = total - estudadas.length;
    const diasAteTeste = a.data ? Math.round((dia(a.data) - hoje) / 86400000) : null;
    let ritmo = null, fim = null;
    if (estudadas.length && datas.length) {
      const dias = Math.max(1, Math.round((hoje - dia(datas[0])) / 86400000) + 1);
      ritmo = estudadas.length / dias;
      if (falta > 0) { fim = new Date(hoje); fim.setDate(fim.getDate() + Math.ceil(falta / ritmo)); }
    }
    return {
      total, estudadas: estudadas.length, falta, ritmo, fim, diasAteTeste,
      pctEstudado: pct(estudadas.length, total), pctDominado: pct(certasPerg, totalPerg),
      // para acabar na véspera do teste
      porDia: falta > 0 && diasAteTeste > 1 ? falta / (diasAteTeste - 1) : null,
    };
  }
  // Progresso por estilo e nível: % das perguntas desse nível que ela já acertou SEM ajuda, pelo menos
  // uma vez (assim só sobe se praticar perguntas diferentes). As certas só com ajuda contam à parte (💡).
  // Respostas que o pai, na revisão, marcou como mal autoavaliadas não contam como certas.
  const ESTILOS = { escola: '✍️ Tipo escola (escrita)', escolha: '⚡ Escolha múltipla' };
  const estiloDe = r => r.modo === 'escolha' ? 'escolha' : 'escola';
  function progressoNiveis(lid, nums) {
    const qs = livros[lid].perguntas.filter(q => nums.includes(q.pagina));
    const novo = () => ({ escola: new Set(), escolha: new Set() });
    const certas = novo(), ajuda = novo(), pend = novo();
    // Num teste ainda por rever, as respostas que ela própria se deu como certas ficam "provisórias" (pend):
    // aparecem com outra cor até a revisão as confirmar.
    A.estado.testes.forEach(t => t.livro === lid && !porCorrigir(t) && t.respostas.forEach(r => {
      if (r.certa && r.auditoria !== 'mal' && !anulada(t, r)) (r.ajuda ? ajuda : certas)[estiloDe(r)].add(r.id);
    }));
    A.estado.testes.forEach(t => t.livro === lid && t.modo === 'escola' && porCorrigir(t) && t.respostas.forEach(r => {
      if (!r.certa) return;
      const auto = autoavaliadas({ respostas: [r] }).length;
      (r.ajuda ? ajuda : auto ? pend : certas)[estiloDe(r)].add(r.id);
    }));
    const res = {};
    for (const e of Object.keys(ESTILOS)) for (const n of [1, 2, 3]) {
      const lista = qs.filter(q => q.nivel === n && (e === 'escolha' ? q.opcoes : q.escrita));
      res[e + n] = {
        total: lista.length,
        certas: lista.filter(q => certas[e].has(q.id)).length,
        pend: lista.filter(q => !certas[e].has(q.id) && pend[e].has(q.id)).length,
        ajuda: lista.filter(q => !certas[e].has(q.id) && !pend[e].has(q.id) && ajuda[e].has(q.id)).length,
      };
    }
    return res;
  }

  // Célula das tabelas de progresso (painel e mini-tabela das lições). Se há respostas autoavaliadas
  // ainda por rever, mostra a % provisória (com elas) noutra cor, com ✋.
  function celulaNivel(c, compacta) {
    if (!c.total) return '<td class="muted">—</td>';
    const v = pct(c.certas, c.total), vp = pct(c.certas + (c.pend || 0), c.total);
    const prov = c.pend > 0;
    const titulo = `${c.certas} de ${c.total} perguntas certas sem ajuda` + (prov ? `; mais ${c.pend} que ela deu como certas, à espera de revisão (sem elas: ${v}%)` : '') + (c.ajuda ? `; mais ${c.ajuda} só com ajuda` : '');
    return `<td class="cel-nivel ${corPct(prov ? vp : v)}${prov ? ' provisorio' : ''}" title="${titulo}">${prov ? vp : v}%${prov ? '<sup>✋</sup>' : ''}${c.ajuda ? (compacta ? '<sup>💡</sup>' : `<small> +${c.ajuda}💡</small>`) : ''}</td>`;
  }
  // Coluna "Misto": melhor nota dos testes mistos da lição, por estilo (✍️ escola / ⚡ rápido).
  // Usa a nota final; se só houver testes por rever, mostra a autoavaliação a roxo ✋.
  function celulaMisto(lid, nums, estilo) {
    const modo = estilo === 'escolha' ? 'rapido' : 'escola';
    const ts = A.estado.testes.filter(t => t.livro === lid && t.dificuldade === 'misto' && t.modo === modo && t.tipo !== 'global'
      && !testeAnulado(t) && nums.includes(t.pagina));
    if (!ts.length) return '<td class="muted" title="Ainda não fizeste um teste misto desta lição neste estilo">—</td>';
    const finais = ts.filter(t => t.percent != null).map(t => t.percent);
    const provis = ts.filter(t => t.percent == null && t.autoPercent != null).map(t => t.autoPercent);
    const v = finais.length ? Math.max(...finais) : Math.max(...provis);
    const prov = !finais.length;
    return `<td class="cel-nivel misto ${corPct(v)}${prov ? ' provisorio' : ''}" title="Melhor nota em ${ts.length} teste(s) misto(s)${prov ? ' — autoavaliação, à espera de revisão' : ''}">${v}%${prov ? '<sup>✋</sup>' : ''}</td>`;
  }
  function celulaMedia(p, estilo) {
    const m = mediaEstilo(p, estilo), mp = mediaEstilo(p, estilo, true);
    if (m == null) return '<td class="muted">—</td>';
    const prov = mp !== m;
    return `<td class="cel-nivel media ${corPct(prov ? mp : m)}${prov ? ' provisorio' : ''}" title="Média dos 3 níveis${prov ? ` (provisória; sem as respostas por rever: ${m}%)` : ''}">${prov ? mp : m}%${prov ? '<sup>✋</sup>' : ''}</td>`;
  }
  const comAjuda = t => t.respostas.filter(r => r.ajuda).length;

  // ---------- perguntas que custam ----------
  // Para cada pergunta, as tentativas por ordem (de todos os treinos). Uma tentativa é "boa" se acertou
  // sem ajuda (e o pai/Claude não desmentiu a autoavaliação). Respostas autoavaliadas ainda por rever não contam.
  function tentativasPorPergunta(ate) {
    const m = {};
    for (const t of A.estado.testes) {
      if (t.modo === 'real' && t.estado !== 'corrigido') continue;
      if (ate && t.data > ate) continue;
      for (const r of t.respostas) {
        if (porCorrigir(t) && autoavaliadas({ respostas: [r] }).length) continue;
        if (anulada(t, r)) continue;
        (m[r.id] ||= []).push({ data: t.data, boa: !!r.certa && !r.ajuda && r.auditoria !== 'mal', ajuda: !!r.ajuda, estilo: estiloDe(r) });
      }
    }
    return m;
  }
  // Estado de uma pergunta que já falhou alguma vez:
  //   'custa'     – a última tentativa foi errada ou com ajuda
  //   'melhorar'  – acertou as últimas 1 ou 2 vezes, mas ainda não 3 seguidas
  //   'resolvida' – acertou as últimas 3 vezes seguidas sem ajuda
  const SEGUIDAS = 3;
  function estadoPergunta(ts) {
    if (!ts?.some(x => !x.boa)) return null; // nunca falhou: não é "difícil"
    let seguidas = 0;
    for (let i = ts.length - 1; i >= 0 && ts[i].boa; i--) seguidas++;
    return seguidas >= SEGUIDAS ? 'resolvida' : seguidas > 0 ? 'melhorar' : 'custa';
  }
  const ESTADO_CUSTA = {
    custa: { nome: '🔴 Ainda custa', ordem: 0 },
    melhorar: { nome: '🟡 A melhorar', ordem: 1 },
    resolvida: { nome: '🟢 Já não custa', ordem: 2 },
  };
  // Lista das perguntas difíceis de um conjunto de páginas, das que mais custam para as que menos.
  function perguntasQueCustam(lid, paginas, ate) {
    const tent = tentativasPorPergunta(ate);
    return livros[lid].perguntas.filter(q => !paginas || paginas.includes(q.pagina)).map(q => {
      const ts = tent[q.id] || [];
      const estado = estadoPergunta(ts);
      const ultimas = ts.slice(-5);
      return estado && { q, ts, estado, ultimas, falhasRecentes: ultimas.filter(x => !x.boa).length, falhas: ts.filter(x => !x.boa).length };
    }).filter(Boolean)
      .sort((a, b) => ESTADO_CUSTA[a.estado].ordem - ESTADO_CUSTA[b.estado].ordem || b.falhasRecentes - a.falhasRecentes || b.falhas - a.falhas);
  }
  const bolinhas = ts => ts.map(x => x.boa ? '✅' : x.ajuda ? '💡' : '❌').join('');
  // Respostas escritas em que foi ela a dizer se estava certa (pontos-chave marcados, ou "a minha também está certa").
  const autoavaliadas = t => t.respostas.filter(r => r.autoavaliada || r.corrigidaPelaAluna || (r.modo === 'explica' && r.confirmada));
  // Média de um estilo: média simples das % dos 3 níveis (cada nível pesa o mesmo — não chega fazer só as fáceis).
  function mediaEstilo(p, estilo, provisoria) {
    const vals = [1, 2, 3].map(n => p[estilo + n]).filter(c => c.total).map(c => 100 * (c.certas + (provisoria ? c.pend || 0 : 0)) / c.total);
    return vals.length ? Math.round(vals.reduce((s, v) => s + v, 0) / vals.length) : null;
  }
  const corPct = v => v >= 80 ? 'bom' : v >= 40 ? 'medio' : v > 0 ? 'baixo' : '';
  const difSugerida = (lid, nums) => DIF_DE[Math.min(3, nivelDominado(lid, nums) + 1)];

  function progressoAvaliacao(a) {
    const pags = paginasDaAvaliacao(a);
    const estudadas = pags.filter(n => A.infoPagina(a.livro, n).estudada).length;
    return { total: pags.length, estudadas };
  }

  function ampliar(src, zona) {
    const z = zona ? zona.split(',').map(Number) : null;
    $ampliar.innerHTML = `
      <div class="pagina-marcada grande">
        <img src="${src}" alt="Página ampliada">
        ${z ? `<span class="marca-zona" style="${estiloZona(z)}"></span>` : ''}
      </div>
      <button class="fechar" aria-label="Fechar">✕</button>`;
    $ampliar.hidden = false;
    $ampliar.scrollTop = 0;
    if (z) $ampliar.querySelector('img').onload = () => $ampliar.querySelector('.marca-zona').scrollIntoView({ block: 'center' });
  }
  $ampliar.addEventListener('click', () => { $ampliar.hidden = true; });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') $ampliar.hidden = true; });
  $app.addEventListener('click', e => { const z = e.target.closest('[data-ampliar]'); if (z) ampliar(z.dataset.ampliar, z.dataset.zona); });
  // O recorte só sabe a sua proporção quando a imagem da página carrega.
  $app.addEventListener('load', e => {
    const caixa = e.target.closest?.('.recorte');
    if (!caixa) return;
    const [, , w, h] = caixa.dataset.zona.split(',').map(Number);
    const proporcao = (w * e.target.naturalWidth) / (h * e.target.naturalHeight);
    caixa.style.aspectRatio = proporcao;
    const [larg, alt] = caixa.classList.contains('grande') ? [720, 420] : [560, 340];
    caixa.style.width = Math.min(larg, alt * proporcao) + 'px'; // zonas altas não ficam enormes
  }, true);

  // ---------- tempo de estudo ativo ----------
  // Só conta quando a janela está visível e houve interação nos últimos 2 minutos (ler uma página
  // pode levar isso sem mexer no rato). Enquanto vê o vídeo, os cliques ficam dentro do leitor do
  // Drive e a app não os vê: se o leitor tem o foco (ela clicou no play), conta até 15 minutos.
  // O painel e a gestão de testes não contam (o pai pode estar só a consultar).
  let ultimaInteracao = Date.now();
  ['mousemove', 'keydown', 'click', 'scroll', 'touchstart', 'wheel'].forEach(ev =>
    addEventListener(ev, () => { ultimaInteracao = Date.now(); }, { passive: true }));
  const aVerVideo = () => document.activeElement?.closest?.('.video-drive') != null;
  const atualizarRelogio = () => { $relogio.textContent = `⏱ Hoje: ${fmt(A.estado.tempoPorDia[A.hoje()] || 0)}`; };
  setInterval(() => {
    const naoConta = /^#\/(painel|gerir|revisao)/.test(location.hash);
    const limite = aVerVideo() ? 15 * 60000 : 2 * 60000;
    if (pronto && !naoConta && document.visibilityState === 'visible' && Date.now() - ultimaInteracao < limite) {
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
      const doPai = ecra === 'painel' || ecra === 'revisao';
      el.classList.toggle('ativo', alvo === 'painel' ? doPai : !doPai);
    });
    if (ecra === 'd' && disciplinas[a] && b === 'correcoes') return ecraCorrecoes(c, { did: a });
    if (ecra === 'd' && disciplinas[a]) return ecraDisciplina(a);
    if (ecra === 'l' && livros[a]) return ecraLivro(a);
    if (ecra === 't' && avaliacao(a)?.livroInteiro) return ecraLivro(avaliacao(a).livro);
    if (ecra === 't' && avaliacao(a)) return ecraAvaliacao(avaliacao(a), b === 'correcoes' ? (c || '') : null);
    if (ecra === 'estudar' && livros[a]) return ecraEstudar(a, +b, c && avaliacao(c));
    if (ecra === 'testar' && avaliacao(a) && b === 'custam') return ecraCustam(avaliacao(a));
    if (ecra === 'testar' && avaliacao(a)) return ecraDificuldade(avaliacao(a), b === 'global' ? null : +b);
    if (ecra === 'gerir' && disciplinas[a]) return ecraGerir(a, b);
    if (ecra === 'teste' && teste) return ecraPergunta();
    if (ecra === 'resultado' && teste?.registo) return ecraResultado();
    if (ecra === 'real' && testeReal(a)) return ecraTesteReal(testeReal(a));
    if (ecra === 'painel') return ecraPainel();
    if (ecra === 'revisao') return ecraRevisao(a === 'todas');
    if (ecra === 'correcoes') { location.hash = linkAvisoCorrecoes(Object.keys(disciplinas)[0], a); return; } // endereço antigo
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
        ${avisoCorrecoes()}
        <div class="disciplinas">${cartoes}</div>
      </section>`);
  }

  // ---------- correções (por disciplina e por teste da escola) ----------
  // (a coluna Misto das tabelas usa celulaMisto, definida junto das células de progresso)
  // Depois da revisão, a Leonor vê, dentro de cada disciplina, o que não estava bem: a sua resposta, a nota que deu,
  // a nota final, o comentário e a resposta certa — e diz se concorda com a correção (e, se não, porquê).
  // amb = { did, aval }: disciplina e, opcionalmente, um teste da escola.
  const disciplinaDe = t => t.disciplina || livros[t.livro]?.disciplina;
  // Num teste da escola entram os treinos feitos nele e os treinos do livro dessas mesmas páginas.
  function noAmbito(t, amb = {}) {
    if (amb.did && disciplinaDe(t) !== amb.did) return false;
    if (!amb.aval) return true;
    if (String(t.avaliacao) === String(amb.aval)) return true;
    const a = avaliacao(amb.aval);
    const pags = t.licao || (t.pagina != null ? [t.pagina] : t.paginas || []);
    return !!a && String(t.avaliacao).startsWith('L-') && t.livro === a.livro && pags.length > 0 && pags.every(p => p >= a.de && p <= a.ate);
  }
  const corrigidos = amb => A.estado.testes.filter(t => corrigivel(t) && t.estado === 'corrigido' && noAmbito(t, amb)).reverse();
  const pendentesRevisao = amb => A.estado.testes.filter(t => porCorrigir(t) && noAmbito(t, amb)).reverse();
  const porMelhorar = t => t.respostas.filter(r => r.pontuacao < 1 || r.ajuda);
  // Respostas corrigidas que interessam à Leonor: não estavam a 100%, tiveram ajuda, ou a nota final é diferente da dela.
  const notaDiferente = r => r.pontuacaoAuto != null && Math.abs(r.pontuacaoAuto - (r.pontuacao || 0)) > 0.001;
  const itensCorrecao = amb => corrigidos(amb).flatMap(t => t.respostas.filter(r => r.pontuacao < 1 || r.ajuda || notaDiferente(r)).map(r => ({ t, r })));
  const FILTROS_CORRECAO = {
    rever: { nome: '🔎 Para rever', desc: 'A nota final é diferente da que deste e ainda não disseste se concordas.', f: ({ r }) => notaDiferente(r) && !r.reacao },
    mal: { nome: '❌ Não estavam bem', desc: 'Todas as respostas que não ficaram com 100% (ou em que usaste ajuda).', f: ({ r }) => r.pontuacao < 1 || r.ajuda },
    contestei: { nome: '💬 Que contestei', desc: 'As correções com que não concordaste, e a resposta da revisão.', f: ({ r }) => r.reacao?.concorda === false },
    testes: { nome: '📋 Por teste', desc: 'Nota final de cada teste revisto.' },
  };
  const linkCorrecoes = (amb, filtro = '') => `#/d/${amb.did}/correcoes/${filtro}`;
  // A Leonor prefere ver as correções dentro do teste da escola (ex.: "1.º Período · 1.º Teste"):
  // leva ao teste da escola com correções (primeiro o que tem respostas para ela ver); senão, às da disciplina.
  function linkAvisoCorrecoes(did, filtro = '') {
    const comCorr = avaliacoesDe(did).filter(a => corrigidos({ did, aval: a.id }).length || pendentesRevisao({ did, aval: a.id }).length);
    const a = comCorr.find(a => itensCorrecao({ did, aval: a.id }).some(FILTROS_CORRECAO.rever.f)) || comCorr[0];
    return a ? `#/t/${a.id}/correcoes/${filtro}` : linkCorrecoes({ did }, filtro);
  }
  const pctTxt = v => `${Math.round((v || 0) * 100)}%`;
  const perguntasPorId = () => Object.fromEntries(Object.values(livros).flatMap(l => l.perguntas).map(q => [q.id, q]));

  // Resumo para a página da disciplina e de cada teste da escola.
  function blocoCorrecoes(amb) {
    const itens = itensCorrecao(amb), testes = corrigidos(amb), pend = pendentesRevisao(amb);
    if (!testes.length && !pend.length) return '';
    const n = k => itens.filter(FILTROS_CORRECAO[k].f).length;
    const novos = testes.filter(t => !t.correcao?.vista).length;
    return `
      <div class="global bloco-correcoes ${n('rever') ? 'destaque' : ''}">
        <div><b>📝 Correções</b> ${novos ? `<span class="chip ok">${novos} nova(s)</span>` : ''}<br>
          <span class="muted">${testes.length} teste(s) revisto(s)${pend.length ? ` · ⏳ ${pend.length} à espera de revisão` : ''}${n('rever') ? ` · <b>${n('rever')} resposta(s) com nota diferente da tua para veres</b>` : ''}${n('contestei') ? ` · ${n('contestei')} contestada(s)` : ''}</span></div>
        ${testes.length ? `<a class="btn ${n('rever') ? 'prim' : ''} grande" href="${linkAvisoCorrecoes(amb.did)}">Ver correções</a>` : ''}
      </div>`;
  }

  // Aviso na página inicial: por disciplina, leva às correções dessa disciplina.
  function avisoCorrecoes() {
    return Object.values(disciplinas).map(d => {
      const amb = { did: d.id };
      const novos = corrigidos(amb).filter(t => !t.correcao?.vista).length;
      const paraRever = itensCorrecao(amb).filter(FILTROS_CORRECAO.rever.f).length;
      if (!novos && !paraRever) return '';
      return `
        <div class="cartao aviso-correcoes">
          <div><b>📝 ${esc(d.nome)}: ${novos ? (novos === 1 ? 'um teste teu já foi revisto!' : `${novos} testes teus já foram revistos!`) : 'tens correções para ver.'}</b>
            <span class="muted">${paraRever ? `${paraRever} resposta(s) em que a nota final é diferente da tua — diz se concordas.` : 'Vê a nota final e o que ainda não estava bem.'}</span></div>
          <a class="btn prim" href="${linkAvisoCorrecoes(amb.did)}">Ver correções</a>
        </div>`;
    }).join('');
  }

  // Uma resposta corrigida. editavel = a Leonor pode dizer se concorda; senão (painel do pai) só mostra a reação dela.
  function cartaoRespostaCorrecao({ t, r }, i, perg, editavel, comTeste = true) {
    const q = perg[r.id];
    const modelo = q?.escrita?.modelo || (q?.opcoes ? q.opcoes[q.correta] : '');
    const re = r.reacao;
    let reacaoHtml = '';
    if (!editavel) {
      reacaoHtml = notaDiferente(r) || re ? `<div class="reacao-feita ${re ? (re.concorda ? 'ok' : 'nao') : ''}">${re ? (re.concorda ? '👍 A Leonor concordou com a correção.' : `👎 A Leonor não concordou: «${esc(re.comentario || '')}»${r.respostaRevisao ? '' : ' — à espera de resposta.'}`) : '<span class="muted">A Leonor ainda não disse se concorda.</span>'}</div>` : '';
    } else if (re && !re.editar) {
      reacaoHtml = `
        <div class="reacao-feita ${re.concorda ? 'ok' : 'nao'}">
          ${re.concorda ? '👍 Concordaste com a correção.' : `👎 Não concordaste: «${esc(re.comentario || '')}»`}
          ${!re.concorda && !r.respostaRevisao ? ' <span class="muted">— à espera de resposta da revisão.</span>' : ''}
          <button class="btn mini" data-mudar="${i}">Mudar</button>
        </div>`;
    } else if (notaDiferente(r) || re) {
      reacaoHtml = `
        <div class="reacao">
          <span>Concordas com esta correção?</span>
          <button class="btn" data-concordo="${i}">👍 Concordo</button>
          <button class="btn" data-discordo="${i}">👎 Não concordo</button>
          <div class="reacao-comentario" id="rc-${i}" hidden>
            <textarea rows="2" placeholder="Explica porque achas que a tua resposta estava certa">${esc(re?.comentario || '')}</textarea>
            <button class="btn prim" data-enviar="${i}">Enviar</button>
          </div>
        </div>`;
    }
    const resposta = r.texto ?? (q?.opcoes && r.resposta != null ? q.opcoes[r.resposta] : '');
    return `
      <div class="cartao-revisao item-correcao">
        <div class="seccao-topo"><span class="muted">${comTeste ? `${esc(nomeTreino(t))} · ${dataCurta(t.data)}` : `${NIVEL[r.nivel] || ''}`}</span>${r.ajuda ? '<span class="chip aviso">💡 com ajuda</span>' : ''}</div>
        <p><b>${esc(r.pergunta || q?.pergunta || '')}</b></p>
        <div class="a-tua"><b>${editavel ? 'A tua resposta' : 'Resposta dela'}:</b> ${esc(resposta) || '<i>em branco</i>'}</div>
        <div class="notas-comparar">
          ${r.pontuacaoAuto != null ? `<span>✋ ${editavel ? 'Tu deste' : 'Ela deu'} <b>${pctTxt(r.pontuacaoAuto)}</b></span><span class="seta">→</span>` : ''}
          <span class="nota-final ${r.pontuacao === 1 ? 'bom' : r.pontuacao > 0 ? 'medio' : 'mau'}">Nota final <b>${pctTxt(r.pontuacao)}</b></span>
        </div>
        ${r.comentario ? `<p class="comentario-revisao">💬 ${esc(r.comentario)}</p>` : ''}
        ${modelo && r.pontuacao < 1 ? `<p><b>Resposta certa:</b> ${esc(modelo)}</p>` : ''}
        ${q?.onde && r.pontuacao < 1 ? `<p class="muted">📍 Página ${q.pagina}: ${esc(q.onde)}</p>` : ''}
        ${r.respostaRevisao ? `<p class="comentario-revisao resposta">↩️ Resposta da revisão: ${esc(r.respostaRevisao)}</p>` : ''}
        ${reacaoHtml}
      </div>`;
  }

  // Secção de correções (usada dentro da página de cada teste da escola, e na página de correções da disciplina).
  // link(filtro) dá o endereço de cada filtro, para mudar de filtro sem sair da página onde a Leonor está.
  function seccaoCorrecoes(amb, filtro, link) {
    const itens = itensCorrecao(amb);
    const lista = corrigidos(amb);
    const contagem = k => FILTROS_CORRECAO[k].f ? itens.filter(FILTROS_CORRECAO[k].f).length : lista.length;
    if (!FILTROS_CORRECAO[filtro]) filtro = contagem('rever') ? 'rever' : contagem('mal') ? 'mal' : 'testes';
    const pend = pendentesRevisao(amb);
    const perg = perguntasPorId();
    const cartaoTeste = t => `
      <div class="cartao-revisao">
        <div class="seccao-topo"><b>${t.modo === 'real' ? '🎓' : '✍️'} ${esc(nomeTreino(t))}</b><span class="muted">${dataCurta(t.data)}</span></div>
        <p>${t.autoPercent != null ? `✋ A tua autoavaliação: ${t.autoPercent}% · ` : ''}<b>Nota final: ${t.percent}%</b> ${!t.correcao?.vista ? '<span class="chip ok">Nova</span>' : ''}</p>
        ${t.correcao?.comentarioGeral ? `<div class="feedback ajuda">💬 ${esc(t.correcao.comentarioGeral)}</div>` : ''}
        <p>${porMelhorar(t).length ? `${porMelhorar(t).length} resposta(s) que não estavam bem.` : '🎉 Estava tudo certo!'} <a class="btn" href="#/real/${t.id}">Ver todas as respostas</a></p>
      </div>`;
    const mostrar = FILTROS_CORRECAO[filtro].f ? itens.filter(FILTROS_CORRECAO[filtro].f) : null;
    const html = `
      <div id="correcoes">
        <p class="muted">Depois da revisão, vês aqui a nota final de cada resposta. Quando a nota é diferente da que deste, diz se concordas — e, se não concordas, explica porquê. As perguntas que falhaste entram no treino "🎯 As que mais custam".</p>
        ${pend.length ? `<p>⏳ À espera de revisão: ${pend.map(t => `${esc(nomeTreino(t))} (✋ ${t.autoPercent ?? '—'}%)`).join(', ')}</p>` : ''}
        <div class="filtros-correcao">
          ${Object.entries(FILTROS_CORRECAO).map(([k, f]) => `<a class="filtro ${k === filtro ? 'ativo' : ''}" href="${link(k)}">${f.nome} <span class="contagem">${contagem(k)}</span></a>`).join('')}
        </div>
        <p class="muted">${FILTROS_CORRECAO[filtro].desc}</p>
        ${mostrar
          ? (mostrar.length ? mostrar.map((x, i) => cartaoRespostaCorrecao(x, i, perg, true)).join('') : `<p>${filtro === 'rever' ? '✅ Já viste todas as correções em que a nota era diferente da tua. Muito bem!' : 'Não há respostas aqui.'}</p>`)
          : (lista.length ? lista.map(cartaoTeste).join('') : '<p class="muted">Ainda não há testes revistos.</p>')}
      </div>`;

    // Liga os botões depois de a página estar desenhada; reabrir() volta a desenhar a mesma página.
    const ligar = reabrir => {
      const redesenhar = () => { const y = scrollY; reabrir(); scrollTo(0, y); };
      const guardarReacao = async (i, concorda, comentario = '') => {
        const { t, r } = mostrar[i];
        r.reacao = { concorda, comentario, data: new Date().toISOString() };
        try { await A.guardarRegisto(t); } catch (erro) { alert('Não foi possível guardar: ' + erro.message); }
        redesenhar();
      };
      $app.querySelectorAll('[data-concordo]').forEach(bt => bt.onclick = () => guardarReacao(+bt.dataset.concordo, true));
      $app.querySelectorAll('[data-discordo]').forEach(bt => bt.onclick = () => {
        const caixa = document.getElementById('rc-' + bt.dataset.discordo);
        caixa.hidden = false; caixa.querySelector('textarea').focus();
      });
      $app.querySelectorAll('[data-enviar]').forEach(bt => bt.onclick = () => {
        const caixa = document.querySelector(`#rc-${bt.dataset.enviar} textarea`);
        const txt = caixa.value.trim();
        if (!txt) { caixa.placeholder = 'Escreve primeiro porque não concordas 🙂'; return; }
        guardarReacao(+bt.dataset.enviar, false, txt);
      });
      $app.querySelectorAll('[data-mudar]').forEach(bt => bt.onclick = () => {
        const { r } = mostrar[+bt.dataset.mudar];
        r.reacao = { ...r.reacao, editar: true };
        redesenhar();
      });
      // Marca como vistas as correções novas (para o aviso da página inicial desaparecer).
      lista.filter(t => !t.correcao?.vista).forEach(t => { t.correcao.vista = new Date().toISOString(); A.guardarRegisto(t).catch(() => {}); });
    };
    return { html, ligar };
  }

  // Página de correções de uma disciplina (para os treinos do livro e testes fora de um teste da escola).
  function ecraCorrecoes(filtro, amb) {
    const d = disciplinas[amb.did];
    const sec = seccaoCorrecoes(amb, filtro, k => linkCorrecoes(amb, k));
    render(`
      <section class="cartao">
        <a href="#/d/${d.id}" class="voltar">← ${esc(d.nome)}</a>
        <h1>📝 Correções · ${esc(d.nome)}</h1>
        ${sec.html}
      </section>`);
    sec.ligar(() => ecraCorrecoes(filtro, amb));
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
        ${blocoCorrecoes({ did })}
        <h2>Livros</h2>
        <div class="livros">${livrosHtml}</div>
      </section>`);
  }

  // ---------- lista de lições (usada no teste e no livro) ----------
  function linhaLicao(lid, g, a) {
    const l = livros[lid];
    const titulo = g.licao?.titulo || pagina(lid, g.nums[0]).titulo;
    const nPerg = l.perguntas.filter(q => g.nums.includes(q.pagina)).length;
    const temVideo = g.licao && (g.licao.videoDrive || g.licao.videoDriveCurto);
    return `
      <li class="pag-linha">
        <div class="minis">${g.nums.map(n => { const pg = pagina(lid, n); return `<img src="${img(lid, pg)}" alt="Página ${n}" class="mini" data-ampliar="${img(lid, pg)}">`; }).join('')}</div>
        <div class="pag-info">
          <b>${esc(titulo)}</b> <span class="muted">· ${intervalo(g.nums)}</span>
          <div class="estado">
            ${licaoEstudada(lid, g.nums) ? '<span class="chip ok">✓ Estudada</span>' : '<span class="chip">Por estudar</span>'}
            ${temVideo ? '<span class="chip ok">🎬 Com vídeo</span>' : g.licao?.video ? '<span class="chip">Vídeo em breve</span>' : ''}
            <span class="muted">${nPerg} perguntas</span>
          </div>
        </div>
        <div class="acoes">
          <a class="btn ${a ? '' : 'prim'}" href="#/estudar/${lid}/${g.nums[0]}${a ? '/' + a.id : ''}">📖 Estudar</a>
          ${a ? `<a class="btn prim" href="#/testar/${a.id}/${g.nums[0]}">✏️ Testar</a>` : ''}
        </div>
        ${miniProgresso(lid, g.nums)}
      </li>`;
  }

  // O mesmo progresso da tabela do painel, em pequeno: % das perguntas certas sem ajuda,
  // por estilo (✍️ escrita / ⚡ escolha múltipla) e nível. Mostra o que falta praticar.
  function miniProgresso(lid, nums) {
    const p = progressoNiveis(lid, nums);
    const cel = c => celulaNivel(c, true);
    const media = e => celulaMedia(p, e);
    return `
      <table class="mini-niveis" title="Perguntas certas sem ajuda, por estilo e nível">
        <tr><th></th><th>★</th><th>★★</th><th>★★★</th><th title="Melhor nota nos testes mistos desta lição">Misto</th><th>Média</th></tr>
        <tr><th title="Respostas escritas (como na escola)">✍️</th>${[1, 2, 3].map(n => cel(p['escola' + n])).join('')}${celulaMisto(lid, nums, 'escola')}${media('escola')}</tr>
        <tr><th title="Escolha múltipla">⚡</th>${[1, 2, 3].map(n => cel(p['escolha' + n])).join('')}${celulaMisto(lid, nums, 'escolha')}${media('escolha')}</tr>
      </table>`;
  }

  // ---------- um teste da escola ----------
  // filtroCorrecoes: se vier (#/t/<id>/correcoes/<filtro>), a secção das correções aparece aberta nesta mesma página.
  function ecraAvaliacao(a, filtroCorrecoes) {
    const l = livros[a.livro];
    if (!l) return render(`<section class="cartao"><a href="#/d/${a.disciplina}" class="voltar">← Voltar</a><h1>Livro não encontrado</h1></section>`);
    const pags = paginasDaAvaliacao(a);
    const { total, estudadas } = progressoAvaliacao(a);
    const amb = { did: a.disciplina, aval: a.id };
    const temCorrecoes = corrigidos(amb).length || pendentesRevisao(amb).length;
    const nRever = itensCorrecao(amb).filter(FILTROS_CORRECAO.rever.f).length;
    const novos = corrigidos(amb).filter(t => !t.correcao?.vista).length;
    const aberta = filtroCorrecoes != null;
    const sec = aberta ? seccaoCorrecoes(amb, filtroCorrecoes, k => `#/t/${a.id}/correcoes/${k}`) : null;
    render(`
      <section class="cartao">
        <a href="#/d/${a.disciplina}" class="voltar">← ${esc(disciplinas[a.disciplina]?.nome || 'Voltar')}</a>
        <h1>${esc(nomeAvaliacao(a))}</h1>
        <p class="muted">📅 ${quandoE(a.data)} · 📕 ${esc(l.titulo)}, páginas ${a.de} a ${a.ate}</p>
        <div class="progresso"><div style="width:${pct(estudadas, total)}%"></div></div>
        <p class="muted">${estudadas} de ${total} páginas estudadas. Estuda e testa lição a lição; no fim faz o teste global.</p>
        ${temCorrecoes ? `
          <div class="seccao-correcoes ${nRever ? 'destaque' : ''}" id="sec-correcoes">
            <div class="seccao-topo">
              <div><b>📝 Correções</b> ${novos ? `<span class="chip ok">${novos} nova(s)</span>` : ''} ${nRever ? `<span class="chip aviso">${nRever} para veres</span>` : ''}</div>
              ${aberta ? `<a class="btn" href="#/t/${a.id}">Fechar</a>` : `<a class="btn ${nRever ? 'prim' : ''}" href="#/t/${a.id}/correcoes">Ver correções</a>`}
            </div>
            ${aberta ? sec.html : ''}
          </div>` : ''}
        ${listaPorLicao(a.livro, pags, a)}
        <div class="global">
          <div><b>Teste global</b><br><span class="muted">Todas as páginas deste teste (${a.de} a ${a.ate}), com perguntas de vários níveis.</span></div>
          <a class="btn prim grande" href="#/testar/${a.id}/global">🏁 Fazer teste global</a>
        </div>
        ${blocoCustam(a)}
      </section>`);
    if (aberta) {
      sec.ligar(() => ecraAvaliacao(a, filtroCorrecoes));
      document.getElementById('sec-correcoes')?.scrollIntoView();
    }
  }

  // ---------- livro inteiro ----------
  function ecraLivro(lid) {
    const l = livros[lid];
    render(`
      <section class="cartao">
        <a href="#/d/${l.disciplina}" class="voltar">← ${esc(disciplinas[l.disciplina].nome)}</a>
        <h1>📕 ${esc(l.titulo)}</h1>
        <p class="muted">${esc(l.descricao || '')}. Estuda cada lição e testa-te logo a seguir. Para treinar para um teste da escola, abre esse teste na disciplina.</p>
        ${listaPorLicao(lid, l.paginas.map(p => p.numero), avaliacaoLivro(lid))}
        ${blocoCustam(avaliacaoLivro(lid))}
      </section>`);
  }

  // Agrupa páginas seguidas da mesma lição.
  function gruposLicoes(lid, nums) {
    const grupos = [];
    for (const n of nums) {
      const licao = livros[lid].licoes.find(x => x.paginas.includes(n));
      const ultimo = grupos.at(-1);
      if (ultimo && ultimo.licao === licao && licao) ultimo.nums.push(n);
      else grupos.push({ licao, nums: [n] });
    }
    return grupos;
  }

  // Uma linha por lição (as páginas de um vídeo), com estudar e testar.
  const listaPorLicao = (lid, nums, a) => `
    <p class="muted legenda-niveis">Tabelas: % das perguntas da lição já certas sem ajuda — ✍️ escrita, ⚡ escolha múltipla; <b>Misto</b> = melhor nota nos testes mistos.
      <span class="cel-nivel provisorio">roxo ✋</span> = inclui respostas que deste como certas e que ainda vão ser revistas · 💡 = há perguntas que só acertaste com ajuda.</p>
    <ol class="pag-lista">${gruposLicoes(lid, nums).map(g => linhaLicao(lid, g, a)).join('')}</ol>`;

  // Os vídeos ficam no Google Drive do pai, partilhados com a conta Google da Leonor
  // (ocupam muito espaço para o Supabase). Em modo local usa-se o ficheiro da pasta Videos.
  // Uma lição pode ter a explicação completa e um resumo curto; quando há os dois, a Leonor escolhe.
  function blocoVideo(l, n) {
    const licao = l.licoes.find(x => x.paginas.includes(n));
    if (!licao) return '<p class="muted">Ainda não há vídeo para esta página.</p>';
    const versoes = [
      { nome: '🎓 Explicação completa', drive: licao.videoDrive },
      { nome: '⚡ Resumo curto', drive: licao.videoDriveCurto },
    ].filter(v => v.drive);
    if (!versoes.length) return '<p class="muted">Ainda não há vídeo para esta lição.</p>';
    const leitor = v => `<div class="video-drive"><iframe src="https://drive.google.com/file/d/${encodeURIComponent(v.drive)}/preview" allow="autoplay; fullscreen" allowfullscreen></iframe></div>`;
    const botoes = versoes.length > 1
      ? `<div class="versoes">${versoes.map((v, i) => `<button class="btn ${i === 0 ? 'prim' : ''}" data-versao="${i}">${v.nome}</button>`).join('')}</div>` : '';
    setTimeout(() => $app.querySelectorAll('[data-versao]').forEach(bt => bt.onclick = () => {
      const v = versoes[+bt.dataset.versao];
      $app.querySelector('#leitor-video').innerHTML = leitor(v);
      $app.querySelectorAll('[data-versao]').forEach(b => b.classList.toggle('prim', b === bt));
    }), 0);
    return `
      ${botoes}
      <div id="leitor-video">${leitor(versoes[0])}</div>
      <p class="muted">Lição das páginas ${licao.paginas.join(' e ')}. Se o vídeo não aparecer, confirma que estás com a tua conta Google no Chrome.</p>`;
  }

  // ---------- estudar uma lição ----------
  // Estuda-se, marca-se e testa-se por lição (normalmente 2 páginas): o vídeo em cima e as páginas por baixo.
  function ecraEstudar(lid, n, a) {
    const l = livros[lid];
    if (!pagina(lid, n)) return ecraLivro(lid);
    const licao = licaoDe(lid, n);
    const nums = licao.nums;
    contexto = { livro: lid, pagina: nums[0] };
    const sufixo = a ? '/' + a.id : '';
    const pagsTeste = a ? paginasDaAvaliacao(a) : [];
    const todasLicoes = l.licoes.length ? l.licoes : l.paginas.map(p => ({ paginas: [p.numero] }));
    const idx = todasLicoes.findIndex(x => x.paginas.includes(n));
    const ant = todasLicoes[idx - 1], seg = todasLicoes[idx + 1];
    const voltar = a ? `<a href="#/t/${a.id}" class="voltar">← ${esc(nomeAvaliacao(a))}</a>` : `<a href="#/l/${lid}" class="voltar">← ${esc(l.titulo)}</a>`;
    const temVideo = licao.videoDrive || licao.videoDriveCurto;
    const paginaTeste = nums.find(p => pagsTeste.includes(p));
    const acoesLicao = `
      <div class="acoes-licao">
        ${licaoEstudada(lid, nums)
          ? '<span class="chip ok">✓ Lição estudada</span><button class="btn" data-desmarcar>↩ Voltar a por estudar</button>'
          : '<button class="btn prim" data-estudei>✓ Já estudei esta lição</button>'}
        ${paginaTeste != null ? `<a class="btn prim" href="#/testar/${a.id}/${paginaTeste}">✏️ Testar esta lição</a>` : ''}
      </div>`;

    const paginasHtml = nums.map(p => {
      const pg = pagina(lid, p);
      return `
        <div class="pagina-licao" id="pag-${p}">
          <h2>Página ${p} <span class="muted titulo-sub">· ${esc(pg.titulo)}</span></h2>
          <img src="${img(lid, pg)}" alt="Página ${p} do livro" data-ampliar="${img(lid, pg)}" class="pagina-img">
        </div>`;
    }).join('');

    render(`
      <section class="estudar">
        ${testeAMeio()}
        <div class="estudar-topo">
          ${voltar}
          <h1>${esc(licao.titulo)} <span class="muted titulo-sub">· páginas ${nums[0]}${nums.length > 1 ? ' a ' + nums.at(-1) : ''}</span></h1>
        </div>
        ${temVideo ? `<div class="cartao video-licao"><h2>🎬 Vídeo da lição</h2>${blocoVideo(l, n)}</div>` : licao.video ? '<p class="muted">🎬 O vídeo desta lição ainda não está pronto.</p>' : ''}
        <p class="muted">Vê o vídeo e lê as páginas com atenção (clica numa página para a ver em grande). Depois marca a lição como estudada e testa-te.</p>
        ${acoesLicao}
        ${paginasHtml}
        ${acoesLicao}
        <div class="navegar">
          ${ant ? `<a class="btn" href="#/estudar/${lid}/${ant.paginas[0]}${sufixo}">← Lição anterior</a>` : '<span></span>'}
          ${seg ? `<a class="btn" href="#/estudar/${lid}/${seg.paginas[0]}${sufixo}">Lição seguinte →</a>` : ''}
        </div>
      </section>`);
    $app.querySelectorAll('[data-estudei]').forEach(bt => bt.onclick = () => { nums.forEach(p => A.marcarEstudada(lid, p)); ecraEstudar(lid, n, a); });
    $app.querySelectorAll('[data-desmarcar]').forEach(bt => bt.onclick = () => { nums.forEach(p => A.desmarcarEstudada(lid, p)); ecraEstudar(lid, n, a); });
    if (n !== nums[0]) document.getElementById('pag-' + n)?.scrollIntoView();
  }

  // ---------- escolher modo e dificuldade ----------
  // escola: respostas escritas com correção logo a seguir (as curtas automáticas, as de explicar por pontos-chave);
  // rapido: escolha múltipla; real: só escrita, sem ajuda nem correção — o pai pede a correção ao Claude no fim.
  const MODOS = {
    escola: { nome: '✍️ Como no teste da escola', desc: 'Respostas escritas, com correção logo a seguir' },
    rapido: { nome: '⚡ Treino rápido', desc: 'Escolha múltipla' },
    real:   { nome: '🎓 Teste real', desc: 'Só respostas escritas, sem ajuda. O pai pede a correção no fim' },
  };
  let modoEscolhido = 'escola';
  let exato = false; // 🎯 só perguntas do nível escolhido (no Médio e no Difícil; o Fácil já é só fácil)

  // n = uma página da lição a testar (ou null para o teste global).
  function ecraDificuldade(a, n) {
    const paginas = paginasDaAvaliacao(a);
    const licao = n == null ? null : licaoDe(a.livro, n, a);
    const alvo = licao?.nums ?? null;
    const anteriores = alvo == null ? [] : paginas.filter(p => p < alvo[0]);
    const titulo = alvo == null ? `Teste global · páginas ${a.de} a ${a.ate}` : `Testar a lição: ${esc(licao.titulo)}`;
    const explica = alvo == null
      ? 'Perguntas de todas as páginas deste teste.'
      : anteriores.length
        ? `A maior parte das perguntas é desta lição (${intervalo(alvo)}), e algumas são das lições anteriores para não te esqueceres.`
        : `Todas as perguntas são desta lição (${intervalo(alvo)}).`;
    // O teste real é sempre sobre a matéria toda.
    const modos = alvo == null ? MODOS : { escola: MODOS.escola, rapido: MODOS.rapido };
    const sugerida = alvo ? difSugerida(a.livro, alvo) : null;
    if (!modos[modoEscolhido]) modoEscolhido = 'escola';

    render(`
      <section class="cartao centro">
        <a href="#/t/${a.id}" class="voltar">← ${esc(nomeAvaliacao(a))}</a>
        <h1>${titulo}</h1>
        <p>${explica}</p>
        <h2>Como queres treinar?</h2>
        <div class="modos">
          ${Object.entries(modos).map(([k, m]) => `
            <button class="modo ${k === modoEscolhido ? 'ativo' : ''}" data-modo="${k}">
              <b>${m.nome}</b><span class="muted">${m.desc}</span>
            </button>`).join('')}
        </div>
        <h2>Escolhe a dificuldade</h2>
        ${sugerida ? `<p class="muted">${nivelDominado(a.livro, alvo)
          ? `🏅 Já dominas o nível ${DIFICULDADES[DIF_DE[nivelDominado(a.livro, alvo)]].nome} desta lição. Sugestão: ${DIFICULDADES[sugerida].nome}.`
          : 'Sugestão: começa pelo Fácil e sobe de nível quando acertares 80% ou mais.'}</p>` : ''}
        <div class="dificuldades">
          ${Object.entries(DIFICULDADES).map(([k, d]) => `
            <button class="dif ${k === sugerida ? 'sugerida' : ''}" data-dif="${k}">
              ${k === sugerida ? '<span class="chip ok">👉 Sugerido</span>' : ''}
              <span class="estrelas">${d.estrelas}</span>
              <b>${d.nome}</b>
              <span class="muted">${k === 'misto' ? d.desc : exato && k !== 'facil' ? `Só perguntas ${NIVEL[NIVEL_DE[k]]}` : d.desc}</span>
            </button>`).join('')}
        </div>
        <label class="exato"><input type="checkbox" id="exato" ${exato ? 'checked' : ''}> 🎯 Exato: só perguntas do nível escolhido (sem fáceis pelo meio)</label>
      </section>`);

    $app.querySelectorAll('[data-modo]').forEach(bt => bt.onclick = () => { modoEscolhido = bt.dataset.modo; ecraDificuldade(a, n); });
    document.getElementById('exato').onchange = ev => { exato = ev.target.checked; ecraDificuldade(a, n); };
    $app.querySelectorAll('[data-dif]').forEach(bt => bt.onclick = () => {
      if (alvo != null) alvo.forEach(p => A.marcarEstudada(a.livro, p));
      const dificuldade = bt.dataset.dif;
      const modo = modoEscolhido;
      const todas = livros[a.livro].perguntas;
      teste = {
        avaliacao: a, livro: a.livro, alvo, paginas, dificuldade, exato: exato && dificuldade !== 'misto' && dificuldade !== 'facil', modo, inicio: new Date().toISOString(),
        perguntas: Motor.gerar({ perguntas: modo === 'rapido' ? todas : todas.filter(q => q.escrita), historico: A.estado.historico, paginas, alvo, dificuldade, exato }),
        indice: 0, respostas: [], ajuda: false, respondida: null,
      };
      location.hash = '#/teste';
    });
  }

  // ---------- treino "as que mais custam" ----------
  // Só perguntas que ela já falhou e que ainda não estão resolvidas (3 certas seguidas sem ajuda),
  // das que mais custam para as que menos. Serve para fazer descer o número de 🔴 no painel.
  const TAMANHO_CUSTAM = 10;
  function blocoCustam(a) {
    const n = perguntasQueCustam(a.livro, paginasDaAvaliacao(a)).filter(x => x.estado !== 'resolvida').length;
    return `
      <div class="global">
        <div><b>🎯 As que mais custam</b><br><span class="muted">${n ? `Treina as ${n} pergunta(s) que ainda te custam, até as acertares 3 vezes seguidas.` : 'Ainda não há perguntas que te custem aqui. 🎉'}</span></div>
        ${n ? `<a class="btn grande" href="#/testar/${a.id}/custam">🎯 Treinar as que custam</a>` : ''}
      </div>`;
  }

  function ecraCustam(a) {
    const todas = perguntasQueCustam(a.livro, paginasDaAvaliacao(a)).filter(x => x.estado !== 'resolvida');
    const modos = { escola: MODOS.escola, rapido: MODOS.rapido };
    if (!modos[modoEscolhido]) modoEscolhido = 'escola';
    const servem = x => modoEscolhido === 'rapido' ? x.q.opcoes : x.q.escrita;
    const lista = todas.filter(servem).slice(0, TAMANHO_CUSTAM);
    const n = c => todas.filter(x => x.estado === c).length;

    render(`
      <section class="cartao centro">
        <a href="#/t/${a.id}" class="voltar">← ${esc(nomeAvaliacao(a))}</a>
        <h1>🎯 As que mais custam</h1>
        <p>${todas.length ? `Tens <b>${n('custa')}</b> pergunta(s) 🔴 que ainda custam e <b>${n('melhorar')}</b> 🟡 a melhorar. Cada uma fica 🟢 resolvida quando a acertares 3 vezes seguidas sem ajuda.` : 'Não há perguntas que te custem. 🎉'}</p>
        ${todas.length ? `
          <h2>Como queres treinar?</h2>
          <div class="modos">
            ${Object.entries(modos).map(([k, m]) => `
              <button class="modo ${k === modoEscolhido ? 'ativo' : ''}" data-modo="${k}"><b>${m.nome}</b><span class="muted">${m.desc}</span></button>`).join('')}
          </div>
          <p class="muted">Este treino terá ${lista.length} pergunta(s), começando pelas que mais custam. Tenta não pedir ajuda: com ajuda não contam como acertadas.</p>
          ${lista.length ? '<button class="btn prim grande" id="comecar">Começar</button>' : '<p>Neste modo não há perguntas destas — experimenta o outro.</p>'}` : ''}
      </section>`);

    $app.querySelectorAll('[data-modo]').forEach(bt => bt.onclick = () => { modoEscolhido = bt.dataset.modo; ecraCustam(a); });
    const $c = document.getElementById('comecar');
    if ($c) $c.onclick = () => {
      teste = {
        avaliacao: a, livro: a.livro, alvo: null, tipoTreino: 'custam', paginas: paginasDaAvaliacao(a), dificuldade: 'misto', modo: modoEscolhido,
        inicio: new Date().toISOString(), perguntas: Motor.preparar(lista.map(x => x.q)),
        indice: 0, respostas: [], ajuda: false, respondida: null,
      };
      location.hash = '#/teste';
    };
  }

  // ---------- correção das respostas curtas ----------
  // Ignora maiúsculas, acentos e pontuação; aceita plurais. "aceites" é uma lista de grupos:
  // a resposta tem de ter um termo de CADA grupo (ex.: [["magalhaes"], ["elcano"]]).
  const normalizar = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim();
  const escRegex = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  function verificarCurta(texto, grupos) {
    const t = normalizar(texto);
    if (!t) return false;
    return grupos.every(g => g.some(v => new RegExp(`(^|\\s)${escRegex(normalizar(v))}(s|es)?(?=\\s|$)`).test(t)));
  }

  // ---------- pergunta ----------
  const ehEscrita = q => teste.modo !== 'rapido' && q.escrita;

  function blocoPagina(q) {
    const pg = pagina(teste.livro, q.pagina), src = img(teste.livro, pg), z = q.zona;
    const zona = z ? ` data-zona="${z.join(',')}"` : '';
    return `
      <div class="ajuda-pagina">
        <div class="pagina-marcada" data-ampliar="${src}"${zona}>
          <img src="${src}" alt="Página ${q.pagina}">
          ${z ? `<span class="marca-zona" style="${estiloZona(z)}"></span>` : ''}
        </div>
        <div class="ajuda-texto">
          <b>📍 Procura na página ${q.pagina}:</b><br>${esc(q.onde)}
          ${z ? `<div class="recorte" data-ampliar="${src}"${zona}><img src="${src}" alt="Zona da página ${q.pagina} onde está a resposta" style="${estiloRecorte(z)}"></div>` : ''}
          <span class="muted">Clica na página para a ver em grande.</span>
        </div>
      </div>`;
  }

  // Imagem da pergunta: só o recorte (sem legenda), e sem abrir a página inteira, onde estaria a resposta.
  function imagemPergunta(q) {
    if (!q.imagem) return '';
    const pg = pagina(teste.livro, q.imagem.pagina);
    if (!pg) return '';
    const z = q.imagem.zona;
    return `<div class="imagem-pergunta"><div class="recorte grande" data-zona="${z.join(',')}"><img src="${img(teste.livro, pg)}" alt="Imagem da pergunta" style="${estiloRecorte(z)}"></div></div>`;
  }

  // A marca é uma moldura por cima da página; o recorte mostra só essa zona, ampliada.
  const estiloZona = ([x, y, w, h]) => `left:${x}%;top:${y}%;width:${w}%;height:${h}%`;
  const estiloRecorte = ([x, y, w, h]) => `width:${10000 / w}%;left:${-100 * x / w}%;top:${-100 * y / h}%;height:${10000 / h}%`;

  function topoPergunta(q) {
    const total = teste.perguntas.length;
    return `
      <div class="teste-topo">
        <span>${teste.modo === 'real' ? '🎓 Teste real · ' : ''}Pergunta ${teste.indice + 1} de ${total}</span>
        <span class="nivel n${q.nivel}" title="Nível de dificuldade">${NIVEL[q.nivel]}</span>
      </div>
      <div class="progresso"><div style="width:${pct(teste.indice, total)}%"></div></div>
      <div class="teste-acoes" id="teste-acoes">
        ${teste.modo === 'real' ? '' : `<button class="btn" id="ver-materia" title="Abre a lição desta pergunta. Se ainda não respondeste, conta como ajuda.">📖 Ver a matéria</button>`}
        <button class="btn" id="sair-teste">✕ Sair do teste</button>
      </div>`;
  }

  // Botões do topo da pergunta: ir ver a matéria (e voltar) ou desistir do teste.
  function ligarAcoesTeste(q) {
    document.getElementById('ver-materia')?.addEventListener('click', () => {
      if (teste.respondida == null) teste.ajuda = true;
      location.hash = `#/estudar/${teste.livro}/${q.pagina}/${teste.avaliacao.id}`;
    });
    document.getElementById('sair-teste')?.addEventListener('click', () => {
      document.getElementById('teste-acoes').innerHTML = `
        <span>Sair? As respostas deste teste não ficam guardadas.</span>
        <button class="btn perigo" id="sair-sim">Sim, sair</button>
        <button class="btn prim" id="sair-nao">Continuar o teste</button>`;
      document.getElementById('sair-nao').onclick = () => ecraPergunta();
      document.getElementById('sair-sim').onclick = () => { const id = teste.avaliacao.id; teste = null; location.hash = '#/t/' + id; };
    });
  }

  // Aviso de teste a meio (nos ecrãs de estudo), com o caminho de volta.
  const testeAMeio = () => teste && !teste.registo ? `
    <div class="cartao aviso-teste">
      <span>📝 Tens um teste a meio (pergunta ${teste.indice + 1} de ${teste.perguntas.length}).</span>
      <a class="btn prim" href="#/teste">↩ Voltar ao teste</a>
    </div>` : '';

  const botaoSeguinte = () => `<button class="btn prim grande" id="seguinte">${teste.indice + 1 < teste.perguntas.length ? 'Seguinte →' : 'Ver resultado 🏁'}</button>`;

  function ecraPergunta() {
    const q = teste.perguntas[teste.indice];
    if (ehEscrita(q)) return ecraPerguntaEscrita(q);
    const r = teste.respondida;

    const opcoes = q.opcoes.map((o, i) => {
      let cls = '';
      if (r != null) cls = i === q.correta ? 'certa' : i === r ? 'errada' : 'apagada';
      return `<button class="opcao ${cls}" data-op="${i}" ${r != null ? 'disabled' : ''}><span class="letra">${'abcd'[i]})</span> ${esc(o)}</button>`;
    }).join('');

    let feedback = '';
    if (r != null) {
      const certa = r === q.correta;
      feedback = `
        <div class="feedback ${certa ? 'bom' : 'mau'}">
          <h3>${certa ? (teste.ajuda ? '👍 Certo, com ajuda!' : '🎉 Muito bem!') : '💪 Não faz mal, vamos ver onde está.'}</h3>
          ${certa ? '' : `<p><b>Resposta certa:</b> ${esc(q.opcoes[q.correta])}</p>`}
          <p>${esc(q.explicacao)}</p>
          ${certa ? '' : blocoPagina(q)}
          ${botaoSeguinte()}
        </div>`;
    } else if (teste.ajuda) {
      feedback = `<div class="feedback ajuda">${blocoPagina(q)}</div>`;
    }

    render(`
      <section class="cartao teste">
        ${topoPergunta(q)}
        ${imagemPergunta(q)}
        <h2 class="enunciado">${esc(q.pergunta)}</h2>
        <div class="opcoes">${opcoes}</div>
        ${r == null && !teste.ajuda ? '<button class="btn ajuda-btn" id="ajuda">💡 Preciso de ajuda</button>' : ''}
        ${feedback}
      </section>`);

    ligarAcoesTeste(q);
    $app.querySelectorAll('[data-op]').forEach(bt => bt.onclick = () => responder(+bt.dataset.op));
    document.getElementById('ajuda')?.addEventListener('click', () => { teste.ajuda = true; ecraPergunta(); });
    document.getElementById('seguinte')?.addEventListener('click', seguinte);
  }

  function ecraPerguntaEscrita(q) {
    const e = q.escrita, r = teste.respondida, real = teste.modo === 'real';
    const ultima = teste.indice + 1 >= teste.perguntas.length;
    let corpo;

    if (!r) {
      corpo = `
        <form id="f-escrita" class="escrita">
          ${e.tipo === 'curta'
            ? '<input id="resp" autocomplete="off" spellcheck="false" placeholder="Escreve a tua resposta">'
            : '<textarea id="resp" rows="4" placeholder="Escreve a tua resposta com as tuas palavras"></textarea>'}
          <button class="btn prim">${real ? (ultima ? 'Entregar teste 🏁' : 'Seguinte →') : e.tipo === 'curta' ? 'Responder' : 'Ver a resposta'}</button>
        </form>
        ${real ? '' : teste.ajuda ? `<div class="feedback ajuda">${blocoPagina(q)}</div>` : '<button class="btn ajuda-btn" id="ajuda">💡 Preciso de ajuda</button>'}`;
    } else if (e.tipo === 'curta') {
      const certa = r.pontuacao === 1;
      corpo = `
        <div class="a-tua">A tua resposta: <b>${esc(r.texto) || '—'}</b></div>
        <div class="feedback ${certa ? 'bom' : 'mau'}">
          <h3>${certa ? (teste.ajuda ? '👍 Certo, com ajuda!' : '🎉 Muito bem!') : '💪 Não faz mal, vamos ver onde está.'}</h3>
          <p><b>Resposta:</b> ${esc(e.modelo)}</p>
          <p>${esc(q.explicacao)}</p>
          ${certa ? '' : blocoPagina(q)}
          <div class="linha-botoes esquerda">
            ${certa ? '' : '<button class="btn" id="acertei">A minha resposta também está certa</button>'}
            ${botaoSeguinte()}
          </div>
        </div>`;
    } else if (!r.confirmada) {
      corpo = `
        <div class="a-tua"><b>A tua resposta:</b><br>${esc(r.texto) || '—'}</div>
        <div class="feedback ajuda">
          <h3>Compara com os pontos-chave</h3>
          <p class="muted">Marca os pontos que a tua resposta tem, mesmo que escritos com outras palavras.${e.minimo && e.minimo < e.pontos.length ? ` <b>Basta teres ${e.minimo} destes ${e.pontos.length} para a resposta estar completa.</b>` : ''}</p>
          ${e.pontos.map((p, i) => `<label class="ponto"><input type="checkbox" data-ponto="${i}"> ${esc(p)}</label>`).join('')}
          <p><b>Resposta modelo:</b> ${esc(e.modelo)}</p>
          <button class="btn prim" id="confirmar">Confirmar</button>
        </div>`;
    } else {
      const certa = r.pontuacao === 1;
      corpo = `
        <div class="a-tua"><b>A tua resposta:</b><br>${esc(r.texto) || '—'}</div>
        <div class="feedback ${certa ? 'bom' : r.pontuacao > 0 ? 'ajuda' : 'mau'}">
          <h3>${certa ? (e.minimo && e.minimo < e.pontos.length ? `🎉 Tinhas os ${e.minimo} pontos-chave pedidos!` : '🎉 Tinhas todos os pontos-chave!') : r.pontuacao > 0 ? `🙂 Tinhas ${r.marcados} de ${Math.min(e.minimo || e.pontos.length, e.pontos.length)} pontos-chave.` : '💪 Não faz mal, vamos ver onde está.'}</h3>
          <p>${esc(q.explicacao)}</p>
          ${certa ? '' : blocoPagina(q)}
          ${botaoSeguinte()}
        </div>`;
    }

    render(`
      <section class="cartao teste">
        ${topoPergunta(q)}
        ${imagemPergunta(q)}
        <h2 class="enunciado">${esc(e.pergunta || q.pergunta)}</h2>
        ${corpo}
      </section>`);
    ligarAcoesTeste(q);

    const f = document.getElementById('f-escrita');
    if (f) {
      const $r = document.getElementById('resp');
      $r.value = teste.rascunho || '';
      $r.oninput = () => { teste.rascunho = $r.value; };
      $r.focus();
      f.onsubmit = ev => { ev.preventDefault(); responderEscrita(q, $r.value.trim()); };
    }
    document.getElementById('ajuda')?.addEventListener('click', () => { teste.ajuda = true; ecraPergunta(); });
    document.getElementById('seguinte')?.addEventListener('click', seguinte);
    document.getElementById('acertei')?.addEventListener('click', () => {
      Object.assign(r, { pontuacao: 1, certa: true, corrigidaPelaAluna: true, autoavaliada: true });
      ecraPergunta();
    });
    document.getElementById('confirmar')?.addEventListener('click', () => {
      // Guarda quais os pontos-chave que ela marcou, para o pai poder rever a autoavaliação.
      const pontosMarcados = [...$app.querySelectorAll('[data-ponto]:checked')].map(c => +c.dataset.ponto);
      const marcados = pontosMarcados.length;
      // "Indica pelo menos N…": N pontos já valem 100% (escrita.minimo); senão, todos os pontos-chave.
      const precisa = Math.min(e.minimo || e.pontos.length, e.pontos.length);
      Object.assign(r, { marcados, pontosMarcados, pontuacao: Math.min(1, marcados / precisa), confirmada: true, autoavaliada: true });
      r.certa = r.pontuacao === 1;
      ecraPergunta();
    });
  }

  function responder(i) {
    const q = teste.perguntas[teste.indice];
    const certa = i === q.correta;
    teste.respondida = i;
    teste.respostas.push({ id: q.id, pagina: q.pagina, nivel: q.nivel, modo: 'escolha', certa, pontuacao: certa ? 1 : 0, ajuda: teste.ajuda });
    ecraPergunta();
  }

  function responderEscrita(q, texto) {
    const e = q.escrita;
    const r = { id: q.id, pagina: q.pagina, nivel: q.nivel, modo: e.tipo, pergunta: e.pergunta || q.pergunta, texto, ajuda: teste.ajuda };
    if (teste.modo === 'real') {
      Object.assign(r, { pontuacao: null, certa: false });
      teste.respostas.push(r);
      teste.respondida = r;
      return seguinte();
    }
    if (e.tipo === 'curta') {
      r.pontuacao = verificarCurta(texto, e.aceites) ? 1 : 0;
      r.certa = r.pontuacao === 1;
    }
    teste.respostas.push(r);
    teste.respondida = r;
    ecraPergunta();
  }

  // Pontos: cada pergunta vale 1 (as de explicar valem a fração de pontos-chave); com ajuda vale metade.
  function calcularNota(respostas) {
    const pontos = Math.round(respostas.reduce((s, r) => s + (r.pontuacao || 0) * (r.ajuda ? 0.5 : 1), 0) * 10) / 10;
    const porNivel = {};
    respostas.forEach(r => { const n = porNivel[r.nivel] ||= { certas: 0, total: 0 }; n.total++; if (r.pontuacao === 1 && !r.ajuda) n.certas++; });
    return { pontos, porNivel, percent: pct(pontos, respostas.length) };
  }

  function seguinte() {
    if (teste.registo) return; // evita gravar o mesmo teste duas vezes (duplo clique)
    teste.indice++;
    teste.ajuda = false;
    teste.respondida = null;
    teste.rascunho = '';
    if (teste.indice < teste.perguntas.length) return ecraPergunta();

    const a = teste.avaliacao;
    const real = teste.modo === 'real';
    // "Como no teste da escola": a nota que sai é a da autoavaliação; a nota final fica pendente
    // até o pai pedir a revisão ao Claude (como no teste real).
    const escola = teste.modo === 'escola';
    const nota = real ? { pontos: null, porNivel: {}, percent: null } : calcularNota(teste.respostas);
    if (escola) {
      teste.respostas.forEach(r => { r.pontuacaoAuto = r.pontuacao; });
      Object.assign(nota, { autoPercent: nota.percent, autoPontos: nota.pontos, percent: null, pontos: null });
    }
    teste.registo = {
      id: Date.now(), data: new Date().toISOString(), disciplina: a.disciplina, livro: a.livro,
      avaliacao: a.id, avaliacaoNome: nomeAvaliacao(a), modo: teste.modo, estado: real ? 'por corrigir' : escola ? 'por rever' : 'feito',
      tipo: teste.tipoTreino || (teste.alvo == null ? 'global' : 'licao'), pagina: teste.alvo?.[0] ?? null, licao: teste.alvo,
      paginas: [teste.paginas[0], teste.paginas[teste.paginas.length - 1]],
      dificuldade: teste.dificuldade, exato: teste.exato, total: teste.respostas.length, ...nota, respostas: teste.respostas,
    };
    A.registarTeste(teste.registo);
    location.hash = '#/resultado';
  }

  // ---------- resultado ----------
  function ecraResultado() {
    const t = teste.registo;
    if (t.modo === 'real') {
      return render(`
        <section class="cartao centro">
          <h1>📝 Teste entregue!</h1>
          <p>Respondeste a ${t.total} perguntas. Quando o pai pedir a correção, vais ver aqui a nota e um comentário a cada resposta.</p>
          <div class="linha-botoes">
            <a class="btn prim" href="#/real/${t.id}">Ver as minhas respostas</a>
            <a class="btn" href="#/t/${t.avaliacao}">Voltar ao teste</a>
          </div>
        </section>`);
    }
    // No modo escola a nota mostrada é a da autoavaliação; a final fica pendente da revisão.
    const pendente = t.estado === 'por rever';
    const p = t.percent ?? t.autoPercent;
    const mensagem = p >= 90 ? '🌟 Excelente!' : p >= 70 ? '😀 Muito bem!' : p >= 50 ? '🙂 Estás quase lá!' : '💪 Vale a pena rever esta matéria.';
    const erradas = teste.perguntas.filter((q, i) => !teste.respostas[i].certa || teste.respostas[i].ajuda);
    const respostaCerta = q => ehEscrita(q) ? q.escrita.modelo : q.opcoes[q.correta];

    render(`
      <section class="cartao centro">
        <h1>${mensagem}</h1>
        ${pendente ? '<p class="muted">✋ A tua autoavaliação</p>' : ''}
        <div class="nota ${p >= 70 ? 'bom' : p >= 50 ? 'medio' : 'mau'}">${p}%</div>
        <p>${t.pontos ?? t.autoPontos} pontos em ${t.total} perguntas · ${MODOS[t.modo]?.nome || ''} · ${DIFICULDADES[t.dificuldade].nome}${t.exato ? ' 🎯 Exato' : ''}</p>
        ${pendente ? '<p class="feedback ajuda">⏳ <b>Nota final pendente.</b> Esta é a nota que deste a ti própria. O pai vai pedir a revisão das tuas respostas e depois aparece a nota final.</p>' : ''}
        ${comAjuda(t) ? `<p class="feedback ajuda">💡 Usaste ajuda em ${comAjuda(t)} de ${t.total} perguntas. Essas valem metade e ainda não contam como sabidas — tenta outra vez sem ajuda.</p>` : ''}
        <div class="niveis">
          ${[1, 2, 3].filter(n => t.porNivel[n]).map(n => `<span class="chip">${NIVEL[n]} ${t.porNivel[n].certas}/${t.porNivel[n].total}</span>`).join('')}
        </div>
        ${t.licao && p >= DOMINIO && t.dificuldade !== 'dificil' && t.dificuldade !== 'misto' ? `
          <div class="feedback bom subir">
            <b>🚀 Já dominas o nível ${DIFICULDADES[t.dificuldade].nome} desta lição!</b>
            Experimenta agora o ${DIFICULDADES[DIF_DE[NIVEL_DE[t.dificuldade] + 1]].nome}.
            <a class="btn prim" href="#/testar/${t.avaliacao}/${t.pagina}">Experimentar o ${DIFICULDADES[DIF_DE[NIVEL_DE[t.dificuldade] + 1]].nome} ${DIFICULDADES[DIF_DE[NIVEL_DE[t.dificuldade] + 1]].estrelas}</a>
          </div>` : t.licao && p >= DOMINIO && t.dificuldade === 'dificil' ? `
          <div class="feedback bom subir"><b>🏆 Dominas esta lição até ao nível mais difícil!</b> Passa à lição seguinte ou faz o teste global.</div>` : ''}
        ${erradas.length ? `
          <h2>Para rever</h2>
          <ul class="rever">
            ${erradas.map(q => `<li><b>${esc(ehEscrita(q) ? q.escrita.pergunta || q.pergunta : q.pergunta)}</b><br>✔ ${esc(respostaCerta(q))}<br><span class="muted">📍 Página ${q.pagina}: ${esc(q.onde)}</span></li>`).join('')}
          </ul>` : '<p>Acertaste tudo sem ajuda! 🎉</p>'}
        <div class="linha-botoes">
          <a class="btn prim" href="#/testar/${t.avaliacao}/${t.tipo === 'custam' ? 'custam' : t.pagina ?? 'global'}">🔁 Repetir</a>
          ${t.pagina ? `<a class="btn" href="#/estudar/${t.livro}/${t.pagina}/${t.avaliacao}">📖 Rever a lição</a>` : ''}
          <a class="btn" href="#/t/${t.avaliacao}">Voltar ao teste</a>
        </div>
      </section>`);
  }

  // ---------- correção pelo Claude: teste real e testes "como na escola" ----------
  // O teste real não tem nota nenhuma até ser corrigido; o "como na escola" tem a nota da autoavaliação
  // e fica com a nota final pendente ("por rever") até chegar a correção.
  const corrigivel = t => t.modo === 'real' || t.modo === 'escola' && t.autoPercent != null;
  const porCorrigir = t => corrigivel(t) && t.estado !== 'corrigido';
  const testeReal = id => A.estado.testes.find(t => corrigivel(t) && String(t.id) === String(id));
  const perguntaDoBanco = (t, qid) => livros[t.livro]?.perguntas.find(q => q.id === qid);
  const nomeTreino = t => t.tipo === 'custam' ? '🎯 As que mais custam' : t.tipo === 'global' ? `Global (págs. ${t.paginas[0]}–${t.paginas[1]})` : t.licao ? `Lição (${intervalo(t.licao)})` : `Página ${t.pagina}`;

  function ecraTesteReal(t) {
    const corrigido = t.estado === 'corrigido';
    const real = t.modo === 'real';
    const chipNota = v => v == null ? '' : `<span class="chip ${v === 1 ? 'ok' : v > 0 ? 'aviso' : ''}">${Math.round(v * 100)}%</span>`;
    render(`
      <section class="cartao centro">
        <a href="javascript:history.back()" class="voltar">← Voltar</a>
        <h1>${real ? '🎓' : '✍️'} ${esc(t.avaliacaoNome)} · ${real ? 'teste real' : 'como no teste da escola'}</h1>
        <p class="muted">${dataCurta(t.data)} · ${nomeTreino(t)}</p>
        ${t.autoPercent != null ? `<p>✋ Autoavaliação: <b>${t.autoPercent}%</b></p>` : ''}
        ${corrigido
          ? `<p class="muted">Nota final</p><div class="nota ${t.percent >= 70 ? 'bom' : t.percent >= 50 ? 'medio' : 'mau'}">${t.percent}%</div>
             ${t.correcao?.comentarioGeral ? `<div class="feedback ajuda"><b>Comentário:</b> ${esc(t.correcao.comentarioGeral)}</div>` : ''}`
          : `<div class="feedback ajuda">⏳ ${real ? 'Ainda por corrigir.' : 'Nota final pendente: falta a revisão.'}</div>`}
        <ol class="respostas-real">
          ${t.respostas.map(r => {
            const q = perguntaDoBanco(t, r.id);
            return `
              <li>
                <b>${esc(r.pergunta || q?.pergunta || '')}</b>
                ${r.pontuacaoAuto != null ? `<small class="muted">✋ ${Math.round(r.pontuacaoAuto * 100)}%</small>` : ''}
                ${corrigido || real ? chipNota(r.pontuacao) : ''}
                ${r.ajuda ? '<span class="chip aviso">💡 com ajuda</span>' : ''}
                <div class="a-tua">${esc(r.texto ?? (q?.opcoes && r.resposta != null ? q.opcoes[r.resposta] : '')) || '<i>sem resposta</i>'}</div>
                ${corrigido ? `
                  ${r.comentario ? `<p>💬 ${esc(r.comentario)}</p>` : ''}
                  ${q?.escrita ? `<p class="muted">Resposta modelo: ${esc(q.escrita.modelo)}</p>` : ''}` : ''}
              </li>`;
          }).join('')}
        </ol>
      </section>`);
  }

  // Ficheiro que o pai entrega ao Claude para corrigir (um teste ou vários de uma vez).
  function pedidoDe(t) {
    return {
      id: t.id, data: t.data, teste: t.avaliacaoNome, modo: t.modo, treino: nomeTreino(t), livro: t.livro, paginas: t.paginas,
      autoavaliacao: t.autoPercent ?? null,
      respostas: t.respostas.map(r => {
        const q = perguntaDoBanco(t, r.id);
        return { id: r.id, pagina: r.pagina, nivel: r.nivel, tipo: r.modo, pergunta: r.pergunta || q?.pergunta, resposta: r.texto,
          comAjuda: !!r.ajuda, autoavaliacao: r.pontuacaoAuto ?? null, pontosMarcados: r.pontosMarcados,
          respostaModelo: q?.escrita?.modelo, pontosChave: q?.escrita?.pontos, explicacao: q?.explicacao };
      }),
    };
  }
  function descarregarParaCorrecao(testes) {
    const pedido = {
      tipo: 'pedido-correcao', gerado: new Date().toISOString(),
      instrucoes: 'Corrige cada resposta com pontuacao entre 0 e 1 e um comentário curto e encorajador para uma criança de 11 anos. Nos testes "escola" compara com a autoavaliação dela. Devolve um ficheiro com tipo "correcao" e testes: [{ id, comentarioGeral, respostas: [{ id, pontuacao, comentario }] }].',
      testes: testes.map(pedidoDe),
    };
    const blob = new Blob([JSON.stringify(pedido, null, 2)], { type: 'application/json' });
    const nome = testes.length === 1 ? `pedido-correcao-${testes[0].id}.json` : `pedido-correcao-${A.hoje()}-${testes.length}-testes.json`;
    const el = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: nome });
    el.click();
    URL.revokeObjectURL(el.href);
  }

  // Aceita o formato antigo (um teste: { tipo, id, respostas }) e o novo ({ tipo, testes: [...] }).
  async function carregarCorrecao(ficheiro) {
    const c = JSON.parse(await ficheiro.text());
    if (c.tipo !== 'correcao') throw new Error('Este ficheiro não é uma correção.');
    const lista = c.testes || [c];
    const feitos = [];
    for (const ct of lista) {
      const t = testeReal(ct.id);
      if (!t) continue;
      for (const rc of ct.respostas || []) {
        const r = t.respostas.find(x => x.id === rc.id);
        if (r) {
          Object.assign(r, { pontuacao: Math.max(0, Math.min(1, +rc.pontuacao || 0)), comentario: rc.comentario || '' });
          // Resposta a uma contestação dela ("Não concordo"), numa revisão seguinte.
          if (rc.respostaContestacao) Object.assign(r, { respostaRevisao: rc.respostaContestacao, respostaRevisaoEm: new Date().toISOString() });
        }
      }
      t.respostas.forEach(r => {
        if (r.pontuacao == null) r.pontuacao = 0;
        r.certa = r.pontuacao === 1;
        // A correção serve também de auditoria das autoavaliações (diferença de mais de 25 pontos = mal avaliada).
        if (r.pontuacaoAuto != null && autoavaliadas({ respostas: [r] }).length && !r.auditoria) {
          r.auditoria = Math.abs(r.pontuacaoAuto - r.pontuacao) <= 0.25 ? 'ok' : 'mal';
          r.auditadoPor = 'Claude';
        }
      });
      Object.assign(t, calcularNota(t.respostas), { estado: 'corrigido', correcao: { data: new Date().toISOString(), comentarioGeral: ct.comentarioGeral || '' } });
      // O teste real ainda não estava no histórico de acertos (não tinha notas); o "escola" já estava.
      if (t.modo === 'real') await A.atualizarTeste(t); else await A.guardarRegisto(t);
      feitos.push(t);
    }
    if (!feitos.length) throw new Error('Nenhum dos testes deste ficheiro foi encontrado nesta conta.');
    return feitos;
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

  // ---------- revisão das autoavaliações (para o pai) ----------
  // Nas respostas escritas de explicar é ela que marca os pontos-chave que acertou, e nas curtas pode dizer
  // "a minha resposta também está certa". Aqui o pai vê a resposta e o que ela marcou, e diz se concorda.
  // "Não concordo" faz a resposta deixar de contar como certa no progresso.
  function ecraRevisao(todas) {
    const perguntaPorId = Object.fromEntries(Object.values(livros).flatMap(l => l.perguntas).map(q => [q.id, q]));
    const itens = [...A.estado.testes].reverse().flatMap(t => autoavaliadas(t).map(r => ({ t, r })));
    const porRever = itens.filter(x => !x.r.auditoria);
    const revistas = itens.filter(x => x.r.auditoria);
    const concordo = revistas.filter(x => x.r.auditoria === 'ok').length;
    const mostrar = todas ? itens : porRever;

    const cartao = ({ t, r }, i) => {
      const q = perguntaPorId[r.id], e = q?.escrita;
      let avaliacao;
      if (r.modo === 'explica') {
        avaliacao = e?.pontos ? `
          <p class="muted">Pontos-chave — o que ela marcou como presente na resposta:</p>
          <ul class="pontos-auditoria">${e.pontos.map((p, k) => {
            const marcou = r.pontosMarcados ? r.pontosMarcados.includes(k) : null;
            return `<li class="${marcou ? 'marcou' : marcou === false ? 'nao' : ''}">${marcou ? '☑' : marcou === false ? '☐' : '·'} ${esc(p)}</li>`;
          }).join('')}</ul>
          ${r.pontosMarcados ? '' : `<p class="muted">(Resposta antiga: só sabemos que marcou ${r.marcados ?? '?'} de ${e.pontos.length} pontos.)</p>`}` : '';
      } else {
        avaliacao = '<p><span class="chip aviso">A correção automática deu errado</span> e ela carregou em <b>"A minha resposta também está certa"</b>.</p>';
      }
      return `
        <div class="cartao-revisao ${r.auditoria ? 'revista ' + r.auditoria : ''}">
          <div class="seccao-topo"><span class="muted">${dataCurta(t.data)} · ${t.licao ? `Lição (${intervalo(t.licao)})` : `Página ${t.pagina ?? '—'}`} · ${NIVEL[r.nivel] || ''}</span>
            ${r.auditoria ? `<span class="chip ${r.auditoria === 'ok' ? 'ok' : 'aviso'}">${r.auditoria === 'ok' ? '👍 Concordo' : '👎 Não concordo'}</span>` : '<span class="chip">Por rever</span>'}</div>
          <p><b>${esc(r.pergunta || q?.pergunta || '')}</b></p>
          <div class="a-tua"><b>Resposta dela:</b><br>${esc(r.texto) || '<i>(em branco)</i>'}</div>
          ${avaliacao}
          ${e?.modelo ? `<p><b>Resposta modelo:</b> ${esc(e.modelo)}</p>` : ''}
          <p class="muted">Ela deu-se ${Math.round((r.pontuacao || 0) * 100)}% nesta resposta.</p>
          <div class="linha-botoes esquerda">
            <button class="btn ${r.auditoria === 'ok' ? 'prim' : ''}" data-aud="${i}" data-val="ok">👍 Autoavaliou-se bem</button>
            <button class="btn ${r.auditoria === 'mal' ? 'perigo' : ''}" data-aud="${i}" data-val="mal">👎 Não estava certa</button>
          </div>
        </div>`;
    };

    render(`
      <section class="cartao">
        <a href="#/painel" class="voltar">← Painel</a>
        <h1>🔍 Revisão das autoavaliações</h1>
        <p class="muted">Respostas escritas em que foi a Leonor a dizer se estava certa. Confirma se concordas — as que marcares como "não estava certa" deixam de contar como certas no progresso.</p>
        <div class="kpis">
          <div class="kpi"><span>Por rever</span><b>${porRever.length}</b></div>
          <div class="kpi"><span>Revistas</span><b>${revistas.length}</b></div>
          <div class="kpi"><span>Autoavaliou-se bem</span><b>${revistas.length ? pct(concordo, revistas.length) + '%' : '—'}</b></div>
        </div>
        <p><a class="btn" href="${todas ? '#/revisao' : '#/revisao/todas'}">${todas ? 'Mostrar só as por rever' : 'Mostrar todas (também as já revistas)'}</a></p>
        ${mostrar.length ? mostrar.map(cartao).join('') : `<p>${todas ? 'Ainda não há respostas autoavaliadas.' : '✅ Não há nada por rever.'}</p>`}
      </section>`);

    $app.querySelectorAll('[data-aud]').forEach(bt => bt.onclick = async () => {
      const { t, r } = mostrar[+bt.dataset.aud];
      r.auditoria = bt.dataset.val;
      r.auditadoEm = new Date().toISOString();
      try { await A.guardarRegisto(t); } catch (erro) { alert('Não foi possível guardar: ' + erro.message); }
      const y = scrollY; ecraRevisao(todas); scrollTo(0, y);
    });
  }

  // ---------- painel ----------
  function ecraPainel() {
    const e = A.estado;
    const hoje = A.hoje();
    const dias = [...Array(7)].map((_, i) => { const d = new Date(); d.setDate(d.getDate() - 6 + i); return d.toLocaleDateString('sv'); });
    const tempoSemana = dias.reduce((s, d) => s + (e.tempoPorDia[d] || 0), 0);
    const tempoTotal = Object.values(e.tempoPorDia).reduce((s, v) => s + v, 0);
    const maxDia = Math.max(60, ...dias.map(d => e.tempoPorDia[d] || 0));
    const comNota = e.testes.filter(t => t.percent != null);
    const media = comNota.length ? Math.round(comNota.reduce((s, t) => s + t.percent, 0) / comNota.length) : null;
    const reais = e.testes.filter(corrigivel).reverse();
    const perguntasTodas = perguntasPorId();
    const pendentes = reais.filter(porCorrigir);

    const porNivel = { 1: { c: 0, t: 0 }, 2: { c: 0, t: 0 }, 3: { c: 0, t: 0 } };
    comNota.forEach(t => t.respostas.forEach(r => { if (anulada(t, r)) return; porNivel[r.nivel].t++; if (r.certa && !r.ajuda) porNivel[r.nivel].c++; }));

    // Perguntas que custam: estado atual e comparação com há 7 dias, para se ver se estão a diminuir.
    const contarEstados = lista => Object.fromEntries(Object.keys(ESTADO_CUSTA).map(k => [k, lista.filter(x => x.estado === k).length]));
    const ha7 = new Date(); ha7.setDate(ha7.getDate() - 7);
    const custamPorLivro = Object.values(livros).map(l => {
      const lista = perguntasQueCustam(l.id);
      return { l, lista, agora: contarEstados(lista), antes: contarEstados(perguntasQueCustam(l.id, null, ha7.toISOString())) };
    });
    const htmlCustam = custamPorLivro.map(({ l, lista, agora, antes }) => {
      const dif = agora.custa - antes.custa;
      const tendencia = dif < 0 ? `📉 ${-dif} a menos que há 7 dias` : dif > 0 ? `📈 ${dif} a mais que há 7 dias` : 'igual a há 7 dias';
      const linha = x => `<tr><td>${esc(x.q.pergunta)}<br><small class="muted">Página ${x.q.pagina} · ${NIVEL[x.q.nivel]}</small></td>
        <td>${ESTADO_CUSTA[x.estado].nome}</td><td class="bolinhas" title="Últimas tentativas, da mais antiga para a mais recente">${bolinhas(x.ultimas)}</td>
        <td>${x.falhas} de ${x.ts.length}</td></tr>`;
      const ativas = lista.filter(x => x.estado !== 'resolvida');
      return `
        <h3>${esc(disciplinas[l.disciplina].nome)} · ${esc(l.titulo)}</h3>
        <div class="kpis">
          <div class="kpi"><span>🔴 Ainda custam</span><b>${agora.custa}</b><small class="muted">${tendencia}</small></div>
          <div class="kpi"><span>🟡 A melhorar</span><b>${agora.melhorar}</b></div>
          <div class="kpi"><span>🟢 Já não custam</span><b>${agora.resolvida}</b></div>
        </div>
        ${ativas.length ? `<div class="tabela-larga"><table>
          <thead><tr><th>Pergunta</th><th>Estado</th><th>Últimas tentativas</th><th>Falhas</th></tr></thead>
          <tbody>${ativas.slice(0, 15).map(linha).join('')}</tbody></table></div>
          ${ativas.length > 15 ? `<p class="muted">… e mais ${ativas.length - 15}.</p>` : ''}` : (lista.length ? '<p>🎉 Todas as perguntas que custavam já estão resolvidas.</p>' : '<p class="muted">Ainda não há perguntas difíceis.</p>')}`;
    }).join('');

    const dataPt = d => d.toLocaleDateString('pt-PT', { weekday: 'short', day: 'numeric', month: 'long' });
    const porSemana = x => x >= 1 ? `${Math.ceil(x)} lição(ões) por dia` : `${Math.ceil(x * 7)} lição(ões) por semana`;
    const testesEscola = [...A.estado.avaliacoes].sort((x, y) => String(x.data || '9999').localeCompare(String(y.data || '9999'))).map(a => {
      const p = progressoTeste(a);
      const feitos = e.testes.filter(t => String(t.avaliacao) === String(a.id));
      const nota = melhorNota(t => String(t.avaliacao) === String(a.id) && t.tipo === 'global');
      let previsao;
      if (!p.falta) previsao = '✅ A matéria toda já está estudada. Agora é treinar os níveis e fazer o teste global.';
      else if (p.diasAteTeste != null && p.diasAteTeste < 0) previsao = 'Este teste já foi.';
      else if (!p.ritmo) previsao = `Ainda sem ritmo para estimar.${p.porDia ? ` Para acabar na véspera do teste: ${porSemana(p.porDia)}.` : ''}`;
      else {
        const aTempo = p.diasAteTeste == null || p.fim < new Date(a.data + 'T12:00');
        previsao = `${aTempo ? '🟢' : '🔴'} Ao ritmo atual fica tudo estudado <b>${dataPt(p.fim)}</b>`
          + (p.diasAteTeste != null ? (aTempo ? ', antes do teste.' : ', depois do teste!') : '.')
          + (p.porDia ? ` Para acabar na véspera do teste: ${porSemana(p.porDia)}.` : '');
      }
      return `
        <div class="progresso-teste">
          <div class="seccao-topo"><b>${esc(disciplinas[a.disciplina]?.nome || a.disciplina)} · ${esc(nomeAvaliacao(a))}</b>
            <span class="muted">${a.data ? quandoE(a.data) : 'Sem data'}</span></div>
          <div class="barra-rotulo"><span>📖 Estudado</span><b>${p.pctEstudado}%</b> <small class="muted">(${p.estudadas} de ${p.total} lições)</small></div>
          <div class="progresso"><div style="width:${p.pctEstudado}%"></div></div>
          <div class="barra-rotulo"><span>🏅 Dominado</span><b>${p.pctDominado}%</b> <small class="muted">(perguntas certas sem ajuda, nos 2 estilos e 3 níveis — ver tabela abaixo)</small></div>
          <div class="progresso dominado"><div style="width:${p.pctDominado}%"></div></div>
          <p>${previsao}</p>
          <p class="muted">${feitos.length} treino(s) feitos · melhor teste global: ${nota != null ? nota + '%' : '—'}</p>
        </div>`;
    }).join('');

    const soma = linhas => Object.fromEntries(Object.keys(linhas[0] || {}).map(k => [k, linhas.reduce((s, x) => ({ total: s.total + x[k].total, certas: s.certas + x[k].certas, pend: s.pend + x[k].pend, ajuda: s.ajuda + x[k].ajuda }), { total: 0, certas: 0, pend: 0, ajuda: 0 })]));
    const chaves = Object.keys(ESTILOS).flatMap(e => [1, 2, 3, 'X', 'M'].map(n => e + n));
    // X = coluna Misto (melhor nota dos testes mistos da lição); na linha do total não se aplica.
    const celulaOuMedia = (p, k, lid, nums) => k.endsWith('M') ? celulaMedia(p, k.slice(0, -1))
      : k.endsWith('X') ? (nums ? celulaMisto(lid, nums, k.slice(0, -1)) : '<td class="muted">—</td>') : celulaNivel(p[k]);
    const tabelasNiveis = Object.values(livros).map(l => {
      const linhas = gruposLicoes(l.id, l.paginas.map(p => p.numero)).map(g => ({ g, p: progressoNiveis(l.id, g.nums) }));
      const total = soma(linhas.map(x => x.p));
      return `
        <h3>${esc(disciplinas[l.disciplina].nome)} · ${esc(l.titulo)}</h3>
        <div class="tabela-larga"><table class="tabela-niveis">
          <thead>
            <tr><th rowspan="2">Lição</th>${Object.values(ESTILOS).map(n => `<th colspan="5">${n}</th>`).join('')}</tr>
            <tr>${chaves.map(k => `<th>${k.endsWith('M') ? 'Média' : k.endsWith('X') ? 'Misto' : NIVEL[k.slice(-1)]}</th>`).join('')}</tr>
          </thead>
          <tbody>
            ${linhas.map(({ g, p }) => `<tr><td>${esc(g.licao?.titulo || pagina(l.id, g.nums[0]).titulo)} <small class="muted">(${intervalo(g.nums)})</small></td>${chaves.map(k => celulaOuMedia(p, k, l.id, g.nums)).join('')}</tr>`).join('')}
            <tr class="total"><td><b>Total</b></td>${chaves.map(k => celulaOuMedia(total, k)).join('')}</tr>
          </tbody>
        </table></div>`;
    }).join('');

    const tabelasLicoes = Object.values(livros).map(l => `
      <h3>${esc(disciplinas[l.disciplina].nome)} · ${esc(l.titulo)}</h3>
      <table>
        <thead><tr><th>Lição</th><th>Estudada</th><th>Tempo</th><th>Testes</th><th>Melhor nota</th><th title="Nível em que já acertou ${DOMINIO}% ou mais">Nível dominado</th></tr></thead>
        <tbody>${gruposLicoes(l.id, l.paginas.map(p => p.numero)).map(g => {
          const titulo = g.licao?.titulo || pagina(l.id, g.nums[0]).titulo;
          const segundos = g.nums.reduce((s, n) => s + (A.infoPagina(l.id, n).segundos || 0), 0);
          const nTestes = e.testes.filter(t => t.livro === l.id && t.tipo !== 'global' && g.nums.includes(t.pagina)).length;
          const nota = melhorNotaLicao(l.id, g.nums);
          const nivel = nivelDominado(l.id, g.nums);
          return `<tr><td>${esc(titulo)} <small class="muted">(${intervalo(g.nums)})</small></td><td>${licaoEstudada(l.id, g.nums) ? '✓' : '—'}</td>
            <td>${fmt(segundos)}</td><td>${nTestes}</td><td>${nota != null ? nota + '%' : '—'}</td><td>${nivel ? NIVEL[nivel] : '—'}</td></tr>`;
        }).join('')}</tbody>
      </table>`).join('');

    render(`
      <section class="cartao">
        <h1>Painel de estudo</h1>
        ${contaAtual ? `<p class="muted">Conta: <b>${esc(contaAtual)}</b>${A.testesPorEnviar ? ` · ⚠️ ${A.testesPorEnviar} teste(s) por gravar no servidor` : ' · ✅ tudo gravado no servidor'}</p>` : ''}
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
        ${testesEscola || '<p class="muted">Ainda não há testes marcados.</p>'}

        <h2>📝 Correções (notas finais)</h2>
        ${reais.length ? `
          <p>${pendentes.length ? `<b>${pendentes.length} teste(s) à espera de revisão.</b> <button class="btn prim" id="pedido-todos">⬇️ Descarregar todos para correção</button>` : '✅ Não há testes por corrigir.'}</p>
          <div class="tabela-larga"><table>
          <thead><tr><th>Data</th><th>Teste</th><th>Treino</th><th>Nível</th><th>Estado</th><th>✋ Autoavaliação</th><th>Nota final</th><th></th></tr></thead>
          <tbody>${reais.map(t => `<tr><td>${dataCurta(t.data)}</td><td>${esc(t.avaliacaoNome)}</td>
            <td>${t.modo === 'real' ? '🎓 Teste real' : '✍️ Escola'} · ${nomeTreino(t)}</td>
            <td>${DIFICULDADES[t.dificuldade]?.estrelas || ''} ${DIFICULDADES[t.dificuldade]?.nome || '—'}${t.exato ? ' 🎯' : ''}</td>
            <td>${t.estado === 'corrigido' ? '<span class="chip ok">Corrigido</span>' : `<span class="chip aviso">${t.modo === 'real' ? 'Por corrigir' : 'Por rever'}</span>`}</td>
            <td>${t.autoPercent != null ? `${t.autoPercent}%` : '—'}</td>
            <td>${t.percent != null ? `<b>${t.percent}%</b>` : '⏳'}</td>
            <td class="acoes-tabela"><button class="btn" data-abrir="${t.id}">▸ Respostas${t.respostas.some(r => r.reacao?.concorda === false) ? ' 💬' : ''}</button>
              ${t.estado !== 'corrigido' ? `<button class="btn" data-pedido="${t.id}">⬇️ Só este</button>` : ''}</td></tr>
            <tr class="detalhe-correcao" id="det-${t.id}" hidden><td colspan="8">
              ${t.correcao?.comentarioGeral ? `<div class="feedback ajuda">💬 ${esc(t.correcao.comentarioGeral)}</div>` : ''}
              ${t.respostas.map((r, i) => cartaoRespostaCorrecao({ t, r }, i, perguntasTodas, false, false)).join('')}
            </td></tr>`).join('')}</tbody>
          </table></div>
          ${(() => {
            const contest = e.testes.flatMap(t => t.respostas.filter(r => r.reacao?.concorda === false).map(r => ({ t, r })));
            const semResposta = contest.filter(({ r }) => !r.respostaRevisao || r.respostaRevisaoEm < r.reacao.data);
            const concorda = e.testes.flatMap(t => t.respostas.filter(r => r.reacao?.concorda === true)).length;
            if (!contest.length && !concorda) return '';
            const perg = id => Object.values(livros).flatMap(l => l.perguntas).find(q => q.id === id);
            return `<div class="feedback ${semResposta.length ? 'mau' : 'ajuda'}">
              <b>Reações da Leonor às correções:</b> 👍 concordou com ${concorda} · 👎 não concordou com ${contest.length}${semResposta.length ? ` — <b>${semResposta.length} à espera de resposta</b> (entram na próxima revisão)` : ''}.
              ${semResposta.length ? `<ul class="rever">${semResposta.map(({ t, r }) => `<li><b>${esc(r.pergunta || perg(r.id)?.pergunta || '')}</b><br>
                Resposta dela: ${esc(r.texto ?? '')} · nota final ${Math.round((r.pontuacao || 0) * 100)}%<br>💬 Ela diz: «${esc(r.reacao.comentario)}»</li>`).join('')}</ul>` : ''}
            </div>`;
          })()}
          <p class="muted">As notas finais aparecem aqui depois da revisão das respostas, que também confirma (ou não) as autoavaliações dela.
            Em alternativa: descarrega o pedido de correção e, depois, carrega aqui o ficheiro da correção.</p>
          <p><label class="btn">📥 Carregar correção<input type="file" id="correcao" accept=".json,application/json" hidden></label> <span id="msg-correcao" class="muted"></span></p>`
        : '<p class="muted">Ainda não há testes para corrigir. Os testes "✍️ Como no teste da escola" e "🎓 Teste real" aparecem aqui.</p>'}

        <h2>🔍 Autoavaliações</h2>
        ${(() => {
          const itens = e.testes.flatMap(autoavaliadas), porRever = itens.filter(r => !r.auditoria).length;
          const revistas = itens.filter(r => r.auditoria), ok = revistas.filter(r => r.auditoria === 'ok').length;
          return `<p>${itens.length} resposta(s) escritas em que foi ela a corrigir-se · <b>${porRever} por rever</b>${revistas.length ? ` · autoavaliou-se bem em ${pct(ok, revistas.length)}% das revistas` : ''}.
            <a class="btn ${porRever ? 'prim' : ''}" href="#/revisao">Rever autoavaliações</a></p>`;
        })()}

        <h2>Progresso por nível</h2>
        <p class="muted">Percentagem das perguntas de cada nível que ela já acertou <b>sem ajuda</b>, pelo menos uma vez — só sobe se praticar perguntas diferentes, em cada estilo.
          <b>+N💡</b> = perguntas que só acertou com ajuda (ainda não contam). <span class="cel-nivel provisorio">Roxo ✋</span> = valor provisório, inclui respostas autoavaliadas à espera de revisão.
          O caminho certo é ★ → ★★ → ★★★, nos dois estilos.</p>
        ${tabelasNiveis}

        <h2>Acertos por nível <small class="muted">(todas as respostas, sem ajuda)</small></h2>
        <div class="niveis">
          ${[1, 2, 3].map(n => `<span class="chip">${NIVEL[n]} ${porNivel[n].t ? pct(porNivel[n].c, porNivel[n].t) + '%' : '—'} <small class="muted">(${porNivel[n].c}/${porNivel[n].t})</small></span>`).join('')}
        </div>

        <h2>Lições</h2>
        <p class="muted">Nível dominado: o nível mais alto em que ela já acertou ${DOMINIO}% ou mais num teste da lição. O ideal é ir subindo de ★ para ★★★.</p>
        ${tabelasLicoes}

        <h2>Últimos treinos</h2>
        ${e.testes.length ? `<table>
          <thead><tr><th>Data</th><th>Teste da escola</th><th>Treino</th><th>Dificuldade</th><th>Nota</th><th title="Respostas em que pediu ajuda ou foi ver a matéria (valem metade)">💡 Com ajuda</th><th title="Respostas que ela própria corrigiu">✋ Autoavaliadas</th></tr></thead>
          <tbody>${[...e.testes].reverse().slice(0, 15).map(t => `<tr><td>${dataCurta(t.data)}</td>
            <td>${esc(t.avaliacaoNome || '—')}</td>
            <td>${nomeTreino(t)}</td>
            <td>${MODOS[t.modo]?.nome || ''} · ${DIFICULDADES[t.dificuldade].nome}${t.exato ? ' 🎯' : ''}</td>
            <td>${t.percent != null ? `<b>${t.percent}%</b> <small class="muted">(${t.pontos}/${t.total})</small>${t.autoPercent != null ? ` <small class="muted">✋ ${t.autoPercent}%</small>` : ''}`
              : t.autoPercent != null ? `<span class="chip aviso">✋ ${t.autoPercent}% · ⏳ final</span>` : '<span class="chip aviso">Por corrigir</span>'}</td>
            <td>${comAjuda(t) ? `<span class="chip aviso">${comAjuda(t)} de ${t.total}</span>` : '—'}</td>
            <td>${autoavaliadas(t).length ? `${autoavaliadas(t).length}${autoavaliadas(t).some(r => !r.auditoria) ? ' <small class="muted">(por rever)</small>' : ''}` : '—'}</td></tr>`).join('')}</tbody>
        </table>` : '<p class="muted">Ainda não há treinos.</p>'}

        <h2>Perguntas que custam mais</h2>
        <p class="muted">Perguntas que ela já falhou (ou só acertou com ajuda) alguma vez. <b>🔴 Ainda custa</b>: a última tentativa falhou ·
          <b>🟡 A melhorar</b>: acertou as últimas 1–2 vezes · <b>🟢 Já não custa</b>: acertou ${SEGUIDAS} vezes seguidas sem ajuda.
          O objetivo é o número de 🔴 ir descendo — para isso há o treino <b>"🎯 As que mais custam"</b> em cada teste e no livro.</p>
        ${htmlCustam}

        <p><button class="btn" id="exportar">⬇️ Guardar cópia do progresso</button>
          <label class="btn">📥 Juntar testes de uma cópia<input type="file" id="importar" accept=".json,application/json" hidden></label>
          <span id="msg-importar" class="muted"></span></p>
        <p class="muted">"Juntar testes" acrescenta os testes de uma cópia que ainda não estejam gravados (não apaga nem repete nada).</p>

        <h2>Recomeçar do zero</h2>
        <p class="muted">Apaga as páginas estudadas e todos os treinos e notas. Os testes da escola (datas e páginas) ficam.</p>
        <label class="ponto"><input type="checkbox" id="apagar-tempos"> Apagar também os tempos de estudo</label>
        <p><button class="btn perigo" id="recomecar">🗑️ Recomeçar do zero</button> <span id="msg-recomecar" class="muted"></span></p>
      </section>`);
    document.getElementById('recomecar').onclick = async () => {
      const tempos = document.getElementById('apagar-tempos').checked;
      if (!confirm(`Apagar as páginas estudadas e todos os treinos${tempos ? ' e os tempos de estudo' : ''}? Isto não se pode desfazer.`)) return;
      try { await A.apagarProgresso({ tempos }); atualizarRelogio(); ecraPainel(); }
      catch (erro) { document.getElementById('msg-recomecar').textContent = 'Não foi possível apagar: ' + erro.message; }
    };
    document.getElementById('exportar').onclick = A.exportar;
    document.getElementById('importar').onchange = async ev => {
      const $m = document.getElementById('msg-importar');
      try {
        const copia = JSON.parse(await ev.target.files[0].text());
        const n = await A.importarTestes(copia.testes || []);
        ecraPainel();
        document.getElementById('msg-importar').textContent = n ? `✅ ${n} teste(s) juntados.` : 'Não havia testes novos nesta cópia.';
      } catch (erro) { $m.textContent = 'Não foi possível juntar: ' + erro.message; }
    };
    $app.querySelectorAll('[data-pedido]').forEach(bt => bt.onclick = () => descarregarParaCorrecao([testeReal(bt.dataset.pedido)]));
    // Abrir/fechar as respostas de um teste na tabela das correções (com as reações da Leonor).
    $app.querySelectorAll('[data-abrir]').forEach(bt => bt.onclick = () => {
      const det = document.getElementById('det-' + bt.dataset.abrir);
      det.hidden = !det.hidden;
      bt.textContent = bt.textContent.replace(det.hidden ? '▾' : '▸', det.hidden ? '▸' : '▾');
    });
    const $todos = document.getElementById('pedido-todos');
    if ($todos) $todos.onclick = () => descarregarParaCorrecao(pendentes);
    const $correcao = document.getElementById('correcao');
    if ($correcao) $correcao.onchange = async () => {
      const $msg = document.getElementById('msg-correcao');
      try {
        const feitos = await carregarCorrecao($correcao.files[0]);
        if (feitos.length === 1) location.hash = `#/real/${feitos[0].id}`;
        else { ecraPainel(); document.getElementById('msg-correcao').textContent = `✅ ${feitos.length} testes corrigidos.`; }
      } catch (erro) { $msg.textContent = 'Não foi possível carregar: ' + erro.message; }
    };
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
    const paginas = bancos.flatMap(b => (b.paginas || []).map(p => ({ ...p, capitulo: b.capitulo })));
    // zonas: { pagina: { onde: [x, y, largura, altura] em % da página } } — onde está a resposta na imagem.
    const zonas = Object.assign({}, ...bancos.map(b => b.zonas || {}));
    // ajustes: { id: { pergunta?, escritaPergunta?, imagem?: { pagina, zona: [x, y, w, h] } } } — p. ex. perguntas
    // sobre uma imagem do livro passam a mostrar só a imagem recortada (sem a legenda) em vez de remeter para o livro.
    const ajustes = Object.assign({}, ...bancos.map(b => b.ajustes || {}));
    const perguntas = bancos.flatMap(b => b.perguntas || []).map(q => {
      const aj = ajustes[q.id] || {};
      return {
        ...q, zona: q.zona || zonas[q.pagina]?.[q.onde],
        ...(aj.pergunta && { pergunta: aj.pergunta }),
        ...(aj.imagem && { imagem: aj.imagem }),
        ...(q.escrita && aj.escritaPergunta && { escrita: { ...q.escrita, pergunta: aj.escritaPergunta } }),
      };
    });
    const licoes = bancos.flatMap(b => b.licoes || []);
    let url = f => '../' + info.base + f;
    if (db) {
      const caminhos = paginas.map(p => info.base + p.imagem);
      const assinados = await db.storage.from(BUCKET).createSignedUrls(caminhos, 60 * 60 * 12);
      if (assinados.error) throw assinados.error;
      const urls = Object.fromEntries(assinados.data.map(s => [s.path, s.signedUrl]));
      url = f => urls[info.base + f];
    }
    return { ...info, disciplina, paginas: paginas.sort((a, b) => a.numero - b.numero), perguntas, licoes, url };
  }

  async function iniciar() {
    if (db) {
      const { data } = await db.auth.getSession();
      if (!data.session) return ecraLogin();
      $sair.hidden = false;
      contaAtual = data.session.user?.email || '';
      $sair.title = 'Conta: ' + contaAtual;
    }
    try {
      // Aviso no topo enquanto houver testes que não se conseguiram gravar no servidor.
      const $avisoGravar = document.getElementById('aviso-gravar');
      A.aoMudarPendentes = n => {
        $avisoGravar.hidden = !n;
        $avisoGravar.innerHTML = n ? `⚠️ ${n} teste(s) ainda não foram gravados no servidor (ficaram guardados neste computador). <b>Não limpes o browser.</b> A app vai tentar outra vez. <button class="btn mini" id="tentar-gravar">Tentar agora</button>` : '';
        document.getElementById('tentar-gravar')?.addEventListener('click', () => A.reenviarPendentes());
      };
      await A.iniciar(db);
      const catalogo = await (await fetch('catalogo.json', { cache: 'no-cache' })).json();
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
