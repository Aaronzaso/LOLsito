"""Import competitive drafts from Leaguepedia into the dashboard's JSON file."""

import argparse
from collections import Counter
from datetime import UTC, datetime
from html import unescape
import json
from pathlib import Path
import re
import sys
from tempfile import NamedTemporaryFile
from time import sleep
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode, urlsplit
from urllib.request import Request, urlopen


SOURCE = "https://lol.fandom.com"
OUTPUT = Path(__file__).resolve().parents[1] / "site" / "data" / "picks.json"
SIDES = {"1": "blue", "2": "red"}
ROLES = ("top", "jng", "mid", "bot", "sup")
BATCH_SIZE = 500
TEAM_STATS = ("Kills", "Gold", "Towers", "Dragons", "Barons")


def cargo(**params):
    query = urlencode({"action": "cargoquery", "format": "json", **params})
    request = Request(
        f"{SOURCE}/api.php?{query}",
        headers={"User-Agent": "LOLsito/1.0 (League of Legends esports dashboard)"},
    )
    for attempt in range(5):
        try:
            with urlopen(request, timeout=35) as response:
                data = json.load(response)
            if "cargoquery" in data:
                return [
                    {field: unescape(value or "") for field, value in item["title"].items()}
                    for item in data["cargoquery"]
                ]
            error = data["error"]
            if error["code"] not in {"ratelimited", "maxlag"}:
                raise ValueError(error["info"])
            failure = error["info"]
        except HTTPError as error:
            if error.code not in {429, 500, 502, 503, 504}:
                raise
            failure = str(error)
        except (TimeoutError, URLError) as error:
            failure = str(error)
        if attempt < 4:
            sleep(5 * 2**attempt)
    raise RuntimeError(f"Leaguepedia no respondió: {failure}")


def pages(**params):
    for offset in range(0, 10_000, BATCH_SIZE):
        batch = cargo(**params, limit=BATCH_SIZE, offset=offset)
        yield from batch
        if len(batch) < BATCH_SIZE:
            return
        sleep(2)
    raise ValueError("Se superó el límite de 10 000 filas por consulta")


def patch_id(value):
    if not re.fullmatch(r"\d{2}\.\d{1,2}", value):
        raise argparse.ArgumentTypeError("usa el formato de Riot, por ejemplo 26.22")
    return value


def wiki_url(page):
    return f"{SOURCE}/wiki/{quote(page.replace(' ', '_'), safe='/')}"


def web_url(value):
    value = value.strip()
    try:
        url = urlsplit(value)
    except ValueError:
        return None
    return value if url.scheme == "https" and url.hostname else None


def duration_seconds(value):
    parts = value.split(":")
    if len(parts) not in {2, 3} or not all(part.isdecimal() for part in parts):
        return None
    return sum(int(part) * 60**index for index, part in enumerate(reversed(parts)))


def scoreboard_games(where):
    stats = ",".join(f"G.Team{team}{stat}=Side{team}{stat}" for team in SIDES for stat in TEAM_STATS)
    return pages(
        tables="ScoreboardGames=G,Tournaments=T",
        join_on="G.OverviewPage=T.OverviewPage",
        fields=(
            "G.GameId=Id,G.MatchId=SeriesId,G.Patch=Patch,G.Team1=Blue,G.Team2=Red,G.Winner=Winner,"
            "G.DateTime_UTC=Date,G.OverviewPage=Page,G.Team1Bans=BlueBans,"
            "G.Team2Bans=RedBans,G.Team1Picks=BluePicks,G.Team2Picks=RedPicks,"
            "G.Team1Players=BluePlayers,G.Team2Players=RedPlayers,"
            "G.VOD=Vod,G._pageName=Evidence,G.N_GameInMatch=Number,G.Gamelength=Duration,"
            f"T.Name=League,T.TournamentLevel=Tier,{stats}"
        ),
        where=where,
        order_by="G.DateTime_UTC DESC,G.GameId",
    )


def to_game(row):
    if row["Winner"] not in SIDES or not row["Blue"] or not row["Red"] or not row["Date"]:
        return None
    picks = []
    for side in SIDES.values():
        champions = row[f"{side.title()}Picks"].split(",")
        players = row[f"{side.title()}Players"].split(",")
        if len(champions) != len(ROLES) or len(players) != len(ROLES):
            return None
        # ScoreboardAbstract writes these fields in in-game role order for each side.
        for role, champion, player in zip(ROLES, champions, players):
            champion = champion.strip()
            player = player.strip()
            if champion in {"", "None", "Unknown"} or not player:
                return None
            display_name = re.sub(r"\s+\([^()]+\)$", "", player)
            picks.append({"champion": champion, "role": role, "side": side, "player": display_name})
    if len({pick["champion"] for pick in picks}) != 2 * len(ROLES):
        return None
    series_id = row["SeriesId"] or row["Id"].rsplit("_", 1)[0]
    round_name = series_id.rsplit("_", 2)
    game = {
        "id": row["Id"],
        "seriesId": series_id,
        "round": round_name[1] if len(round_name) == 3 else "",
        "patch": row["Patch"],
        "league": row["League"] or row["Page"],
        "tier": row["Tier"].lower() or "unknown",
        "date": datetime.fromisoformat(row["Date"]).replace(tzinfo=UTC).isoformat(),
        "blueTeam": row["Blue"],
        "redTeam": row["Red"],
        "winner": SIDES[row["Winner"]],
        "number": int(row["Number"] or 1),
        "durationSeconds": duration_seconds(row["Duration"]),
        "source": wiki_url(row["Evidence"] or row["Page"]),
        "vod": web_url(row["Vod"]),
        "picks": picks,
        "bans": [
            {"champion": name, "side": side}
            for side in ("blue", "red")
            for champion in row[f"{side.title()}Bans"].split(",")
            if (name := champion.strip()) and name not in {"None", "No Ban", "Unknown", "-"}
        ],
    }
    stats = {side: {} for side in SIDES.values()}
    for team, side in SIDES.items():
        for field in TEAM_STATS:
            value = row[f"Side{team}{field}"]
            if re.fullmatch(r"\d+(?:\.\d+)?", value):
                stats[side][field.lower()] = float(value) if "." in value else int(value)
    if all(stats.values()):
        game["stats"] = stats
    return game


def build_dataset(current, previous, worlds):
    where = f"(G.Patch='{current}' OR G.Patch='{previous}')"
    if worlds:
        where += (
            f" OR (G.Patch='{worlds}' "
            "AND G.OverviewPage LIKE '2026 Season World Championship/%')"
        )
    game_rows = list(scoreboard_games(where))
    if not game_rows:
        raise ValueError("Leaguepedia devolvió cero partidas. Se conserva la última muestra.")

    games = {}
    skipped = Counter()
    for row in game_rows:
        game = to_game(row)
        if game:
            games[game["id"]] = game
        else:
            skipped[row["Patch"]] += 1
    if not games:
        raise ValueError("No se encontraron marcadores completos. Se conserva la última muestra.")

    return {
        "updatedAt": datetime.now(UTC).isoformat(timespec="seconds"),
        "currentPatch": current,
        "previousPatch": previous,
        "sources": [
            {
                "name": "Leaguepedia",
                "url": wiki_url("Module:CargoDeclare/ScoreboardGames"),
                "license": "CC BY-SA 3.0",
                "licenseUrl": "https://creativecommons.org/licenses/by-sa/3.0/",
            }
        ],
        "excludedByPatch": dict(skipped),
        "games": list(games.values()),
    }


def save(dataset, target):
    target.parent.mkdir(parents=True, exist_ok=True)
    pending = None
    try:
        with NamedTemporaryFile(
            mode="w", encoding="utf-8", newline="\n", dir=target.parent, delete=False
        ) as output:
            pending = Path(output.name)
            json.dump(dataset, output, ensure_ascii=False, indent=2)
            output.write("\n")
        pending.replace(target)
    finally:
        if pending is not None:
            pending.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--current", default="26.22", type=patch_id)
    parser.add_argument("--previous", default="26.21", type=patch_id)
    parser.add_argument("--worlds", default="26.20", type=patch_id)
    parser.add_argument("--no-worlds", action="store_true", help="Excluye Worlds 2026.")
    parser.add_argument("--output", default=OUTPUT, type=Path)
    args = parser.parse_args()
    try:
        dataset = build_dataset(args.current, args.previous, None if args.no_worlds else args.worlds)
        save(dataset, args.output)
    except (ValueError, RuntimeError, OSError) as error:
        sys.exit(str(error))
    counts = Counter((game["patch"], game["tier"]) for game in dataset["games"])
    for (patch, tier), count in sorted(counts.items(), reverse=True):
        print(f"{patch} ({tier}): {count}")
    print(f"Marcadores incompletos excluidos: {dataset['excludedByPatch']}")


if __name__ == "__main__":
    main()
