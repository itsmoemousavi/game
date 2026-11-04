"""Edit hero numbers in src/sim/data/heroes.ts: tune.py '<hero>.<field>=<value>' or '<hero>.<abilityId>.<valueKey>=[...]'."""
import re, sys
import os
p = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'src', 'sim', 'data', 'heroes.ts')
s = open(p).read()
def block(hero):
    a = s.index(f"\n  {hero}: {{")
    b = s.index("\n  },\n", a) + 5  # end of hero object (abilities close with '    ],\n  },')
    return a, b
for arg in sys.argv[1:]:
    key, val = arg.split('=', 1)
    parts = key.split('.')
    a, b = block(parts[0])
    blk = s[a:b]
    if len(parts) == 2:
        new, n = re.subn(rf"(\n    {parts[1]}: )[^,\n]+,", rf"\g<1>{val},", blk, count=1)
    else:
        ai = blk.index(f"id: '{parts[1]}'")
        sub = blk[ai:]
        sub2, n = re.subn(rf"({parts[2]}: )\[[^\]]*\]", rf"\g<1>{val}", sub, count=1)
        new = blk[:ai] + sub2
    assert n == 1, arg
    s = s[:a] + new + s[b:]
open(p, 'w').write(s)
print('ok', len(sys.argv) - 1, 'changes')
