// Aulas visuais: a "câmara" percorre as páginas do livro (aproxima-se de cada figura, com uma moldura a apontar),
// uma voz gravada (Raquel, pt-PT) explica, há animações desenhadas e, no fim, uma tabela-resumo ao lado da imagem.
// Os passos de cada aula vêm do banco do livro (aulas-*.json, gerado por ferramentas/aulas-*.js).
// Passo: { pag, camara: [x, y, l, a] (% da página), marcas: [[x, y, l, a]...], etiqueta: [texto, x, y], texto,
//          percurso: [[x, y]...] (linha a desenhar-se por cima da página), anim: 'nome', resumo: {...} }
const Aulas = (() => {
  // ---------- animações desenhadas (SVG) ----------
  const ANIMACOES = {
    // Uma ferida na pele: o sangue traz prótidos, água e sais minerais, que viram células novas até a ferida fechar.
    ferida() {
      const celulas = [], novas = [], parts = [];
      for (let k = 0; k < 10; k++) (k >= 4 && k <= 6 ? novas : celulas).push(22 + k * 76);
      const cel = (x, cls = '', delay = 0) => `<g class="rot ${cls}" style="animation-delay:${delay}s"><rect x="${x}" y="120" width="70" height="80" rx="18" fill="#f6c9a8" stroke="#d99b74" stroke-width="3"/><circle cx="${x + 35}" cy="160" r="12" fill="#c9785a"/></g>`;
      const formas = [
        '<rect x="-11" y="-11" width="22" height="22" rx="4" fill="#ffc533" stroke="#c99400" stroke-width="2"/><text y="6" text-anchor="middle" font-size="15" font-weight="700" fill="#7a5a00">P</text>',
        '<path d="M0 -13 C8 -2 10 4 0 12 C-10 4 -8 -2 0 -13Z" fill="#4aa8ff" stroke="#1f6fc0" stroke-width="2"/>',
        '<circle r="8" fill="#9aa3b0" stroke="#5d6673" stroke-width="2"/>',
      ];
      for (let k = 0; k < 18; k++) {
        const x0 = 260 + (k * 53) % 300, alvo = 340 + (k * 37) % 170;
        parts.push(`<g transform="translate(${x0} 405)"><g class="particula" style="--dx:${alvo - x0}px;--dy:-245px;animation-delay:${1.5 + k * 0.55}s">${formas[k % 3]}</g></g>`);
      }
      return `<svg viewBox="0 0 800 500">
        <text x="400" y="50" text-anchor="middle" font-size="30" font-weight="700" fill="#b4441f">Dentro da ferida</text>
        <rect x="0" y="110" width="800" height="100" fill="#fbe3d3"/>
        <text x="14" y="100" font-size="18" fill="#8a5a40">Pele (células)</text>
        ${celulas.map(x => cel(x)).join('')}
        <g class="ferida"><rect x="318" y="114" width="232" height="92" rx="12" fill="#e2483a"/><text x="434" y="168" text-anchor="middle" font-size="22" font-weight="700" fill="#fff">ferida</text></g>
        ${novas.map((x, k) => cel(x, 'nova', 6 + k * 2.2)).join('')}
        <rect x="0" y="385" width="800" height="44" rx="22" fill="#e9898a"/>
        <text x="14" y="455" font-size="18" fill="#9b2f30">Vaso sanguíneo (sangue)</text>
        ${parts.join('')}
        <g font-size="17" fill="#1d2433">
          <rect x="380" y="440" width="18" height="18" rx="3" fill="#ffc533"/><text x="404" y="455">prótidos (proteínas)</text>
          <path d="M615 438 C621 446 623 451 615 458 C607 451 609 446 615 438Z" fill="#4aa8ff"/><text x="628" y="455">água</text>
          <circle cx="685" cy="449" r="8" fill="#9aa3b0"/><text x="698" y="455">sais minerais</text>
        </g>
        <g class="aparecer" style="animation-delay:14s"><rect x="190" y="250" width="420" height="60" rx="30" fill="#2f6fdf"/><text x="400" y="289" text-anchor="middle" font-size="24" font-weight="700" fill="#fff">Função plástica: formar e reparar</text></g>
      </svg>`;
    },

    // A cárie a avançar: açúcar → bactérias → ácidos que furam o esmalte, a dentina e chegam à polpa.
    carie() {
      const bact = [0, 1, 2, 3, 4, 5].map(k => `<g class="aparecer" style="animation-delay:${2 + k * 0.3}s"><ellipse cx="${330 + k * 28}" cy="${92 + (k % 2) * 14}" rx="11" ry="6" fill="#7bc043" stroke="#3d7a14" stroke-width="2"/></g>`).join('');
      return `<svg viewBox="0 0 800 500">
        <text x="400" y="44" text-anchor="middle" font-size="28" font-weight="700" fill="#b4441f">Como se forma uma cárie</text>
        <path d="M250 130 Q250 90 300 90 L500 90 Q550 90 550 130 L540 330 Q530 380 480 470 L440 470 Q430 400 400 400 Q370 400 360 470 L320 470 Q270 380 260 330Z" fill="#fffdf6" stroke="#cfc6ad" stroke-width="5"/>
        <path d="M285 140 Q285 118 315 118 L485 118 Q515 118 515 140 L505 320 Q495 360 460 440 L445 440 Q430 385 400 385 Q370 385 355 440 L340 440 Q305 360 295 320Z" fill="#f3e2b8"/>
        <path d="M340 170 Q340 150 360 150 L440 150 Q460 150 460 170 L450 300 Q440 330 420 400 L380 400 Q360 330 350 300Z" fill="#f19aa0"/>
        <text x="575" y="110" font-size="18" fill="#6c6350">esmalte</text><text x="575" y="200" font-size="18" fill="#8a6d2b">dentina</text><text x="575" y="270" font-size="18" fill="#a23b44">polpa (nervos)</text>
        <g class="aparecer" style="animation-delay:.8s"><rect x="300" y="60" width="200" height="22" rx="11" fill="#fff" stroke="#e6a0c8" stroke-width="2"/><text x="400" y="77" text-anchor="middle" font-size="15" fill="#a2306f">açúcar dos alimentos</text></g>
        ${bact}
        <g class="aparecer" style="animation-delay:4s"><text x="235" y="118" text-anchor="end" font-size="17" font-weight="700" fill="#3d7a14">bactérias → ácidos</text></g>
        <path class="buraco" style="animation-delay:5s" d="M386 90 Q400 140 414 90Z" fill="#3b2a1a"/>
        <path class="buraco" style="animation-delay:8s" d="M380 90 Q400 205 420 90Z" fill="#3b2a1a"/>
        <path class="buraco" style="animation-delay:11s" d="M374 90 Q400 330 426 90Z" fill="#3b2a1a"/>
        <g class="aparecer" style="animation-delay:12.5s"><circle cx="400" cy="250" r="34" fill="none" stroke="#e2483a" stroke-width="5"/><text x="400" y="300" text-anchor="middle" font-size="20" font-weight="700" fill="#e2483a">dói!</text></g>
      </svg>`;
    },

    // Absorção: os nutrientes simples passam do interior do intestino, pelas vilosidades, para o sangue.
    absorcao() {
      const vilos = [0, 1, 2, 3, 4, 5].map(k => { const x = 110 + k * 110; return `<path d="M${x - 35} 330 L${x - 35} 190 Q${x - 35} 140 ${x} 140 Q${x + 35} 140 ${x + 35} 190 L${x + 35} 330Z" fill="#f4b6b0" stroke="#d27c74" stroke-width="3"/><path d="M${x - 12} 330 L${x - 12} 190 Q${x} 168 ${x + 12} 190 L${x + 12} 330" fill="none" stroke="#c0392b" stroke-width="5"/>`; }).join('');
      const nutri = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(k => {
        const x0 = 80 + (k * 61) % 640, cor = ['#ffc533', '#4aa8ff', '#7bc043', '#e67ce0'][k % 4];
        const alvo = 110 + (k % 6) * 110 + (k % 2 ? -12 : 12);
        return `<g transform="translate(${x0} 90)"><g class="particula" style="--dx:${alvo - x0}px;--dy:200px;animation-delay:${1 + k * 0.7}s"><circle r="9" fill="${cor}" stroke="#0004" stroke-width="2"/></g></g>`;
      }).join('');
      return `<svg viewBox="0 0 800 500">
        <text x="400" y="40" text-anchor="middle" font-size="28" font-weight="700" fill="#b4441f">Absorção no intestino delgado</text>
        <text x="20" y="80" font-size="18" fill="#637087">interior do intestino (nutrientes simples)</text>
        ${vilos}
        <rect x="0" y="330" width="800" height="60" fill="#e9898a"/><text x="20" y="420" font-size="18" fill="#9b2f30">sangue → leva os nutrientes a todas as células</text>
        <text x="610" y="130" font-size="17" fill="#a0453d">vilosidade</text>
        ${nutri}
        <g class="aparecer" style="animation-delay:10s"><rect x="210" y="440" width="380" height="46" rx="23" fill="#2f6fdf"/><text x="400" y="470" text-anchor="middle" font-size="20" font-weight="700" fill="#fff">absorção: do intestino para o sangue</text></g>
      </svg>`;
    },
  };

  // ---------- leitor ----------
  // el: onde pôr a aula; aula: { titulo, passos }; urlPagina(n), urlAudio(k): endereços das imagens e dos sons.
  const verLegendas = () => { try { return localStorage.getItem('app-ver-legendas') === '1'; } catch { return false; } };
  function montar(el, aula, { urlPagina, urlAudio }) {
    el.innerHTML = `
      <div class="aula">
        <div class="aula-palco"><div class="aula-folha"><img alt=""></div><div class="aula-anim"></div><div class="aula-resumo"></div><div class="aula-pausa" hidden></div></div>
        <div class="aula-legenda"></div>
        <div class="aula-traducao" hidden></div>
        <div class="aula-ler" hidden></div>
        <div class="aula-controlos">
          <button class="btn" data-a="ant">⏮</button>
          <button class="btn prim" data-a="play">▶ Começar a aula</button>
          <button class="btn" data-a="seg">⏭</button>
          ${aula.passos.some(p => p.legenda || p.partes?.some(x => x.legenda)) ? '<button class="btn" data-a="leg">🇵🇹 Subtitles</button>' : ''}
          <span class="muted aula-passo"></span>
        </div>
        <div class="aula-barra"><div></div></div>
      </div>`;
    const q = s => el.querySelector(s);
    const palco = q('.aula-palco'), folha = q('.aula-folha'), img = q('.aula-folha img');
    const P = aula.passos, audio = new Audio();
    let i = 0, aTocar = false, temporizadores = [];
    const leituras = {}; // leituras em voz alta já feitas nesta aula (para a nota no fim)
    const limpar = () => { temporizadores.forEach(clearTimeout); temporizadores = []; };
    const depois = (f, ms) => temporizadores.push(setTimeout(f, ms));

    function apontar(p) {
      if (!p.camara || !img.naturalWidth) return;
      const Wp = palco.clientWidth, H = palco.clientHeight, W = p.resumo ? Wp * 0.54 : Wp;
      const iw = Wp, ih = iw * img.naturalHeight / img.naturalWidth;
      const [x, y, w, h] = p.camara;
      const s = Math.min(W / (iw * w / 100), H / (ih * h / 100));
      const cx = iw * (x + w / 2) / 100, cy = ih * (y + h / 2) / 100;
      folha.style.width = iw + 'px';
      folha.style.transform = `translate(${W / 2 - cx * s}px, ${H / 2 - cy * s}px) scale(${s})`;
    }

    function desenharMarcas(p) {
      for (const [x, y, w, h] of p.marcas || []) {
        const m = Object.assign(document.createElement('div'), { className: 'aula-marca' });
        Object.assign(m.style, { left: x + '%', top: y + '%', width: w + '%', height: h + '%' });
        folha.appendChild(m); requestAnimationFrame(() => m.classList.add('ver'));
      }
      if (p.etiqueta) {
        const [t, x, y] = p.etiqueta;
        const e = Object.assign(document.createElement('div'), { className: 'aula-etiqueta', textContent: t });
        Object.assign(e.style, { left: x + '%', top: y + '%' });
        folha.appendChild(e); requestAnimationFrame(() => e.classList.add('ver'));
      }
      if (p.percurso) {
        // Linha que se desenha devagar por cima da página (ex.: o caminho dos alimentos no tubo digestivo).
        const r = img.naturalHeight / img.naturalWidth;
        const pts = p.percurso.map(([x, y]) => `${x},${y * r}`).join(' ');
        folha.insertAdjacentHTML('beforeend', `<svg class="aula-percurso" viewBox="0 0 100 ${100 * r}" preserveAspectRatio="none"><polyline points="${pts}" pathLength="100" style="animation-duration:${p.duracao || 8}s"/></svg>`);
      }
    }

    // Passos "em partes" (aulas de Inglês): cada parte tem a sua voz (prof = explica, ex = exemplo), as suas marcas
    // no livro e, às vezes, uma pausa para a Leonor repetir (🔁 Repeat!) ou pensar (🤔 Think!).
    // Quem fala: prof = professora (explica), ex = exemplos, texto = leitura do livro, menina/harry = diálogo.
    const ICONE_VOZ = { ex: '🗣️ ', texto: '📖 ', menina: '👧 ', harry: '👦 ' };
    const marcasParte = parte => {
      if (!parte?.marcas) return;
      folha.querySelectorAll('.aula-marca').forEach(e => e.remove());
      desenharMarcas({ marcas: parte.marcas });
    };
    function ativarParte(p, j) {
      el.querySelectorAll('.aula-parte').forEach((e, k) => { e.classList.toggle('ativa', k === j); e.classList.toggle('dita', k < j); });
      marcasParte(p.partes[j]);
      const $tr = q('.aula-traducao');
      $tr.innerHTML = p.partes[j].legenda || '';
      $tr.hidden = !p.partes[j].legenda || !verLegendas();
    }
    function tocarParte(k, j) {
      const p = P[k], parte = p.partes[j];
      ativarParte(p, j);
      audio.src = urlAudio(k + 1, j + 1);
      audio.onended = () => {
        if (!aTocar || i !== k) return;
        const seguir = () => (j + 1 < p.partes.length ? tocarParte(k, j + 1) : depois(() => (i < P.length - 1 ? mostrar(i + 1) : parar(true)), 900));
        // Repetir: a aula espera que a Leonor leia em voz alta (🎤) e avalia a leitura; só depois continua.
        if (parte.pausa && (parte.acao || 'repetir') === 'repetir' && window.Leitura) {
          const $p = q('.aula-pausa'), $l = q('.aula-ler');
          $p.textContent = '🔁 Your turn!'; $p.hidden = false; $l.hidden = false;
          const texto = parte.ler || parte.texto.replace(/<[^>]+>/g, '');
          const estado = leituras[k + '-' + j] || (leituras[k + '-' + j] = {});
          Leitura.montar($l, { titulo: '🎤 Read it aloud: <i>' + texto + '</i>', texto, urlAudio: urlAudio(k + 1, j + 1), estado,
            aoPassar: () => depois(() => { if (!aTocar || i !== k) return; $p.hidden = true; $l.hidden = true; seguir(); }, 1800) });
          if (estado.passou) { $l.hidden = true; $p.hidden = true; depois(seguir, 450); }
        } else if (parte.pausa) {
          const $p = q('.aula-pausa');
          $p.textContent = parte.acao === 'pensar' ? '🤔 Think!' : parte.acao === 'responder' ? '🗣️ Your turn! Answer.' : '🔁 Repeat!';
          $p.hidden = false;
          depois(() => { $p.hidden = true; seguir(); }, parte.pausa * 1000);
        } else depois(seguir, 450);
      };
      (window.Leitura?.acordarSom() || Promise.resolve()).then(() => audio.play().catch(() => {}));
    }

    function mostrar(n) {
      limpar(); audio.pause();
      i = Math.max(0, Math.min(P.length - 1, n));
      const p = P[i];
      folha.querySelectorAll('.aula-marca, .aula-etiqueta, .aula-percurso').forEach(e => e.remove());
      const $anim = q('.aula-anim'), $res = q('.aula-resumo');
      if (p.anim && ANIMACOES[p.anim]) { $anim.innerHTML = ANIMACOES[p.anim](); $anim.classList.add('ver'); } else $anim.classList.remove('ver');
      if (p.resumo) {
        const r = p.resumo;
        $res.innerHTML = `<h3>${r.titulo}</h3><table><tr>${r.colunas.map(c => `<th>${c}</th>`).join('')}</tr>${r.linhas.map(l => `<tr class="linha">${l.slice(0, r.colunas.length).map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</table>`;
        $res.classList.add('ver');
        const linhas = [...$res.querySelectorAll('tr.linha')];
        r.linhas.forEach((l, k) => depois(() => linhas[k].classList.add('ver'), aTocar ? 1300 + (l[r.colunas.length] ?? k * 3) * 1000 : 600 + k * 500));
      } else $res.classList.remove('ver');
      if (p.pag) {
        const src = urlPagina(p.pag);
        const pronto = () => { apontar(p); depois(() => desenharMarcas(p), 1200); };
        if (img.dataset.pag !== String(p.pag)) { img.onload = pronto; img.dataset.pag = p.pag; img.src = src; } else pronto();
      }
      q('.aula-pausa').hidden = true; q('.aula-ler').hidden = true;
      q('.aula-legenda').innerHTML = p.partes
        ? p.partes.map(pt => `<p class="aula-parte voz-${pt.voz || 'prof'}">${ICONE_VOZ[pt.voz] || ''}${pt.texto}</p>`).join('')
        : p.texto;
      // Aulas de Inglês: legenda em português (liga/desliga; a escolha fica guardada neste browser).
      const $tr = q('.aula-traducao');
      $tr.innerHTML = p.partes ? (p.partes[0].legenda || '') : (p.legenda || '');
      $tr.hidden = !$tr.innerHTML || !verLegendas();
      if (p.partes && !aTocar) depois(() => ativarParte(p, 0), 1250);
      q('.aula-passo').textContent = `${i + 1} / ${P.length}`;
      q('.aula-barra div').style.width = `${100 * (i + 1) / P.length}%`;
      if (aTocar) falar(i);
    }

    function falar(k) {
      if (P[k].partes) return depois(() => tocarParte(k, 0), 1300);
      audio.src = urlAudio(k + 1);
      audio.onended = () => { if (aTocar && i === k) depois(() => (i < P.length - 1 ? mostrar(i + 1) : parar(true)), 900); };
      depois(() => (window.Leitura?.acordarSom() || Promise.resolve()).then(() => audio.play().catch(() => {})), 1300); // a câmara chega primeiro (e as colunas "acordam" na 1.ª vez)
    }
    function parar(fim) {
      aTocar = false; audio.pause();
      q('[data-a=play]').textContent = fim ? '🔁 Ver outra vez' : '▶ Continuar';
      const notas = Object.values(leituras).filter(e => e.melhor != null).map(e => e.melhor);
      if (fim && notas.length) q('.aula-passo').innerHTML = `🎤 Reading: <b>${Math.round(notas.reduce((a, b) => a + b, 0) / notas.length)}%</b> (${notas.length} sentences)`;
      if (fim) i = -1;
    }
    q('[data-a=play]').onclick = () => {
      if (aTocar) return parar();
      aTocar = true; q('[data-a=play]').textContent = '⏸ Pausa';
      window.Leitura?.acordarSom(); // tem de começar no próprio clique (o browser só deixa ligar o som com um clique)
      mostrar(Math.max(i, 0));
    };
    q('[data-a=seg]').onclick = () => mostrar(i + 1);
    q('[data-a=leg]')?.addEventListener('click', () => {
      try { localStorage.setItem('app-ver-legendas', verLegendas() ? '0' : '1'); } catch {}
      const $tr = q('.aula-traducao'); $tr.hidden = !$tr.innerHTML || !verLegendas();
      q('[data-a=leg]').classList.toggle('prim', verLegendas());
    });
    q('[data-a=leg]')?.classList.toggle('prim', verLegendas());
    q('[data-a=ant]').onclick = () => mostrar(i - 1);
    addEventListener('resize', () => apontar(P[Math.max(i, 0)]));
    mostrar(0);
    // Parar o som se a Leonor sair da página.
    addEventListener('hashchange', () => { aTocar = false; audio.pause(); limpar(); }, { once: true });
  }

  return { montar, ANIMACOES };
})();
