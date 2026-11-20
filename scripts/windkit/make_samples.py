"""Write the small example files the windkit tools can start from, to public/py/samples/.

  demo_turbine_3MW.wtg   a synthetic 3 MW turbine (power and thrust curves), WAsP .wtg format
  demo_mast_80m.tab      binned wind climate at 80 m from brightwind's demo mast data, WAsP .tab format
  demo_elevation.tif     a synthetic 4 km x 4 km hill, GeoTIFF elevation raster (UTM 29N)
  demo_elevation.map     the same hill as 10 m contour lines, WAsP .map format
  demo_roughness.map     roughness change lines around a forest, WAsP .map format

Usage: python scripts/windkit/make_samples.py   (needs windkit, rioxarray and brightwind)
"""
import json
import os
import sys
import warnings

warnings.simplefilter('ignore')
import numpy as np
import xarray as xr
import geopandas as gpd
import shapely
import windkit as wk

sys.path.insert(0, os.path.dirname(__file__))
from samples import WTG_XML  # noqa: E402

OUT = os.path.join(os.path.dirname(__file__), '..', '..', 'public', 'py', 'samples')
CRS = 'EPSG:32629'
X0, Y0 = 480000.0, 5880000.0        # west of Ireland, UTM zone 29N
SAMPLES = [
    ('demo_turbine_3MW.wtg', 'A synthetic 3 MW turbine with power and thrust curves (WAsP .wtg).'),
    ('demo_mast_80m.tab', "Binned wind climate at 80 m from brightwind's demo mast data (WAsP .tab)."),
    ('demo_elevation.tif', 'A synthetic 4 km by 4 km hill as an elevation raster (GeoTIFF, UTM 29N).'),
    ('demo_elevation.map', 'The same hill as 10 m elevation contours (WAsP .map).'),
    ('demo_roughness.map', 'Roughness change lines around a forest (WAsP .map).'),
]


def hill():
    x = X0 + np.arange(0, 4001, 50.0)
    y = Y0 + np.arange(0, 4001, 50.0)
    xx, yy = np.meshgrid(x, y)
    z = 20 + 180 * np.exp(-(((xx - X0 - 2000) / 900) ** 2 + ((yy - Y0 - 2200) / 700) ** 2))
    da = xr.DataArray(z, dims=('south_north', 'west_east'), coords={'west_east': x, 'south_north': y}, name='elevation')
    da = wk.spatial.add_crs(da, CRS) if hasattr(wk.spatial, 'add_crs') else da
    return wk.spatial.set_crs(da, CRS) if not hasattr(da, 'crs') else da


def contours(da):
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    levels = np.arange(30, 200, 10.0)
    cs = plt.contour(da.west_east.values, da.south_north.values, da.values, levels=levels)
    rows = []
    for level, segs in zip(cs.levels, cs.allsegs):
        for seg in segs:
            if len(seg) > 2:
                rows.append({'elev': float(level), 'geometry': shapely.LineString(seg)})
    plt.close('all')
    return gpd.GeoDataFrame(rows, crs=CRS)


def forest():
    ring = shapely.Polygon([(X0 + 2600, Y0 + 400), (X0 + 3700, Y0 + 600), (X0 + 3500, Y0 + 1900), (X0 + 2500, Y0 + 1500)])
    # inside the forest z0 = 0.8 m, outside open grassland z0 = 0.03 m; the ring runs anticlockwise so the forest is on the left
    return gpd.GeoDataFrame({'z0_left': [0.8], 'z0_right': [0.03]}, geometry=[shapely.LineString(ring.exterior.coords)], crs=CRS)


def mast_bwc():
    import brightwind as bw
    data = bw.load_csv(bw.demo_datasets.demo_data)
    # a .tab file stores geographic coordinates, so the mast goes in as longitude and latitude (on top of the hill)
    from pyproj import Transformer
    lon, lat = Transformer.from_crs(CRS, 'EPSG:4326', always_xy=True).transform(X0 + 2000, Y0 + 2200)
    ts = wk.tswc_from_dataframe(data[['Spd80mN', 'Dir78mS']].dropna(), round(lon, 5), round(lat, 5), 'EPSG:4326', height_to_columns={80.0: ('Spd80mN', 'Dir78mS')})
    return wk.bwc_from_tswc(ts)


def main():
    os.makedirs(OUT, exist_ok=True)
    open(os.path.join(OUT, 'demo_turbine_3MW.wtg'), 'w').write(WTG_XML.replace('Demo 3 MW', 'Demo 3 MW (synthetic)'))
    wk.bwc_to_file(mast_bwc(), os.path.join(OUT, 'demo_mast_80m.tab'))
    da = hill()
    wk.elevation_map_to_file(da, os.path.join(OUT, 'demo_elevation.tif'))
    wk.elevation_map_to_file(contours(da), os.path.join(OUT, 'demo_elevation.map'))
    wk.roughness_map_to_file(forest(), os.path.join(OUT, 'demo_roughness.map'))
    json.dump([dict(file=f, doc=d) for f, d in SAMPLES], open(os.path.join(OUT, 'index.json'), 'w'), indent=1)
    for f, _ in SAMPLES:
        print(f'{f}: {os.path.getsize(os.path.join(OUT, f)) / 1e3:.0f} kB')


main()
