const byId = (id) => document.getElementById(id);
const desktop = location.origin === 'https://lolsito.local';
const roles = { top: 'Top', jng: 'Jungla', mid: 'Mid', bot: 'ADC', sup: 'Soporte' };
const sides = { blue: 'Azul', red: 'Rojo', unknown: 'Lado sin confirmar' };
const coverageLabels = {
  complete: 'Registro completo',
  events: 'Eventos sin verificar cobertura',
  vod: 'Muestra de la repetición',
  unspecified: 'Cobertura sin verificar',
};
const number = new Intl.NumberFormat('es-CR');
const percent = new Intl.NumberFormat('es-CR', { maximumFractionDigits: 1 });
const counted = (count, singular, plural) => `${number.format(count)} ${count === 1 ? singular : plural}`;
const minuteSeconds = (seconds) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

function node(tag, value, className) {
  const result = document.createElement(tag);
  if (value !== undefined) result.textContent = value;
  if (className) result.className = className;
  return result;
}

function setText(id, value) {
  const element = byId(id);
  if (element) element.textContent = value;
}

function toggle(id, show) {
  const element = byId(id);
  if (element) element.hidden = !show;
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

function sourceAnchor(value, label) {
  const url = safeUrl(value);
  if (!url) return node('span', label);
  const anchor = node('a', label);
  anchor.href = url;
  anchor.target = '_blank';
  anchor.rel = 'noopener noreferrer';
  return anchor;
}

function fillSelect(id, entries, selected, fallback) {
  const select = byId(id);
  if (!select) return;
  select.replaceChildren(...entries.map(([value, label]) => new Option(label, value)));
  select.value = entries.some(([value]) => value === selected) ? selected : fallback ?? entries[0]?.[0];
}

async function fetchData(filename, signal) {
  const response = await fetch(`./data/${filename}.json`, { signal, cache: 'no-cache' });
  if (!response.ok) throw new Error(`${filename}: HTTP ${response.status}`);
  return response.json();
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function normalizeWards(data) {
  assert(data && Array.isArray(data.games) && Array.isArray(data.wards),
    'El JSON debe incluir las listas games y wards.');
  const games = new Map();
  const wardCounts = new Map();
  for (const game of data.games) {
    assert(game && typeof game.id === 'string' && game.id.trim() &&
      /^\d{2}\.\d{1,2}$/.test(game.patch) &&
      ['league', 'blueTeam', 'redTeam'].every((key) => typeof game[key] === 'string' && game[key].trim()) &&
      (!game.date || typeof game.date === 'string') &&
      (game.durationSeconds === undefined || (Number.isInteger(game.durationSeconds) && game.durationSeconds > 0)),
    'Cada partida necesita id, patch, league, blueTeam y redTeam.');
    assert(game.coverage === undefined || Object.hasOwn(coverageLabels, game.coverage),
      `Cobertura inválida en ${game.id}.`);
    assert(!games.has(game.id), `Partida duplicada: ${game.id}`);
    games.set(game.id, game);
  }
  const wards = data.wards.map((item, index) => {
    const prefix = `Ward ${index + 1}`;
    assert(item && games.has(item.gameId), `${prefix}: gameId no encontrado.`);
    assert(typeof item.x === 'number' && item.x >= 0 && item.x <= 1 &&
      typeof item.y === 'number' && item.y >= 0 && item.y <= 1,
    `${prefix}: x e y deben estar entre 0 y 1.`);
    assert(Number.isInteger(item.seconds) && item.seconds >= 0 && Object.hasOwn(sides, item.side),
      `${prefix}: revisa seconds y side (blue, red o unknown).`);
    assert(!item.role || Object.hasOwn(roles, item.role), `${prefix}: rol inválido.`);
    assert(!item.type || typeof item.type === 'string', `${prefix}: tipo inválido.`);
    const game = games.get(item.gameId);
    assert(!game.durationSeconds || item.seconds <= game.durationSeconds, `${prefix}: el tiempo supera la duración de la partida.`);
    assert(game.coverage !== 'complete' || (!item.observed && !item.approximate && item.side !== 'unknown'),
      `${prefix}: un registro completo requiere eventos de colocación con coordenadas y lado.`);
    wardCounts.set(item.gameId, (wardCounts.get(item.gameId) ?? 0) + 1);
    return item;
  });
  for (const game of games.values()) {
    if (game.coverage === 'complete') {
      assert(game.durationSeconds && game.expectedWards === (wardCounts.get(game.id) ?? 0),
        `El total del resumen final no coincide con los eventos de ${game.id}.`);
    }
  }
  return { games: [...games.values()], wards, sources: Array.isArray(data.sources) ? data.sources : [] };
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let value = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') {
        value += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (!quoted && char === ',') {
      row.push(value.trim());
      value = '';
    } else if (!quoted && (char === '\n' || char === '\r')) {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      row.push(value.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      value = '';
    } else {
      value += char;
    }
  }
  assert(!quoted, 'El CSV contiene un campo con comillas sin cerrar.');
  row.push(value.trim());
  if (row.some(Boolean)) rows.push(row);
  const header = rows.shift() ?? [];
  const required = ['gameId', 'patch', 'league', 'blueTeam', 'redTeam', 'seconds', 'x', 'y', 'side'];
  assert(required.every((key) => header.includes(key)), `Columnas requeridas: ${required.join(', ')}.`);
  const games = new Map();
  const wards = rows.map((fields, index) => {
    assert(fields.length === header.length, `Fila ${index + 2}: número de columnas inválido.`);
    const item = Object.fromEntries(header.map((key, position) => [key, fields[position]]));
    const { gameId: id, patch, league, date, blueTeam, redTeam, sourceUrl, durationSeconds } = item;
    const existing = games.get(id);
    assert(!existing || [patch, league, blueTeam, redTeam].every((part, i) =>
      part === [existing.patch, existing.league, existing.blueTeam, existing.redTeam][i]),
    `Los datos de la partida ${id} cambian entre filas.`);
    if (!existing) games.set(id, {
      id, patch, league, date, blueTeam, redTeam, sourceUrl,
      durationSeconds: durationSeconds ? Number(durationSeconds) : undefined,
    });
    return {
      gameId: id, sourceUrl, side: item.side, role: item.role, player: item.player, type: item.type, location: item.location,
      seconds: item.seconds ? Number(item.seconds) : NaN,
      x: item.x ? Number(item.x) : NaN, y: item.y ? Number(item.y) : NaN,
      approximate: /^(true|1|sí)$/i.test(item.approximate ?? ''),
      observed: /^(true|1|sí)$/i.test(item.observed ?? ''),
    };
  });
  return normalizeWards({ games: [...games.values()], wards });
}

const emptyWards = { games: [], wards: [], sources: [] };
const state = {
  picks: { games: [], sources: [], currentPatch: '26.22', previousPatch: '26.21' },
  publishedWards: emptyWards,
  localWards: emptyWards,
  importedWards: emptyWards,
  champions: {},
  builds: new Map(),
  buildSources: [],
  items: {},
  pickError: false,
  wardError: false,
  buildError: false,
  timelineKey: '',
  selectedWard: null,
  playback: null,
  importRequest: 0,
};

const selection = (id, fallback = '') => byId(id)?.value || fallback;
const patchOrder = (a, b) => b.localeCompare(a, 'es', { numeric: true });
const worldsScope = 'worlds-2026';
const isWorlds = (game) => game.league.startsWith('Worlds 2026');
const wardTypes = {
  control: 'Control', Control: 'Control', CONTROL_WARD: 'Control', VISION_WARD: 'Control',
  trinket: 'Centinela invisible', YELLOW_TRINKET: 'Centinela invisible', SIGHT_WARD: 'Centinela invisible',
  stealth: 'Centinela invisible', wards: 'Centinela invisible',
  farsight: 'Visión lejana', BLUE_TRINKET: 'Visión lejana', zombie: 'Centinela zombi', unknown: 'Tipo sin confirmar',
};
const labelType = (type) => (Object.hasOwn(wardTypes, type) ? wardTypes[type] : type) || wardTypes.unknown;

function wardData() {
  const importedIds = new Set(state.importedWards.games.map((game) => game.id));
  const localIds = new Set(state.localWards.games.map((game) => game.id));
  return {
    games: new Map([...state.publishedWards.games, ...state.localWards.games, ...state.importedWards.games]
      .map((game) => [game.id, game])),
    wards: [
      ...state.publishedWards.wards.filter((ward) => !localIds.has(ward.gameId) && !importedIds.has(ward.gameId)),
      ...state.localWards.wards.filter((ward) => !importedIds.has(ward.gameId)),
      ...state.importedWards.wards,
    ],
    importedIds: new Set([...localIds, ...importedIds]),
  };
}

function updateSelectors(primary, comparison) {
  const { currentPatch, previousPatch } = state.picks;
  const games = [...state.picks.games, ...wardData().games.values()];
  const patches = [...new Set([currentPatch, previousPatch, ...games.map((game) => game.patch)])].sort(patchOrder);
  const patchOptions = patches.map((patch) => [patch,
    `${patch}${patch === currentPatch ? ' · actual' : patch === previousPatch ? ' · anterior' : ''}`]);
  fillSelect('patch', patchOptions, primary, currentPatch);
  const selectedPatch = selection('patch', currentPatch);
  byId('patch').dataset.selected = selectedPatch;
  const comparisonOptions = patchOptions.filter(([patch]) => patch !== selectedPatch);
  fillSelect('compare-patch', [['off', 'Sin comparación'], ...comparisonOptions], comparison,
    patches[patches.indexOf(selectedPatch) + 1] ?? 'off');
  const leagues = [...new Set(games.map((game) => game.league))].sort((a, b) => a.localeCompare(b));
  const worldsOption = leagues.some((league) => league.startsWith('Worlds 2026')) ? [[worldsScope, 'Worlds 2026 · todo el torneo']] : [];
  fillSelect('league', [['all', 'Todas'], ...worldsOption, ...leagues.map((league) => [league, league])],
    selection('league', 'all'));
  fillSelect('role', [['all', 'Todos los roles'], ...Object.entries(roles)], selection('role', 'all'));
  setText('available-patches', `Parche actual ${currentPatch} · anterior ${previousPatch}`);
}

function gameMatches(game, patch, league) {
  return game.patch === patch &&
    (league === 'all' || (league === worldsScope ? isWorlds(game) : game.league === league));
}

function pickCounts(games, role) {
  const counts = new Map();
  let sampleSize = 0;
  for (const game of games) {
    const picks = game.picks.filter((pick) => role === 'all' || pick.role === role);
    if (!picks.length) continue;
    sampleSize += 1;
    for (const champion of new Set(picks.map((pick) => pick.champion))) {
      counts.set(champion, (counts.get(champion) ?? 0) + 1);
    }
  }
  return { sampleSize, counts };
}

function pickRate(count, total) {
  return total ? (count * 100) / total : null;
}

const rateLabel = (rate) => rate === null ? '—' : `${percent.format(rate)} %`;

function championIcon(champion) {
  const image = node('span', undefined, 'pick-icon');
  image.setAttribute('aria-hidden', 'true');
  if (!Object.hasOwn(state.champions, champion)) {
    image.hidden = true;
    return image;
  }
  const [sprite, x, y] = state.champions[champion];
  image.style.backgroundImage = `url(./assets/champions/${sprite})`;
  image.style.backgroundPosition = `${x * 100 / 432}% ${y * 100 / 96}%`;
  return image;
}

function bar(rate, patch, isComparison) {
  const entry = node('div', undefined, 'pick-bar-row');
  const track = node('div', undefined, 'pick-track');
  const fill = node('div', undefined, `pick-fill${isComparison ? ' is-comparison' : ''}`);
  const value = node('span', rateLabel(rate), 'pick-value');
  fill.style.width = `${rate ?? 0}%`;
  track.append(fill);
  entry.title = `${patch}: ${rate === null ? 'sin muestra' : rateLabel(rate)}`;
  entry.append(track, value);
  return entry;
}

function renderPicks(patch, compare, league, role) {
  const current = pickCounts(state.picks.games.filter((game) => gameMatches(game, patch, league)), role);
  const previous = pickCounts(state.picks.games.filter((game) => gameMatches(game, compare, league)), role);
  const champions = [...new Set([...current.counts.keys(), ...previous.counts.keys()])].map((champion) => {
    const count = current.counts.get(champion) ?? 0;
    const compareCount = previous.counts.get(champion) ?? 0;
    return { champion, count, compareCount, rate: pickRate(count, current.sampleSize),
      compareRate: pickRate(compareCount, previous.sampleSize) };
  });
  const usingComparison = compare !== 'off';
  const sort = byId('pick-sort');
  if (sort) {
    sort.options[0].text = patch;
    sort.options[1].text = usingComparison ? compare : 'Sin comparación';
    sort.options[1].disabled = !previous.sampleSize;
    if (!previous.sampleSize && sort.value === 'comparison') sort.value = 'primary';
  }
  const sortComparison = previous.sampleSize && (!current.sampleSize || sort?.value === 'comparison');
  champions.sort((a, b) => (sortComparison ? b.compareCount - a.compareCount : b.count - a.count) ||
    (sortComparison ? b.count - a.count : b.compareCount - a.compareCount) || a.champion.localeCompare(b.champion));
  const chart = byId('pick-chart');
  chart.replaceChildren(...champions.slice(0, 8).map((item) => {
    const row = node('div', undefined, 'pick-row');
    const label = node('div', undefined, 'pick-label');
    label.append(championIcon(item.champion), node('span', item.champion));
    const bars = node('div', undefined, 'pick-bars');
    bars.append(bar(item.rate, patch, false));
    if (usingComparison) bars.append(bar(item.compareRate, compare, true));
    row.append(label, bars);
    return row;
  }));
  byId('picks-table-body').replaceChildren(...champions.map((item) => {
    const row = node('tr');
    const difference = item.rate === null || item.compareRate === null ? null : item.rate - item.compareRate;
    const title = node('th', item.champion);
    title.scope = 'row';
    row.append(title);
    for (const value of [
      current.sampleSize ? number.format(item.count) : '—', rateLabel(item.rate),
      previous.sampleSize ? number.format(item.compareCount) : '—', rateLabel(item.compareRate),
      difference === null ? '—' : `${difference > 0 ? '+' : ''}${percent.format(difference)}`,
    ]) row.append(node('td', value));
    return row;
  }));
  toggle('picks-empty', !champions.length);
  setText('picks-empty', 'No hay partidas con picks documentados para estos filtros.');
  toggle('pick-chart', Boolean(champions.length));
  toggle('picks-table', Boolean(champions.length));
  toggle('comparison-legend', usingComparison);
  setText('pick-main-label', patch);
  setText('pick-compare-label', usingComparison ? compare : '—');
  setText('picks-count', counted(current.sampleSize, 'partida', 'partidas'));
  setText('picks-status', state.pickError ? 'No se pudo cargar la fuente de picks.' :
    [`${patch} · ${counted(current.sampleSize, 'partida', 'partidas')}`,
      ...(usingComparison ? [`${compare} · ${counted(previous.sampleSize, 'partida', 'partidas')}`] : [])].join(' / '));
  return current.sampleSize;
}

function matchLabel(game) {
  const number = game.number ?? game.gameNumber;
  return `${game.blueTeam} vs. ${game.redTeam}${number ? ` · P${number}` : ''}${game.date ? ` · ${game.date.slice(0, 10)}` : ''}`;
}

function itemIcon(id, trinket = false) {
  const item = state.items[id];
  const icon = node('li', item?.sprite ? undefined : id, `draft-item${item?.sprite ? '' : ' draft-item-number'}`);
  const label = `${item?.name ?? `Objeto ${id}`}${trinket ? ' · abalorio' : ''}`;
  icon.dataset.trinket = String(trinket);
  icon.title = label;
  icon.setAttribute('aria-label', label);
  if (item?.sprite) {
    icon.style.backgroundImage = `url(./assets/items/${item.sprite})`;
    icon.style.backgroundSize = `${item.columns * 100}% ${item.rows * 100}%`;
    icon.style.backgroundPosition = `${item.x * 100 / (item.columns - 1 || 1)}% ${item.y * 100 / (item.rows - 1 || 1)}%`;
  }
  return icon;
}

function draftTeam(game, side, build) {
  const team = node('section', undefined, 'draft-team');
  team.dataset.side = side;
  const heading = node('div', undefined, 'draft-team-header');
  heading.append(node('h4', side === 'blue' ? game.blueTeam : game.redTeam));
  heading.append(node('span', `Lado ${sides[side].toLowerCase()}${game.winner === side ? ' · Victoria' : ''}`, 'draft-result'));
  const lineup = node('ul', undefined, 'draft-lineup');
  lineup.setAttribute('aria-label', 'Campeones por rol y objetos finales');
  for (const pick of game.picks.filter((item) => item.side === side)) {
    const row = node('li', undefined, 'draft-player');
    const name = node('div', undefined, 'draft-player-name');
    const player = node('div');
    player.append(node('strong', pick.champion), node('small', `${roles[pick.role]} · ${pick.player}`));
    name.append(championIcon(pick.champion), player);
    row.append(name);
    const inventory = build?.players.find((entry) => entry.side === side && entry.role === pick.role && entry.champion === pick.champion);
    if (!inventory) {
      row.append(node('span', 'Sin build registrada', 'draft-item-missing'));
    } else {
      const items = node('ul', undefined, 'draft-items');
      items.setAttribute('aria-label', `Inventario final de ${pick.player}`);
      for (const item of inventory.items) items.append(itemIcon(item));
      if (inventory.trinket) items.append(itemIcon(inventory.trinket, true));
      if (inventory.roleItem && !inventory.items.includes(inventory.roleItem) && inventory.trinket !== inventory.roleItem) {
        items.append(itemIcon(inventory.roleItem));
      }
      if (!items.childElementCount) items.append(node('li', 'Inventario vacío', 'draft-item-missing'));
      row.append(items);
      if (inventory.order?.length) {
        const details = node('details', undefined, 'draft-purchases');
        const purchases = node('ol');
        for (const { seconds, itemId } of inventory.order) {
          purchases.append(node('li', `${minuteSeconds(seconds)} · ${state.items[itemId]?.name ?? `Objeto ${itemId}`}`));
        }
        details.append(node('summary', 'Adquisiciones registradas'), purchases);
        row.append(details);
      }
    }
    lineup.append(row);
  }
  const bans = (game.bans ?? []).filter((ban) => ban.side === side);
  const blocked = node('ul', undefined, 'draft-bans');
  blocked.setAttribute('aria-label', 'Campeones bloqueados');
  for (const { champion } of bans) {
    const ban = node('li');
    ban.append(championIcon(champion), node('span', champion));
    blocked.append(ban);
  }
  team.append(heading, node('h5', build ? 'Composición y objetos finales' : 'Composición'), lineup,
    node('h5', 'Bans registrados'), bans.length ? blocked : node('p', 'Sin bans documentados', 'draft-bans-missing'));
  if (bans.length && bans.length < 5) {
    team.append(node('p', `${bans.length} bloqueos en la fuente.`, 'draft-bans-missing'));
  }
  return team;
}

function renderDraft() {
  const patch = selection('patch');
  const league = selection('league', 'all');
  const search = byId('draft-search').value.toLocaleLowerCase().trim();
  const games = state.picks.games.filter((game) =>
    gameMatches(game, patch, league) && `${game.blueTeam} ${game.redTeam}`.toLocaleLowerCase().includes(search));
  const select = byId('draft-game');
  const coverage = games.reduce((count, game) => count + Number(state.builds.has(game.id)), 0);
  const selected = select.value;
  const optionKey = JSON.stringify(games.map((game) => game.id));
  if (select.dataset.options !== optionKey) {
    fillSelect('draft-game', games.map((game) => [game.id,
      `${matchLabel(game)}${state.builds.has(game.id) ? ' · con builds' : ''}`]), selected);
    select.dataset.options = optionKey;
  }
  select.disabled = !games.length;
  const index = games.findIndex((game) => game.id === select.value);
  byId('draft-prev').disabled = index < 1;
  byId('draft-next').disabled = index < 0 || index >= games.length - 1;
  setText('draft-status', games.length ? `${counted(games.length, 'partida', 'partidas')} · ${coverage} con builds` :
    'No hay partidas con draft para estos filtros.');
  toggle('draft-body', index >= 0);
  if (index < 0) return;
  const game = games[index];
  const build = state.builds.get(game.id);
  setText('draft-match-title', `${matchLabel(game)}${game.durationSeconds ? ` · ${minuteSeconds(game.durationSeconds)}` : ''}`);
  const links = [sourceAnchor(game.source, 'Marcador de la partida')];
  if (game.vod) links.push(sourceAnchor(game.vod, 'Repetición'));
  if (build?.sourceUrl) links.push(sourceAnchor(build.sourceUrl, 'Fuente de objetos'));
  const wardSelector = byId('ward-game');
  if ([...wardSelector.options].some((option) => option.value === game.id)) {
    const showMap = node('button', 'Ver mapa de esta partida', 'button');
    showMap.type = 'button';
    showMap.addEventListener('click', () => {
      wardSelector.value = game.id;
      byId('role').value = 'all';
      byId('ward-side').value = 'all';
      byId('ward-kind').value = 'all';
      render();
      byId('tab-vision').click();
      byId('tab-vision').focus();
    });
    links.push(showMap);
  }
  byId('draft-links').replaceChildren(...links);
  byId('draft-teams').replaceChildren(draftTeam(game, 'blue', build), draftTeam(game, 'red', build));
  setText('draft-build-status', build ? 'Los objetos corresponden al inventario final de cada jugador.' :
    state.buildError ? 'No se pudo cargar la fuente de objetos. El draft sigue disponible.' :
      'La fuente de esta partida incluye el draft. El inventario final está pendiente.');
}

function wardDescription(ward, game) {
  const parts = [`${minuteSeconds(ward.seconds)} · ${sides[ward.side]}`, labelType(ward.type),
    ward.player, roles[ward.role], ward.location ?? ward.zone, `${game.blueTeam} vs. ${game.redTeam}`];
  if (ward.approximate) parts.push('posición aproximada');
  if (ward.observed) parts.push('visto en la repetición');
  return parts.filter(Boolean).join(' · ');
}

function showWardDetail(ward, game) {
  const summary = byId('ward-summary');
  summary.replaceChildren(document.createTextNode(wardDescription(ward, game)));
  const source = ward.sourceUrl ?? game.sourceUrl;
  if (safeUrl(source)) {
    summary.append(document.createTextNode(' · '),
      sourceAnchor(source, ward.observed ? 'Ver en la repetición' : 'Ver fuente'));
  }
}

function wardPoint(ward, game, size) {
  const description = wardDescription(ward, game);
  const point = node('button', undefined, 'ward-point');
  point.type = 'button';
  point.dataset.side = ward.side;
  point.dataset.selected = String(state.selectedWard === ward);
  point.style.left = `${ward.x * 100}%`;
  point.style.top = `${ward.y * 100}%`;
  point.title = description;
  point.setAttribute('aria-label', description);
  if (size > 220) point.tabIndex = -1;
  const showDetail = () => {
    state.selectedWard = ward;
    for (const marker of point.parentElement.children) marker.dataset.selected = String(marker === point);
    showWardDetail(ward, game);
  };
  point.addEventListener('click', showDetail);
  point.addEventListener('focus', showDetail);
  return point;
}

function drawDensity(wards) {
  const canvas = node('canvas', undefined, 'ward-heat');
  canvas.width = canvas.height = 512;
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
  canvas.setAttribute('aria-label', 'Densidad de ubicaciones de wards');
  canvas.setAttribute('role', 'img');
  const context = canvas.getContext('2d');
  const cells = new Map();
  for (const ward of wards) {
    const column = Math.min(19, Math.floor(ward.x * 20));
    const row = Math.min(19, Math.floor(ward.y * 20));
    const key = row * 20 + column;
    cells.set(key, (cells.get(key) ?? 0) + 1);
  }
  const maximum = Math.max(...cells.values());
  for (const [key, count] of cells) {
    const x = (key % 20 + 0.5) * 25.6;
    const y = (Math.floor(key / 20) + 0.5) * 25.6;
    const radius = 29 + 16 * Math.sqrt(count / maximum);
    const glow = context.createRadialGradient(x, y, 0, x, y, radius);
    glow.addColorStop(0, `rgba(255,223,115,${0.4 + 0.59 * count / maximum})`);
    glow.addColorStop(0.45, `rgba(255,114,34,${0.25 + 0.55 * count / maximum})`);
    glow.addColorStop(1, 'rgba(255,48,74,0)');
    context.fillStyle = glow;
    context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }
  return canvas;
}

function stopPlayback() {
  window.clearInterval(state.playback);
  state.playback = null;
  setText('ward-play', 'Reproducir');
  byId('ward-play')?.setAttribute('aria-pressed', 'false');
}

function renderCurrentWards(updateStatus = true) {
  const patch = selection('patch', state.picks.currentPatch);
  const wards = renderWards(patch, selection('league', 'all'), selection('role', 'all'));
  if (updateStatus && !state.pickError && !state.wardError) {
    setText('app-status', `Parche ${patch} · ${byId('picks-count').textContent} con picks · ${counted(wards, 'ward en el mapa', 'wards en el mapa')}`);
  }
}

function jumpToWard(ward) {
  stopPlayback();
  byId('ward-minute').value = ward.seconds;
  if (byId('ward-mode')) byId('ward-mode').value = 'points';
  state.selectedWard = ward;
  renderCurrentWards();
}

function renderTimeline(game, wards, duration, seconds, key) {
  const container = byId('ward-timeline');
  if (!container) return;
  const show = Boolean(game && wards.length);
  toggle('ward-timeline', show);
  toggle('ward-history', show);
  if (byId('ward-play')) byId('ward-play').disabled = !show;
  if (!show) {
    if (state.playback !== null) stopPlayback();
    state.timelineKey = '';
    return;
  }
  const windowSelect = byId('ward-window');
  if (windowSelect.dataset.match !== game.id || windowSelect.dataset.duration !== String(duration)) {
    windowSelect.dataset.match = game.id;
    windowSelect.dataset.duration = duration;
    const windows = [['all', 'Partida entera']];
    for (let start = 0; start < duration; start += 300) {
      windows.push([String(start), `${minuteSeconds(start)}–${minuteSeconds(Math.min(start + 300, duration))}`]);
    }
    fillSelect('ward-window', windows, 'all');
  }
  const windowValue = selection('ward-window', 'all');
  const start = windowValue === 'all' ? 0 : Number(windowValue);
  const end = windowValue === 'all' ? duration : Math.min(start + 300, duration);
  const range = end - start;
  key = JSON.stringify([key, windowValue]);
  if (state.timelineKey !== key) {
    state.timelineKey = key;
    const indexes = new Map(wards.map((ward, index) => [ward, index]));
    byId('ward-timeline-axis').replaceChildren(...[0, 0.25, 0.5, 0.75, 1].map((fraction) =>
      node('span', minuteSeconds(start + Math.round(range * fraction)))));
    const chronological = wards.toSorted((a, b) => a.seconds - b.seconds);
    const inWindow = chronological.filter((ward) =>
      ward.seconds >= start && (ward.seconds < end || (end === duration && ward.seconds === end)));
    const lanes = [];
    for (const [side, label] of Object.entries(sides)) {
      const entries = inWindow.filter((ward) => ward.side === side);
      if (!entries.length) continue;
      const lane = node('div', undefined, 'timeline-lane');
      const track = node('div', undefined, 'timeline-track');
      const simultaneous = new Map();
      for (const ward of entries) {
        if (!simultaneous.has(ward.seconds)) simultaneous.set(ward.seconds, []);
        simultaneous.get(ward.seconds).push(ward);
      }
      for (const ward of entries) {
        const description = wardDescription(ward, game);
        const event = node('button', undefined, 'timeline-event');
        event.type = 'button';
        event.dataset.side = side;
        event.dataset.seconds = ward.seconds;
        event.dataset.index = indexes.get(ward);
        event.style.left = `${100 * (ward.seconds - start) / range}%`;
        const stack = simultaneous.get(ward.seconds);
        if (stack.length > 1) {
          const offset = stack.indexOf(ward) * 12 / (stack.length - 1) - 6;
          event.style.top = `calc(50% + ${offset}px)`;
        }
        event.title = description;
        event.setAttribute('aria-label', description);
        event.addEventListener('click', () => jumpToWard(ward));
        track.append(event);
      }
      lane.append(node('span', side === 'unknown' ? 'Sin lado' : label, 'timeline-lane-label'), track);
      lanes.push(lane);
    }
    byId('ward-timeline-lanes').replaceChildren(...(lanes.length ? lanes :
      [node('p', 'Sin wards en este tramo.', 'timeline-caption')]));
    byId('ward-history-list')?.replaceChildren(...chronological.map((ward) => {
      const item = node('li');
      const details = node('button', wardDescription(ward, game), 'history-event');
      details.type = 'button';
      details.addEventListener('click', () => jumpToWard(ward));
      item.append(details);
      return item;
    }));
    const method = wards.some((ward) => ward.observed) ? 'Los puntos indican cuándo se vio cada ward en la repetición.' :
      game.coverage === 'complete' ? 'Cada punto indica el momento en que se colocó un ward.' :
        'Los puntos indican cuándo se registró cada ward.';
    setText('ward-timeline-caption', game.durationSeconds ? method :
      `${method} La escala llega a la última observación registrada.`);
  }
  for (const marker of byId('ward-timeline-lanes').querySelectorAll('.timeline-event')) {
    marker.dataset.active = String(Number(marker.dataset.seconds) <= seconds);
    marker.setAttribute('aria-current', String(wards[Number(marker.dataset.index)] === state.selectedWard));
  }
  for (const track of byId('ward-timeline-lanes').querySelectorAll('.timeline-track')) {
    track.style.setProperty('--timeline-progress', `${100 * Math.min(1, Math.max(0, (seconds - start) / range))}%`);
  }
}

function renderWards(patch, league, role) {
  const { games, wards, importedIds } = wardData();
  const matchingGames = [...games.values()].filter((game) => gameMatches(game, patch, league));
  const ids = new Set(matchingGames.map((game) => game.id));
  const available = wards.filter((ward) => ids.has(ward.gameId));
  const wardsByGame = new Map(matchingGames.map((game) => [game.id, []]));
  for (const ward of available) wardsByGame.get(ward.gameId).push(ward);
  const coverageOf = (game) => game.coverage ??
    (wardsByGame.get(game.id).some((ward) => ward.observed) ? 'vod' : 'unspecified');
  const gameOptions = matchingGames.map((game) => [game.id, matchLabel(game)]);
  const group = JSON.stringify([patch, league, gameOptions.map(([id]) => id)]);
  const gameSelect = byId('ward-game');
  const gameChanged = gameSelect.dataset.group !== group;
  gameSelect.dataset.group = group;
  if (gameChanged) {
    fillSelect('ward-game', [['all', 'Todas las partidas con datos'], ...gameOptions],
      gameSelect.dataset.preferred ?? gameOptions[0]?.[0], gameOptions[0]?.[0] ?? 'all');
    delete gameSelect.dataset.preferred;
  }
  const gameId = selection('ward-game', 'all');
  gameSelect.title = gameOptions.find(([id]) => id === gameId)?.[1] ?? 'Todas las partidas con datos';
  gameSelect.disabled = !matchingGames.length;
  const minuteSlider = byId('ward-minute');
  const game = games.get(gameId);
  const relevant = game ? wardsByGame.get(game.id) : available;
  const observedEnd = relevant.reduce((max, ward) => Math.max(max, ward.seconds), 1);
  const duration = Math.max(observedEnd, game?.durationSeconds ?? 0);
  const sliderScope = JSON.stringify([group, gameId, duration, relevant.length]);
  if (minuteSlider.dataset.scope !== sliderScope) {
    minuteSlider.dataset.scope = sliderScope;
    minuteSlider.min = 0;
    minuteSlider.max = duration;
    minuteSlider.step = 1;
    minuteSlider.value = duration;
    state.selectedWard = null;
    state.timelineKey = '';
    const types = [...new Set(relevant.map((ward) => labelType(ward.type)))].sort();
    fillSelect('ward-kind', [['all', 'Todos los tipos'], ...types.map((type) => [type, type])],
      selection('ward-kind', 'all'));
    byId('ward-kind').disabled = !types.length;
    stopPlayback();
  }
  minuteSlider.disabled = !relevant.length;
  const seconds = Number(minuteSlider.value);
  const side = selection('ward-side', 'all');
  const type = selection('ward-kind', 'all');
  const density = ['density', 'heat', 'heatmap'].includes(selection('ward-mode'));
  toggle('ward-side-legend', !density);
  toggle('ward-heat-legend', density);
  const eligible = relevant.filter((ward) => (side === 'all' || side === ward.side) &&
    (type === 'all' || type === labelType(ward.type)) && (role === 'all' || role === ward.role));
  const filtered = eligible.filter((ward) => ward.seconds <= seconds);
  renderTimeline(game, eligible, duration, seconds, JSON.stringify([sliderScope, side, type, role]));
  setText('ward-minute-value', relevant.length ? minuteSeconds(seconds) : '—');
  minuteSlider.setAttribute('aria-valuetext', `${minuteSeconds(seconds)} de ${minuteSeconds(duration)}`);
  const layer = byId('ward-layer');
  layer.replaceChildren();
  if (filtered.length) {
    if (density) layer.append(drawDensity(filtered));
    else {
      const points = document.createDocumentFragment();
      for (const ward of filtered) points.append(wardPoint(ward, games.get(ward.gameId), filtered.length));
      layer.append(points);
    }
  }
  toggle('ward-empty', !filtered.length);
  setText('ward-empty', eligible.length ? 'Aún no hay wards en el historial para este minuto.' :
    game?.coverage === 'complete' && !relevant.length ? 'El resumen final registra cero wards.' :
    available.length ? 'Ningún ward coincide con estos filtros.' : 'Sin wards verificados para esta selección.');
  const matchCount = new Set(filtered.map((ward) => ward.gameId)).size;
  setText('ward-status', state.wardError && !available.length ? 'No se pudo cargar la fuente de wards.' :
    game ? `${counted(filtered.length, 'ward visible', 'wards visibles')} de ${number.format(relevant.length)}` :
      `${counted(filtered.length, 'ward', 'wards')} en ${counted(matchCount, 'partida', 'partidas')}`);
  const completeCount = matchingGames.filter((match) => match.coverage === 'complete').length;
  const coverage = game ? coverageLabels[coverageOf(game)] : [
    counted(matchingGames.length, 'partida con datos', 'partidas con datos'),
    completeCount ? counted(completeCount, 'registro completo', 'registros completos') : '',
  ].filter(Boolean).join(' · ');
  setText('ward-coverage', matchingGames.length ? coverage : '');
  const summary = filtered.length
    ? [filtered.some((ward) => ward.approximate) ? 'Incluye posiciones aproximadas del VOD.' : 'Coordenadas de wards registrados.',
      filtered.some((ward) => importedIds.has(ward.gameId)) ? 'Incluye datos importados en este equipo.' : '',
      density ? 'El color más intenso indica más wards en la zona.' : 'Selecciona un punto para ver su minuto y fuente.'].filter(Boolean).join(' ')
    : game?.coverage === 'complete' && !relevant.length ? 'Se comprobó el total con el resumen final.'
      : eligible.length ? 'Avanza en la línea de tiempo para ver las ubicaciones registradas.'
      : available.length ? 'Ajusta los filtros para ver las observaciones disponibles.'
      : `Sin coordenadas de wards verificadas en la fuente para ${patch} con estos filtros.`;
  setText('ward-summary', summary);
  if (!density && state.selectedWard && filtered.includes(state.selectedWard)) {
    showWardDetail(state.selectedWard, games.get(state.selectedWard.gameId));
  }
  setText('ward-timeline-instruction', gameId === 'all' && available.length ?
    'Selecciona una partida para ver su línea de tiempo.' : '');
  const matches = byId('ward-matches');
  if (matches && gameChanged) {
    const labels = new Map(gameOptions);
    matches.replaceChildren(...matchingGames.map((game) => {
      const item = node('li');
      const selectMatch = node('button', labels.get(game.id), 'history-event ward-match-select');
      selectMatch.type = 'button';
      selectMatch.dataset.game = game.id;
      selectMatch.addEventListener('click', () => {
        gameSelect.value = game.id;
        renderCurrentWards();
      });
      const count = wardsByGame.get(game.id).length;
      const detail = node('span', `${counted(count, 'ward', 'wards')} · ${coverageLabels[coverageOf(game)]}`, 'ward-match-info');
      item.append(selectMatch, detail);
      if (safeUrl(game.sourceUrl)) detail.append(document.createTextNode(' · '),
        sourceAnchor(game.sourceUrl, coverageOf(game) === 'vod' ? 'Repetición' : 'Fuente'));
      return item;
    }));
    setText('ward-match-heading', `Partidas con datos de wards (${number.format(matchingGames.length)})`);
    toggle('ward-match-list', Boolean(matchingGames.length));
  }
  for (const button of matches?.querySelectorAll('.ward-match-select') ?? []) {
    button.setAttribute('aria-current', String(button.dataset.game === gameId));
  }
  return filtered.length;
}

function renderSources() {
  const sources = new Map();
  for (const source of [
    ...state.picks.sources, ...state.publishedWards.sources, ...state.localWards.sources, ...state.buildSources,
    { name: 'Notas del parche actual de Riot', url: `https://www.leagueoflegends.com/es-mx/news/game-updates/league-of-legends-patch-${state.picks.currentPatch.replace('.', '-')}-notes/` },
    { name: 'Notas del parche anterior de Riot', url: `https://www.leagueoflegends.com/es-mx/news/game-updates/league-of-legends-patch-${state.picks.previousPatch.replace('.', '-')}-notes/` },
  ]) {
    if (source?.name && safeUrl(source.url)) {
      sources.set(source.url, source.name);
      if (source.license && safeUrl(source.licenseUrl)) sources.set(source.licenseUrl, source.license);
    }
  }
  byId('source-list').replaceChildren(...Array.from(sources, ([url, label]) => {
    const item = node('li');
    item.append(sourceAnchor(url, label));
    return item;
  }));
  const date = state.picks.updatedAt?.slice(0, 10);
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    setText('data-date', new Date(`${date}T12:00:00Z`).toLocaleDateString('es-CR', { dateStyle: 'medium', timeZone: 'UTC' }));
  }
}

function render() {
  const patch = selection('patch', state.picks.currentPatch);
  const compare = selection('compare-patch', 'off');
  const league = selection('league', 'all');
  const role = selection('role', 'all');
  const picks = renderPicks(patch, compare, league, role);
  const wards = renderWards(patch, league, role);
  renderDraft();
  if (state.pickError || state.wardError) {
    setText('app-status', 'Una fuente no se pudo cargar. Puedes consultar los datos disponibles.');
  } else {
    setText('app-status', `Parche ${patch} · ${counted(picks, 'partida', 'partidas')} con picks · ${counted(wards, 'ward en el mapa', 'wards en el mapa')}`);
  }
  byId('preset-live')?.setAttribute('aria-pressed', String(
    patch === state.picks.currentPatch && compare === state.picks.previousPatch && league === 'all' && role === 'all'));
  byId('preset-pro')?.setAttribute('aria-pressed', String(league === worldsScope));
  const showPatches = [patch, compare !== 'off' ? compare : ''].filter(Boolean).join(' vs. ');
  setText('view-patches', showPatches);
}

function choosePreset(type) {
  const { currentPatch, previousPatch, games } = state.picks;
  let patch = currentPatch;
  let compare = previousPatch;
  if (type === 'pro') {
    patch = [...games, ...state.publishedWards.games].filter(isWorlds).map((game) => game.patch).sort(patchOrder)[0] ?? '26.20';
    compare = 'off';
  }
  if (byId('league')) byId('league').value = 'all';
  if (byId('role')) byId('role').value = 'all';
  byId('ward-game').dataset.group = '';
  for (const id of ['ward-kind', 'ward-side']) {
    if (byId(id)) byId(id).value = 'all';
  }
  byId('ward-minute').value = byId('ward-minute').max;
  updateSelectors(patch, compare);
  if (type === 'pro') byId('league').value = worldsScope;
  byId('draft-search').value = '';
  render();
}

function configureTabs() {
  const tabs = [...document.querySelectorAll('.dashboard-tabs [role="tab"]')];
  const activate = (tab, moveFocus = false) => {
    const panelId = tab.getAttribute('aria-controls');
    for (const candidate of tabs) {
      const active = candidate === tab;
      candidate.setAttribute('aria-selected', String(active));
      candidate.tabIndex = active ? 0 : -1;
      toggle(candidate.getAttribute('aria-controls'), active);
    }
    if (panelId !== 'vision') stopPlayback();
    if (moveFocus) tab.focus();
    return panelId;
  };
  const syncHash = () => {
    const hash = location.hash.slice(1);
    const tab = tabs.find((item) => item.getAttribute('aria-controls') === hash);
    if (tab) activate(tab);
  };
  for (const [index, tab] of tabs.entries()) {
    const select = (target, moveFocus = false) => {
      const id = activate(target, moveFocus);
      history.replaceState(null, '', `#${id}`);
    };
    tab.addEventListener('click', () => select(tab));
    tab.addEventListener('keydown', (event) => {
      const navigation = {
        ArrowRight: (index + 1) % tabs.length,
        ArrowLeft: (index + tabs.length - 1) % tabs.length,
        Home: 0,
        End: tabs.length - 1,
      };
      if (!Object.hasOwn(navigation, event.key)) return;
      event.preventDefault();
      select(tabs[navigation[event.key]], true);
    });
  }
  window.addEventListener('hashchange', syncHash);
  syncHash();
}

async function importWards(event) {
  const file = event.target.files[0];
  if (!file) return;
  const request = ++state.importRequest;
  event.target.value = '';
  try {
    assert(file.size <= 8 * 1024 * 1024, 'Usa un archivo de hasta 8 MB.');
    const text = (await file.text()).replace(/^\uFEFF/, '');
    if (state.importRequest !== request) return;
    const data = /\.csv$/i.test(file.name) ? parseCsv(text) : normalizeWards(JSON.parse(text));
    assert(data.wards.length || data.games.some((game) => game.coverage === 'complete'),
      'El archivo no trae observaciones de wards.');
    state.importedWards = data;
    const patch = [...new Set(data.games.map((game) => game.patch))].sort(patchOrder)[0];
    const importedGame = data.games.find((game) => game.patch === patch);
    byId('league').value = 'all';
    byId('role').value = 'all';
    updateSelectors(patch, selection('compare-patch'));
    byId('ward-game').dataset.group = '';
    byId('ward-game').dataset.preferred = importedGame.id;
    byId('ward-minute').dataset.scope = '';
    for (const id of ['ward-kind', 'ward-side']) {
      if (byId(id)) byId(id).value = 'all';
    }
    byId('ward-minute').value = byId('ward-minute').max;
    render();
    setText('ward-import-status', `${counted(data.wards.length, 'ward', 'wards')} en ${counted(data.games.length, 'partida importada', 'partidas importadas')} en esta sesión.`);
    toggle('ward-reset', true);
  } catch (error) {
    if (state.importRequest === request) setText('ward-import-status', `No se pudo importar el archivo. ${error.message}`);
  }
}

async function loadLocalWards() {
  try {
    const response = await fetch('./data/wards-local.json', { cache: 'no-store', signal: AbortSignal.timeout(10_000) });
    const dataset = response.status === 404 ? emptyWards : normalizeWards(await response.json());
    assert(response.ok || response.status === 404, 'No se pudo abrir el archivo local.');
    state.localWards = dataset;
    setText('desktop-data-status', dataset.games.length ?
      `${counted(dataset.games.length, 'partida guardada', 'partidas guardadas')} en este equipo.` :
      'Tus exportaciones de GRID aparecerán aquí tras la conversión.');
    return true;
  } catch (error) {
    setText('desktop-data-status', `Revisa el archivo local de wards. ${error.message}`);
    return false;
  }
}

async function start() {
  configureTabs();
  const signal = AbortSignal.timeout(15_000);
  const [picks, wards, champions, builds, items] = await Promise.allSettled([
    fetchData('picks', signal),
    fetchData('wards', signal),
    fetch('./assets/champions/index.json', { signal }).then((response) => response.json()),
    fetchData('builds', signal),
    fetch('./assets/items/index.json', { signal }).then((response) => response.json()),
    desktop && loadLocalWards(),
  ]);
  if (champions.status === 'fulfilled') state.champions = champions.value;
  if (items.status === 'fulfilled') state.items = items.value;
  if (builds.status === 'fulfilled' && Array.isArray(builds.value.games)) {
    state.builds = new Map(builds.value.games.map((game) => [game.id, game]));
    state.buildSources = builds.value.sources ?? [];
  } else state.buildError = true;
  if (picks.status === 'fulfilled' && Array.isArray(picks.value.games)) state.picks = picks.value;
  else state.pickError = true;
  if (wards.status === 'fulfilled') {
    try {
      state.publishedWards = normalizeWards(wards.value);
    } catch (error) {
      state.wardError = true;
      console.error('Datos de wards inválidos', error);
    }
  } else state.wardError = true;
  toggle('desktop-controls', desktop);
  renderSources();
  choosePreset('pro');
  byId('desktop-reload')?.addEventListener('click', async (event) => {
    event.currentTarget.disabled = true;
    const button = event.currentTarget;
    try {
      const game = selection('ward-game', 'all');
      if (await loadLocalWards()) {
        if (game !== 'all') byId('ward-game').dataset.preferred = game;
        byId('ward-game').dataset.group = '';
        byId('ward-minute').dataset.scope = '';
        updateSelectors(selection('patch'), selection('compare-patch'));
        renderSources();
        render();
      }
    } finally {
      button.disabled = false;
    }
  });
  byId('patch').addEventListener('change', (event) => {
    const patch = event.target.value;
    const comparison = selection('compare-patch');
    updateSelectors(patch, patch === comparison ? event.target.dataset.selected : comparison);
    render();
  });
  for (const id of ['compare-patch', 'league', 'role', 'ward-side', 'ward-game', 'ward-kind', 'ward-mode']) {
    byId(id)?.addEventListener('change', render);
  }
  byId('pick-sort')?.addEventListener('change', () => renderPicks(
    selection('patch'), selection('compare-patch', 'off'), selection('league', 'all'), selection('role', 'all')));
  byId('ward-window').addEventListener('change', () => renderCurrentWards(false));
  const draftGame = byId('draft-game');
  byId('draft-search').addEventListener('input', renderDraft);
  draftGame.addEventListener('change', renderDraft);
  for (const [id, increment] of [['draft-prev', -1], ['draft-next', 1]]) {
    byId(id).addEventListener('click', () => {
      draftGame.selectedIndex += increment;
      renderDraft();
    });
  }
  const slider = byId('ward-minute');
  slider.addEventListener('input', () => {
    stopPlayback();
    state.selectedWard = null;
    renderCurrentWards();
  });
  byId('ward-play')?.addEventListener('click', () => {
    if (state.playback !== null) {
      stopPlayback();
      return;
    }
    if (Number(slider.value) === Number(slider.max)) slider.value = 0;
    state.selectedWard = null;
    setText('ward-play', 'Pausar');
    byId('ward-play').setAttribute('aria-pressed', 'true');
    renderCurrentWards(false);
    state.playback = window.setInterval(() => {
      slider.value = Math.min(Number(slider.max), Number(slider.value) + 15);
      const ended = slider.value === slider.max;
      if (ended) stopPlayback();
      renderCurrentWards(ended);
    }, 400);
  });
  (byId('preset-live') ?? byId('live-patches'))?.addEventListener('click', () => choosePreset('live'));
  byId('preset-pro')?.addEventListener('click', () => choosePreset('pro'));
  byId('ward-file')?.addEventListener('change', importWards);
  byId('ward-reset')?.addEventListener('click', () => {
    state.importRequest += 1;
    state.importedWards = emptyWards;
    byId('ward-game').dataset.group = '';
    byId('ward-minute').dataset.scope = '';
    setText('ward-import-status', 'Se quitaron las observaciones importadas.');
    toggle('ward-reset', false);
    updateSelectors(selection('patch'), selection('compare-patch'));
    render();
  });
}

start().catch((error) => {
  setText('app-status', 'El panel no se pudo iniciar. Recarga la página.');
  console.error(error);
});
