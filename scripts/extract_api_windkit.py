"""Extract windkit's public API (signatures and numpy-style docstrings) into raw JSON.

Unlike extract_api.py for brightwind, this imports windkit: its public names are re-exported
from many submodules, so runtime introspection is the reliable way to list them.

Usage (in an environment with windkit and numpydoc installed):
    python scripts/extract_api_windkit.py raw_windkit.json
"""
import inspect
import json
import sys
import textwrap
import warnings

warnings.simplefilter('ignore')
import windkit as wk  # noqa: E402
from numpydoc.docscrape import NumpyDocString  # noqa: E402

SKIP = {'TYPE_CHECKING', 'WindkitError', 'WindkitFileFormatError', 'WindkitValidationError', 'UnsupportedFileTypeError'}
NAMESPACES = ['spatial', 'weibull', 'ltc', 'plot']


def doc_of(obj):
    raw = inspect.getdoc(obj) or ''
    try:
        d = NumpyDocString(raw)
    except Exception:
        return {'summary': raw.split('\n\n')[0].strip(), 'extended': '', 'params': {}, 'returns': [], 'raw': raw}
    def lines(x):
        return ' '.join(' '.join(x).split())
    return {
        'summary': lines(d['Summary']),
        'extended': lines(d['Extended Summary']),
        'params': {p.name.strip(): {'type': p.type, 'desc': lines(p.desc)} for p in d['Parameters'] + d['Other Parameters']},
        'returns': [{'name': r.name, 'type': r.type, 'desc': lines(r.desc)} for r in d['Returns'] + d['Yields']],
        'raw': raw,
    }


def where(obj):
    target = inspect.unwrap(obj)
    try:
        f = inspect.getsourcefile(target) or ''
        line = inspect.getsourcelines(target)[1]
    except (TypeError, OSError):
        f, line = '', 0
    i = f.rfind('/windkit/')
    return (f[i + 1:] if i >= 0 else f), line


def params_of(obj):
    try:
        sig = inspect.signature(obj)
    except (TypeError, ValueError):
        return [], None, None
    out, var, kw = [], None, None
    for p in sig.parameters.values():
        if p.name in ('self', 'cls'):
            continue
        if p.kind is p.VAR_POSITIONAL:
            var = p.name; continue
        if p.kind is p.VAR_KEYWORD:
            kw = p.name; continue
        out.append({
            'name': p.name,
            'required': p.default is inspect.Parameter.empty,
            'default': None if p.default is inspect.Parameter.empty else repr(p.default),
            'kwonly': p.kind is p.KEYWORD_ONLY,
            'ann': None if p.annotation is inspect.Parameter.empty else (p.annotation if isinstance(p.annotation, str) else getattr(p.annotation, '__name__', str(p.annotation))),
        })
    return out, var, kw


def entry(path, obj):
    module, line = where(obj)
    e = {'path': path, 'kind': 'class' if inspect.isclass(obj) else 'function', 'module': module, 'line': line, 'doc': doc_of(obj)}
    e['params'], e['vararg'], e['kwarg'] = params_of(obj.__init__ if inspect.isclass(obj) else obj)
    wrapped = getattr(obj, '__wrapped__', None)
    e['wrapper'] = getattr(obj, '__qualname__', '') if wrapped is not None else None
    if inspect.isclass(obj):
        if not e['doc']['params'] and obj.__init__.__doc__:
            e['doc']['params'] = doc_of(obj.__init__)['params']
        e['methods'] = []
        for name, m in inspect.getmembers(obj):
            if name.startswith('_') or not (inspect.isfunction(m) or isinstance(inspect.getattr_static(obj, name), property)):
                continue
            is_prop = isinstance(inspect.getattr_static(obj, name), property)
            me = {'name': name, 'property': is_prop, 'doc': doc_of(m.fget if is_prop else m)}
            if not is_prop:
                me['params'], me['vararg'], me['kwarg'] = params_of(m)
            me['module'], me['line'] = where(m.fget if is_prop else m)
            e['methods'].append(me)
    return e


def members(path, cls, out):
    """Class members as entries of their own: classmethods are called like functions
    (wk.spatial.BBox.from_cornerpts), methods and properties on an instance."""
    if not inspect.isclass(cls):
        return
    for name in sorted(dir(cls)):
        owner = next((k for k in cls.__mro__ if name in vars(k)), None)
        if name.startswith('_') or owner is None or not owner.__module__.startswith('windkit'):
            continue
        raw = inspect.getattr_static(cls, name)
        if isinstance(raw, (classmethod, staticmethod)):
            e = entry(f'{path}.{name}', getattr(cls, name))
            e['kind'] = 'classmethod'
        elif isinstance(raw, property):
            module, line = where(raw.fget)
            e = {'path': f'{path}.{name}', 'kind': 'property', 'module': module, 'line': line, 'doc': doc_of(raw.fget),
                 'params': [], 'vararg': None, 'kwarg': None, 'wrapper': None}
        elif inspect.isfunction(raw):
            e = entry(f'{path}.{name}', raw)
            e['kind'] = 'method'
        else:
            continue
        out.append(e)


def main():
    out = []
    for name in sorted(dir(wk)):
        obj = getattr(wk, name)
        if name.startswith('_') or name in SKIP or inspect.ismodule(obj):
            continue
        if callable(obj):
            out.append(entry('wk.' + name, obj))
            members('wk.' + name, obj, out)
    for ns in NAMESPACES:
        mod = getattr(wk, ns)
        for name in sorted(dir(mod)):
            obj = getattr(mod, name)
            if name.startswith('_') or inspect.ismodule(obj) or not callable(obj):
                continue
            if not (getattr(obj, '__module__', '') or '').startswith('windkit'):
                continue
            out.append(entry(f'wk.{ns}.{name}', obj))
            members(f'wk.{ns}.{name}', obj, out)
    json.dump({'version': wk.__version__, 'entries': out}, open(sys.argv[1], 'w'), indent=1)
    print(f'{len(out)} entries from windkit {wk.__version__}')


main()
