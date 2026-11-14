# Prueba de detección de wards en Worlds 2026

## pyLoL

Probé el código upstream del commit `19afccfc` con el minimapa recortado de tres fotogramas reales. `DataPreprocessor.get_each_Vision_Area` arrojó `TypeError` al llamar al método sobre una instancia. Con la propia clase como primer argumento, ejecutó el código sin editarlo y devolvió seis valores de área por fotograma. Su salida no identifica wards ni sus posiciones. El enlace del README para descargar el modelo de detección de campeones devolvió HTTP 404 durante la prueba. [Repositorio pyLoL GPL-3.0](https://github.com/league-of-legends-replay-extractor/pyLoL/tree/19afccfc6590e074567798598833d3a737724ba4)

## Detector de candidatos de LOLsito

La utilidad analiza los segmentos de color de la barra que aparece encima de un ward visible en la escena. Devuelve píxeles de pantalla y lado probable. Las cámaras, la ocultación y los cambios de diseño de la transmisión pueden impedir la detección. Los resultados requieren revisar el modelo en el video, el reloj de partida y la ubicación en el minimapa antes de añadir una observación al panel.

En seis fotogramas independientes con wards de referencia, coincidieron 12 de los 13 puntos anotados manualmente, con máximo 6,7 píxeles de diferencia y el lado correcto. Los 12 candidatos emitidos coincidieron con esos puntos. En un fotograma de control adicional de la final obtuvo cero candidatos. Es una muestra pequeña de transmisiones 1080p con el mismo formato de Worlds 2026.

| VOD | Segundo del VOD | Coincidencias |
| --- | ---: | ---: |
| [T1 vs. BLG, partida 2](https://www.youtube.com/watch?v=r9-avVeme5o&t=820s) | 820 | 2 de 3 |
| [T1 vs. BLG, partida 2](https://www.youtube.com/watch?v=r9-avVeme5o&t=950s) | 950 | 3 de 3 |
| [Gen.G vs. IG, partida 2](https://www.youtube.com/watch?v=CdcL2IO5Bo0&t=1600s) | 1600 | 3 de 3 |
| [BLG vs. Gen.G, final, partida 1](https://www.youtube.com/watch?v=QZCHpYleJnc&t=1400s) | 1400 | 1 de 1 |
| [BLG vs. Gen.G, final, partida 1](https://www.youtube.com/watch?v=QZCHpYleJnc&t=2040s) | 2040 | 1 de 1 |
| [BLG vs. Gen.G, final, partida 1](https://www.youtube.com/watch?v=QZCHpYleJnc&t=2750s) | 2750 | 2 de 2 |

Para analizar capturas JPG o PNG de 1920 × 1080 en Windows, ejecutá desde el repositorio:

```powershell
py -m venv "$env:TEMP\lolsito-vod"
& "$env:TEMP\lolsito-vod\Scripts\python.exe" -m pip install numpy Pillow
& "$env:TEMP\lolsito-vod\Scripts\python.exe" scripts\wards-vod-candidates.py .\capturas --out .\candidatos.json
```

El JSON de candidatos sirve para revisión local. No se importa directamente como historial de wards.
