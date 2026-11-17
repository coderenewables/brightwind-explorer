"""Statically parse a brightwind source tree into raw.json (no import, so no dependencies needed).

Usage: python extract_api.py path/to/brightwind/brightwind raw.json
"""
import ast, sys, os, json, re, textwrap
root = sys.argv[1]
def src(n):
    return ast.unparse(n) if n is not None else None
def parse_doc(doc):
    doc = textwrap.dedent(doc or '').strip()
    params, types, ret, rtype = {}, {}, '', ''
    # split on field markers
    parts = re.split(r'\n\s*(?=:(?:param|type|return|returns|rtype)\b)', '\n' + doc)
    summary = parts[0].strip()
    for p in parts[1:]:
        p = p.strip()
        # cut off trailing example section
        m = re.match(r':param\s+(\w+)\s*:(.*)', p, re.S)
        cut = lambda s: re.split(r'\n\s*\*\*Example', s)[0]
        if m: params[m.group(1)] = ' '.join(cut(m.group(2)).split()); continue
        m = re.match(r':type\s+(\w+)\s*:(.*)', p, re.S)
        if m: types[m.group(1)] = ' '.join(cut(m.group(2)).split()); continue
        m = re.match(r':returns?\s*:(.*)', p, re.S)
        if m: ret = ' '.join(cut(m.group(1)).split()); continue
        m = re.match(r':rtype\s*:(.*)', p, re.S)
        if m: rtype = ' '.join(cut(m.group(1)).split()); continue
    return doc, summary, params, types, ret, rtype
def fn(n, owner=None):
    a = n.args
    pos = a.posonlyargs + a.args
    defaults = [None]*(len(pos)-len(a.defaults)) + list(a.defaults)
    doc, summary, pd_, ty, ret, rtype = parse_doc(ast.get_docstring(n, clean=False))
    ps = []
    for arg, d in zip(pos, defaults):
        if arg.arg in ('self', 'cls'): continue
        ps.append(dict(name=arg.arg, default=src(d), required=d is None, ann=src(arg.annotation),
                       doc=pd_.get(arg.arg, ''), type=ty.get(arg.arg, '')))
    for arg, d in zip(a.kwonlyargs, a.kw_defaults):
        ps.append(dict(name=arg.arg, default=src(d), required=d is None, ann=src(arg.annotation),
                       doc=pd_.get(arg.arg, ''), type=ty.get(arg.arg, ''), kwonly=True))
    decs = [src(d) for d in n.decorator_list]
    return dict(name=n.name, params=ps, vararg=a.vararg.arg if a.vararg else None, kwarg=a.kwarg.arg if a.kwarg else None,
                doc=doc, summary=summary, ret=ret, rtype=rtype, retann=src(n.returns), decorators=decs, line=n.lineno)
def cls(n):
    d = dict(name=n.name, bases=[src(b) for b in n.bases], doc=textwrap.dedent(ast.get_docstring(n, clean=False) or '').strip(),
             methods=[], classes=[], line=n.lineno)
    for m in n.body:
        if isinstance(m, ast.FunctionDef) and (not m.name.startswith('_') or m.name == '__init__'):
            d['methods'].append(fn(m))
        elif isinstance(m, ast.ClassDef) and not m.name.startswith('_'):
            d['classes'].append(cls(m))
    return d
out = {}
for dp, dn, fns in os.walk(root):
    for f in fns:
        if not f.endswith('.py'): continue
        p = os.path.join(dp, f)
        tree = ast.parse(open(p, encoding='utf-8').read())
        mod = dict(all=None, functions=[], classes=[], doc=ast.get_docstring(tree) or '')
        for n in tree.body:
            if isinstance(n, ast.Assign) and any(getattr(t,'id',None)=='__all__' for t in n.targets):
                try: mod['all'] = ast.literal_eval(n.value)
                except Exception: pass
            elif isinstance(n, ast.FunctionDef): mod['functions'].append(fn(n))
            elif isinstance(n, ast.ClassDef): mod['classes'].append(cls(n))
        out[os.path.relpath(p, root)] = mod
json.dump(out, open(sys.argv[2], 'w'), indent=1)
