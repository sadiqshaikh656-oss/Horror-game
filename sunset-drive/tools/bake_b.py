import numpy as np, time
from PIL import Image
from bake import *
t0=time.time()
S=2048
P,UV,FID,faces=tris_of(['Building'])
# ---- face features + class
info=[]
for name,pts in faces:
    n=np.zeros(3)
    for i in range(len(pts)): n+=np.cross(pts[i],pts[(i+1)%len(pts)])
    area=np.linalg.norm(n)/2; n=n/(np.linalg.norm(n)+1e-12)
    c=pts.mean(0); e=pts.max(0)-pts.min(0); thin=sorted(e)[1]; d=float(np.dot(c,n))
    vert=abs(n[1])<.3; band=3.3<c[1]<12.35
    if not vert:
        if n[1]>.9: k='roof' if c[1]>13.2 else 'ledge'
        elif n[1]<-.9: k='under'
        else: k='corr' if c[1]>13.9 else 'awn'
    else:
        if band and area>2 and e[1]>1.4: k='glass'
        elif thin<.1:
            if c[1]>12.9: k='rail'
            elif band: k='wframe' if 5<d<6.2 else 'frame'
            elif max(e[0],e[2])>3: k='ledge'
            else: k='frame'
        elif band and 5<d<6.25 and area>.12 and e[1]>.6 and c[1]<11.6: k='pane'
        elif c[1]<3.4: k='ground'
        elif c[1]>13.2: k='shed'
        else: k='conc'
    info.append((k,n,c,e))
import collections; print(collections.Counter(i[0] for i in info))
pos,fid=raster(P,UV,FID,S); print('raster',time.time()-t0)
valid=fid>=0
idx=np.nonzero(valid); p=pos[idx]; f=fid[idx]
K=np.array([i[0] for i in info])[f]; Nn=np.array([i[1] for i in info])[f]; C=np.array([i[2] for i in info])[f]; E=np.array([i[3] for i in info])[f]
col=np.zeros((len(f),3)); rough=np.full(len(f),.9); metal=np.zeros(len(f)); ao=np.ones(len(f))
n1=fbm(p,1.3,4,1); n2=fbm(p,6,3,7); drip=fbm(p*[3.5,.25,3.5],1,4,3); spots=fbm(p,9,3,11)
def setc(m,rgb,var=.08,r=.9,mt=0):
    col[m]=np.array(rgb)/255*(1-var/2+var*n1[m,None]); rough[m]=r; metal[m]=mt
conc=np.isin(K,['conc','ledge','roof','shed','ground','under'])
setc(conc,(142,143,141),.24,.92)
setc(K=='ground',(112,113,111),.28,.95); setc(K=='under',(112,112,110),.2,.95); setc(K=='roof',(132,133,131),.25,.95)
setc(K=='shed',(140,140,137),.3,.97)
# water stains running down the concrete
st=conc&(K!='roof'); dk=np.clip((drip[st]-.55)*3,0,1)*.35+np.clip((n2[st]-.6)*2,0,1)*.12
col[st]*= (1-dk)[:,None]
# grime at the bottom of each floor band
fl=((p[:,1]-0.2)%2.81)/2.81; col[st]*=(1-.12*np.clip(1-fl[st]*4,0,1))[:,None]
setc(K=='frame',(78,80,86),.15,.55,.6); setc(K=='wframe',(196,198,199),.12,.6,.1); setc(K=='rail',(60,58,56),.2,.55,.5)
setc(K=='awn',(98,94,93),.22,.6,.45); setc(K=='corr',(126,128,130),.18,.55,.6)
# corrugation stripes on the shed roof
m=K=='corr'; col[m]*=(0.82+.18*np.abs(np.sin(p[m,0]*np.pi/0.09)))[:,None]
# rust on metal
for kk in ('frame','rail','awn','corr'):
    m=K==kk; r=np.clip((spots[m]-.6)*3,0,1)*(.55 if kk!='frame' else .4)
    col[m]=col[m]*(1-r[:,None])+np.array([110,70,45])/255*r[:,None]*(0.7+.6*n1[m,None])
    rough[m]=np.maximum(rough[m],.55+.4*r)
# glass: small-pane steel grid painted on the big window faces
m=(K=='glass')|(K=='pane')
hcoord=np.where(np.abs(Nn[:,2])>np.abs(Nn[:,0]),p[:,0],p[:,2])
y0=C[:,1]-E[:,1]/2; rows=np.maximum(1,np.round(E[:,1]/.45)); rh=E[:,1]/rows
fx=(hcoord/.43)%1; fy=((p[:,1]-y0)/np.maximum(rh,1e-3))%1
lw=.045/.43; lh=.045/np.maximum(rh,1e-3)
grid=(K=='glass')&((fx<lw)|(fx>1-lw*.3)|(fy<lh)|(fy>1-lh*.3))
pane_id=np.floor(hcoord/.43)*31+np.floor((p[:,1]-y0)/np.maximum(rh,1e-3))*7
pv=hashn(pane_id.astype(np.int64),0,0,5)
gl=m&~grid
base=np.array([146,186,190])/255
col[gl]=base*(0.88+.16*pv[gl,None])*(1-.18*np.clip((n2[gl]-.5)*2,0,1)[:,None])
# reflection gradient + dirt along the bottom of panes
col[gl]*=(0.92+.12*fy[gl])[:,None]
rough[gl]=.08; metal[gl]=.15
col[grid]=np.array([70,73,79])/255*(0.85+.3*n1[grid,None]); rough[grid]=.5; metal[grid]=.55
r=np.clip((spots[grid]-.6)*4,0,1); col[grid]=col[grid]*(1-r[:,None]*.6)+np.array([105,68,44])/255*r[:,None]*.6
# subtle shadow inside the frame edges (fake AO)
ao[gl]=1-.25*np.clip(1-np.minimum(np.minimum(fx[gl],1-fx[gl]),np.minimum(fy[gl],1-fy[gl]))*12,0,1)
col*=ao[:,None]
img=np.zeros((S,S,3),np.float32); img[idx]=np.clip(col,0,1)
orm=np.zeros((S,S,3),np.float32); orm[idx]=np.stack([ao,rough,metal],1)
img=dilate(img,valid,8); orm=dilate(orm,valid,8)
Image.fromarray((img*255).astype(np.uint8)).save('bld_bc.jpg',quality=86)
Image.fromarray((orm*255).astype(np.uint8)).resize((1024,1024)).save('bld_orm.jpg',quality=85)
print('done',time.time()-t0)
