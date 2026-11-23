"""Stand-ins for the services windkit downloads from, so the probe can check those tools offline.

They copy the shape of the real responses (checked against the live services from a browser):
  - Global Wind Atlas map API: GeoJSON polygons whose "id" property is a CORINE class.
  - Zenodo tutorial data: a zip with bwc.nc, wtg.nc, turbines.nc, elev.gpkg and rgh.gpkg at its root.
What the probe then checks is windkit's own processing of those responses, and the types it returns.
"""
import os
import zipfile

import shapely
import geopandas as gpd


class _Response:
    def __init__(self, payload):
        self.status_code, self.ok, self._payload = 200, True, payload

    def json(self):
        return self._payload

    def raise_for_status(self):
        pass


def fake_gwa(wk):
    """Answer get_vector_map's request with forest (311) and pasture (231) polygons around the box."""
    import windkit.integrations._gwa_map_api as gwa

    def get(url, *a, **k):
        assert 'api.globalwindatlas.info/qgis-data/v1/corine_2018?points_str=' in url, url
        pts = [tuple(map(float, p.split(','))) for p in url.split('points_str=')[1].split(';')]
        xs, ys = [p[0] for p in pts], [p[1] for p in pts]
        x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
        xm = (x0 + x1) / 2
        feats = [{'type': 'Feature', 'properties': {'id': cid}, 'geometry': shapely.geometry.mapping(shapely.box(a, y0, b, y1))}
                 for cid, a, b in ((311, x0, xm), (231, xm, x1))]
        return _Response({'type': 'FeatureCollection', 'features': feats})

    gwa.requests = type('requests', (), {'get': staticmethod(get), 'exceptions': __import__('requests').exceptions})


def fake_zenodo(wk, S, tmp):
    """Serve a tutorial zip made from the probe's samples, cached under tmp instead of the user's folder."""
    import windkit.tutorial_data as td
    os.environ['XDG_DATA_HOME'] = os.path.join(tmp, 'xdg')
    src = os.path.join(tmp, 'tutorial_src.zip')
    if not os.path.exists(src):
        d = os.path.join(tmp, 'tutorial_src')
        os.makedirs(d, exist_ok=True)
        S['BWC'].to_netcdf(os.path.join(d, 'bwc.nc'))
        S['WTG'].to_netcdf(os.path.join(d, 'wtg.nc'))
        S['WindTurbines'].to_netcdf(os.path.join(d, 'turbines.nc'))
        S['VectorMap'].to_file(os.path.join(d, 'elev.gpkg'))
        S['VectorMap_roughness'].to_file(os.path.join(d, 'rgh.gpkg'))
        with zipfile.ZipFile(src, 'w') as z:
            for f in os.listdir(d):
                z.write(os.path.join(d, f), f)

    def download(zip_path):
        assert zip_path.name == 'SerraSantaLuzia.zip', zip_path
        zip_path.write_bytes(open(src, 'rb').read())

    td._check_internet_connection = lambda: None
    td._download_tutorial_data = download
