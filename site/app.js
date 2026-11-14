const byId = (id) => document.getElementById(id);
const roles = { top: 'Top', jng: 'Jungla', mid: 'Mid', bot: 'ADC', sup: 'Soporte' };
const sides = { blue: 'Azul', red: 'Rojo', unknown: 'Lado sin confirmar' };
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
  const response = await fetch(`./data/${filename}.json`, { signal });
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
  for (const game of data.games) {
    assert(game && typeof game.id === 'string' && game.id.trim() &&
      /^\d{2}\.\d{1,2}$/.test(game.patch) &&
      ['league', 'blueTeam', 'redTeam'].every((key) => typeof game[key] === 'string' && game[key].trim()) &&
      (!game.date || typeof game.date === 'string') &&
      (game.durationSeconds === undefined || (Number.isInteger(game.durationSeconds) && game.durationSeconds > 0)),
    'Cada partida necesita id, patch, league, blueTeam y redTeam.');
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
    return item;
  });
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
  importedWards: emptyWards,
  pickError: false,
  wardError: false,
  timelineKey: '',
  selectedWard: null,
  playback: null,
};

const selection = (id, fallback = '') => byId(id)?.value || fallback;
const patchOrder = (a, b) => b.localeCompare(a, 'es', { numeric: true });
const wardTypes = {
  control: 'Control', Control: 'Control', CONTROL_WARD: 'Control', VISION_WARD: 'Control',
  trinket: 'Centinela invisible', YELLOW_TRINKET: 'Centinela invisible', SIGHT_WARD: 'Centinela invisible',
  stealth: 'Centinela invisible', wards: 'Centinela invisible',
  farsight: 'Visión lejana', BLUE_TRINKET: 'Visión lejana', zombie: 'Centinela zombi', unknown: 'Tipo sin confirmar',
};
const labelType = (type) => (Object.hasOwn(wardTypes, type) ? wardTypes[type] : type) || wardTypes.unknown;

function wardData() {
  const importedIds = new Set(state.importedWards.games.map((game) => game.id));
  return {
    games: new Map([...state.publishedWards.games, ...state.importedWards.games].map((game) => [game.id, game])),
    wards: [...state.publishedWards.wards.filter((ward) => !importedIds.has(ward.gameId)), ...state.importedWards.wards],
    importedIds,
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
  fillSelect('league', [['all', 'Todas'], ...leagues.map((league) => [league, league])],
    selection('league', 'all'));
  fillSelect('role', [['all', 'Todos los roles'], ...Object.entries(roles)], selection('role', 'all'));
  setText('available-patches', `Parche actual ${currentPatch} · anterior ${previousPatch}`);
}

function gameMatches(game, patch, league) {
  return game.patch === patch && (league === 'all' || game.league === league);
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
  const aliases = {
    "Bel'Veth": 'Belveth', 'Dr. Mundo': 'DrMundo', 'Jarvan IV': 'JarvanIV', "K'Sante": 'KSante',
    "Kai'Sa": 'Kaisa', 'Kog’Maw': 'KogMaw', "Kha'Zix": 'Khazix', LeBlanc: 'Leblanc',
    'Lee Sin': 'LeeSin', 'Master Yi': 'MasterYi', 'Miss Fortune': 'MissFortune', 'Nunu & Willump': 'Nunu',
    Renata: 'Renata', 'Renata Glasc': 'Renata', 'Tahm Kench': 'TahmKench', 'Twisted Fate': 'TwistedFate',
    "Vel'Koz": 'Velkoz', 'Wukong': 'MonkeyKing', "Rek'Sai": 'RekSai', "Cho'Gath": 'Chogath',
  };
  const image = node('img', undefined, 'pick-icon');
  image.alt = '';
  image.width = 28;
  image.height = 28;
  image.loading = 'lazy';
  const slug = Object.hasOwn(aliases, champion) ? aliases[champion] : champion.replace(/[^a-zA-Z0-9]/g, '');
  image.src = `https://ddragon.leagueoflegends.com/cdn/16.22.1/img/champion/${slug}.png`;
  image.addEventListener('error', () => { image.hidden = true; }, { once: true });
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
  if (safeUrl(source)) summary.append(document.createTextNode(' · '), sourceAnchor(source, 'Ver en la repetición'));
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
    setText('app-status', `Parche ${patch} · ${byId('picks-count').textContent} con picks · ${number.format(wards)} wards observados`);
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
  if (state.timelineKey !== key) {
    state.timelineKey = key;
    const indexes = new Map(wards.map((ward, index) => [ward, index]));
    byId('ward-timeline-axis').replaceChildren(...[0, 0.25, 0.5, 0.75, 1].map((fraction) =>
      node('span', minuteSeconds(Math.round(duration * fraction)))));
    const chronological = wards.toSorted((a, b) => a.seconds - b.seconds);
    const lanes = [];
    for (const [side, label] of Object.entries(sides)) {
      const entries = chronological.filter((ward) => ward.side === side);
      if (!entries.length) continue;
      const lane = node('div', undefined, 'timeline-lane');
      const track = node('div', undefined, 'timeline-track');
      for (const ward of entries) {
        const description = wardDescription(ward, game);
        const event = node('button', undefined, 'timeline-event');
        event.type = 'button';
        event.dataset.side = side;
        event.dataset.seconds = ward.seconds;
        event.dataset.index = indexes.get(ward);
        event.style.left = `${100 * ward.seconds / duration}%`;
        event.title = description;
        event.setAttribute('aria-label', description);
        event.addEventListener('click', () => jumpToWard(ward));
        track.append(event);
      }
      lane.append(node('span', side === 'unknown' ? 'Sin lado' : label, 'timeline-lane-label'), track);
      lanes.push(lane);
    }
    byId('ward-timeline-lanes').replaceChildren(...lanes);
    byId('ward-history-list')?.replaceChildren(...chronological.map((ward) => {
      const item = node('li');
      const details = node('button', wardDescription(ward, game), 'history-event');
      details.type = 'button';
      details.addEventListener('click', () => jumpToWard(ward));
      item.append(details);
      return item;
    }));
    const method = wards.some((ward) => ward.observed) ? 'Los puntos indican cuándo se vio cada ward en la repetición.' :
      'Los puntos indican cuándo se registró cada ward.';
    setText('ward-timeline-caption', game.durationSeconds ? method :
      `${method} La escala llega a la última observación registrada.`);
  }
  for (const marker of byId('ward-timeline-lanes').querySelectorAll('.timeline-event')) {
    marker.dataset.active = String(Number(marker.dataset.seconds) <= seconds);
    marker.setAttribute('aria-current', String(wards[Number(marker.dataset.index)] === state.selectedWard));
  }
  for (const track of byId('ward-timeline-lanes').querySelectorAll('.timeline-track')) {
    track.style.setProperty('--timeline-progress', `${100 * seconds / duration}%`);
  }
}

function renderWards(patch, league, role) {
  const { games, wards, importedIds } = wardData();
  const matchingGames = [...games.values()].filter((game) => gameMatches(game, patch, league));
  const ids = new Set(matchingGames.map((game) => game.id));
  const available = wards.filter((ward) => ids.has(ward.gameId));
  const gameOptions = matchingGames.map((game) => {
    const gameNumber = game.number ?? game.gameNumber;
    return [game.id, `${game.blueTeam} vs. ${game.redTeam}${gameNumber ? ` · P${gameNumber}` : ''}${game.date ? ` · ${game.date.slice(0, 10)}` : ''}`];
  });
  const group = JSON.stringify([patch, league, gameOptions.map(([id]) => id)]);
  const gameChanged = byId('ward-game').dataset.group !== group;
  byId('ward-game').dataset.group = group;
  const gameValue = gameChanged ? gameOptions[0]?.[0] : selection('ward-game');
  if (gameChanged) fillSelect('ward-game', [['all', 'Todas las partidas'], ...gameOptions], gameValue, 'all');
  const gameId = selection('ward-game', 'all');
  if (gameChanged) {
    const types = [...new Set(available.map((ward) => labelType(ward.type)))].sort();
    fillSelect('ward-kind', [['all', 'Todos los tipos'], ...types.map((type) => [type, type])],
      selection('ward-kind', 'all'));
  }
  const minuteSlider = byId('ward-minute');
  const game = games.get(gameId);
  const relevant = available.filter((ward) => gameId === 'all' || gameId === ward.gameId);
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
  setText('ward-empty', eligible.length ? 'Todavía no hay observaciones para este minuto.' :
    available.length ? 'Ningún ward coincide con estos filtros.' : 'Sin wards verificados para esta selección.');
  const matchCount = new Set(filtered.map((ward) => ward.gameId)).size;
  setText('ward-status', state.wardError && !available.length ? 'No se pudo cargar la fuente de wards.' :
    `${counted(filtered.length, 'ward', 'wards')} en ${counted(matchCount, 'partida', 'partidas')}`);
  const summary = filtered.length
    ? [filtered.some((ward) => ward.approximate) ? 'Incluye posiciones aproximadas del VOD.' : 'Coordenadas de wards registrados.',
      filtered.some((ward) => importedIds.has(ward.gameId)) ? 'Incluye datos importados en este navegador.' : '',
      density ? 'El color más intenso indica más observaciones en la zona.' : 'Selecciona un punto para ver su minuto y fuente.'].filter(Boolean).join(' ')
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
  if (matches) {
    const visibleIds = new Set(eligible.map((ward) => ward.gameId));
    const list = matchingGames.filter((game) => visibleIds.has(game.id));
    matches.replaceChildren(...list.map((game) => {
      const item = node('li');
      const label = gameOptions.find(([id]) => id === game.id)[1];
      item.append(sourceAnchor(game.sourceUrl, label));
      return item;
    }));
    matches.hidden = !list.length;
  }
  return filtered.length;
}

function renderSources() {
  const sources = new Map();
  for (const source of [
    ...state.picks.sources, ...state.publishedWards.sources,
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
  if (state.pickError || state.wardError) {
    setText('app-status', 'Una fuente no se pudo cargar. Puedes consultar los datos disponibles.');
  } else {
    setText('app-status', `Parche ${patch} · ${counted(picks, 'partida', 'partidas')} con picks · ${counted(wards, 'ward observado', 'wards observados')}`);
  }
  byId('preset-live')?.setAttribute('aria-pressed', String(
    patch === state.picks.currentPatch && compare === state.picks.previousPatch && league === 'all' && role === 'all'));
  byId('preset-pro')?.setAttribute('aria-pressed', String(patch === state.picks.worldsPatch || patch === '26.20'));
  const showPatches = [patch, compare !== 'off' ? compare : ''].filter(Boolean).join(' vs. ');
  setText('view-patches', showPatches);
}

function choosePreset(type) {
  const { currentPatch, previousPatch, games } = state.picks;
  let patch = currentPatch;
  let compare = previousPatch;
  if (type === 'pro') {
    const observed = [...new Set(games.map((game) => game.patch))].sort(patchOrder);
    patch = observed.find((version) => games.some((game) => game.patch === version && game.league.includes('Worlds'))) ??
      observed.find((version) => version !== currentPatch && version !== previousPatch) ?? observed[0] ?? patch;
    compare = observed.find((item) => item !== patch) ?? 'off';
  }
  if (byId('league')) byId('league').value = 'all';
  if (byId('role')) byId('role').value = 'all';
  byId('ward-game').dataset.group = '';
  for (const id of ['ward-kind', 'ward-side']) {
    if (byId(id)) byId(id).value = 'all';
  }
  byId('ward-minute').value = byId('ward-minute').max;
  updateSelectors(patch, compare);
  render();
}

async function importWards(event) {
  const file = event.target.files[0];
  if (!file) return;
  try {
    assert(file.size <= 8 * 1024 * 1024, 'Usa un archivo de hasta 8 MB.');
    const text = (await file.text()).replace(/^\uFEFF/, '');
    const data = /\.csv$/i.test(file.name) ? parseCsv(text) : normalizeWards(JSON.parse(text));
    assert(data.wards.length, 'El archivo no trae observaciones de wards.');
    state.importedWards = data;
    const patch = [...new Set(data.games.map((game) => game.patch))].sort(patchOrder)[0];
    byId('league').value = 'all';
    byId('role').value = 'all';
    updateSelectors(patch, selection('compare-patch'));
    byId('ward-game').dataset.group = '';
    byId('ward-minute').dataset.scope = '';
    for (const id of ['ward-kind', 'ward-side']) {
      if (byId(id)) byId(id).value = 'all';
    }
    byId('ward-minute').value = byId('ward-minute').max;
    render();
    setText('ward-import-status', `${number.format(data.wards.length)} observaciones cargadas para esta sesión.`);
    toggle('ward-reset', true);
  } catch (error) {
    setText('ward-import-status', `No se pudo importar el archivo. ${error.message}`);
  } finally {
    event.target.value = '';
  }
}

async function start() {
  const signal = AbortSignal.timeout(15_000);
  const [picks, wards] = await Promise.allSettled([fetchData('picks', signal), fetchData('wards', signal)]);
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
  renderSources();
  choosePreset('live');
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
    state.importedWards = emptyWards;
    byId('ward-game').dataset.group = '';
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
