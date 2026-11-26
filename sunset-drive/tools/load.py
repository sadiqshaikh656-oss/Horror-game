import numpy as np
F='/root/.claude/uploads/aa9bff0d-cb3e-580f-ae80-57acafd45447/fb189545-Building.obj'
def load():
    V=[];T=[];N=[];objs={};cur=None
    for l in open(F):
        s=l.split()
        if not s: continue
        if s[0]=='o': cur=s[1]; objs[cur]=[]
        elif s[0]=='v': V.append(list(map(float,s[1:4])))
        elif s[0]=='vt': T.append(list(map(float,s[1:3])))
        elif s[0]=='vn': N.append(list(map(float,s[1:4])))
        elif s[0]=='f':
            idx=[[int(x)-1 if x else -1 for x in (p.split('/')+['',''])[:3]] for p in s[1:]]
            objs[cur].append(idx)
    return np.array(V),np.array(T),np.array(N),objs
