import numpy as np, time
from PIL import Image
from bake import *
# 10 ground-floor shops: each gets a 512 tile in a 4x3 atlas
SH=['stand_%d'%i for i in range(1,11)]
TYPES=[('shutter',(206,170,48)),('shutter',(70,100,160)),('door',(178,46,46)),('shutter',(84,148,96)),('door',(196,160,60)),
       ('shutter',(170,100,60)),('door',(40,60,150)),('shutter',(60,110,170)),('shutter',(200,175,60)),('door',(60,130,140))]
def tile(name): i=SH.index(name); return i%4, i//4
def uvmap(name,uv):
    cx,cy=tile(name); return np.stack([(uv[:,0]*.96+.02+cx)/4,(uv[:,1]*.96+.02+cy)/4*4/3],1)
W,H=2048,1536
P,UV,FID,faces=tris_of(SH,uvmap)
# raster into a square canvas then crop (raster assumes square): use S=2048 with v scaled by 3/4
UV2=UV.copy(); UV2[...,1]=UV2[...,1]*.75+.25
pos,fid=raster(P,UV2,FID,2048); pos=pos[:1536]; fid=fid[:1536]
info=[]
for name,pts in faces:
    n=np.zeros(3)
    for i in range(len(pts)): n+=np.cross(pts[i],pts[(i+1)%len(pts)])
    area=np.linalg.norm(n)/2; n=n/(np.linalg.norm(n)+1e-12); c=pts.mean(0); e=pts.max(0)-pts.min(0); thin=sorted(e)[1]
    typ,colr=TYPES[SH.index(name)]
    if abs(n[1])>.6: k='flat'
    elif c[1]>2.75 and e[1]<1.2: k='sign'
    elif thin<.09: k='frame'
    elif area>.6 and e[1]>1.2: k=typ
    else: k='wall'
    info.append((k,n,c,e,np.array(colr)/255))
valid=fid>=0; idx=np.nonzero(valid); p=pos[idx]; f=fid[idx]
K=np.array([i[0] for i in info])[f]; Nn=np.array([i[1] for i in info])[f]; CL=np.array([i[4] for i in info])[f]
n1=fbm(p,1.5,4,2); rust=fbm(p*[3,1.2,3],2.2,4,9); drip=fbm(p*[4,.3,4],1,4,4)
col=np.zeros((len(f),3)); rough=np.full(len(f),.8); metal=np.zeros(len(f))
m=K=='shutter'
sl=(p[m,1]%.075)/.075; slat=.78+.22*np.clip(np.sin(sl*np.pi),0,1)**.6
col[m]=CL[m]*slat[:,None]*(0.85+.25*n1[m,None]); rough[m]=.6; metal[m]=.5
r=np.clip((rust[m]-.52)*3.5,0,1)*np.clip((drip[m]-.35)*2,0,1)
col[m]=col[m]*(1-r[:,None])+np.array([88,52,32])/255*r[:,None]*(0.7+.5*n1[m,None]); rough[m]+=.3*r
m=K=='door'
col[m]=np.array([84,128,134])/255*(0.8+.25*n1[m,None])*(0.8+.3*((p[m,1]%3)/3))[:,None]; rough[m]=.08; metal[m]=.3
col[m]*=(1-.25*np.clip((drip[m]-.5)*2,0,1))[:,None]
m=K=='frame'; col[m]=CL[m]*.8*(0.85+.2*n1[m,None]); rough[m]=.5; metal[m]=.3
m=K=='sign'; col[m]=CL[m]*(0.75+.3*n1[m,None]); rough[m]=.7
r=np.clip((rust[m]-.6)*3,0,1); col[m]=col[m]*(1-.5*r[:,None])
m=(K=='wall')|(K=='flat'); col[m]=np.array([110,110,108])/255*(0.8+.3*n1[m,None]); rough[m]=.95
import collections; print(collections.Counter(K))
img=np.zeros((1536,2048,3),np.float32); img[idx]=np.clip(col,0,1)
orm=np.zeros((1536,2048,3),np.float32); orm[idx]=np.stack([np.ones(len(f)),np.clip(rough,0,1),metal],1)
img=dilate(img,valid,8); orm=dilate(orm,valid,8)
Image.fromarray((img*255).astype(np.uint8)).save('shop_bc.jpg',quality=86)
Image.fromarray((orm*255).astype(np.uint8)).resize((1024,768)).save('shop_orm.jpg',quality=85)
