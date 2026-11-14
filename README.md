# LOLsito

[Abrir el panel interactivo](https://aaronzaso.github.io/LOLsito/)

Explora dónde colocan wards en partidas competitivas de League of Legends y compara los picks entre parches.

## Uso del panel

- Elige un parche y una partida para ver sus wards en el mapa. Mueve el deslizador o pulsa **Reproducir** para recorrer la partida. Selecciona un punto de la línea de tiempo para resaltar su ubicación. Puedes ver la partida entera, revisar tramos de cinco minutos o abrir **Historial de wards** para consultar la lista cronológica. Cada observación de una transmisión enlaza al momento correspondiente del video.
- Cambia entre **Puntos** y **Calor** y filtra por lado y tipo de ward. El filtro de rol requiere que la observación identifique quién colocó el ward. Las marcas permanecen visibles como historial acumulado hasta el instante elegido.
- Compara los parches, filtra por liga y rol y abre **Tabla de picks** para consultar todos los campeones. La frecuencia divide las partidas en las que aparece un campeón por las partidas con picks de la selección. `Δ pp` es la diferencia en puntos porcentuales.

## Cobertura

La muestra de picks incluye **132 partidas del 26.22** (18 de ascenso a la LCP y 114 de otras competiciones) y **25 del 26.21** (competiciones secundarias). También incluye 94 de Worlds 2026, disputadas en **26.20**. El panel indica cuántas partidas quedan al aplicar los filtros. [Parche 26.22](https://www.leagueoflegends.com/en-us/news/game-updates/league-of-legends-patch-26-22-notes/) · [Parche 26.21](https://www.leagueoflegends.com/en-us/news/game-updates/league-of-legends-patch-26-21-notes/) · [Parche de Worlds](https://www.leagueoflegends.com/en-us/news/game-updates/league-of-legends-patch-26-20-notes/)

El mapa incluye 140 observaciones de 12 partidas. En **26.22** hay 53 observaciones de cinco partidas de LCP Promotion. En **26.21** hay 87 de siete partidas de CELOL y Breeze of Glory. Las posiciones se estimaron sobre el minimapa de las transmisiones y cada marca indica cuándo se vio el ward. La cobertura depende de la cámara. [Partidas, observaciones y enlaces de video](site/data/wards.json)

Los picks provienen de los marcadores de Leaguepedia. El importador adapta sus campos, normaliza las posiciones y agrupa los diez picks por partida. Los datos adaptados conservan la licencia CC BY-SA 3.0. El minimapa y los retratos de campeones provienen de Riot Data Dragon. [Leaguepedia](https://lol.fandom.com/wiki/Module:CargoDeclare/ScoreboardGames) · [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) · [Riot Data Dragon](https://developer.riotgames.com/docs/lol#data-dragon)

## Ejecutar en local

Se requiere Python 3.11 o superior. Desde la raíz del repositorio:

```sh
python -m http.server 8765 --bind 127.0.0.1 --directory site
```

Abre [el panel local](http://127.0.0.1:8765/).

## Actualizar los datos

Ejecuta el importador indicando el parche actual y el anterior. Añade `--no-worlds` para omitir la muestra de Worlds 2026.

```sh
python scripts/picks_import.py --current 26.22 --previous 26.21
python scripts/validate-data.py
```

El registro publicado de wards está en [wards.json](site/data/wards.json). Puedes abrir **Importar ubicaciones de wards** y cargar otro conjunto CSV o JSON en tu sesión del navegador. La importación se procesa localmente. Usa las listas `games` y `wards` para JSON o estas columnas para CSV:

```csv
gameId,patch,league,blueTeam,redTeam,seconds,x,y,side
```

`seconds` usa segundos enteros del reloj. `x` e `y` van de 0 a 1 desde el borde izquierdo y el superior del mapa. `side` admite `blue`, `red` o `unknown`. Puedes agregar `date`, `durationSeconds`, `role`, `player`, `type`, `location`, `sourceUrl`, `approximate` y `observed`. Las filas de una misma partida comparten `gameId`.

### Exportaciones de Riot Events

Con acceso a los archivos **Riot Events** (JSONL) y **Riot End State Summary** (JSON), crea un manifiesto `games.json` con una lista como esta. Las rutas son relativas al manifiesto. El campo `patch` se puede omitir si el resumen incluye `gameVersion`.

```json
[
  {
    "id": "partida-1",
    "league": "Nombre del torneo",
    "date": "2026-11-13",
    "blueTeam": "Equipo azul",
    "redTeam": "Equipo rojo",
    "sourceUrl": "https://example.com/partida-1",
    "patch": "26.22",
    "number": 1,
    "events": "events_SERIES_GAME_riot.jsonl",
    "summary": "end_state_summary_riot_SERIES_GAME.json"
  }
]
```

```sh
python scripts/wards-grid.py games.json wards-import.json
```

Carga el archivo resultante desde el panel. El conversor indica **Registro completo** cuando tiene duración y todos los eventos de colocación coinciden con el total de wards de cada jugador en el resumen final. Si faltan coordenadas, hay discrepancias o el resumen no incluye los totales, muestra **Eventos sin verificar cobertura**. El acceso a las descargas depende de los permisos de la cuenta. [Documentación de GRID](https://docs.grid.gg/public/documentation/api-documentation/in-game-data/grid-file-download-api)

GitHub Pages publica la carpeta `site` al actualizar la rama `main`.

LOLsito usa recursos de Riot Games conforme a su política Legal Jibber Jabber. Riot Games no patrocina ni respalda el proyecto. [Política de Riot Games](https://www.riotgames.com/en/legal)
