import numpy as np
from PIL import Image
from load import load
V,T,N,objs=load()

def tris_of(names, uvmap=None):
    """returns per-triangle arrays: P (n,3,3), Nn (n,3) face normal, UV (n,3,2), fid (n,) face index, plus face info list"""
    P=[];UV=[];FID=[];faces=[]
    for name in names:
        for f in objs[name]:
            pts=V[[k[0] for k in f]]; uvs=T[[k[1] for k in f]]
            if uvmap: uvs=uvmap(name,uvs)
            fi=len(faces); faces.append((name,pts))
            for i in range(1,len(f)-1):
                P.append(pts[[0,i,i+1]]); UV.append(uvs[[0,i,i+1]]); FID.append(fi)
    return np.array(P),np.array(UV),np.array(FID),faces

def raster(P,UV,FID,S):
    pos=np.zeros((S,S,3),np.float32); fid=-np.ones((S,S),np.int32)
    for t in range(len(P)):
        uv=UV[t]*[S,S]; uv[:,1]=S-uv[:,1]
        x0,y0=np.floor(uv.min(0)).astype(int); x1,y1=np.ceil(uv.max(0)).astype(int)
        x0=max(x0,0);y0=max(y0,0);x1=min(x1,S-1);y1=min(y1,S-1)
        if x1<x0 or y1<y0: continue
        xs,ys=np.meshgrid(np.arange(x0,x1+1)+.5,np.arange(y0,y1+1)+.5)
        a,b,c=uv; d=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1])
        if abs(d)<1e-12: continue
        l1=((b[1]-c[1])*(xs-c[0])+(c[0]-b[0])*(ys-c[1]))/d; l2=((c[1]-a[1])*(xs-c[0])+(a[0]-c[0])*(ys-c[1]))/d; l3=1-l1-l2
        e=-0.6/ max(abs(d),1e-9)**.5  # small tolerance so thin islands get pixels
        m=(l1>=e)&(l2>=e)&(l3>=e)
        if not m.any(): continue
        w=np.stack([l1[m],l2[m],l3[m]],1)
        yy=(ys[m]-.5).astype(int); xx=(xs[m]-.5).astype(int)
        pos[yy,xx]=w@P[t]; fid[yy,xx]=FID[t]
    return pos,fid

def dilate(img,valid,it=6):
    img=img.copy(); valid=valid.copy()
    for _ in range(it):
        nv=valid.copy()
        for dy,dx in ((0,1),(0,-1),(1,0),(-1,0)):
            sh=np.roll(np.roll(img,dy,0),dx,1); sv=np.roll(np.roll(valid,dy,0),dx,1)
            m=sv&~nv; img[m]=sh[m]; nv|=m
        valid=nv
    return img

def hashn(ix,iy,iz,seed=0):
    h=(ix*374761393+iy*668265263+iz*2147483647+seed*144665)&0xffffffff
    h=((h^(h>>13))*1274126177)&0xffffffff
    return ((h^(h>>16))&0xffff)/65535.0
def vnoise(p,scale,seed=0):
    q=p*scale; i=np.floor(q).astype(np.int64); f=q-i; f=f*f*(3-2*f)
    out=0
    for dx in (0,1):
        for dy in (0,1):
            for dz in (0,1):
                w=(f[...,0] if dx else 1-f[...,0])*(f[...,1] if dy else 1-f[...,1])*(f[...,2] if dz else 1-f[...,2])
                out=out+w*hashn(i[...,0]+dx,i[...,1]+dy,i[...,2]+dz,seed)
    return out
def fbm(p,scale,oct=4,seed=0):
    a=.5;s=scale;t=0;n=0
    for o in range(oct): t=t+a*vnoise(p,s,seed+o); n+=a; a*=.5; s*=2.1
    return t/n
