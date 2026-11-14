"""Encuentra los pares de archivos Riot descargados de GRID en una carpeta."""

from collections import defaultdict
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
import io
import json
from pathlib import Path, PurePosixPath
import re
from zipfile import BadZipFile, ZipFile


FILE_NAMES = {
    'events': re.compile(r'events_([1-9][0-9]*)_([1-9][0-9]*)_riot\.jsonl', re.IGNORECASE),
    'summary': re.compile(r'end_state_summary_riot_([1-9][0-9]*)_([1-9][0-9]*)\.json', re.IGNORECASE),
}
LEGACY_NAME = re.compile(r'series_([1-9][0-9]*)/games/([1-9][0-9]*)/(events\.jsonl|summary\.json)$', re.IGNORECASE)
MAX_SUMMARY = 16 * 1024 * 1024
MAX_EVENTS = 512 * 1024 * 1024


@dataclass(frozen=True)
class GameFile:
    path: Path
    member: str | None = None

    @property
    def name(self):
        return self.member or self.path.name

    @contextmanager
    def open(self, max_size):
        if self.member is None:
            if self.path.stat().st_size > max_size:
                raise ValueError(f'{self.name} supera el tamaño de archivo permitido')
            with self.path.open(encoding='utf-8-sig') as stream:
                yield stream
        else:
            with ZipFile(self.path) as archive:
                entry = archive.getinfo(self.member)
                if entry.file_size > max_size:
                    raise ValueError(f'{self.name} supera el tamaño de archivo permitido')
                with archive.open(entry) as stream:
                    yield io.TextIOWrapper(stream, encoding='utf-8-sig')


def identify(name):
    basename = PurePosixPath(name).name
    for kind, pattern in FILE_NAMES.items():
        if match := pattern.fullmatch(basename):
            series, game = match.groups()
            return (series, int(game)), kind
    if match := LEGACY_NAME.search(name):
        series, game, filename = match.groups()
        return (series, int(game)), 'events' if filename.lower() == 'events.jsonl' else 'summary'
    return None


def discover(folder):
    if not folder.is_dir():
        raise ValueError(f'No se encontró la carpeta GRID: {folder}')
    matches = defaultdict(lambda: defaultdict(list))
    warnings = []
    for path in sorted(folder.rglob('*')):
        if not path.is_file():
            continue
        if path.suffix.lower() == '.zip':
            try:
                with ZipFile(path) as archive:
                    for entry in archive.infolist():
                        if entry.is_dir():
                            continue
                        result = identify(entry.filename.replace('\\', '/'))
                        if result:
                            key, kind = result
                            matches[key][kind].append(GameFile(path, entry.filename))
            except BadZipFile:
                if 'riot' in path.name.lower():
                    warnings.append(f'{path.name}: ZIP ilegible')
        elif result := identify(path.relative_to(folder).as_posix()):
            key, kind = result
            matches[key][kind].append(GameFile(path))

    found = {}
    for (series, game), files in sorted(matches.items()):
        pair = {}
        for kind in FILE_NAMES:
            candidates = files[kind]
            loose = [item for item in candidates if item.member is None]
            use = loose or candidates
            if len(use) != 1:
                label = 'Riot Events' if kind == 'events' else 'Riot End State Summary'
                reason = 'falta' if not use else 'hay varias copias de'
                warnings.append(f'Serie {series}, partida {game}: {reason} {label}')
                break
            pair[kind] = use[0]
        else:
            found[(series, game)] = pair
    return found, warnings


def read_summary(source):
    with source.open(MAX_SUMMARY) as stream:
        summary = json.load(stream)
    if not isinstance(summary, dict) or not isinstance(summary.get('info', summary), dict):
        raise ValueError('El archivo Riot End State Summary no contiene un objeto de partida')
    return summary.get('info', summary)


def game_date(info):
    for field in ('gameStartTimestamp', 'gameCreation'):
        value = info.get(field)
        if type(value) is int and 946684800000 <= value <= 4102444800000:
            return datetime.fromtimestamp(value / 1000, UTC).date().isoformat()
    return None


def explicit_teams(info):
    teams = {}
    for team in info.get('teams', []):
        side = str(team.get('teamId'))
        name = team.get('teamName') or team.get('name')
        if side in {'100', '200'} and isinstance(name, str) and name.strip():
            teams[side] = name.strip()
    return teams
