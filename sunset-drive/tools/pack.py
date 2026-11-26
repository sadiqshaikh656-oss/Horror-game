import io,json
from PIL import Image
from glb import *
def shrink(src,dst,maxs=512,q=80):
    j,b=rd(src); vd={}
    for im in j.get('images',[]):
        v=j['bufferViews'][im['bufferView']]; o=v.get('byteOffset',0); I=Image.open(io.BytesIO(b[o:o+v['byteLength']])); I.load()
        if max(I.size)>maxs: I=I.resize((min(maxs,I.size[0]),min(maxs,I.size[1])),Image.LANCZOS)
        bio=io.BytesIO(); I.convert('RGB').save(bio,'JPEG',quality=q); vd[im['bufferView']]=bio.getvalue(); im['mimeType']='image/jpeg'
    j.pop('extensionsUsed',None) if False else None
    j,nb=rebuild(j,b,vd); n=wr(dst,j,nb); print(dst,n//1024,'KB')
shrink('/root/.claude/uploads/aa9bff0d-cb3e-580f-ae80-57acafd45447/bd4d7499-standing_man.glb','man.glb')
shrink('human/source/684c0f35-ba0b-48e0-ab19-db572ea748d3.glb','rpm.glb')
# animations only from the repo's Mixamo player
j,b=rd('/home/user/Horror-game/assets/models/player.glb')
keep=['idle','walk_f','run_f','sprint_f','death_front','death_back']
anims=[a for a in j['animations'] if a['name'] in keep]
nodes_used=set(c['target']['node'] for a in anims for c in a['channels'])
# keep full node tree (names), drop meshes/skins/materials
for n in j['nodes']:
    for k in ('mesh','skin','camera'): n.pop(k,None)
j['animations']=anims
for k in ('meshes','skins','materials','textures','images','samplers'): j.pop(k,None)
acc_used=set()
for a in anims:
    for s in a['samplers']: acc_used|={s['input'],s['output']}
remapA={}; newA=[]
for i,a in enumerate(j['accessors']):
    if i in acc_used: remapA[i]=len(newA); newA.append(a)
j['accessors']=newA
for a in anims:
    for s in a['samplers']: s['input']=remapA[s['input']]; s['output']=remapA[s['output']]
j,nb=rebuild(j,b,{}); print('anims.glb',wr('anims.glb',j,nb)//1024,'KB')
