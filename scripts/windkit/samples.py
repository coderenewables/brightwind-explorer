"""Sample objects for every port type, and a classifier that names the type of any object.

Used by the probe (does each windkit function accept what the catalog says, and return what it
claims?) and by the browser runner tests.
"""
import os
import tempfile
import warnings

warnings.simplefilter('ignore')
import numpy as np
import pandas as pd
import xarray as xr
import windkit as wk

CRS = 'EPSG:32629'
X0, Y0 = 500000.0, 5900000.0
WTG_XML = '''<?xml version="1.0" encoding="utf-8"?>
<WindTurbineGenerator Description="Demo 3 MW" ManufacturerName="Demo" RotorDiameter="112" FormatVersion="1.00">
  <SuggestedHeights><Height>94</Height></SuggestedHeights>
  <PerformanceTable AirDensity="1.225" StationaryThrustCoEfficient="0.161">
    <StartStopStrategy LowSpeedCutIn="3" HighSpeedCutOut="25" LowSpeedCutOut="3" HighSpeedCutIn="22"/>
    <DataTable>''' + ''.join(
    f'<DataPoint WindSpeed="{v}" PowerOutput="{min(3000000, max(0, 3000000 * ((v - 3) / 9) ** 3))}" ThrustCoEfficient="{max(0.1, 0.85 - 0.03 * v)}"/>'
    for v in range(3, 26)) + '''</DataTable>
  </PerformanceTable>
</WindTurbineGenerator>'''


def build(tmpdir=None):
    """Return {type_name: sample object}. Every value is a fresh object of that type."""
    d = tmpdir or tempfile.mkdtemp()
    S = {}
    S['Point'] = wk.spatial.create_point([X0], [Y0], [80.0], CRS)
    S['StackedPoint'] = wk.spatial.create_stacked_point([X0, X0 + 500], [Y0, Y0 + 500], [50.0, 100.0], CRS)
    S['Cuboid'] = wk.spatial.create_cuboid(X0 + np.arange(3) * 200.0, Y0 + np.arange(3) * 200.0, [50.0, 100.0], CRS)
    S['Raster'] = wk.spatial.create_raster(X0 + np.arange(6) * 100.0, Y0 + np.arange(5) * 100.0, CRS)
    pt2 = wk.spatial.create_stacked_point([X0, X0], [Y0, Y0], [40.0, 80.0], CRS)
    S['TSWC'] = wk.create_tswc(S['Point'], date_range=pd.date_range('2020-01-01', periods=24 * 60, freq='h'))
    S['TSWC_2heights'] = wk.create_tswc(pt2, date_range=pd.date_range('2020-01-01', periods=24 * 60, freq='h'))
    S['BWC'] = wk.bwc_from_tswc(S['TSWC'])
    S['WWC'] = wk.weibull_fit(S['BWC'])
    S['GWC'] = wk.create_gwc(S['Point'])
    S['GeoWC'] = wk.create_geowc(S['Point'])
    S['GEWC'] = wk.create_gewc(S['Point'])
    S['PEWC'] = wk.create_pewc(S['Point'])
    S['PWC'] = wk.create_pwc(S['Point'])
    S['MetFields'] = wk.create_met_fields(S['Point'])
    S['SurfaceFields'] = wk.create_surface_fields(S['Point'], date_range=pd.date_range('2020-01-01', periods=24 * 10, freq='h'))
    S['SiteEffects'] = wk.create_wasp_site_effects(S['Point'])
    S['V50LUT'] = wk.create_v50_lut(S['Point'])
    p = os.path.join(d, 'demo.wtg')
    open(p, 'w').write(WTG_XML)
    S['WTG'] = wk.read_wtg(p)
    S['WindTurbines'] = wk.create_wind_turbines_from_arrays([X0, X0 + 400.0], [Y0, Y0], [94.0, 94.0], [1, 1], crs=CRS)
    S['RasterMap'] = wk.create_raster_map(S['Raster'], 100.0, map_type='elevation')
    S['RasterMap_roughness'] = wk.create_raster_map(S['Raster'], 100.0, map_type='roughness')
    S['RasterMap_landcover'] = wk.create_raster_map(S['Raster'], 100.0, map_type='landcover')
    bbox = wk.spatial.BBox.from_cornerpts(X0, Y0, X0 + 2000, Y0 + 2000, crs=CRS)
    S['BBox'] = bbox
    S['VectorMap'] = wk.create_vector_map(bbox, map_type='elevation', elevation=100.0)
    S['VectorMap_roughness'] = wk.create_vector_map(bbox, map_type='roughness', roughness_change=(0.03, 0.4))
    S['LandCoverTable'] = wk.get_landcover_table('CORINE')
    S['LossTable'] = wk.get_loss_table()
    S['UncertaintyTable'] = wk.get_uncertainty_table()
    S['DataArray'] = S['TSWC']['wind_speed']
    S['Dataset'] = S['TSWC'][['wind_speed']].isel(time=slice(0, 10)).rename({'wind_speed': 'var'})
    idx = pd.date_range('2020-01-01', periods=24 * 30, freq='10min')
    rng = np.random.default_rng(1)
    S['DataFrame'] = pd.DataFrame({'ws_80': rng.weibull(2.0, len(idx)) * 8, 'wd_80': rng.uniform(0, 360, len(idx)),
                                   'ws_40': rng.weibull(2.0, len(idx)) * 7, 'wd_40': rng.uniform(0, 360, len(idx))}, index=idx)
    S['Series'] = S['DataFrame']['ws_80']
    import geopandas as gpd
    S['GeoDataFrame'] = wk.wind_turbines_to_geodataframe(S['WindTurbines'])
    return S


MAP_NAMES = {'elevation', 'roughness_length', 'landcover', 'z0', 'roughness'}


def classify(obj):
    """Name the port type of obj. Tuples give a list of types."""
    if isinstance(obj, tuple):
        return [classify(o) for o in obj]
    mod = type(obj).__module__
    if mod.startswith('plotly'):
        return 'Plotly'
    if mod.startswith(('matplotlib', 'mpl_toolkits')):
        from matplotlib.axes import Axes
        return 'Axes' if isinstance(obj, Axes) else 'Figure'
    if isinstance(obj, wk.ltc.mcp.MCPBase):
        return f'wk.ltc.{type(obj).__name__}' + (' (fitted)' if getattr(obj, 'sector_edges', None) is not None else '')
    if isinstance(obj, wk.Workspace):
        return 'Workspace'
    import pathlib
    if isinstance(obj, pathlib.PurePath):
        return 'Path'
    import enum, pyproj
    if isinstance(obj, (enum.Enum, pyproj.CRS)):
        return 'Value'
    if isinstance(obj, np.ndarray):
        return 'Value' if obj.ndim == 0 else 'List'
    if isinstance(obj, xr.Dataset):
        vars_, dims, otype = set(obj.data_vars), set(obj.sizes), str(obj.attrs.get('Object type', ''))
        for name, fn in (('WTG', wk.is_wtg), ('WindTurbines', wk.is_windturbines)):
            try:
                if fn(obj):
                    return name
            except Exception:
                pass
        if vars_ <= {'output'}:
            if {'west_east', 'south_north'} <= dims and 'point' not in dims:
                return 'Cuboid' if obj.sizes.get('height', 1) > 1 else 'Raster'
            for name, fn in (('Point', wk.spatial.is_point), ('StackedPoint', wk.spatial.is_stacked_point)):
                try:
                    if fn(obj):
                        return name
                except Exception:
                    pass
        if otype.startswith('Generalized Extreme') or ({'max_wspd'} <= vars_ and {'sector', 'year'} <= dims):
            return 'GEWC'
        if otype.startswith('LINCOM V50') or ({'max_wspd'} <= vars_ and 'year' in dims):
            return 'PEWC'
        if otype.startswith('LINCOM Lookup'):
            return 'V50LUT'
        if otype.startswith('Met fields'):
            return 'MetFields'
        if otype.startswith('Topographic effects'):
            return 'SiteEffects'
        for name, fn in (('GWC', wk.is_gwc), ('GeoWC', wk.is_geowc)):
            try:
                if fn(obj):
                    return name
            except Exception:
                pass
        try:
            if wk.is_tswc(obj):
                return 'SurfaceFields' if vars_ & {'UST', 'HFX', 'T2', 'PSFC'} else 'TSWC'
        except Exception:
            pass
        try:
            if wk.is_bwc(obj):
                return 'BWC'
        except Exception:
            pass
        try:
            if wk.is_wwc(obj):
                return 'PWC' if vars_ & {'A_combined', 'site_elev'} else 'WWC'
        except Exception:
            pass
        return 'Dataset'
    if isinstance(obj, xr.DataArray):
        try:
            if wk.spatial.is_raster(obj) and (obj.name in MAP_NAMES):
                return 'RasterMap'
        except Exception:
            pass
        return 'DataArray'
    try:
        import geopandas as gpd
        if isinstance(obj, gpd.GeoDataFrame):
            cols = set(obj.columns)
            # windkit's vector maps: elevation lines, roughness or land-cover change lines, or land-cover
            # polygons that carry their table inline (id, z0, d, desc), as read_roughness_map returns them
            if cols & {'elev', 'z0_left', 'z0_right', 'id_left', 'id_right'} or {'id', 'z0', 'd', 'desc'} <= cols:
                return 'VectorMap'
            return 'GeoDataFrame'
    except ImportError:
        pass
    if type(obj).__name__ == 'LandCoverTable':
        return 'LandCoverTable'
    if type(obj).__name__ == 'BBox':
        return 'BBox'
    if isinstance(obj, pd.DataFrame):
        for name, fn in (('LossTable', wk.validate_loss_table), ('UncertaintyTable', wk.validate_uncertainty_table)):
            try:
                fn(obj)
                return name
            except Exception:
                pass
        return 'DataFrame'
    if isinstance(obj, pd.Series):
        return 'Series'
    if isinstance(obj, (bool, int, float, str, np.number, np.bool_)):
        return 'Value'
    if isinstance(obj, dict):
        return 'Dict'
    if isinstance(obj, list):
        return 'List'
    if obj is None:
        return 'None'
    return type(obj).__module__ + '.' + type(obj).__name__


if __name__ == '__main__':
    S = build()
    bad = []
    for k, v in S.items():
        c = classify(v)
        base = k.split('_')[0] if k not in ('TSWC_2heights',) else 'TSWC'
        flag = '' if c == base else '   <-- classified differently'
        if flag: bad.append(k)
        print(f'{k:22s} -> {c}{flag}')
    print('mismatches:', bad)
