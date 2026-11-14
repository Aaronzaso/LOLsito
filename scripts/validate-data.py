"""Comprueba la consistencia de los datos que se muestran en el panel."""

import json
from collections import Counter
from pathlib import Path

DATA = Path(__file__).resolve().parents[1] / "site" / "data"
ROLES = {"top", "jng", "mid", "bot", "sup"}


def read(filename):
    with (DATA / filename).open(encoding="utf-8-sig") as file:
        return json.load(file)


def main():
    picks = read("picks.json")
    ward_data = read("wards.json")
    drafts = {game["id"]: game for game in picks["games"]}
    games = {game["id"]: game for game in ward_data["games"]}
    assert len(drafts) == len(picks["games"]), "IDs repetidos en picks"
    assert len(games) == len(ward_data["games"]), "IDs repetidos en el registro de wards"
    ward_counts = Counter(ward["gameId"] for ward in ward_data["wards"])
    for game in games.values():
        assert game.get("coverage") in {None, "complete", "events", "vod", "unspecified"}, game
        if game.get("coverage") == "complete":
            assert game["expectedWards"] == ward_counts[game["id"]] and game["durationSeconds"] > 0, game
    for game in drafts.values():
        roles = Counter((pick["side"], pick["role"]) for pick in game["picks"])
        assert roles == {(side, role): 1 for side in ("blue", "red") for role in ROLES}, game["id"]
        assert all(pick["champion"] for pick in game["picks"]), game["id"]

    for ward in ward_data["wards"]:
        game = games[ward["gameId"]]
        assert 0 <= ward["x"] <= 1 and 0 <= ward["y"] <= 1, ward
        assert isinstance(ward["seconds"], int) and ward["seconds"] >= 0, ward
        assert ward["side"] in {"blue", "red", "unknown"}, ward
        assert not ward.get("role") or ward["role"] in ROLES, ward
        duration = game.get("durationSeconds") or drafts.get(game["id"], {}).get("durationSeconds")
        assert not duration or ward["seconds"] <= duration, ward
        if ward.get("observed"):
            assert ward.get("approximate") and ward["sourceUrl"].startswith("https://"), ward
        if game.get("coverage") == "complete":
            assert not ward.get("observed") and not ward.get("approximate") and ward["side"] != "unknown", ward
        if game["id"] in drafts:
            assert game["patch"] == drafts[game["id"]]["patch"], game
    print("Partidas con picks:", dict(Counter(game["patch"] for game in drafts.values())))
    print("Wards observados:", dict(Counter(games[ward["gameId"]]["patch"] for ward in ward_data["wards"])))
    print("Partidas con datos de wards:", dict(Counter(game["patch"] for game in games.values())))


if __name__ == "__main__":
    main()
