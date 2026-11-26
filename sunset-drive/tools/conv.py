import struct, json, gzip, base64, sys
F='/root/.claude/uploads/aa9bff0d-cb3e-580f-ae80-57acafd45447/fb189545-Building.obj'
V=[];T=[];N=[];objs=[];cur=None
for l in open(F):
    s=l.split()
    if not s: continue
    if s[0]=='o': cur={'name':s[1],'f':[]}; objs.append(cur)
    elif s[0]=='v': V.append(tuple(map(float,s[1:4])))
    elif s[0]=='vt': T.append(tuple(map(float,s[1:3])))
    elif s[0]=='vn': N.append(tuple(map(float,s[1:4])))
    elif s[0]=='f':
        cur['f'].append([tuple(int(x) if x else 0 for x in (p.split('/')+['',''])[:3]) for p in s[1:]])
SH=['stand_%d'%i for i in range(1,11)]
def uvmap(name,u):
    i=SH.index(name); cx,cy=i%4,i//4; return ((u[0]*.96+.02+cx)/4,(u[1]*.96+.02+cy)/3)
groups=[('building',['Building']),('shops',SH),('vent',['ventilation_3_low.003']),('ac',['Cylinder.035_low.020'])]
byname={o['name']:o for o in objs}
merged=[]
for gname,names in groups:
    fs=[]
    for nm in names:
        for f in byname[nm]['f']: fs.append([(k[0],k[1],k[2],nm) for k in f])
    merged.append({'name':gname,'f':fs})
head=[];blob=bytearray()
for o in merged:
    m={};pos=[];nor=[];uv=[];idx=[]
    for f in o['f']:
        ids=[]
        for k in f:
            if k not in m:
                m[k]=len(pos); pos.append(V[k[0]-1]); nor.append(N[k[2]-1] if k[2] else (0,1,0)); t=T[k[1]-1] if k[1] else (0,0)
                uv.append(uvmap(k[3],t) if k[3] in SH else t)
            ids.append(m[k])
        for i in range(1,len(ids)-1): idx+= [ids[0],ids[i],ids[i+1]]
    e={'name':o['name'],'n':len(pos),'i':len(idx),'off':len(blob)}
    for p in pos: blob+=struct.pack('<3f',*p)
    for n in nor: blob+=struct.pack('<3b',*[max(-127,min(127,round(c*127))) for c in n])
    if len(blob)%4: blob+=b'\0'*(4-len(blob)%4)
    for u in uv: blob+=struct.pack('<2H',*[max(0,min(65535,round(c*65535))) for c in u])
    for i in idx: blob+=struct.pack('<H' if len(pos)<65536 else '<I',i)
    e['u32']=len(pos)>=65536
    if len(blob)%4: blob+=b'\0'*(4-len(blob)%4)
    head.append(e); print(e)
hj=json.dumps(head).encode(); out=struct.pack('<I',len(hj))+hj
pad=(4-len(out)%4)%4; out+=b' '*pad
data=gzip.compress(out+bytes(blob),9)
open('building.b64.txt','w').write(base64.b64encode(data).decode())
print('json',len(hj),'blob',len(blob),'gz',len(data))
