import re,sys,os
root,nm,out=sys.argv[1:4]
s=open(os.path.join(root,'index.html'),encoding='utf-8').read()
def inl(code):
    assert '</script' not in code.lower()
    return '<script>'+code+'</script>'
def rep_asset(m):
    return inl(open(os.path.join(root,m.group(1)),encoding='utf-8').read())
s,n1=re.subn(r'<script src="(assets/[^"]+)"></script>',rep_asset,s)
def rep_cdn(m):
    return inl(open(os.path.join(nm,m.group(1)),encoding='utf-8').read())
s,n2=re.subn(r'<script src="https://cdn\.jsdelivr\.net/npm/three@0\.147\.0/([^"]+)"[^>]*></script>',rep_cdn,s)
s,n3=re.subn(r'<link rel="(preconnect|preload)"[^>]*cdn\.jsdelivr\.net[^>]*>','',s)
open(out,'w',encoding='utf-8').write(s)
print(n1,n2,n3,len(s))
