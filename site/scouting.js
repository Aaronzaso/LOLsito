const sides = ['blue', 'red'];
const names = new Intl.Collator('es', { sensitivity: 'base' });
const counts = new Intl.NumberFormat('es-CR');
const percentages = new Intl.NumberFormat('es-CR', { style: 'percent', maximumFractionDigits: 1 });

function championTeams(game) {
  if (!game?.id || !sides.includes(game.winner) || !Array.isArray(game.picks) || game.picks.length !== 10) return null;
  const blue = new Set();
  const red = new Set();
  for (const pick of game.picks) {
    if (!pick || typeof pick.champion !== 'string' || !pick.champion || !sides.includes(pick.side)) return null;
    const { side, champion } = pick;
    (side === 'blue' ? blue : red).add(champion);
  }
  if (blue.size !== 5 || red.size !== 5 ||
      [...blue].some((champion) => red.has(champion))) return null;
  return { blue, red };
}

function record(rows, champions, sample, roster) {
  for (const champion of champions) {
    if (roster.has(champion)) continue;
    const row = rows.get(champion) ?? { games: 0, wins: 0, matches: [] };
    row.games += 1;
    if (sample.won) row.wins += 1;
    row.matches.push(sample);
    rows.set(champion, row);
  }
}

export function analyzeScouting(games, selectedChampions) {
  const roster = new Set(selectedChampions.filter(Boolean));
  const result = { games: 0, wins: 0, eligibleGames: 0, allies: new Map(), opponents: new Map() };
  if (!roster.size) return result;
  const seen = new Set();

  for (const game of games) {
    if (seen.has(game?.id)) continue;
    const teams = championTeams(game);
    if (!teams) continue;
    seen.add(game.id);
    result.eligibleGames += 1;
    const side = sides.find((candidate) => [...roster].every((champion) => teams[candidate].has(champion)));
    if (!side) continue;

    const opponent = side === 'blue' ? 'red' : 'blue';
    const won = game.winner === side;
    const sample = { game, side, won };
    result.games += 1;
    if (won) result.wins += 1;
    record(result.allies, teams[side], sample, roster);
    record(result.opponents, teams[opponent], sample, roster);
  }
  return result;
}

function element(tag, text, style) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (style) node.className = style;
  return node;
}

function selectField(label, options, id) {
  const field = element('label', undefined, 'field');
  const select = element('select');
  if (id) select.id = id;
  select.replaceChildren(...options.map(([value, name]) => new Option(name, value)));
  field.append(element('span', label), select);
  return [field, select];
}

function frequency(games) {
  const seen = new Set();
  const usage = new Map();
  for (const game of games) {
    if (seen.has(game?.id)) continue;
    const teams = championTeams(game);
    if (!teams) continue;
    seen.add(game.id);
    for (const champion of [...teams.blue, ...teams.red]) {
      usage.set(champion, (usage.get(champion) ?? 0) + 1);
    }
  }
  return usage;
}

function winRate(sample) {
  return sample?.games ? sample.wins / sample.games : null;
}

function statCell(sample) {
  const cell = element('td', undefined, 'scout-stat');
  const rate = winRate(sample);
  if (rate === null) {
    cell.append(element('span', '—', 'scout-no-sample'));
    return cell;
  }
  const value = element('span', percentages.format(rate), 'scout-stat-rate');
  const record = element('span', `${counts.format(sample.wins)} V · ${counts.format(sample.games - sample.wins)} D`, 'scout-stat-count');
  const track = element('span', undefined, 'scout-stat-track');
  const bar = element('span', undefined, 'scout-stat-bar');
  track.setAttribute('aria-hidden', 'true');
  bar.style.width = `${rate * 100}%`;
  track.append(bar);
  cell.append(value, track, record);
  return cell;
}

function rowOrder(primary, comparison, minimum, order) {
  const rows = [...new Set([...primary.keys(), ...comparison.keys()])].map((champion) =>
    ({ champion, primary: primary.get(champion), comparison: comparison.get(champion) }));

  return rows.filter((row) => Math.max(row.primary?.games ?? 0, row.comparison?.games ?? 0) >= minimum)
    .sort((a, b) => {
      const aValue = winRate(a.primary) ?? winRate(a.comparison);
      const bValue = winRate(b.primary) ?? winRate(b.comparison);
      let difference = 0;
      if (order === 'wins') difference = bValue - aValue;
      if (order === 'losses') difference = aValue - bValue;
      return difference || (b.primary?.games ?? 0) - (a.primary?.games ?? 0) ||
        (b.comparison?.games ?? 0) - (a.comparison?.games ?? 0) || names.compare(a.champion, b.champion);
    });
}

function overview(label, analysis) {
  const line = element('div', undefined, 'scout-overview-item');
  const rate = winRate(analysis);
  line.append(element('span', label, 'scout-patch'),
    element('strong', rate === null ? 'Sin coincidencias' : `${percentages.format(rate)} de victorias`),
    element('span', `${counts.format(analysis.games)} de ${counts.format(analysis.eligibleGames)} partidas del filtro`));
  return line;
}

export function createScouting(container, {
  championIcon = () => null, matchLabel = (game) => `${game.blueTeam} vs. ${game.redTeam}`, onOpenGame,
} = {}) {
  if (!container) throw new TypeError('Falta el contenedor de scouting.');
  let input = { games: [], comparisonGames: [], patch: '', comparisonPatch: null };
  let selectedMatchup = null;
  let initialChoice = false;
  const rosterFields = element('div', undefined, 'scout-roster');
  const championSelects = Array.from({ length: 5 }, (_, index) => {
    const [field, select] = selectField(index === 0 ? 'Campeón principal' : `Aliado ${index}`,
      [['', index === 0 ? 'Seleccionar campeón' : 'Opcional']], `scout-champion-${index + 1}`);
    rosterFields.append(field);
    select.addEventListener('change', () => {
      initialChoice = true;
      selectedMatchup = null;
      updateOptions();
      render();
    });
    return select;
  });
  const [minimumField, minimum] = selectField('Mínimo por parche',
    [[1, '1 partida'], [3, '3 partidas'], [5, '5 partidas'], [10, '10 partidas']], 'scout-minimum');
  const [orderField, order] = selectField('Ordenar por',
    [['games', 'Partidas jugadas'], ['wins', 'Mayor % de victorias'], ['losses', 'Menor % de victorias']], 'scout-sort');
  const controls = element('div', undefined, 'scout-controls');
  controls.append(minimumField, orderField);
  for (const select of [minimum, order]) select.addEventListener('change', render);
  const snapshot = element('div', undefined, 'scout-overview');
  snapshot.setAttribute('role', 'status');
  const explanation = element('p', 'V y D son victorias y derrotas del grupo seleccionado en cada cruce. Selecciona un campeón de la tabla para ver las partidas.', 'scout-note');
  const empty = element('p', '', 'section-status');
  const tables = element('div', undefined, 'scout-results');
  const examples = element('section', undefined, 'scout-examples');
  examples.id = 'scout-examples';
  examples.setAttribute('aria-label', 'Partidas del cruce seleccionado');
  container.replaceChildren(rosterFields, controls, snapshot, explanation, empty, tables, examples);

  let pool = [];
  function updateOptions() {
    const choices = championSelects.map((select) => select.value);
    const options = [...new Set([...pool, ...choices.filter(Boolean)])].sort(names.compare);
    for (const [index, select] of championSelects.entries()) {
      const taken = new Set(choices.filter((champion, position) => champion && position !== index));
      select.replaceChildren(new Option(index === 0 ? 'Seleccionar campeón' : 'Opcional', ''),
        ...options.filter((champion) => !taken.has(champion)).map((champion) => new Option(champion)));
      select.value = choices[index];
      select.disabled = options.length === 0;
    }
  }

  function renderExamples(sample, comparison) {
    examples.hidden = !selectedMatchup || !(sample || comparison);
    if (examples.hidden) return;
    const relation = selectedMatchup.kind === 'allies' ? 'Con' : 'Contra';
    const title = element('h3', `${relation} ${selectedMatchup.champion}`);
    const sections = [[input.patch, sample], [input.comparisonPatch, comparison]].filter(([, data]) => data?.matches.length);
    examples.replaceChildren(title, ...sections.map(([patch, data]) => {
      const section = element('div');
      section.append(element('h4', `${patch} · ${counts.format(data.matches.length)} ${data.matches.length === 1 ? 'partida' : 'partidas'}`));
      const list = element('ul', undefined, 'scout-example-list');
      for (const { game, won } of data.matches) {
        const item = element('li');
        const result = element('span', won ? 'Victoria' : 'Derrota', `scout-game-result ${won ? 'scout-win' : ''}`);
        item.append(result, element('span', matchLabel(game)));
        if (onOpenGame) {
          const button = element('button', 'Ver draft', 'button');
          button.type = 'button';
          button.setAttribute('aria-label', `Ver draft de ${matchLabel(game)}`);
          button.addEventListener('click', () => onOpenGame(game));
          item.append(button);
        }
        list.append(item);
      }
      section.append(list);
      return section;
    }));
  }

  function section(kind, title, current, previous) {
    const area = element('section', undefined, 'scout-relations');
    area.append(element('h3', title));
    const rows = rowOrder(current, previous, Number(minimum.value), order.value);
    if (!rows.length) {
      area.append(element('p', 'Sin coincidencias con este mínimo.', 'section-status'));
      return area;
    }
    const wrapper = element('div', undefined, 'table-scroll scout-table-wrap');
    const table = element('table', undefined, 'scout-table');
    table.append(element('caption', `${title} y victorias del grupo por parche`, 'sr-only'));
    const head = document.createElement('thead');
    const headings = document.createElement('tr');
    for (const label of ['Campeón', input.patch, input.comparisonPatch].filter(Boolean)) {
      const column = element('th', label);
      column.scope = 'col';
      headings.append(column);
    }
    head.append(headings);
    const rowsDisplay = document.createElement('tbody');
    for (const { champion, primary, comparison } of rows) {
      const row = document.createElement('tr');
      const label = document.createElement('th');
      label.scope = 'row';
      const button = element('button', undefined, 'scout-matchup');
      button.type = 'button';
      const icon = championIcon(champion);
      if (icon) button.append(icon);
      button.append(document.createTextNode(champion));
      button.dataset.champion = champion;
      button.dataset.relation = kind;
      button.setAttribute('aria-controls', examples.id);
      button.setAttribute('aria-pressed', String(selectedMatchup?.champion === champion && selectedMatchup.kind === kind));
      button.addEventListener('click', () => {
        selectedMatchup = { kind, champion };
        for (const current of tables.querySelectorAll('.scout-matchup')) {
          current.setAttribute('aria-pressed', String(current === button));
        }
        renderExamples(primary, comparison);
        examples.scrollIntoView({ block: 'nearest' });
      });
      label.append(button);
      row.append(label, statCell(primary));
      if (input.comparisonPatch) row.append(statCell(comparison));
      rowsDisplay.append(row);
    }
    table.append(head, rowsDisplay);
    wrapper.append(table);
    area.append(wrapper);
    return area;
  }

  function render() {
    const roster = championSelects.map((select) => select.value).filter(Boolean);
    const primary = analyzeScouting(input.games, roster);
    const comparison = analyzeScouting(input.comparisonGames, roster);
    const hasResults = primary.games + comparison.games > 0;
    empty.hidden = hasResults;
    tables.hidden = !hasResults;
    snapshot.hidden = !roster.length;
    explanation.hidden = !hasResults;
    empty.textContent = roster.length ? 'El grupo no jugó junto en estas partidas.' :
      pool.length ? 'Selecciona un campeón para explorar sus partidas.' : 'Sin partidas con draft y resultado en esta selección.';
    if (roster.length) {
      snapshot.replaceChildren(overview(input.patch, primary));
      if (input.comparisonPatch) snapshot.append(overview(input.comparisonPatch, comparison));
    }
    if (hasResults) tables.replaceChildren(
      section('allies', 'Compañeros de equipo', primary.allies, comparison.allies),
      section('opponents', 'Campeones rivales', primary.opponents, comparison.opponents));
    const selected = selectedMatchup && { ...selectedMatchup };
    const visible = selected && hasResults && [...tables.querySelectorAll('.scout-matchup')].some((button) =>
      button.dataset.champion === selected.champion && button.dataset.relation === selected.kind);
    if (visible) renderExamples(primary[selected.kind].get(selected.champion), comparison[selected.kind].get(selected.champion));
    else examples.hidden = true;
  }

  return {
    update({ games, comparisonGames = [], patch, comparisonPatch = null }) {
      input = { games, comparisonGames: comparisonPatch ? comparisonGames : [], patch, comparisonPatch };
      const primary = frequency(games);
      const comparison = frequency(input.comparisonGames);
      pool = [...new Set([...primary.keys(), ...comparison.keys()])];
      updateOptions();
      if (!initialChoice && pool.length) {
        const main = primary.size ? primary : comparison;
        const mostPlayed = [...main.entries()].sort((a, b) => b[1] - a[1] || names.compare(a[0], b[0]))[0][0];
        championSelects[0].value = mostPlayed;
        initialChoice = true;
        updateOptions();
      }
      render();
    }
  };
}
