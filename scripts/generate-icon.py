#!/usr/bin/env python3
"""Rasterize the source icon's simple geometry without runtime build dependencies."""
from pathlib import Path
import math
import struct
import zlib

SIZE = 512
SCALE = 2
mark = [(96, 320), (153, 320), (190, 281), (190, 193), (225, 155), (342, 155), (381, 193), (381, 260), (314, 260), (314, 226), (272, 226), (272, 304), (233, 343), (233, 391), (190, 391), (190, 350), (153, 350), (120, 320)]

def inside(x, y, vertices):
    contained = False
    previous = vertices[-1]
    for current in vertices:
        x1, y1 = previous
        x2, y2 = current
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            contained = not contained
        previous = current
    return contained

def pixel(x, y):
    # Rounded square, with a subtle graphite gradient.
    dx = max(132 - x, 0, x - 380)
    dy = max(132 - y, 0, y - 380)
    if x < 16 or x > 496 or y < 16 or y > 496 or dx * dx + dy * dy > 116 * 116:
        return (0, 0, 0, 0)
    mix = min(1, max(0, (x + y) / 1024))
    color = tuple(round(a + (b - a) * mix) for a, b in zip((56, 62, 69), (32, 37, 42)))
    if inside(x, y, mark):
        mix = min(1, max(0, (y - 155) / 236))
        color = tuple(round(a + (b - a) * mix) for a, b in zip((176, 229, 195), (112, 188, 145)))
    if 286 <= x <= 301 and 196 <= y <= 211:
        color = (35, 42, 45)
    for x1, y1, x2, y2 in [(319, 271, 379, 271), (364, 359, 410, 359)]:
        nearest = min(max(x, x1), x2)
        if (x - nearest) ** 2 + (y - y1) ** 2 < 6.5 ** 2:
            color = (148, 203, 170)
    return (*color, 255)

rows = bytearray()
for y in range(SIZE):
    rows.append(0)
    for x in range(SIZE):
        samples = [pixel(x + (sx + .5) / SCALE, y + (sy + .5) / SCALE) for sy in range(SCALE) for sx in range(SCALE)]
        rows.extend(round(sum(sample[channel] for sample in samples) / len(samples)) for channel in range(4))

def chunk(kind, payload):
    return struct.pack('!I', len(payload)) + kind + payload + struct.pack('!I', zlib.crc32(kind + payload))

output = Path(__file__).resolve().parent.parent / 'resources' / 'icon.png'
output.write_bytes(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('!IIBBBBB', SIZE, SIZE, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(rows, 9)) + chunk(b'IEND', b''))
print(output)
