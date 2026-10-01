"""Build glTF normal and ORM maps from the source Unity texture set (requires Pillow)."""
import json
import sys
from pathlib import Path
from PIL import Image, ImageOps

color_path = Path(sys.argv[1])
metallic = float(sys.argv[2])
roughness_fallback = float(sys.argv[3])
output_dir = Path(sys.argv[4])
output_dir.mkdir(parents=True, exist_ok=True)
base = color_path.name.replace('_Color.png', '')
size = (512, 512)

def source(suffix):
    return color_path.with_name(f'{base}_{suffix}.png')

def channel(file, fallback):
    if file.exists():
        return Image.open(file).convert('L').resize(size, Image.Resampling.LANCZOS)
    return Image.new('L', size, fallback)

roughness = channel(source('Roughness'), round(roughness_fallback * 255))
ao = channel(source('AmbientOcclusion'), 255)
metal = Image.new('L', size, round(metallic * 255))
orm_path = output_dir / f'{base}_orm.png'
Image.merge('RGB', (ao, roughness, metal)).save(orm_path, optimize=True)
normal_path = source('NormalDX')
normal_output = None
if normal_path.exists():
    normal = Image.open(normal_path).convert('RGB').resize(size, Image.Resampling.LANCZOS)
    r, g, b = normal.split()
    normal_output = output_dir / f'{base}_normal.png'
    Image.merge('RGB', (r, ImageOps.invert(g), b)).save(normal_output, optimize=True)
print(json.dumps({'orm': str(orm_path), 'normal': str(normal_output) if normal_output else None}))
