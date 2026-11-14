"""Convert Riot Events files from GRID into a LOLsito ward dataset."""

import argparse
from collections import Counter
from contextlib import contextmanager
from datetime import date
import json
import math
import os
from pathlib import Path
import re
import sys
from tempfile import NamedTemporaryFile
from urllib.parse import urlsplit
from zipfile import BadZipFile

from grid_folder import MAX_EVENTS, GameFile, discover, explicit_teams, game_date, read_summary


GRID_DOCS = 'https://docs.grid.gg/public/documentation/api-documentation/in-game-data/grid-file-download-api'
PICKS = Path(__file__).resolve().parents[1] / 'site' / 'data' / 'picks.json'
SIDES = {'100': 'blue', '200': 'red'}
ROLES = {
    'TOP': 'top',
    'JUNGLE': 'jng',
    'MIDDLE': 'mid',
    'BOTTOM': 'bot',
    'UTILITY': 'sup',
}
TYPES = {
    'yellowtrinket': 'stealth',
    'sightward': 'stealth',
    'stealthward': 'stealth',
    'controlward': 'control',
    'control': 'control',
    'visionward': 'control',
    'bluetrinket': 'farsight',
    'farsightward': 'farsight',
    'farsightalteration': 'farsight',
    'zombieward': 'zombie',
}


def read_json(path):
    with path.open(encoding='utf-8-sig') as stream:
        return json.load(stream)


def absolute_url(value):
    if not isinstance(value, str):
        return False
    parts = urlsplit(value)
    return parts.scheme == 'https' and bool(parts.netloc)


def named_game(entry):
    game = {key: entry[key] for key in ('id', 'league', 'date', 'blueTeam', 'redTeam', 'sourceUrl')}
    if not all(isinstance(value, str) and value.strip() for value in game.values()):
        raise ValueError('id, league, date, blueTeam, redTeam y sourceUrl deben tener texto')
    if date.fromisoformat(game['date']).isoformat() != game['date']:
        raise ValueError('date debe tener formato AAAA-MM-DD')
    if not absolute_url(game['sourceUrl']):
        raise ValueError('sourceUrl debe ser una URL https')
    return game


def patch_number(version):
    if not isinstance(version, str):
        return None
    match = re.fullmatch(r'(\d{2})\.(\d{1,2})(?:\.\d+)*', version.strip())
    if not match:
        return None
    major, minor = map(int, match.groups())
    if major == 15:
        major = 25
    if major == 16:
        major = 26
    return f'{major}.{minor:02d}'


def ward_coordinates(position):
    if not isinstance(position, dict):
        return None
    x, z = position.get('x'), position.get('z')
    if any(type(value) not in (int, float) or not math.isfinite(value) for value in (x, z)):
        return None
    # Bounds for the north-up Data Dragon image. Riot Events use X/Z on the ground plane.
    if not (-120 <= x <= 14870 and -120 <= z <= 14980):
        return None
    return round((x + 120) / 14990, 6), round((14980 - z) / 15100, 6)


def load_game(entry, info, events_file):
    game = named_game(entry)
    actual_patch = patch_number(info.get('gameVersion'))
    declared_patch = patch_number(entry.get('patch'))
    if 'patch' in entry and not declared_patch:
        raise ValueError('patch debe tener formato 26.22')
    if actual_patch and declared_patch and actual_patch != declared_patch:
        raise ValueError(f'El parche de la ficha ({declared_patch}) difiere del export ({actual_patch})')
    game['patch'] = actual_patch or declared_patch
    if not game['patch']:
        raise ValueError('El resumen no incluye gameVersion; indica patch en la ficha')
    if info.get('mapId') not in (None, 11, '11'):
        raise ValueError('Se requiere La Grieta del Invocador (mapId 11)')
    duration = entry.get('durationSeconds', info.get('gameDuration'))
    if 'durationSeconds' in entry and (type(duration) is not int or duration <= 0):
        raise ValueError('durationSeconds debe ser un entero positivo')
    # Match-style summaries may export durations in milliseconds or seconds.
    # Only take plausible seconds here; otherwise rely on the manifest.
    if type(duration) is int and 0 < duration < 21600:
        game['durationSeconds'] = duration
    participants = {str(item['participantId']): item for item in info['participants']}
    if not participants:
        raise ValueError('El resumen no contiene participantes')
    if 'number' in entry:
        if type(entry['number']) is not int or entry['number'] < 1:
            raise ValueError('number debe ser un entero positivo')
        game['number'] = entry['number']

    wards = []
    skipped = 0
    placed_by_player = Counter()
    with events_file.open(MAX_EVENTS) as stream:
        for line_number, line in enumerate(stream, start=1):
            if not line.strip():
                continue
            try:
                event = json.loads(line)
            except json.JSONDecodeError as error:
                raise ValueError(f'{events_file.name}:{line_number} tiene JSON inválido') from error
            if event.get('rfc461Schema') != 'ward_placed':
                continue
            point = ward_coordinates(event.get('position'))
            timestamp = event.get('gameTime')
            player = participants.get(str(event.get('placer')), {})
            side = SIDES.get(str(player.get('teamId')))
            if not point or not side or type(timestamp) not in (float, int) or not math.isfinite(timestamp) or timestamp < 0:
                skipped += 1
                continue
            ward = {
                'gameId': game['id'],
                'seconds': int(timestamp / 1000),
                'x': point[0],
                'y': point[1],
                'side': side,
            }
            name = player.get('riotIdGameName') or player.get('summonerName')
            if name:
                ward['player'] = name
            role = ROLES.get(player.get('teamPosition'))
            if role:
                ward['role'] = role
            kind = re.sub(r'[^a-z]', '', str(event.get('wardType', '')).lower())
            if kind in TYPES:
                ward['type'] = TYPES[kind]
            wards.append(ward)
            placed_by_player[str(event['placer'])] += 1

    if skipped:
        print(f'{game["id"]}: {skipped} eventos de colocación sin coordenadas, tiempo o lado válidos', file=sys.stderr)
    if game.get('durationSeconds', 0) < max((ward['seconds'] for ward in wards), default=0):
        if 'durationSeconds' in entry:
            raise ValueError('durationSeconds termina antes del último ward registrado')
        game.pop('durationSeconds', None)

    reported = {key: player.get('wardsPlaced') for key, player in participants.items()}
    team_sizes = Counter(str(player.get('teamId')) for player in participants.values())
    counts_available = (
        team_sizes == {'100': 5, '200': 5}
        and all(type(count) is int and count >= 0 for count in reported.values())
    )
    if counts_available:
        game['expectedWards'] = sum(reported.values())
    verified = (
        counts_available and game.get('durationSeconds') and not skipped
        and all(placed_by_player[key] == count for key, count in reported.items())
    )
    if not wards and not verified:
        raise ValueError(f'{game["id"]}: el archivo no contiene colocaciones con datos válidos')
    game['coverage'] = 'complete' if verified else 'events'
    if not verified:
        print(f'{game["id"]}: no se pudo comprobar el historial completo con el resumen final', file=sys.stderr)
    return game, wards


def manifest_entries(manifest):
    entries = read_json(manifest)
    if not isinstance(entries, list) or not entries:
        raise ValueError('El manifiesto debe ser una lista de fichas de partidas')
    return [(entry, {
        key: GameFile(manifest.parent / entry[key]) for key in ('events', 'summary')
    }) for entry in entries]


def item_key(value):
    return ''.join(char for char in value.casefold() if char.isalnum()) if isinstance(value, str) else ''


def champion_key(value):
    key = item_key(value)
    return {'monkeyking': 'wukong', 'nunu': 'nunuwithwillump', 'nunuwillump': 'nunuwithwillump'}.get(key, key)


def signature(rows):
    if len(rows) != 10 or not all(side in SIDES.values() and player and champion for side, player, champion in rows):
        return None
    if Counter(side for side, _, _ in rows) != {'blue': 5, 'red': 5}:
        return None
    return sorted(rows)


def player_rows(info):
    return [
        (SIDES.get(str(participant.get('teamId'))),
         item_key(participant.get('riotIdGameName') or participant.get('summonerName')),
         champion_key(participant.get('championName')))
        for participant in info.get('participants', [])
    ]


def pick_rows(game):
    return [(pick['side'], item_key(pick['player']), champion_key(pick['champion'])) for pick in game['picks']]


def check_game_match(info, game):
    actual_date = game_date(info)
    if actual_date and actual_date != game['date'][:10]:
        raise ValueError('la fecha del resumen no coincide con la partida del panel')
    observed = signature([(side, champion, champion) for side, _, champion in player_rows(info)])
    expected = signature([(side, champion, champion) for side, _, champion in pick_rows(game)])
    if observed and expected and observed != expected:
        raise ValueError('los campeones por lado del resumen no coinciden con la partida del panel')


def known_pick(info, game_number, picks):
    patch = patch_number(info.get('gameVersion'))
    day = game_date(info)
    if not patch and not day:
        return None
    actual = signature(player_rows(info))
    if actual is None:
        return None
    candidates = []
    for game in picks.values():
        if game['number'] != game_number or (patch and game['patch'] != patch) or (day and game['date'][:10] != day):
            continue
        expected = signature(pick_rows(game))
        if expected == actual:
            candidates.append(game)
    return candidates[0] if len(candidates) == 1 else None


def pick_entry(game):
    entry = {key: game[key] for key in ('id', 'league', 'patch', 'blueTeam', 'redTeam', 'number')}
    entry['date'] = game['date'][:10]
    entry['sourceUrl'] = game['source']
    if type(game.get('durationSeconds')) is int:
        entry['durationSeconds'] = game['durationSeconds']
    return entry


def matches_mapping(path, picks):
    if not path:
        return {}
    mapping = {}
    entries = read_json(path)
    if not isinstance(entries, list):
        raise ValueError('grid-series.json debe contener una lista de asignaciones')
    for row in entries:
        series = str(row['seriesId'])
        number = row['number']
        game_id = row['id']
        if not re.fullmatch(r'[1-9][0-9]*', series) or type(number) is not int or number < 1:
            raise ValueError('Cada asignación requiere un seriesId numérico y un número de partida positivo')
        if game_id not in picks or picks[game_id]['number'] != number:
            raise ValueError(f'{game_id}: el ID o número no coincide con la partida del panel')
        key = (series, number)
        if key in mapping:
            raise ValueError(f'Serie {series}, partida {number}: asignación duplicada')
        mapping[key] = picks[game_id]
    return mapping


def derive_entry(info, series, game_number, picks, mapping):
    game = mapping.get((series, game_number)) or known_pick(info, game_number, picks)
    if game:
        check_game_match(info, game)
        return pick_entry(game)
    teams = explicit_teams(info)
    day = game_date(info)
    patch = patch_number(info.get('gameVersion'))
    if not (teams.keys() == SIDES.keys() and day and patch):
        raise ValueError(
            'el resumen no identifica la partida. Agregá una asignación en grid-series.json '
            'o usá un manifiesto games.json con los equipos, fecha y parche'
        )
    league = info.get('leagueName')
    if not isinstance(league, str) or not league.strip():
        league = 'GRID local'
    return {
        'id': f'grid-{series}-{game_number}', 'league': league, 'date': day, 'patch': patch,
        'blueTeam': teams['100'], 'redTeam': teams['200'], 'number': game_number, 'sourceUrl': GRID_DOCS,
    }


def append_game(data, game_ids, entry, info, events_file):
    game, wards = load_game(entry, info, events_file)
    if game['id'] in game_ids:
        raise ValueError(f'ID de partida duplicado: {game["id"]}')
    game_ids.add(game['id'])
    data['games'].append(game)
    data['wards'].extend(wards)


def scan_folder(data, game_ids, folder, mapping_path):
    explicit_entries = {}
    ambiguous_entries = set()
    for manifest in sorted(folder.rglob('games.json')):
        try:
            for entry, files in manifest_entries(manifest):
                key = tuple(files[kind].path.resolve() for kind in ('events', 'summary'))
                if not all(path.is_relative_to(folder) for path in key):
                    raise ValueError('Los archivos del manifiesto deben estar en la carpeta seleccionada')
                if key in explicit_entries:
                    ambiguous_entries.add(key)
                explicit_entries[key] = entry
        except (OSError, ValueError, KeyError, TypeError) as error:
            print(f'{manifest.name}: {error}', file=sys.stderr)
    pairs, warnings = discover(folder)
    for warning in warnings:
        print(warning, file=sys.stderr)
    if not pairs:
        raise ValueError('No se encontró un par de Riot Events y Riot End State Summary en la carpeta')
    picks = {game['id']: game for game in read_json(PICKS)['games']}
    default_mapping = folder / 'grid-series.json'
    mapping = matches_mapping(mapping_path or (default_mapping if default_mapping.is_file() else None), picks)
    for (series, number), files in pairs.items():
        try:
            info = read_summary(files['summary'])
            key = tuple(files[kind].path.resolve() for kind in ('events', 'summary'))
            raw_pair = all(file.member is None for file in files.values())
            if raw_pair and key in ambiguous_entries:
                raise ValueError('varios manifiestos describen el mismo par de archivos')
            entry = explicit_entries.get(key) if raw_pair else None
            if entry:
                if entry.get('number', number) != number:
                    raise ValueError('El número del manifiesto no coincide con los archivos')
                known = picks.get(entry.get('id'))
                if known:
                    check_game_match(info, known)
                entry = {**entry, 'number': number}
            else:
                entry = derive_entry(info, series, number, picks, mapping)
            append_game(data, game_ids, entry, info, files['events'])
        except (OSError, ValueError, KeyError, AttributeError, TypeError, BadZipFile, RuntimeError, NotImplementedError) as error:
            print(f'Serie {series}, partida {number}: {error}', file=sys.stderr)
    if not data['games']:
        raise ValueError('Ninguna partida pudo importarse. Revisá los mensajes de los archivos.')


@contextmanager
def local_lock(folder):
    if os.name != 'nt':
        yield
        return

    # All LOLsito desktop instances and local CLI imports share this lock.
    import msvcrt
    with (folder / '.wards-local.lock').open('a+b') as lock:
        lock.seek(0)
        msvcrt.locking(lock.fileno(), msvcrt.LK_LOCK, 1)
        try:
            yield
        finally:
            lock.seek(0)
            msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)


def save_local(data):
    """Replace the same match by ID, retaining other local imports."""
    local_app_data = os.environ.get('LOCALAPPDATA')
    if not local_app_data:
        raise ValueError('La opción --local requiere la carpeta LOCALAPPDATA de Windows')
    folder = Path(local_app_data) / 'LOLsito'
    folder.mkdir(parents=True, exist_ok=True)
    target = folder / 'wards-local.json'
    with local_lock(folder):
        merge_local(data, target)
    return target


def merge_local(data, target):
    if target.exists():
        previous = read_json(target)
        complete_ids = {game['id'] for game in previous['games'] if game['coverage'] == 'complete'}
        replaced = {game['id'] for game in data['games'] if game['coverage'] == 'complete' or game['id'] not in complete_ids}
        for game in data['games']:
            if game['id'] not in replaced:
                print(f'{game["id"]}: se conserva el registro completo que ya estaba guardado', file=sys.stderr)
        data['games'] = [game for game in previous['games'] if game['id'] not in replaced] + [
            game for game in data['games'] if game['id'] in replaced]
        data['wards'] = [ward for ward in previous['wards'] if ward['gameId'] not in replaced] + [
            ward for ward in data['wards'] if ward['gameId'] in replaced]
        data['sources'] = list({source['url']: source for source in previous['sources'] + data['sources']}.values())

    pending = None
    try:
        with NamedTemporaryFile(mode='w', encoding='utf-8', dir=target.parent, suffix='.tmp', delete=False) as stream:
            pending = Path(stream.name)
            json.dump(data, stream, ensure_ascii=False)
            stream.write('\n')
        pending.replace(target)
    finally:
        if pending is not None:
            pending.unlink(missing_ok=True)


def main():
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, 'reconfigure'):
            stream.reconfigure(encoding='utf-8')
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('manifest', type=Path, nargs='?', help='JSON con la lista de fichas de partidas y sus archivos de GRID')
    parser.add_argument('output', type=Path, nargs='?', help='Ruta del JSON de wards para importar en LOLsito')
    parser.add_argument('--carpeta', '--folder', type=Path, dest='folder', help='Busca pares Riot Events y Riot End State Summary en una carpeta')
    parser.add_argument('--mapeo', '--mapping', type=Path, dest='mapping', help='Asignaciones opcionales de partidas GRID a IDs del panel')
    parser.add_argument('--salida', type=Path, help='Ruta del JSON al usar --carpeta sin --local')
    parser.add_argument('--local', action='store_true', help='Guarda las partidas en la biblioteca local de LOLsito para Windows')
    args = parser.parse_args()
    if bool(args.folder) == bool(args.manifest):
        parser.error('Indica un manifiesto o usa --carpeta')
    if (args.mapping or args.salida) and not args.folder:
        parser.error('--mapeo y --salida corresponden a --carpeta')
    output = args.output or args.salida
    if args.local == (output is not None):
        parser.error('Indica una ruta de salida o usa --local')
    try:
        data = {'updatedAt': date.today().isoformat(), 'sources': [{'name': 'Riot Events (GRID)', 'url': GRID_DOCS}], 'games': [], 'wards': []}
        game_ids = set()
        if args.folder:
            scan_folder(data, game_ids, args.folder.resolve(), args.mapping)
        else:
            for entry, files in manifest_entries(args.manifest):
                append_game(data, game_ids, entry, read_summary(files['summary']), files['events'])
        if args.local:
            target = save_local(data)
        else:
            target = output
            with target.open('x', encoding='utf-8') as stream:
                json.dump(data, stream, ensure_ascii=False, indent=2)
                stream.write('\n')
    except (OSError, ValueError, KeyError, AttributeError, TypeError, BadZipFile) as error:
        parser.exit(1, f'Error al convertir wards: {error}\n')
    print(f'{len(data["wards"])} wards de {len(data["games"])} partidas en {target}')


if __name__ == '__main__':
    main()
