import sys
from pathlib import Path
from PIL import Image

if len(sys.argv) != 4:
    raise SystemExit("uso: compose-reference.py DEMO DS OUTPUT")
demo_path, ds_path, output_path = map(Path, sys.argv[1:])
with Image.open(demo_path) as source:
    demo = source.convert("RGB")
with Image.open(ds_path) as source:
    ds = source.convert("RGB")
if demo.size != ds.size:
    raise SystemExit(f"tamaños distintos: demo={demo.size}, ds={ds.size}")
paired = Image.new("RGB", (demo.width * 2, demo.height), (255, 255, 255))
paired.paste(demo, (0, 0))
paired.paste(ds, (demo.width, 0))
output_path.parent.mkdir(parents=True, exist_ok=True)
paired.save(output_path)
print(f"{output_path} ({paired.width}x{paired.height}; demo izquierda, design system derecha)")
