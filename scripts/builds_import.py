"""Importa inventarios finales y adquisiciones de Worlds y LCP desde PEM.LOL."""

import argparse
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import sys
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "site" / "data"
ORIGIN = "https://pem.lol"
INDEXES = {
    "/worlds/2026/matches": "PEM.LOL · Worlds 2026",
    "/lcp/2027/promotion/matches": "PEM.LOL · LCP 2027 Promotion",
}
FRAME = re.compile(r"self\.__next_f\.push\((\[[^\n]*?\])\)</script>")
ROLES = {"Top": "top", "Jungle": "jng", "Mid": "mid", "Bot": "bot", "Support": "sup"}
SIDES = {1: "blue", 2: "red"}
DECODER = json.JSONDecoder()


class MatchLinks(HTMLParser):
    def __init__(self):
        super().__init__()
        self.paths = set()

    def handle_starttag(self, tag, attrs):
        if tag != "a":
            return
        href = dict(attrs).get("href", "")
        if any(re.fullmatch(re.escape(index) + "/[a-z0-9-]+", href) for index in INDEXES):
            self.paths.add(href)


def get_html(path):
    request = Request(ORIGIN + path, headers={"User-Agent": "LOLsito/1.0 (competitive match analysis)"})
    with urlopen(request, timeout=20) as result:
        return result.read().decode("utf-8")


def match_payload(html):
    slices = []
    for match in FRAME.finditer(html):
        row = json.loads(match[1])
        if len(row) > 1 and isinstance(row[1], str):
            slices.append(row[1])
    payload = "".join(slices)
    item_table = re.search(r'"maps":\{"version":"[^"]+","items":\{', payload)
    if not item_table:
        raise ValueError("PEM no incluyó su catálogo de objetos")
    lookup = DECODER.raw_decode(payload[item_table.end() - 1 :])[0]
    game_array = re.search(r'"games":\[(?=\{"game_id":|\])', payload)
    if not game_array:
        raise ValueError("PEM no incluyó un marcador de partidas")
    games = DECODER.raw_decode(payload[game_array.end() - 1 :])[0]
    return lookup, games


def norm(value):
    return str(value).casefold().strip()


def item_id(lookup, name):
    if not name:
        return None
    value = lookup.get(norm(name))
    if not value:
        raise ValueError(f"objeto sin ID: {name}")
    return int(value)


def acquired(events):
    return [
        {"seconds": seconds, "itemId": item}
        for seconds, item in sorted(events, key=lambda row: row[0])
        if type(seconds) is int and seconds >= 0 and type(item) is int and item > 0
    ]


def to_game(record, lookup, reference, path):
    if record["patch"] != reference["patch"] or record["n"] != reference["number"]:
        raise ValueError("el parche o número no coincide")
    teams = {SIDES[team["side"]]: team for team in record["teams"]}
    for side in SIDES.values():
        if norm(reference[f"{side}Team"]) not in {
            norm(teams[side]["team"]["name"]), norm(teams[side]["team"]["page"])
        }:
            raise ValueError(f"equipo de lado {side} no coincide")
    positions = {(pick["side"], pick["role"]): pick for pick in reference["picks"]}
    history = {
        (SIDES[player["side"]], norm(player["name"]), player["role"]): player
        for player in (record.get("timeline") or {}).get("players", [])
        if player.get("side") in SIDES and player.get("role") in ROLES
    }
    players = {}
    for side, team in teams.items():
        for published in team["players"]:
            position = (side, ROLES[published["role"]])
            if position in players:
                raise ValueError("rol repetido en el marcador de PEM")
            pick = positions[position]
            if norm(published["champion"]) != norm(pick["champion"]) or norm(published["name"]) != norm(pick["player"]):
                raise ValueError(f"el campeón o jugador de {position} no coincide")
            player = {
                "side": side, "role": position[1], "champion": pick["champion"], "player": pick["player"],
                "items": list(filter(None, (item_id(lookup, name) for name in published["items"]))),
            }
            if trinket := item_id(lookup, published.get("trinket")):
                player["trinket"] = trinket
            role_reward = published.get("role_bound_item")
            role_item = lookup.get(norm(role_reward)) if role_reward else None
            if role_item:
                player["roleItem"] = int(role_item)
            timeline = history.get((side, norm(published["name"]), published["role"]), {})
            if norm(timeline.get("champion")) == norm(published["champion"]):
                if order := acquired(timeline.get("items", [])):
                    player["order"] = order
            players[position] = player
    if len(players) != 10:
        raise ValueError("PEM no incluye los diez jugadores")
    return {
        "id": reference["id"], "sourceUrl": f"{ORIGIN}{path}?game={record['n']}",
        "players": [players[(pick["side"], pick["role"])] for pick in reference["picks"]],
    }


def import_builds(cache, seed):
    refs = {game["id"]: game for game in json.loads((DATA / "picks.json").read_text(encoding="utf-8"))["games"]
            if game["league"].startswith("Worlds 2026") or game["league"] == "LCP 2027 Promotion"}
    links = MatchLinks()
    for index in INDEXES:
        try:
            links.feed(get_html(index))
        except (OSError, ValueError) as error:
            print(f"{index}: {error}", file=sys.stderr)

    def download(path):
        filename = cache / (path.rsplit("/", 1)[-1] + ".html") if cache else None
        if filename and filename.exists():
            return path, filename.read_text(encoding="utf-8")
        html = get_html(path)
        if filename:
            filename.write_text(html, encoding="utf-8")
        return path, html

    builds = {game["id"]: game for game in seed if game["id"] in refs}
    verified = set()
    with ThreadPoolExecutor(max_workers=3) as pool:
        tasks = {path: pool.submit(download, path) for path in sorted(links.paths)}
        for path, future in tasks.items():
            try:
                lookup, games = match_payload(future.result()[1])
                for record in games:
                    if record["game_id"] not in refs:
                        continue
                    try:
                        game = to_game(record, lookup, refs[record["game_id"]], path)
                    except (ValueError, KeyError, TypeError) as error:
                        print(f"{record['game_id']}: {error}", file=sys.stderr)
                    else:
                        builds[game["id"]] = game
                        verified.add(game["id"])
            except (OSError, ValueError) as error:
                print(f"{path}: {error}", file=sys.stderr)
    return {
        "updatedAt": datetime.now(UTC).isoformat(timespec="seconds"),
        "sources": [{"name": name, "url": ORIGIN + index} for index, name in INDEXES.items()],
        "games": [builds[game_id] for game_id in refs if game_id in builds],
    }, verified


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cache", type=Path, help="Carpeta opcional para caché de páginas públicas")
    parser.add_argument("--output", type=Path, default=DATA / "builds.json")
    args = parser.parse_args()
    if args.cache:
        args.cache.mkdir(parents=True, exist_ok=True)
    seed = []
    if args.output.exists():
        seed = json.loads(args.output.read_text(encoding="utf-8"))["games"]
    data, verified = import_builds(args.cache, seed)
    if not verified:
        parser.exit(1, "PEM no devolvió partidas verificables. La versión anterior se conserva.\n")
    target = args.output.with_name(args.output.name + ".tmp")
    target.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    target.replace(args.output)
    retained = len(data["games"]) - len(verified)
    print(f"{len(verified)} partidas verificadas en {args.output}. {retained} conservadas de una importación anterior.")


if __name__ == "__main__":
    main()
