# Port types for windkit nodes

Each node input ("port") accepts a list of types; each output has a list of possible types.
A type is accepted wherever its parent is accepted (e.g. a PWC output can feed an input that accepts WWC;
anything below Dataset can feed an input that accepts Dataset). Use the MOST SPECIFIC types that are true.

| Type | Parent | What it is | Example producer (sample in samples.py) |
|---|---|---|---|
| Dataset | – | any xarray.Dataset | |
| DataArray | – | any xarray.DataArray | `tswc['wind_speed']`, `mean_wind_speed(...)` |
| TSWC | Dataset | time series wind climate (wind_speed, wind_direction over time) | `tswc_from_dataframe`, `create_tswc`, `read_tswc` |
| SurfaceFields | TSWC | TSWC plus surface met fields (UST, HFX, T2, PSFC, ...) | `create_surface_fields` |
| BWC | Dataset | binned wind climate (wsfreq, wdfreq by sector and wind speed bin) | `bwc_from_tswc`, `create_bwc`, `read_bwc` |
| WWC | Dataset | Weibull wind climate (A, k, wdfreq by sector) | `weibull_fit`, `create_wwc`, `read_wwc` |
| PWC | WWC | predicted wind climate: WWC plus A_combined, k_combined, site_elev, power_density... | `create_pwc` |
| GWC | Dataset | generalized wind climate (dims gen_height, gen_roughness) | `create_gwc`, `read_gwc` |
| GeoWC | Dataset | geostrophic wind climate | `create_geowc` |
| GEWC | Dataset | generalized extreme wind climate (max_wspd by sector and year) | `create_gewc` |
| PEWC | Dataset | predicted extreme wind climate (max_wspd by year) | `create_pewc` |
| MetFields | Dataset | met fields (wspd, power_density, ...) | `create_met_fields` |
| SiteEffects | Dataset | WAsP topographic site effects (site_elev, rix, z0meso, speedups ...) | `create_wasp_site_effects` |
| V50LUT | Dataset | LINCOM V50 lookup table | `create_v50_lut` |
| WTG | Dataset | wind turbine generator: power and thrust curves | `read_wtg` |
| WindTurbines | Dataset | turbine layout: positions, hub heights, wtg keys | `create_wind_turbines_from_arrays`, `read_wind_turbines` |
| Locations | Dataset | abstract parent of the four spatial structures below (never an output) | |
| Point | Locations | output locations, point structure | `spatial.create_point` |
| StackedPoint | Locations | stacked points | `spatial.create_stacked_point` |
| Cuboid | Locations | 3-D grid (several heights) | `spatial.create_cuboid` |
| Raster | Locations | 2-D grid (one height) | `spatial.create_raster` |
| RasterMap | DataArray | raster map: elevation, roughness_length or landcover DataArray | `create_raster_map`, `read_elevation_map` |
| GeoDataFrame | – | any geopandas.GeoDataFrame | `wind_turbines_to_geodataframe` |
| VectorMap | GeoDataFrame | vector map: elevation lines (elev) or roughness/landcover change lines (z0_left/right or id_left/right) | `create_vector_map`, `read_roughness_map` (vector) |
| LandCoverTable | Dict | windkit LandCoverTable (landcover id -> z0, d, desc) | `get_landcover_table` |
| LossTable | DataFrame | wind farm loss table | `get_loss_table` |
| UncertaintyTable | DataFrame | uncertainty table | `get_uncertainty_table` |
| BBox | – | windkit.spatial.BBox bounding box | `spatial.BBox.from_cornerpts` |
| DataFrame | – | pandas DataFrame | |
| Series | – | pandas Series | |
| Value | – | number, string, bool, CRS, numpy scalar | |
| List | – | Python list | |
| Dict | – | Python dict | |
| Path | – | a path to a file that is READ (input files only) | |
| Figure | – | matplotlib Figure or Axes | windkit plot functions that use matplotlib |
| Plotly | – | plotly Figure | windkit plot functions that use plotly |

Notes
- Inputs that accept "any xarray object with a spatial structure" (e.g. `obj` in `spatial.reproject`, `spatial.clip`) should accept `["Dataset", "DataArray"]`.
- `output_locs` parameters: use `["Locations"]` unless the probe shows the function also needs or accepts more.
- Parameters that name a file to READ are inputs of type `Path`. Parameters that name a file to WRITE are fields (not ports).
- Settings (numbers, strings, flags, CRS, heights, sector counts, method names) are fields, NOT ports.
