"""Descarga localmente Riot Events y End State Summary desde GRID."""

import argparse
from datetime import UTC, date, datetime
import getpass
import json
import os
from pathlib import Path, PurePosixPath
import re
import sys
from tempfile import TemporaryDirectory
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener
import warnings
import zipfile


API = 'https://api.grid.gg/file-download'
PICKS = Path(__file__).resolve().parents[1] / 'site' / 'data' / 'picks.json'
WARDS = PICKS.with_name('wards.json')
CHUNK_SIZE = 1024 * 1024
MAX_DOWNLOAD = 512 * CHUNK_SIZE
MAX_FILE_LIST = 4 * CHUNK_SIZE
FILE_TYPES = {
    'events': ('events-riot-game-', 'events-riot-compressed', 'events_{series}_{number}_riot.jsonl'),
    'summary': ('state-summary-riot-game-', 'state-riot-compressed', 'end_state_summary_riot_{series}_{number}.json'),
}


def grid_url(url):
    parts = urlsplit(url)
    return parts.scheme == 'https' and parts.netloc == 'api.grid.gg' and parts.path.startswith('/file-download/')


class GridRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, new_url):
        parts = urlsplit(new_url)
        if parts.scheme != 'https' or not parts.hostname or parts.username or parts.password:
            raise ValueError('GRID devolvió una redirección sin HTTPS válido')
        redirected = super().redirect_request(request, fp, code, msg, headers, new_url)
        # GRID may redirect to a signed storage URL. Only the File Download API receives the key.
        if redirected and grid_url(new_url) and request.has_header('X-api-key'):
            redirected.add_unredirected_header('X-Api-Key', request.get_header('X-api-key'))
        return redirected


class Grid:
    def __init__(self, key):
        self.key = key
        self.opener = build_opener(GridRedirect())

    def open(self, url, accept='*/*'):
        if not grid_url(url):
            raise ValueError('La lista de GRID devolvió una URL ajena a File Download API')
        request = Request(url, headers={'Accept': accept, 'User-Agent': 'LOLsito/1.0'})
        request.add_unredirected_header('X-Api-Key', self.key)
        try:
            return self.opener.open(request, timeout=60)
        except HTTPError as error:
            if error.code in {401, 403}:
                raise ValueError(f'GRID devolvió HTTP {error.code}. Revisá la clave y el permiso File Download para la serie.') from None
            if error.code == 404:
                raise ValueError('GRID devolvió HTTP 404. Confirmá el ID de serie y la cobertura de los archivos.') from None
            if error.code == 429:
                raise ValueError('GRID devolvió HTTP 429. Intentá de nuevo cuando se restablezca el límite de consultas.') from None
            raise ValueError(f'GRID devolvió HTTP {error.code}.') from None
        except URLError:
            raise ValueError('No se pudo conectar con GRID. Revisá tu conexión y probá de nuevo.') from None

    def files(self, series):
        with self.open(f'{API}/list/{series}', 'application/json') as response:
            raw = response.read(MAX_FILE_LIST + 1)
        if len(raw) > MAX_FILE_LIST:
            raise ValueError('La lista de archivos supera 4 MB')
        data = json.loads(raw)
        files = data.get('files') if isinstance(data, dict) else None
        if not isinstance(files, list) or not all(isinstance(item, dict) for item in files):
            raise ValueError('GRID devolvió una lista de archivos inválida')
        return files

    def download(self, url, target):
        with self.open(url) as response, target.open('xb') as output:
            copy_file(response, output)


def copy_file(source, target):
    count = 0
    while chunk := source.read(CHUNK_SIZE):
        count += len(chunk)
        if count > MAX_DOWNLOAD:
            raise ValueError('El archivo supera 512 MB')
        target.write(chunk)
    if not count:
        raise ValueError('GRID devolvió un archivo vacío')


def series_id(value):
    value = str(value)
    if not re.fullmatch(r'[1-9][0-9]{0,23}', value):
        raise ValueError('Indicá un seriesId numérico del historial o Central Data Feed de GRID')
    return value


def api_key():
    value = os.environ.get('GRID_API_KEY', '').strip()
    if not value:
        with warnings.catch_warnings():
            warnings.simplefilter('error', getpass.GetPassWarning)
            try:
                value = getpass.getpass('Clave GRID (entrada oculta): ').strip()
            except (EOFError, getpass.GetPassWarning):
                raise ValueError('Abrí una terminal interactiva para ingresar la clave GRID.') from None
    if not value:
        raise ValueError('Falta la clave de GRID')
    return value


def read_json(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def print_matches(patch, all_matches):
    picks = read_json(PICKS)
    wards = read_json(WARDS)
    patches = {patch} if patch else {picks['currentPatch'], picks['previousPatch']}
    annotated = {game['id'] for game in wards['games']}
    games = [game for game in picks['games']
             if game['patch'] in patches and (all_matches or game['id'] in annotated)]
    for game in sorted(games, key=lambda row: (row['patch'], row['date'], row['id']), reverse=True):
        print(f'{game["patch"]}  {game["date"][:10]}  P{game["number"]}  '
              f'{game["blueTeam"]} vs. {game["redTeam"]}  |  {game["id"]}')
    print(f'{len(games)} partidas. Pedí a GRID el seriesId de las series que quieras descargar.')


def selections(path):
    entries = read_json(path)
    if not isinstance(entries, list) or not entries:
        raise ValueError('La selección debe ser una lista de partidas')
    picks = {game['id']: game for game in read_json(PICKS)['games']}
    local_ids = set()
    grid_ids = set()
    results = []
    for entry in entries:
        if not isinstance(entry, dict) or not isinstance(entry.get('id'), str) or not entry['id'].strip():
            raise ValueError('Cada partida necesita id')
        existing = picks.get(entry['id'], {})
        series = series_id(entry.get('seriesId'))
        number = entry.get('number', existing.get('number'))
        if type(number) is not int or number < 1 or (existing and number != existing['number']):
            raise ValueError(f'{entry["id"]}: indicá el número de partida que coincide con el marcador')
        if entry['id'] in local_ids or (series, number) in grid_ids:
            raise ValueError(f'{entry["id"]}: la partida está repetida')
        local_ids.add(entry['id'])
        grid_ids.add((series, number))
        game = {}
        for field in ('id', 'patch', 'date', 'league', 'blueTeam', 'redTeam', 'durationSeconds'):
            if field in entry or field in existing:
                game[field] = entry.get(field, existing.get(field))
        game['number'] = number
        game['sourceUrl'] = entry.get('sourceUrl') or existing.get('source') or existing.get('vod')
        for field in ('patch', 'league', 'date', 'blueTeam', 'redTeam', 'sourceUrl'):
            if not isinstance(game.get(field), str) or not game[field].strip():
                raise ValueError(f'{entry["id"]}: falta {field}')
        if not re.fullmatch(r'\d{2}\.\d{1,2}', game['patch']):
            raise ValueError(f'{entry["id"]}: ingresá el parche, por ejemplo 26.22')
        game['date'] = date.fromisoformat(game['date'][:10]).isoformat()
        source = urlsplit(game['sourceUrl'])
        if source.scheme != 'https' or not source.hostname:
            raise ValueError(f'{entry["id"]}: sourceUrl debe ser HTTPS')
        if game.get('durationSeconds') is None:
            game.pop('durationSeconds', None)
        elif type(game['durationSeconds']) is not int or game['durationSeconds'] < 1:
            raise ValueError(f'{entry["id"]}: durationSeconds debe ser un entero positivo')
        results.append((series, game))
    return results


def plan_file(files, series, number, kind):
    individual_id, archive_id, filename = FILE_TYPES[kind]
    individual_id += str(number)
    by_id = {item['id']: item for item in files if isinstance(item.get('id'), str)}
    for file_id in (individual_id, archive_id):
        item = by_id.get(file_id, {})
        url = item.get('fullURL')
        if item.get('status') == 'ready' and isinstance(url, str) and grid_url(url):
            return url, filename.format(series=series, number=number), file_id == archive_id
    states = [f'{file_id} ({by_id[file_id].get("status", "sin estado")})'
              for file_id in (individual_id, archive_id) if file_id in by_id]
    detail = ', '.join(states) or f'{individual_id} ausente'
    raise ValueError(f'Serie {series}, partida {number}: archivo Riot no disponible. {detail}.')


def save_game_file(downloaded, target, require_zip):
    if zipfile.is_zipfile(downloaded):
        with zipfile.ZipFile(downloaded) as archive:
            members = [item for item in archive.infolist() if not item.is_dir()
                       and PurePosixPath(item.filename.replace('\\', '/')).name == target.name]
            if len(members) != 1:
                raise ValueError(f'El ZIP debe contener una sola copia de {target.name}')
            member = members[0]
            if member.file_size > MAX_DOWNLOAD:
                raise ValueError(f'{target.name} supera 512 MB')
            # Write to our own path, independent of paths inside the ZIP.
            with archive.open(member) as source, target.open('xb') as output:
                copy_file(source, output)
    elif require_zip:
        raise ValueError(f'Se esperaba un ZIP de serie que contuviera {target.name}')
    else:
        with downloaded.open('rb') as source, target.open('xb') as output:
            copy_file(source, output)


def download_games(client, games, output):
    if output.exists():
        raise ValueError(f'La carpeta de destino ya existe: {output}')
    series_lists = {}
    plans = []
    for series, game in games:
        if series not in series_lists:
            series_lists[series] = client.files(series)
        files = {kind: plan_file(series_lists[series], series, game['number'], kind) for kind in FILE_TYPES}
        plans.append((game, files))

    output.parent.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(prefix='.lolsito-grid-', dir=output.parent) as directory:
        temp = Path(directory)
        staged = temp / 'files'
        staged.mkdir()
        downloaded = {}
        manifest = []
        for game, files in plans:
            game = game.copy()
            for kind, (url, name, archive) in files.items():
                if url not in downloaded:
                    file = temp / f'download-{len(downloaded)}'
                    client.download(url, file)
                    downloaded[url] = file
                save_game_file(downloaded[url], staged / name, archive)
                game[kind] = name
            manifest.append(game)
        (staged / 'games.json').write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8'
        )
        staged.rename(output)
    return output / 'games.json'


def default_output():
    local = Path(os.environ.get('LOCALAPPDATA') or Path.home() / '.local' / 'share')
    return local / 'LOLsito' / 'GRID' / datetime.now(UTC).strftime('%Y%m%d-%H%M%S-%f')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    matches = commands.add_parser('matches', help='Muestra los IDs locales de partidas, sin conectarse a GRID')
    matches.add_argument('--patch', help='Parche, por ejemplo 26.22. Por defecto, los dos parches públicos')
    matches.add_argument('--all', action='store_true', help='Incluye partidas sin observaciones de wards')
    list_command = commands.add_parser('list', help='Consulta archivos y disponibilidad de una serie')
    list_command.add_argument('series', help='ID real de la serie en GRID')
    download = commands.add_parser('download', help='Descarga los archivos Riot de las partidas indicadas')
    download.add_argument('selection', type=Path, help='JSON con seriesId, id de partida y number')
    download.add_argument('--out', type=Path, help='Carpeta nueva para los archivos y games.json')
    args = parser.parse_args()
    try:
        if args.command == 'matches':
            print_matches(args.patch, args.all)
        elif args.command == 'list':
            series = series_id(args.series)
            files = Grid(api_key()).files(series)
            if not files:
                print('La serie no ofrece archivos para esta clave.')
            for item in files:
                print(f'{item.get("id", "?")}  {item.get("status", "?")}  {item.get("fileName", "")}')
        else:
            games = selections(args.selection)
            output = (args.out or default_output()).resolve()
            path = download_games(Grid(api_key()), games, output)
            print(f'Manifiesto para wards-grid.py: {path}')
    except (OSError, ValueError, RuntimeError, zipfile.BadZipFile) as error:
        parser.exit(1, f'Error de descarga: {error}\n')


if __name__ == '__main__':
    main()
