"""Carga el orden de picks y bans documentado en Leaguepedia."""

from collections import Counter
from datetime import UTC, datetime
import json
from pathlib import Path
from tempfile import NamedTemporaryFile

from picks_import import OUTPUT, pages, wiki_url


# The table's first drafting team may actually play on the red map side.
# Turn sequence for the standard two-phase, ten-ban tournament draft.
SLOTS = (
    "1B1 2B1 1B2 2B2 1B3 2B3 "
    "1P1 2P1 2P2 1P2 1P3 2P3 "
    "2B4 1B4 2B5 1B5 "
    "2P4 1P4 1P5 2P5"
).split()
SLOT_FIELDS = {
    slot: f"Team{slot[0]}{'Pick' if slot[1] == 'P' else 'Ban'}{slot[2]}"
    for slot in SLOTS
}


def draft_rows(round_pages):
    fields = "GameId=Id,Team1,Team2,_pageName=Page," + ",".join(SLOT_FIELDS.values())
    for overview in round_pages:
        escaped = overview.replace("'", "''")
        yield from pages(
            tables="PicksAndBansS7", fields=fields, where=f"OverviewPage = '{escaped}'",
            order_by="GameId,Page",
        )


def to_draft(row, game):
    sides = {game["blueTeam"]: "blue", game["redTeam"]: "red"}
    teams = (row["Team1"], row["Team2"])
    if set(teams) != sides.keys():
        return None
    actions = []
    for slot in SLOTS:
        name = row[SLOT_FIELDS[slot]].strip()
        if not name or name in {"None", "No Ban", "Unknown", "-"}:
            return None
        actions.append({
            "side": sides[teams[int(slot[0]) - 1]],
            "kind": "pick" if slot[1] == "P" else "ban",
            "champion": name,
        })
    for kind in ("pick", "ban"):
        published = game[f"{kind}s"]
        actual = Counter((item["side"], item["champion"]) for item in actions if item["kind"] == kind)
        if actual != Counter((item["side"], item["champion"]) for item in published):
            return None
    return {"id": game["id"], "sourceUrl": wiki_url(row["Page"]), "actions": actions}


def main():
    picks = json.loads(OUTPUT.read_text(encoding="utf-8"))
    games = {game["id"]: game for game in picks["games"]}
    overviews = sorted({game["id"].rsplit("_", 3)[0] for game in games.values()})
    verified = {}
    conflicts = set()
    for row in draft_rows(overviews):
        game = games.get(row["Id"])
        if not game or not (draft := to_draft(row, game)):
            continue
        prior = verified.setdefault(game["id"], draft)
        if prior["actions"] != draft["actions"]:
            conflicts.add(game["id"])
    result = [verified[game_id] for game_id in games if game_id in verified and game_id not in conflicts]
    if not result:
        raise SystemExit("No se encontraron drafts verificables.")
    data = {
        "updatedAt": datetime.now(UTC).isoformat(timespec="seconds"),
        "source": {"name": "Leaguepedia · orden de picks y bans", "url": wiki_url("Module:CargoDeclare/PicksAndBansS7")},
        "games": result,
    }
    target = OUTPUT.with_name("drafts.json")
    with NamedTemporaryFile(mode="w", encoding="utf-8", dir=target.parent, delete=False) as stream:
        pending = Path(stream.name)
        json.dump(data, stream, ensure_ascii=False, separators=(",", ":"))
        stream.write("\n")
    pending.replace(target)
    print("Drafts verificados por parche:", dict(Counter(games[draft["id"]]["patch"] for draft in result)))


if __name__ == "__main__":
    main()
