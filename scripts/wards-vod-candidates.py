"""Busca candidatos de wards en capturas 1080p de la transmisión de Worlds 2026."""

import argparse
import json
from pathlib import Path


FRAME_SIZE = 1920, 1080
PLAYFIELD_TOP = 56
PLAYFIELD_BOTTOM = 835
IMAGE_SUFFIXES = {'.jpg', '.jpeg', '.png'}


def team_masks(pixels):
    r, g, b = pixels.transpose(2, 0, 1)
    return {
        'blue': (b - r > 34) & (g - r > 33) & (b > 95) & (g > 85),
        'red': (r - g > 64) & (r - b > 48) & (r > 100),
    }


def bar_centers(mask, numpy):
    # The team-colored bar must agree in at least two of three adjacent rows.
    above, middle, below = mask[:-2], mask[1:-1], mask[2:]
    votes = (above & middle) | (above & below) | (middle & below)
    for y, row in enumerate(votes, 1):
        transitions = numpy.diff(row.astype('int8'), prepend=0, append=0)
        starts = numpy.flatnonzero(transitions == 1)
        ends = numpy.flatnonzero(transitions == -1)
        for segments, min_width, max_width in ((4, 11, 18), (3, 15, 23)):
            for index in range(len(starts) - segments + 1):
                lefts = starts[index:index + segments]
                rights = ends[index:index + segments]
                widths = rights - lefts
                left, right = lefts[0], rights[-1]
                if not (54 <= right - left <= 66 and min_width <= widths.min() <= widths.max() <= max_width):
                    continue
                gaps = lefts[1:] - rights[:-1]
                if not 1 <= gaps.min() <= gaps.max() <= 4:
                    continue
                band = mask[y - 1:y + 2]
                if band[:, max(0, left - 3):left].sum() > 5 or band[:, right:right + 3].sum() > 5:
                    continue
                # The visible model is below the HUD bar, and can extend beyond this estimate.
                yield int((left + right) / 2), y + PLAYFIELD_TOP + 12


def group_centers(centers):
    groups = []
    for x, y in centers:
        for group in groups:
            first_x, first_y = group[0]
            if abs(first_x - x) < 5 and abs(first_y - y) < 5:
                group.append((x, y))
                break
        else:
            groups.append([(x, y)])
    for group in groups:
        if len(group) >= 2:
            yield {
                'pixelX': sum(x for x, _ in group) // len(group),
                'pixelY': sum(y for _, y in group) // len(group),
            }


def inspect_frame(path, image_class, numpy):
    with image_class.open(path) as frame:
        if frame.size != FRAME_SIZE:
            raise ValueError(f'{path.name}: se requiere un fotograma de 1920 × 1080 píxeles')
        playfield = frame.crop((0, PLAYFIELD_TOP, FRAME_SIZE[0], PLAYFIELD_BOTTOM)).convert('RGB')
        pixels = numpy.asarray(playfield, dtype='int16')
    candidates = [
        {**center, 'side': side}
        for side, mask in team_masks(pixels).items()
        for center in group_centers(bar_centers(mask, numpy))
    ]
    return {'frame': path.name, 'candidates': sorted(candidates, key=lambda row: (row['pixelY'], row['pixelX']))}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('inputs', nargs='+', type=Path, help='Fotogramas JPG/PNG o una carpeta de fotogramas')
    parser.add_argument('--out', type=Path, help='JSON nuevo para revisar los candidatos')
    args = parser.parse_args()

    try:
        import numpy
        from PIL import Image
    except ImportError:
        parser.exit(1, 'Instalá Pillow y NumPy en tu entorno de Python para analizar fotogramas.\n')

    try:
        paths = []
        for path in args.inputs:
            if path.is_dir():
                paths.extend(sorted(file for file in path.iterdir() if file.suffix.lower() in IMAGE_SUFFIXES))
            else:
                paths.append(path)
        if not paths:
            raise ValueError('No se encontraron imágenes JPG o PNG')
        frames = [inspect_frame(path, Image, numpy) for path in dict.fromkeys(paths)]
        data = {'schema': 'lolsito-ward-vod-candidates-v1', 'width': FRAME_SIZE[0],
                'height': FRAME_SIZE[1], 'frames': frames}
        if args.out:
            with args.out.open('x', encoding='utf-8') as stream:
                json.dump(data, stream, indent=2)
                stream.write('\n')
        else:
            print(json.dumps(data, indent=2))
    except (OSError, ValueError) as error:
        parser.exit(1, f'{error}\n')


if __name__ == '__main__':
    main()
