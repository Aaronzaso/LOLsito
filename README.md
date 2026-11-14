# LOLsito

[Versión web](https://aaronzaso.github.io/LOLsito/)

Explora dónde colocan wards en partidas competitivas de League of Legends y compara los picks entre parches.

## Uso del panel

- Cambia entre **Mapa de wards**, **Picks por campeón** y **Drafts y builds**. Los filtros se conservan al cambiar. **Worlds 2026** carga el torneo internacional en 26.20 y **Parche actual y anterior** vuelve a la comparación de 26.22 con 26.21.
- Elige un parche y una partida para ver sus wards en el mapa. Mueve el deslizador o pulsa **Reproducir** para recorrer la partida. Selecciona un punto de la línea de tiempo para resaltar su ubicación. Puedes ver la partida entera, revisar tramos de cinco minutos o abrir **Historial de wards** para consultar la lista cronológica. Cada observación de una transmisión enlaza al momento correspondiente del video.
- Cambia entre **Puntos** y **Calor** y filtra por lado y tipo de ward. El filtro de rol requiere que la observación identifique quién colocó el ward. Las marcas permanecen visibles como historial acumulado hasta el instante elegido.
- Compara los parches, filtra por liga y rol y abre **Tabla de picks** para consultar todos los campeones. La frecuencia divide las partidas en las que aparece un campeón por las partidas con picks de la selección. `Δ pp` es la diferencia en puntos porcentuales.
- La lista de ligas y torneos corresponde al parche principal. Si cambias de parche y el torneo elegido carece de partidas en ese parche, el filtro vuelve a **Todas**.
- En **Drafts y builds** puedes buscar por equipo y pasar entre partidas. Cada lado muestra sus cinco campeones por rol, los bans documentados, y los inventarios finales y adquisiciones por minuto cuando la fuente los registra. En partidas con wards, **Ver mapa de esta partida** abre su cronología.

## Cobertura

La muestra de picks incluye **132 partidas del 26.22** (18 de ascenso a la LCP y 114 de otras competiciones) y **25 del 26.21** (competiciones secundarias). También incluye 94 de Worlds 2026, disputadas en **26.20**. El panel indica cuántas partidas quedan al aplicar los filtros. [Parche 26.22](https://www.leagueoflegends.com/en-us/news/game-updates/league-of-legends-patch-26-22-notes/) · [Parche 26.21](https://www.leagueoflegends.com/en-us/news/game-updates/league-of-legends-patch-26-21-notes/) · [Parche de Worlds](https://www.leagueoflegends.com/en-us/news/game-updates/league-of-legends-patch-26-20-notes/)

El mapa incluye 158 observaciones de 14 partidas. En **26.22** hay 53 observaciones de cinco partidas de LCP Promotion. En **26.21** hay 87 de siete partidas de CELOL y Breeze of Glory. **Worlds 2026** aporta 18 observaciones de las primeras partidas de las dos semifinales. Las posiciones se estimaron sobre el minimapa de las transmisiones y cada marca indica cuándo se vio el ward. La cobertura depende de la cámara. [Partidas, observaciones y enlaces de video](site/data/wards.json)

Las builds cubren las 94 partidas de Worlds de la muestra documentada, hasta las semifinales, y 18 partidas de LCP 2027 Promotion en 26.22. Los inventarios y las adquisiciones vienen de PEM.LOL y se contrastan con el campeón y rol de los diez jugadores del marcador. **Adquisiciones registradas** muestra los eventos de incorporación de objetos que publica esa fuente. Cada ficha enlaza al detalle de origen. [Worlds en PEM.LOL](https://pem.lol/worlds/2026/matches) · [LCP Promotion en PEM.LOL](https://pem.lol/lcp/2027/promotion/matches)

Los picks provienen de los marcadores de Leaguepedia. El importador adapta sus campos, normaliza las posiciones y agrupa los diez picks por partida. Los datos adaptados conservan la licencia CC BY-SA 3.0. El minimapa y los retratos de campeones provienen de Riot Data Dragon. [Leaguepedia](https://lol.fandom.com/wiki/Module:CargoDeclare/ScoreboardGames) · [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) · [Riot Data Dragon](https://developer.riotgames.com/docs/lol#data-dragon)

## Abrir en Windows

Haz doble clic en [Abrir-LOLsito.cmd](Abrir-LOLsito.cmd) desde la carpeta del proyecto. Abre una ventana de Windows con el mapa, las pestañas, los datos y los retratos almacenados localmente. Los enlaces a las repeticiones abren el navegador predeterminado. El lanzador compila con el SDK de .NET 10 y la aplicación usa WebView2. [SDK de .NET](https://dotnet.microsoft.com/es-es/download/dotnet/10.0) · [WebView2 Runtime](https://developer.microsoft.com/es-es/microsoft-edge/webview2/)

Para importar archivos de GRID, ve a **Mapa de wards → Importar ubicaciones de wards → Importar carpeta de GRID**. Selecciona la carpeta que contiene los archivos o ZIP de GRID. La opción usa Python 3.11 o superior en Windows. Las partidas importadas quedan guardadas en `%LOCALAPPDATA%\LOLsito\wards-local.json` y se vuelven a cargar al abrir la app.

### Desarrollo web

Se requiere Python 3.11 o superior. Desde la raíz del repositorio:

```sh
python -m http.server 8765 --bind 127.0.0.1 --directory site
```

Abre [el panel local](http://127.0.0.1:8765/).

## Actualizar los datos

Ejecuta el importador indicando el parche actual y el anterior. Añade `--no-worlds` para omitir la muestra de Worlds 2026.

```sh
python scripts/picks_import.py --current 26.22 --previous 26.21
python scripts/builds_import.py
python scripts/validate-data.py
```

El registro publicado de wards está en [wards.json](site/data/wards.json). Puedes abrir **Importar ubicaciones de wards** y cargar otro conjunto CSV o JSON en tu sesión del navegador. La importación se procesa localmente. Usa las listas `games` y `wards` para JSON o estas columnas para CSV:

```csv
gameId,patch,league,blueTeam,redTeam,seconds,x,y,side
```

`seconds` usa segundos enteros del reloj. `x` e `y` van de 0 a 1 desde el borde izquierdo y el superior del mapa. `side` admite `blue`, `red` o `unknown`. Puedes agregar `date`, `durationSeconds`, `role`, `player`, `type`, `location`, `sourceUrl`, `approximate` y `observed`. Las filas de una misma partida comparten `gameId`.

### Solicitar los archivos de GRID

Consulta en GRID Developers si pueden habilitar **File Download API** para las series siguientes. Riot anunció Worlds 2026 como el primer evento de Open Access, con Central Data Feed y Series State/Loopfeed. La disponibilidad de descargas de Riot Events depende de la cuenta y la serie. Otra opción es pedir los mismos archivos al organizador para análisis local. [GRID Developers](https://discord.gg/h9yaPMRyq5) · [Anuncio de Riot](https://lolesports.com/en-US/news/build-with-official-league-of-legends-esports-data) · [File Download API](https://docs.grid.gg/public/documentation/api-documentation/in-game-data/grid-file-download-api)

| Parche | Torneo | Serie | Fecha de 2026 | Partidas |
| --- | --- | --- | --- | --- |
| 26.22 | LCP 2027 Promotion | DetonatioN FocusMe vs. Saigon Warriors | 13 nov. | 1–4 |
| 26.22 | LCP 2027 Promotion | Nothin'Here vs. Saigon Warriors | 12 nov. | 1 |
| 26.21 | CELOL Série A, Split 2 | EmBRAZA! vs. Clã NKZ VÓRAX | 1 nov. | 1–2 |
| 26.21 | CELOL Série A, Split 2 | Neon eSports vs. Clã NKZ VÓRAX | 31 oct. | 1–2 |
| 26.21 | Breeze of Glory | Macko vs. Zena | 3 nov. | 1–2 |
| 26.21 | Breeze of Glory | EKO vs. Team Aqua | 4 nov. | 1 |

Texto para pedir acceso en inglés:

> I am building LOLsito, a private, non-commercial Windows analyzer. Could you confirm which of these LoL series are covered and enable File Download API access for Riot Events (Riot LiveStats) and Riot End State Summary? I need ward placement coordinates, timestamps, player IDs and final wardsPlaced totals. Please provide the GRID series IDs or authorized per-game exports for local analysis.

Con acceso, localiza la serie en **Match History Viewer**, abre cada partida y descarga **Events (Riot)** y **End State Summary (Riot)**. Los nombres habituales son `events_<seriesId>_<gameNumber>_riot.jsonl` y `end_state_summary_riot_<seriesId>_<gameNumber>.json`. También sirven los ZIP de serie que contienen esos archivos. [Referencia de File Download API](https://docs.grid.gg/public/documentation/api-reference/live-data-feed/grid-file-download-reference)

### Importar una carpeta de archivos o ZIP

Copia las exportaciones en `%LOCALAPPDATA%\LOLsito\GRID` o en otra carpeta. Selecciónala con **Importar carpeta de GRID**. El importador empareja los dos archivos según el ID de serie y el número de partida, incluso si están dentro de ZIP. Si identifica la partida en el catálogo de LOLsito, sustituye su muestra por los eventos importados. Si el informe indica que faltan datos para identificar una partida, añade un `grid-series.json` con el ID de serie, el número de partida y el ID de LOLsito, como se muestra en la sección siguiente. Los archivos y el historial importado permanecen en el equipo.

La misma operación desde PowerShell:

```powershell
py scripts\wards-grid.py --carpeta "$env:LOCALAPPDATA\LOLsito\GRID" --local
```

El flujo de emparejamiento por serie y partida toma como referencia el formato de [LoL Scouting Replay Kit](https://github.com/Boch-dev-98/lol-scouting-replay-kit#-data-format).

### Descargar con una clave autorizada

Primero localiza el ID de partida de LOLsito y consulta los archivos de la serie GRID. El `seriesId` numérico de GRID se obtiene en Match History Viewer o Central Data Feed.

```powershell
py scripts\wards-download.py matches
py scripts\wards-download.py matches --patch 26.20 --all
py scripts\wards-download.py list ID_NUMERICO_DE_GRID
```

Crea un `grid-series.json` fuera de `site` con una lista de objetos como el de abajo. Sustituye el valor de `seriesId` por el ID de GRID e incluye cada número de partida que necesites. El otro ID lo devuelve `matches`.

```json
[
  {
    "seriesId": "ID_NUMERICO_DE_GRID",
    "id": "LCP/2027 Season/Promotion_FFA Finals_1_1",
    "number": 1
  }
]
```

```powershell
py scripts\wards-download.py download .\grid-series.json
py scripts\wards-grid.py "RUTA_A_GAMES_JSON_QUE_IMPRIME_LA_DESCARGA" --local
```

El descargador pide la clave en una terminal con entrada oculta y guarda los archivos en `%LOCALAPPDATA%\LOLsito\GRID`. Después de convertirlos, pulsa **Recargar datos de GRID** en LOLsito. Conserva las descargas y la clave fuera del repositorio.

### Convertir archivos descargados manualmente

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

```powershell
py scripts\wards-grid.py "RUTA_A_GAMES_JSON" --local
```

Para reemplazar la muestra de una partida ya incluida, usa el `id` mostrado en `py scripts\wards-download.py matches`. El conversor indica **Registro completo** cuando tiene duración y todos los eventos de colocación coinciden con el total de wards de cada jugador en el resumen final. Si faltan coordenadas, hay discrepancias o el resumen no incluye los totales, la app muestra **Eventos sin verificar cobertura**. [Documentación de GRID](https://docs.grid.gg/public/documentation/api-documentation/in-game-data/grid-file-download-api)

GitHub Pages publica la carpeta `site` al actualizar la rama `main`.

LOLsito usa recursos de Riot Games conforme a su política Legal Jibber Jabber. Riot Games no patrocina ni respalda el proyecto. [Política de Riot Games](https://www.riotgames.com/en/legal)
