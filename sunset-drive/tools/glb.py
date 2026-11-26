import json,struct,io
from PIL import Image
def rd(f):
    b=open(f,'rb').read(); l=struct.unpack('<I',b[12:16])[0]; j=json.loads(b[20:20+l]); off=20+l; bl=struct.unpack('<I',b[off:off+4])[0]; return j,b[off+8:off+8+bl]
def wr(f,j,bin_):
    js=json.dumps(j,separators=(',',':')).encode(); js+=b' '*((4-len(js)%4)%4); bin_=bytes(bin_)+b'\0'*((4-len(bin_)%4)%4)
    out=struct.pack('<III',0x46546C67,2,12+8+len(js)+8+len(bin_))+struct.pack('<II',len(js),0x4E4F534A)+js+struct.pack('<II',len(bin_),0x004E4942)+bin_
    open(f,'wb').write(out); return len(out)
def rebuild(j,b,view_data):
    """view_data: dict bufferView index -> new bytes (or None to keep). drops unused views. returns new j, bin"""
    nb=bytearray(); newv=[]; remap={}
    used=set()
    for a in j.get('accessors',[]):
        if 'bufferView' in a: used.add(a['bufferView'])
    for im in j.get('images',[]):
        if 'bufferView' in im: used.add(im['bufferView'])
    for i,v in enumerate(j['bufferViews']):
        if i not in used: continue
        data=view_data.get(i)
        if data is None: o=v.get('byteOffset',0); data=b[o:o+v['byteLength']]
        while len(nb)%4: nb+=b'\0'
        nv=dict(v); nv['byteOffset']=len(nb); nv['byteLength']=len(data); nv['buffer']=0; nb+=data
        remap[i]=len(newv); newv.append(nv)
    j['bufferViews']=newv
    for a in j.get('accessors',[]):
        if 'bufferView' in a: a['bufferView']=remap[a['bufferView']]
    for im in j.get('images',[]):
        if 'bufferView' in im: im['bufferView']=remap[im['bufferView']]
    j['buffers']=[{'byteLength':len(nb)}]
    return j,nb
