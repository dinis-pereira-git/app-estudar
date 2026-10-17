// Motor de testes.
// - Teste de página: ~70% perguntas da página nova + ~30% das páginas anteriores do plano.
// - Teste global: todas as páginas do plano.
// - A dificuldade escolhida define a mistura de níveis.
// - Perguntas erradas antes têm mais probabilidade de voltar a sair.
const Motor = (() => {
  const MISTURAS = {
    facil:   { 1: 0.6, 2: 0.3, 3: 0.1 },
    medio:   { 1: 0.3, 2: 0.5, 3: 0.2 },
    dificil: { 1: 0.1, 2: 0.4, 3: 0.5 },
    misto:   { 1: 0.4, 2: 0.4, 3: 0.2 },
  };
  const PERCENT_PAGINA_NOVA = 0.7;
  const TAMANHO = { pagina: 8, global: 15 };

  const baralhar = lista => {
    const a = [...lista];
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  };

  function amostraPesada(lista, n, peso) {
    const pool = lista.map(x => ({ x, w: peso(x) }));
    const out = [];
    while (out.length < n && pool.length) {
      let r = Math.random() * pool.reduce((s, p) => s + p.w, 0);
      let i = 0;
      while (i < pool.length - 1 && r > pool[i].w) { r -= pool[i].w; i++; }
      out.push(pool.splice(i, 1)[0].x);
    }
    return out;
  }

  // Quotas por nível pelo método do maior resto, depois completa com o que houver.
  function porNivel(lista, n, mistura, peso) {
    const brutas = [1, 2, 3].map(l => n * mistura[l]);
    const quotas = brutas.map(Math.floor);
    let falta = n - quotas.reduce((s, q) => s + q, 0);
    [0, 1, 2].sort((a, b) => (brutas[b] - quotas[b]) - (brutas[a] - quotas[a])).forEach(i => { if (falta > 0) { quotas[i]++; falta--; } });

    const escolhidas = [];
    [1, 2, 3].forEach((nivel, i) => escolhidas.push(...amostraPesada(lista.filter(q => q.nivel === nivel), quotas[i], peso)));
    if (escolhidas.length < n) escolhidas.push(...amostraPesada(lista.filter(q => !escolhidas.includes(q)), n - escolhidas.length, peso));
    return escolhidas;
  }

  function gerar({ perguntas, historico, paginas, alvo, dificuldade }) {
    const mistura = MISTURAS[dificuldade];
    const peso = q => { const h = historico[q.id]; return h ? 1 + 2 * h.erradas / (1 + h.certas) : 1.5; };
    let selecao;

    if (alvo == null) {
      const pool = perguntas.filter(q => paginas.includes(q.pagina));
      selecao = porNivel(pool, Math.min(TAMANHO.global, pool.length), mistura, peso);
    } else {
      const novas = perguntas.filter(q => q.pagina === alvo);
      const antigas = perguntas.filter(q => paginas.includes(q.pagina) && q.pagina < alvo);
      const n = Math.min(TAMANHO.pagina, novas.length + antigas.length);
      const nNovas = Math.min(novas.length, antigas.length ? Math.round(n * PERCENT_PAGINA_NOVA) : n);
      selecao = porNivel(novas, nNovas, mistura, peso);
      selecao.push(...porNivel(antigas, n - selecao.length, mistura, peso));
    }

    // Baralha a ordem das perguntas e das opções (exceto verdadeiro/falso).
    return baralhar(selecao).map(q => {
      const ordem = q.tipo === 'vf' ? q.opcoes.map((_, i) => i) : baralhar(q.opcoes.map((_, i) => i));
      return { ...q, opcoes: ordem.map(i => q.opcoes[i]), correta: ordem.indexOf(q.correta) };
    });
  }

  return { gerar, MISTURAS };
})();
