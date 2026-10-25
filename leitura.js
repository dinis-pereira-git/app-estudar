// Ler em voz alta (Inglês): ouvir a frase com voz britânica gravada e ler em voz alta, com avaliação.
// A avaliação usa o reconhecimento de voz do Chrome (en-GB): compara as palavras que ele percebeu com a frase
// e mostra a verde as palavras ditas e a vermelho as que faltaram. Não é uma nota de sotaque: diz se o que ela
// leu se percebe, palavra a palavra. Passa com 70% ou depois de 3 tentativas (para não ficar presa).
const Leitura = (() => {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const PASSA = 70, TENTATIVAS = 3;
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  // O reconhecimento escreve os números em algarismos ("3", "22nd"): passam a palavras para comparar com a frase.
  const UNID = 'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen'.split(' ');
  const DEZ = ',,twenty thirty forty fifty sixty seventy eighty ninety'.split(',');
  const extenso = n => n < 20 ? UNID[n] : n < 100 ? DEZ[Math.floor(n / 10)] + (n % 10 ? ' ' + UNID[n % 10] : '') : String(n);
  const numeros = s => s.replace(/\b(\d{1,2})(st|nd|rd|th)?\b/gi, (_, d) => ' ' + extenso(+d) + ' ');
  // Palavras da frase a ler (os espaços em branco ___ não contam).
  const palavras = s => norm(numeros(String(s || '').replace(/_{2,}/g, ' ').replace(/-/g, ' '))).split(' ').filter(Boolean);

  // Quantas palavras da frase aparecem, pela mesma ordem, no que foi ouvido (maior subsequência comum).
  function comparar(alvo, ouvido) {
    const a = palavras(alvo), b = palavras(ouvido);
    const t = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
    for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--)
      t[i][j] = a[i] === b[j] ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1]);
    const certas = new Array(a.length).fill(false);
    for (let i = 0, j = 0; i < a.length && j < b.length;) {
      if (a[i] === b[j]) { certas[i] = true; i++; j++; } else if (t[i + 1][j] >= t[i][j + 1]) i++; else j++;
    }
    const n = certas.filter(Boolean).length;
    return { palavras: a, certas, pct: a.length ? Math.round(100 * n / a.length) : 0 };
  }

  function ouvirUmaVez(lingua) {
    return new Promise((resolve, reject) => {
      const r = new SR();
      r.lang = lingua; r.interimResults = false; r.maxAlternatives = 5; r.continuous = false;
      let ok = false;
      r.onresult = ev => { ok = true; resolve([...ev.results[0]].map(a => a.transcript)); };
      r.onerror = ev => reject(new Error(ev.error === 'not-allowed' ? 'The microphone is blocked. Click the padlock in the address bar and allow the microphone. (O microfone não tem autorização.)' : ev.error === 'no-speech' ? 'I did not hear anything. Speak closer to the microphone.' : 'I could not hear you (' + ev.error + ').'));
      r.onend = () => { if (!ok) reject(new Error('I did not hear anything. Try again.')); };
      r.start();
    });
  }

  // el: onde pôr o bloco; texto: frase a ler; urlAudio: voz gravada; estado: { melhor, tentativas, passou } (guardado
  // pelo chamador para não se perder ao redesenhar); aoPassar(): chamado a primeira vez que passa.
  function montar(el, { titulo, texto, urlAudio, lingua = 'en-GB', estado, aoPassar }) {
    if (!el) return;
    // A voz é carregada logo que a pergunta aparece; ao carregar em Ouvir espera-se que esteja pronta e começa com
    // uma pequena pausa (na 1.ª vez cortava o início: o som ainda não tinha carregado ou as colunas estavam a "acordar").
    const som = urlAudio ? Object.assign(new Audio(), { preload: 'auto', src: urlAudio }) : null;
    const tocar = () => {
      if (!som) return;
      som.pause(); som.currentTime = 0;
      const ir = () => Leitura.acordarSom().then(() => som.play().catch(() => {}));
      if (som.readyState >= 4) ir(); else { som.addEventListener('canplaythrough', ir, { once: true }); som.load(); }
    };
    const desenhar = (res, msg) => {
      const frase = res ? res.palavras.map((p, i) => `<span class="${res.certas[i] ? 'lida-ok' : 'lida-falta'}">${esc(p)}</span>`).join(' ') : '';
      el.innerHTML = `
        <div class="leitura ${estado.passou ? 'passou' : ''}">
          <div class="leitura-topo"><b>${titulo}</b>
            ${estado.melhor != null ? `<span class="chip ${estado.melhor >= PASSA ? 'ok' : 'aviso'}">🎤 ${estado.melhor}%</span>` : ''}</div>
          <div class="leitura-botoes">
            ${urlAudio ? '<button class="btn" data-ouvir>🔊 Listen</button>' : ''}
            ${SR ? '<button class="btn prim" data-ler>🎤 Read aloud</button>' : ''}
          </div>
          ${frase ? `<p class="leitura-frase">${frase}</p>` : ''}
          ${msg ? `<p class="leitura-msg">${msg}</p>` : ''}
          ${!SR ? '<p class="muted">This browser cannot hear you (use Chrome). You can go on.</p>' : ''}
        </div>`;
      el.querySelector('[data-ouvir]')?.addEventListener('click', tocar);
      el.querySelector('[data-ler]')?.addEventListener('click', async ev => {
        const bt = ev.currentTarget; bt.disabled = true; bt.textContent = '🔴 Listening… read now';
        try {
          const alternativas = await ouvirUmaVez(lingua);
          const res = alternativas.map(a => comparar(texto, a)).sort((x, y) => y.pct - x.pct)[0];
          estado.tentativas = (estado.tentativas || 0) + 1;
          estado.melhor = Math.max(estado.melhor ?? 0, res.pct);
          const antes = estado.passou;
          if (res.pct >= PASSA || estado.tentativas >= TENTATIVAS) estado.passou = true;
          const msg = res.pct >= 90 ? '🌟 Excellent reading!' : res.pct >= PASSA ? '👍 Well done!' :
            estado.passou ? '🙂 You can go on — but practise this sentence again with 🔊.' :
            `Listen again (🔊) and try again — try ${estado.tentativas} of ${TENTATIVAS}.`;
          desenhar(res, msg);
          if (estado.passou && !antes) aoPassar?.();
        } catch (erro) {
          desenhar(null, '⚠️ ' + esc(erro.message));
        }
      });
    };
    desenhar(null, estado.passou ? '' : 'First listen (🔊), then read aloud (🎤).');
    if (!SR && !estado.passou) { estado.passou = true; aoPassar?.(); }
  }

  // As colunas/auscultadores (sobretudo Bluetooth) "adormecem" nos silêncios e cortam o início de cada som.
  // Ao primeiro som, liga-se um tom inaudível (volume quase zero) que fica a tocar enquanto a página está aberta,
  // para nunca adormecerem; na 1.ª vez espera-se ~0,8 s antes de tocar o som a sério.
  let acordado = null, ctx = null;
  function acordarSom() {
    if (ctx?.state === 'suspended') ctx.resume().catch(() => {});
    if (acordado) return acordado;
    acordado = new Promise(resolve => {
      try {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator(), g = ctx.createGain();
        osc.frequency.value = 30; g.gain.value = 0.001; osc.connect(g); g.connect(ctx.destination);
        ctx.resume().then(() => { osc.start(); setTimeout(resolve, 800); }).catch(resolve);
      } catch { resolve(); }
    });
    return acordado;
  }

  return { montar, comparar, acordarSom, suportado: !!SR, PASSA };
})();
