import json
import sys
from pathlib import Path
from PIL import Image, ImageChops

if len(sys.argv) != 6:
    raise SystemExit("uso: visual-diff.py DEMO DS DIFF RESULTADO LIMITE_PORCIENTO")
demo_path, ds_path, diff_path, result_path = map(Path, sys.argv[1:5])
threshold = float(sys.argv[5])
with Image.open(demo_path) as image:
    demo = image.convert("RGBA")
with Image.open(ds_path) as image:
    ds = image.convert("RGBA")
if demo.size != ds.size:
    raise SystemExit(f"dimensiones distintas: demo={demo.size}, ds={ds.size}")
delta = ImageChops.difference(demo, ds)
diff_rgb = delta.convert("RGB")
pixels = diff_rgb.tobytes()
diff_pixels = sum(1 for index in range(0, len(pixels), 3) if pixels[index] or pixels[index + 1] or pixels[index + 2])
total_pixels = demo.width * demo.height
percent = diff_pixels * 100.0 / total_pixels
# Resaltar diferencias; píxeles idénticos quedan transparentes.
mask = diff_rgb.convert("L").point(lambda value: 255 if value else 0)
visual = Image.new("RGBA", demo.size, (255, 0, 0, 0))
visual.putalpha(mask)
visual.save(diff_path)
result = {
    "etapa": "E1",
    "estado": "aprobado" if percent <= threshold else "diferencias_superan_umbral",
    "umbral_porcentaje": threshold,
    "pantallas": [{
        "nombre": "portada",
        "demo": str(demo_path),
        "ds": str(ds_path),
        "diff": str(diff_path),
        "dimensiones": {"ancho": demo.width, "alto": demo.height},
        "pixeles_distintos": diff_pixels,
        "pixeles_totales": total_pixels,
        "diferencia_porcentaje": round(percent, 6),
    }],
}
result_path.parent.mkdir(parents=True, exist_ok=True)
result_path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(json.dumps(result, ensure_ascii=False, indent=2))
raise SystemExit(0 if percent <= threshold else 1)
