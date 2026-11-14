const rounds = {
  Finals: 'Final',
  Semifinals: 'Semifinales',
  Quarterfinals: 'Cuartos de final',
};
const stats = {
  kills: 'Asesinatos',
  gold: 'Oro',
  towers: 'Torres',
  dragons: 'Dragones',
  barons: 'Barones',
};
const number = new Intl.NumberFormat('es-CR');

function element(tag, text, className) {
  const result = document.createElement(tag);
  if (text !== undefined) result.textContent = text;
  if (className) result.className = className;
  return result;
}

function button(text, action) {
  const result = element('button', text, 'button');
  result.type = 'button';
  result.addEventListener('click', action);
  return result;
}

function link(url, label) {
  if (typeof url !== 'string' || !url.startsWith('https://')) return null;
  const result = element('a', label);
  result.href = url;
  result.target = '_blank';
  result.rel = 'noopener noreferrer';
  return result;
}

export function groupSeries(games) {
  const series = new Map();
  for (const game of games) {
    const id = game.seriesId || game.id.replace(/_\d+$/, '');
    if (!series.has(id)) series.set(id, []);
    series.get(id).push(game);
  }
  return Array.from(series.entries(), ([id, unsorted]) => {
    const games = unsorted.toSorted((a, b) => (a.number ?? a.gameNumber) - (b.number ?? b.gameNumber));
    const first = games[0];
    const teams = [first.blueTeam, first.redTeam];
    const wins = Object.fromEntries(teams.map((team) => [team, 0]));
    for (const game of games) {
      const winner = game.winner === 'blue' ? game.blueTeam : game.winner === 'red' ? game.redTeam : null;
      if (Object.hasOwn(wins, winner)) wins[winner] += 1;
    }
    const roundName = first.round || id.match(/_([^_]+)_\d+$/)?.[1];
    const phase = first.league.endsWith('Play-In') ? 'Play-In'
      : first.league === 'Worlds 2026 Main Event' ? rounds[roundName] ?? 'Fase suiza'
        : roundName || first.league;
    return { id, teams, wins, games, phase, date: first.date, league: first.league };
  }).sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || a.id.localeCompare(b.id));
}

function gameStats(game) {
  const chart = element('dl', undefined, 'series-stats');
  if (!game.stats) return chart;
  for (const [key, label] of Object.entries(stats)) {
    const blue = game.stats.blue[key];
    const red = game.stats.red[key];
    if (!Number.isFinite(blue) || !Number.isFinite(red)) continue;
    const row = element('div');
    const blueValue = element('dd', number.format(blue));
    const redValue = element('dd', number.format(red));
    blueValue.setAttribute('aria-label', `Azul ${blue}`);
    redValue.setAttribute('aria-label', `Rojo ${red}`);
    row.append(element('dt', label), blueValue, redValue);
    chart.append(row);
  }
  return chart;
}

export function createSeriesExplorer(root, { openGame }) {
  const search = root.querySelector('#series-search');
  const phaseSelect = root.querySelector('#series-phase');
  const seriesSelect = root.querySelector('#series-list');
  const status = root.querySelector('#series-status');
  const detail = root.querySelector('#series-detail');
  let groups = [];
  let coverage = {};

  function chooseSeries() {
    const series = groups.find((entry) => entry.id === seriesSelect.value);
    detail.replaceChildren();
    if (!series) return;
    const [left, right] = series.teams;
    const recordedResults = series.wins[left] + series.wins[right];
    const heading = element('header', undefined, 'series-heading');
    heading.append(
      element('h3', recordedResults ? `${left} ${series.wins[left]} – ${series.wins[right]} ${right}` : `${left} vs. ${right}`),
      element('p', `${series.league} · ${series.phase} · ${series.date.slice(0, 10)} · ${series.games.length} en el catálogo${recordedResults < series.games.length ? ' · marcador parcial' : ''}`),
    );
    const gameList = element('ol', undefined, 'series-games');
    for (const game of series.games) {
      const article = element('li', undefined, 'series-game');
      const gameWinner = game.winner === 'blue' ? game.blueTeam : game.winner === 'red' ? game.redTeam : null;
      article.append(element('h4', `Partida ${game.number ?? game.gameNumber}${gameWinner ? ` · Ganó ${gameWinner}` : ''}`),
        element('p', `Azul: ${game.blueTeam} · Rojo: ${game.redTeam}`));
      const metrics = gameStats(game);
      if (metrics.childElementCount) article.append(metrics);
      const actions = element('div', undefined, 'series-actions');
      if (game.picks) {
        actions.append(button(coverage.builds.has(game.id) ? 'Draft y builds' : 'Abrir draft', () => openGame(game, 'draft')));
      }
      if (coverage.wards.has(game.id)) actions.append(button('Ver wards', () => openGame(game, 'vision')));
      const replay = link(game.vod ?? (game.coverage === 'vod' ? game.sourceUrl : null), 'Ver repetición');
      if (replay) actions.append(replay);
      article.append(actions);
      gameList.append(article);
    }
    detail.append(heading, gameList);
  }

  function render() {
    const term = search.value.trim().toLocaleLowerCase();
    const phase = phaseSelect.value;
    const filtered = groups.filter((series) => (!phase || series.phase === phase) &&
      series.teams.join(' ').toLocaleLowerCase().includes(term));
    const selected = seriesSelect.value;
    const key = JSON.stringify(filtered.map((series) => series.id));
    if (seriesSelect.dataset.options !== key) {
      seriesSelect.replaceChildren(...filtered.map((entry) =>
        new Option(`${entry.teams.join(' vs. ')} · ${entry.phase} · ${entry.date.slice(0, 10)}`, entry.id)));
      if (filtered.some((series) => series.id === selected)) seriesSelect.value = selected;
      seriesSelect.dataset.options = key;
    }
    seriesSelect.disabled = !filtered.length;
    const totalGames = filtered.reduce((count, entry) => count + entry.games.length, 0);
    status.textContent = filtered.length
      ? `${filtered.length} ${filtered.length === 1 ? 'serie' : 'series'} · ${totalGames} ${totalGames === 1 ? 'partida' : 'partidas'} registradas`
      : 'No hay series para estos filtros.';
    chooseSeries();
  }

  search.addEventListener('input', render);
  phaseSelect.addEventListener('change', render);
  seriesSelect.addEventListener('change', chooseSeries);
  return {
    update(games, available) {
      groups = groupSeries(games);
      coverage = available;
      const phases = [...new Set(groups.map((series) => series.phase))].sort();
      const selected = phaseSelect.value;
      const key = JSON.stringify(phases);
      if (phaseSelect.dataset.options !== key) {
        phaseSelect.replaceChildren(new Option('Todas las fases', ''),
          ...phases.map((phase) => new Option(phase, phase)));
        if (phases.includes(selected)) phaseSelect.value = selected;
        phaseSelect.dataset.options = key;
      }
      render();
    },
  };
}

export function renderDraftOrder(container, game, draft, championIcon) {
  container.replaceChildren();
  const heading = element('h4', 'Orden del draft');
  container.append(heading);
  if (!draft) {
    container.append(element('p', 'El marcador trae la composición. El orden de selección aún no está verificado.', 'section-status'));
    return;
  }
  const controls = element('div', undefined, 'draft-order-controls');
  const slider = element('input');
  slider.type = 'range';
  slider.min = '0';
  slider.max = String(draft.actions.length);
  slider.value = slider.max;
  slider.setAttribute('aria-label', 'Paso del draft');
  const count = element('output');
  const list = element('ol', undefined, 'draft-order-list');
  const active = element('p', undefined, 'draft-order-active');
  const setStep = (step) => {
    slider.value = step;
    count.value = `${step} / ${draft.actions.length}`;
    slider.setAttribute('aria-valuetext', `Paso ${step} de ${draft.actions.length}`);
    for (const [index, item] of Array.from(list.children).entries()) {
      item.classList.toggle('pending', index >= step);
      const tick = item.firstElementChild;
      tick.setAttribute('aria-current', String(index === step - 1));
      tick.querySelector('.draft-tick-champion').hidden = index >= step;
    }
    const action = draft.actions[step - 1];
    active.textContent = action
      ? `${step}. ${action.side === 'blue' ? game.blueTeam : game.redTeam} · ${action.kind === 'pick' ? 'elige' : 'banea'} ${action.champion}`
      : 'Antes del primer ban';
  };
  for (const [index, action] of draft.actions.entries()) {
    const item = element('li');
    const tick = button('', () => setStep(index + 1));
    tick.classList.add('draft-tick');
    tick.dataset.side = action.side;
    const label = `${index + 1} · ${action.kind === 'pick' ? 'Pick' : 'Ban'}`;
    tick.append(element('span', label), element('span', action.side === 'blue' ? 'Azul' : 'Rojo'));
    const champion = element('span', undefined, 'draft-tick-champion');
    champion.append(championIcon(action.champion), element('span', action.champion));
    tick.append(champion);
    item.append(tick);
    list.append(item);
  }
  slider.addEventListener('input', () => setStep(Number(slider.value)));
  controls.append(button('Inicio', () => setStep(0)), slider, count, button('Final', () => setStep(draft.actions.length)));
  container.append(controls, active, list);
  const source = link(draft.sourceUrl, 'Ver picks y bans en Leaguepedia');
  if (source) container.append(source);
  setStep(draft.actions.length);
}
