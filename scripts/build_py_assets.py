"""Build the Python files the in-browser runner loads from this site.

Writes public/py/:
  brightwind-<ver>-py3-none-any.whl   brightwind without its large demo files (Cloudflare caps static files at 25 MiB)
  colormap-<ver>-py3-none-any.whl      pure-Python dependency that Pyodide does not ship
  demo/<file>.gz                       each large demo dataset, gzip-compressed, fetched only when a pipeline uses it
  windkit-<ver>-py3-none-any.whl       windkit, loaded only when a pipeline uses windkit tools
  rioxarray-0.20.0, affine-3.0.1       windkit dependencies Pyodide does not ship (or ships too old: affine 2.4)
  plotly-<ver>-py3-none-any.whl        plotly without its bundled JavaScript and datasets, for windkit's interactive plots
  plotly.min.js                        the plotly JavaScript, which the page loads to draw those figures
The windkit sample files in public/py/samples/ come from scripts/windkit/make_samples.py.

Usage: python scripts/build_py_assets.py [brightwind version, default 2.8.0]
Needs pip and network access to PyPI.
"""
import base64
import gzip
import hashlib
import io
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

VERSION = sys.argv[1] if len(sys.argv) > 1 else '2.8.0'
COLORMAP = '1.3.0'
WINDKIT = '2.2.0'
EXTRA = ['rioxarray==0.20.0', 'affine==3.0.1']   # rioxarray 0.20 is the last release that works with Pyodide 0.29's rasterio 1.4
PLOTLY = '6.3.1'
LARGE = 1_000_000          # demo files above this size are served separately
OUT = Path(__file__).resolve().parent.parent / 'public' / 'py'


def record_hash(data):
    return 'sha256=' + base64.urlsafe_b64encode(hashlib.sha256(data).digest()).rstrip(b'=').decode()


def main():
    tmp = Path(tempfile.mkdtemp())
    try:
        for req in (f'brightwind=={VERSION}', f'colormap=={COLORMAP}'):
            subprocess.run([sys.executable, '-m', 'pip', 'download', '-q', '--no-deps', '--only-binary', ':all:', '-d', str(tmp), req], check=True)
        for req in (f'windkit=={WINDKIT}', *EXTRA, f'plotly=={PLOTLY}'):
            subprocess.run([sys.executable, '-m', 'pip', 'download', '-q', '--no-deps', '--only-binary', ':all:', '-d', str(tmp), req], check=True)
        samples = OUT / 'samples'
        keep = Path(tempfile.mkdtemp())
        if samples.exists():
            shutil.copytree(samples, keep / 'samples')
        if OUT.exists():
            shutil.rmtree(OUT)
        (OUT / 'demo').mkdir(parents=True)
        if (keep / 'samples').exists():
            shutil.copytree(keep / 'samples', samples)
        shutil.rmtree(keep, ignore_errors=True)

        src = next(tmp.glob('brightwind-*.whl'))
        slim = io.BytesIO()
        moved = []
        with zipfile.ZipFile(src) as zin, zipfile.ZipFile(slim, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as zout:
            record_name = next(n for n in zin.namelist() if n.endswith('.dist-info/RECORD'))
            kept = []
            for info in zin.infolist():
                if info.filename == record_name:
                    continue
                data = zin.read(info.filename)
                if '/demo_datasets/' in info.filename and info.file_size > LARGE:
                    name = info.filename.rsplit('/', 1)[1]
                    (OUT / 'demo' / f'{name}.gz').write_bytes(gzip.compress(data, compresslevel=9, mtime=0))
                    moved.append((name, info.file_size))
                    continue
                zout.writestr(info, data)
                kept.append(f'{info.filename},{record_hash(data)},{len(data)}')
            kept.append(f'{record_name},,')
            zout.writestr(record_name, '\n'.join(kept) + '\n')
        (OUT / src.name).write_bytes(slim.getvalue())
        cm = next(tmp.glob('colormap-*.whl'))
        shutil.copy(cm, OUT / cm.name)

        for pat in (f'windkit-{WINDKIT}-*.whl', 'rioxarray-*.whl', 'affine-*.whl'):
            w = next(tmp.glob(pat))
            shutil.copy(w, OUT / w.name)
            print(f'{w.name}: {w.stat().st_size / 1e3:.0f} kB')
        pw = next(tmp.glob(f'plotly-{PLOTLY}-*.whl'))
        slim_plotly = io.BytesIO()
        with zipfile.ZipFile(pw) as zin, zipfile.ZipFile(slim_plotly, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as zout:
            record_name = next(n for n in zin.namelist() if n.endswith('.dist-info/RECORD'))
            kept = []
            for info in zin.infolist():
                if info.filename == record_name:
                    continue
                data = zin.read(info.filename)
                if info.filename == 'plotly/package_data/plotly.min.js':
                    (OUT / 'plotly.min.js').write_bytes(data)
                    continue
                # keep package_data/templates (the figure themes); drop the notebook widget bundle, sample datasets and Jupyter extension
                if info.filename.startswith(('plotly/package_data/widgetbundle', 'plotly/package_data/datasets/', 'jupyterlab_plotly/', 'plotly-' + PLOTLY + '.data/')):
                    continue
                zout.writestr(info, data)
                kept.append(f'{info.filename},{record_hash(data)},{len(data)}')
            kept.append(f'{record_name},,')
            zout.writestr(record_name, '\n'.join(kept) + '\n')
        (OUT / pw.name).write_bytes(slim_plotly.getvalue())
        print(f'{pw.name}: {pw.stat().st_size / 1e6:.1f} MB -> {len(slim_plotly.getvalue()) / 1e6:.2f} MB; plotly.min.js {(OUT / "plotly.min.js").stat().st_size / 1e6:.1f} MB')
        print(f'{src.name}: {src.stat().st_size / 1e6:.1f} MB -> {len(slim.getvalue()) / 1e6:.2f} MB')
        for name, size in moved:
            gz = (OUT / 'demo' / f'{name}.gz').stat().st_size
            print(f'  demo/{name}.gz  {size / 1e6:.1f} MB -> {gz / 1e6:.1f} MB')
        print(f'{cm.name}: {cm.stat().st_size / 1e3:.0f} kB')
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


main()
