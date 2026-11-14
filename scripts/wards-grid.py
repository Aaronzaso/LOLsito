"""Convert Riot Events files from GRID into a LOLsito ward dataset."""

import argparse
from collections import Counter
from datetime import date
import json
import math
import os
from pathlib import Path
import re
import sys
from tempfile import NamedTemporaryFile
from urllib.parse import urlsplit


GRID_DOCS = 'https://docs.grid.gg/public/documentation/api-documentation/in-game-data/grid-file-download-api'
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


def load_game(entry, folder):
    game = {key: entry[key] for key in ('id', 'league', 'date', 'blueTeam', 'redTeam', 'sourceUrl')}
    if not all(isinstance(value, str) and value.strip() for value in game.values()):
        raise ValueError('id, league, date, blueTeam, redTeam y sourceUrl deben tener texto')
    if date.fromisoformat(game['date']).isoformat() != game['date']:
        raise ValueError('date debe tener formato AAAA-MM-DD')
    if not absolute_url(game['sourceUrl']):
        raise ValueError('sourceUrl debe ser una URL https')

    summary = read_json(folder / entry['summary'])
    info = summary.get('info', summary)
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
    events_file = folder / entry['events']
    with events_file.open(encoding='utf-8-sig') as stream:
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
            side = {'100': 'blue', '200': 'red'}.get(str(player.get('teamId')))
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


def save_local(data):
    """Replace the same match by ID, retaining other local imports."""
    local_app_data = os.environ.get('LOCALAPPDATA')
    if not local_app_data:
        raise ValueError('La opción --local requiere la carpeta LOCALAPPDATA de Windows')
    folder = Path(local_app_data) / 'LOLsito'
    folder.mkdir(parents=True, exist_ok=True)
    target = folder / 'wards-local.json'
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
        with NamedTemporaryFile(mode='w', encoding='utf-8', dir=folder, suffix='.tmp', delete=False) as stream:
            pending = Path(stream.name)
            json.dump(data, stream, ensure_ascii=False)
            stream.write('\n')
        pending.replace(target)
    finally:
        if pending is not None:
            pending.unlink(missing_ok=True)
    return target


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('manifest', type=Path, help='JSON con la lista de fichas de partidas y sus archivos de GRID')
    parser.add_argument('output', type=Path, nargs='?', help='Ruta del JSON de wards para importar en LOLsito')
    parser.add_argument('--local', action='store_true', help='Guarda las partidas en la biblioteca local de LOLsito para Windows')
    args = parser.parse_args()
    if args.local == (args.output is not None):
        parser.error('Indica una ruta de salida o usa --local')
    try:
        entries = read_json(args.manifest)
        if not isinstance(entries, list) or not entries:
            raise ValueError('El manifiesto debe ser una lista de fichas de partidas')
        data = {'updatedAt': date.today().isoformat(), 'sources': [{'name': 'Riot Events (GRID)', 'url': GRID_DOCS}], 'games': [], 'wards': []}
        game_ids = set()
        for entry in entries:
            game, wards = load_game(entry, args.manifest.parent)
            if game['id'] in game_ids:
                raise ValueError(f'ID de partida duplicado: {game["id"]}')
            game_ids.add(game['id'])
            data['games'].append(game)
            data['wards'].extend(wards)
        if args.local:
            target = save_local(data)
        else:
            target = args.output
            with target.open('x', encoding='utf-8') as stream:
                json.dump(data, stream, ensure_ascii=False, indent=2)
                stream.write('\n')
    except (OSError, ValueError, KeyError, AttributeError, TypeError) as error:
        parser.exit(1, f'Error al convertir wards: {error}\n')
    print(f'{len(data["wards"])} wards de {len(data["games"])} partidas en {target}')


if __name__ == '__main__':
    main()
