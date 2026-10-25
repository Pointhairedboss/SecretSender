var BitBopMlKem=(()=>{var ze=Object.create;var E=Object.defineProperty;var Oe=Object.getOwnPropertyDescriptor;var je=Object.getOwnPropertyNames;var Ce=Object.getPrototypeOf,Te=Object.prototype.hasOwnProperty;var Le=(t=>typeof require<"u"?require:typeof Proxy<"u"?new Proxy(t,{get:(e,i)=>(typeof require<"u"?require:e)[i]}):t)(function(t){if(typeof require<"u")return require.apply(this,arguments);throw Error('Dynamic require of "'+t+'" is not supported')});var Ie=(t,e)=>{for(var i in e)E(t,i,{get:e[i],enumerable:!0})},oe=(t,e,i,n)=>{if(e&&typeof e=="object"||typeof e=="function")for(let r of je(e))!Te.call(t,r)&&r!==i&&E(t,r,{get:()=>e[r],enumerable:!(n=Oe(e,r))||n.enumerable});return t};var Fe=(t,e,i)=>(i=t!=null?ze(Ce(t)):{},oe(e||!t||!t.__esModule?E(i,"default",{value:t,enumerable:!0}):i,t)),Ee=t=>oe(E({},"__esModule",{value:!0}),t);var at={};Ie(at,{MlKem1024:()=>$,MlKem512:()=>X,MlKem768:()=>R,MlKemError:()=>p,createMlKem1024:()=>Ke,createMlKem512:()=>Ae,createMlKem768:()=>Ue,sha3_256:()=>Y,sha3_512:()=>B,shake128:()=>ee,shake256:()=>M});var p=class extends Error{constructor(e){let i;e instanceof Error?i=e.message:typeof e=="string"?i=e:i="",super(i),this.name=this.constructor.name}};var Q=[2285,2571,2970,1812,1493,1422,287,202,3158,622,1577,182,962,2127,1855,1468,573,2004,264,383,2500,1458,1727,3199,2648,1017,732,608,1787,411,3124,1758,1223,652,2777,1015,2036,1491,3047,1785,516,3321,3009,2663,1711,2167,126,1469,2476,3239,3058,830,107,1908,3082,2378,2931,961,1821,2604,448,2264,677,2054,2226,430,555,843,2078,871,1550,105,422,587,177,3094,3038,2869,1574,1653,3083,778,1159,3182,2552,1483,2727,1119,1739,644,2457,349,418,329,3173,3254,817,1097,603,610,1322,2044,1864,384,2114,3193,1218,1994,2455,220,2142,1670,2144,1799,2051,794,1819,2475,2459,478,3221,3021,996,991,958,1869,1522,1628],D=[1701,1807,1460,2371,2338,2333,308,108,2851,870,854,1510,2535,1278,1530,1185,1659,1187,3109,874,1335,2111,136,1215,2945,1465,1285,2007,2719,2726,2232,2512,75,156,3e3,2911,2980,872,2685,1590,2210,602,1846,777,147,2170,2551,246,1676,1755,460,291,235,3152,2742,2907,3224,1779,2458,1251,2486,2774,2899,1103,1275,2652,1065,2881,725,1508,2368,398,951,247,1421,3222,2499,271,90,853,1860,3203,1162,1618,666,320,8,2813,1544,282,1838,1293,2314,552,2677,2106,1571,205,2918,1542,2721,2597,2312,681,130,1602,1871,829,2946,3065,1325,2756,1861,1474,1202,2367,3147,1752,2707,171,3127,3042,1907,1836,1517,359,758,1441];var H=0xffffffffn,se=32n;function He(t,e=!1){return e?{h:Number(t&H),l:Number(t>>se&H)}:{h:Number(t>>se&H)|0,l:Number(t&H)|0}}function ue(t,e=!1){let i=t.length,n=new Uint32Array(i),r=new Uint32Array(i);for(let o=0;o<i;o++){let{h:s,l:u}=He(t[o],e);[n[o],r[o]]=[s,u]}return[n,r]}var y=(t,e,i)=>t<<i|e>>>32-i,w=(t,e,i)=>e<<i|t>>>32-i,x=(t,e,i)=>e<<i-32|t>>>64-i,k=(t,e,i)=>t<<i-32|e>>>64-i;function Ve(t){return t instanceof Uint8Array||ArrayBuffer.isView(t)&&t.constructor.name==="Uint8Array"}function Z(t,e=""){if(!Number.isSafeInteger(t)||t<0){let i=e&&`"${e}" `;throw new Error(`${i}expected integer >0, got ${t}`)}}function V(t,e,i=""){let n=Ve(t),r=t?.length,o=e!==void 0;if(!n||o&&r!==e){let s=i&&`"${i}" `,u=o?` of length ${e}`:"",a=n?`length=${r}`:`type=${typeof t}`;throw new Error(s+"expected Uint8Array"+u+", got "+a)}return t}function q(t,e=!0){if(t.destroyed)throw new Error("Hash instance has been destroyed");if(e&&t.finished)throw new Error("Hash#digest() has already been called")}function ae(t,e){V(t,void 0,"digestInto() output");let i=e.outputLen;if(t.length<i)throw new Error('"digestInto() output" expected to be of length >='+i)}function ce(t){return new Uint32Array(t.buffer,t.byteOffset,Math.floor(t.byteLength/4))}function le(...t){for(let e=0;e<t.length;e++)t[e].fill(0)}var Me=new Uint8Array(new Uint32Array([287454020]).buffer)[0]===68;function Ne(t){return t<<24&4278190080|t<<8&16711680|t>>>8&65280|t>>>24&255}function Ge(t){for(let e=0;e<t.length;e++)t[e]=Ne(t[e]);return t}var J=Me?t=>t:Ge;function W(t,e={}){let i=(r,o)=>t(o).update(r).digest(),n=t(void 0);return i.outputLen=n.outputLen,i.blockLen=n.blockLen,i.create=r=>t(r),Object.assign(i,e),Object.freeze(i)}var j=t=>({oid:Uint8Array.from([6,9,96,134,72,1,101,3,4,2,t])});var Xe=0n,C=1n,Re=2n,$e=7n,Qe=256n,De=0x71n,Ze=[],qe=[],fe=[];for(let t=0,e=C,i=1,n=0;t<24;t++){[i,n]=[n,(2*i+3*n)%5],Ze.push(2*(5*n+i)),qe.push((t+1)*(t+2)/2%64);let r=Xe;for(let o=0;o<7;o++)e=(e<<C^(e>>$e)*De)%Qe,e&Re&&(r^=C<<(C<<BigInt(o))-C);fe.push(r)}var he=ue(fe,!0),Je=he[0],We=he[1],T=(t,e,i)=>i>32?x(t,e,i):y(t,e,i),L=(t,e,i)=>i>32?k(t,e,i):w(t,e,i);function Ye(t,e=24,i){i||(i=new Uint32Array(10));for(let n=24-e;n<24;n++){for(let a=0;a<10;a++)i[a]=t[a]^t[a+10]^t[a+20]^t[a+30]^t[a+40];{let a=T(i[2],i[3],1)^i[8],f=L(i[2],i[3],1)^i[9];t[0]^=a,t[1]^=f,t[10]^=a,t[11]^=f,t[20]^=a,t[21]^=f,t[30]^=a,t[31]^=f,t[40]^=a,t[41]^=f}{let a=T(i[4],i[5],1)^i[0],f=L(i[4],i[5],1)^i[1];t[2]^=a,t[3]^=f,t[12]^=a,t[13]^=f,t[22]^=a,t[23]^=f,t[32]^=a,t[33]^=f,t[42]^=a,t[43]^=f}{let a=T(i[6],i[7],1)^i[2],f=L(i[6],i[7],1)^i[3];t[4]^=a,t[5]^=f,t[14]^=a,t[15]^=f,t[24]^=a,t[25]^=f,t[34]^=a,t[35]^=f,t[44]^=a,t[45]^=f}{let a=T(i[8],i[9],1)^i[4],f=L(i[8],i[9],1)^i[5];t[6]^=a,t[7]^=f,t[16]^=a,t[17]^=f,t[26]^=a,t[27]^=f,t[36]^=a,t[37]^=f,t[46]^=a,t[47]^=f}{let a=T(i[0],i[1],1)^i[6],f=L(i[0],i[1],1)^i[7];t[8]^=a,t[9]^=f,t[18]^=a,t[19]^=f,t[28]^=a,t[29]^=f,t[38]^=a,t[39]^=f,t[48]^=a,t[49]^=f}let r=t[2],o=t[3],s,u;s=y(r,o,1),u=w(r,o,1),r=t[20],o=t[21],t[20]=s,t[21]=u,s=y(r,o,3),u=w(r,o,3),r=t[14],o=t[15],t[14]=s,t[15]=u,s=y(r,o,6),u=w(r,o,6),r=t[22],o=t[23],t[22]=s,t[23]=u,s=y(r,o,10),u=w(r,o,10),r=t[34],o=t[35],t[34]=s,t[35]=u,s=y(r,o,15),u=w(r,o,15),r=t[36],o=t[37],t[36]=s,t[37]=u,s=y(r,o,21),u=w(r,o,21),r=t[6],o=t[7],t[6]=s,t[7]=u,s=y(r,o,28),u=w(r,o,28),r=t[10],o=t[11],t[10]=s,t[11]=u,s=x(r,o,36),u=k(r,o,36),r=t[32],o=t[33],t[32]=s,t[33]=u,s=x(r,o,45),u=k(r,o,45),r=t[16],o=t[17],t[16]=s,t[17]=u,s=x(r,o,55),u=k(r,o,55),r=t[42],o=t[43],t[42]=s,t[43]=u,s=y(r,o,2),u=w(r,o,2),r=t[48],o=t[49],t[48]=s,t[49]=u,s=y(r,o,14),u=w(r,o,14),r=t[8],o=t[9],t[8]=s,t[9]=u,s=y(r,o,27),u=w(r,o,27),r=t[30],o=t[31],t[30]=s,t[31]=u,s=x(r,o,41),u=k(r,o,41),r=t[46],o=t[47],t[46]=s,t[47]=u,s=x(r,o,56),u=k(r,o,56),r=t[38],o=t[39],t[38]=s,t[39]=u,s=y(r,o,8),u=w(r,o,8),r=t[26],o=t[27],t[26]=s,t[27]=u,s=y(r,o,25),u=w(r,o,25),r=t[24],o=t[25],t[24]=s,t[25]=u,s=x(r,o,43),u=k(r,o,43),r=t[4],o=t[5],t[4]=s,t[5]=u,s=x(r,o,62),u=k(r,o,62),r=t[40],o=t[41],t[40]=s,t[41]=u,s=y(r,o,18),u=w(r,o,18),r=t[28],o=t[29],t[28]=s,t[29]=u,s=x(r,o,39),u=k(r,o,39),r=t[44],o=t[45],t[44]=s,t[45]=u,s=x(r,o,61),u=k(r,o,61),r=t[18],o=t[19],t[18]=s,t[19]=u,s=y(r,o,20),u=w(r,o,20),r=t[12],o=t[13],t[12]=s,t[13]=u,s=x(r,o,44),u=k(r,o,44),t[2]=s,t[3]=u;for(let a=0;a<50;a+=10)i[0]=t[a],i[1]=t[a+1],i[2]=t[a+2],i[3]=t[a+3],i[4]=t[a+4],i[5]=t[a+5],i[6]=t[a+6],i[7]=t[a+7],i[8]=t[a+8],i[9]=t[a+9],t[a+0]^=~i[2]&i[4],t[a+1]^=~i[3]&i[5],t[a+2]^=~i[4]&i[6],t[a+3]^=~i[5]&i[7],t[a+4]^=~i[6]&i[8],t[a+5]^=~i[7]&i[9],t[a+6]^=~i[8]&i[0],t[a+7]^=~i[9]&i[1],t[a+8]^=~i[0]&i[2],t[a+9]^=~i[1]&i[3];t[0]^=Je[n],t[1]^=We[n]}}var P=class t{constructor(e,i,n,r=!1,o=24){if(Object.defineProperty(this,"state",{enumerable:!0,configurable:!0,writable:!0,value:void 0}),Object.defineProperty(this,"pos",{enumerable:!0,configurable:!0,writable:!0,value:0}),Object.defineProperty(this,"posOut",{enumerable:!0,configurable:!0,writable:!0,value:0}),Object.defineProperty(this,"finished",{enumerable:!0,configurable:!0,writable:!0,value:!1}),Object.defineProperty(this,"state32",{enumerable:!0,configurable:!0,writable:!0,value:void 0}),Object.defineProperty(this,"destroyed",{enumerable:!0,configurable:!0,writable:!0,value:!1}),Object.defineProperty(this,"_B",{enumerable:!0,configurable:!0,writable:!0,value:new Uint32Array(10)}),Object.defineProperty(this,"blockLen",{enumerable:!0,configurable:!0,writable:!0,value:void 0}),Object.defineProperty(this,"suffix",{enumerable:!0,configurable:!0,writable:!0,value:void 0}),Object.defineProperty(this,"outputLen",{enumerable:!0,configurable:!0,writable:!0,value:void 0}),Object.defineProperty(this,"enableXOF",{enumerable:!0,configurable:!0,writable:!0,value:!1}),Object.defineProperty(this,"rounds",{enumerable:!0,configurable:!0,writable:!0,value:void 0}),this.blockLen=e,this.suffix=i,this.outputLen=n,this.enableXOF=r,this.rounds=o,Z(n,"outputLen"),!(0<e&&e<200))throw new Error("only keccak-f1600 function is supported");this.state=new Uint8Array(200),this.state32=ce(this.state)}clone(){return this._cloneInto()}reset(){this.state.fill(0),this.pos=0,this.posOut=0,this.finished=!1,this.destroyed=!1}keccak(){J(this.state32),Ye(this.state32,this.rounds,this._B),J(this.state32),this.posOut=0,this.pos=0}update(e){return q(this),V(e),this.updateUnsafe(e)}updateUnsafe(e){let{blockLen:i,state:n}=this,r=e.length;for(let o=0;o<r;){let s=Math.min(i-this.pos,r-o);for(let u=0;u<s;u++)n[this.pos++]^=e[o++];this.pos===i&&this.keccak()}return this}finish(){if(this.finished)return;this.finished=!0;let{state:e,suffix:i,pos:n,blockLen:r}=this;e[n]^=i,i&128&&n===r-1&&this.keccak(),e[r-1]^=128,this.keccak()}writeInto(e){return q(this,!1),V(e),this.writeIntoUnsafe(e)}writeIntoUnsafe(e){this.finish();let i=this.state,{blockLen:n}=this;for(let r=0,o=e.length;r<o;){this.posOut>=n&&this.keccak();let s=Math.min(n-this.posOut,o-r);e.set(i.subarray(this.posOut,this.posOut+s),r),this.posOut+=s,r+=s}return e}xofInto(e){if(!this.enableXOF)throw new Error("XOF is not possible for this instance");return this.writeInto(e)}xof(e){return Z(e),this.xofInto(new Uint8Array(e))}digestInto(e){if(ae(e,this),this.finished)throw new Error("digest() was already called");return this.writeInto(e),this.destroy(),e}digest(){return this.digestInto(new Uint8Array(this.outputLen))}destroy(){this.destroyed=!0,le(this.state)}_cloneInto(e){let{blockLen:i,suffix:n,outputLen:r,rounds:o,enableXOF:s}=this;return e||=new t(i,n,r,s,o),e.state32.set(this.state32),e.pos=this.pos,e.posOut=this.posOut,e.finished=this.finished,e.rounds=o,e.suffix=n,e.outputLen=r,e.enableXOF=s,e.destroyed=this.destroyed,e}},pe=(t,e,i,n={})=>W(()=>new P(e,t,i),n),Y=pe(6,136,32,j(8)),B=pe(6,72,64,j(10));var _e=(t,e,i,n={})=>W((r={})=>new P(e,t,r.dkLen===void 0?i:r.dkLen,!0),n),ee=_e(31,168,16,j(11)),M=_e(31,136,32,j(12));var Be={},de=et(globalThis,Be);function et(t,e){return new Proxy(t,{get(i,n,r){return n in e?e[n]:t[n]},set(i,n,r){return n in e&&delete e[n],t[n]=r,!0},deleteProperty(i,n){let r=!1;return n in e&&(delete e[n],r=!0),n in t&&(delete t[n],r=!0),r},ownKeys(i){let n=Reflect.ownKeys(t),r=Reflect.ownKeys(e),o=new Set(r);return[...n.filter(s=>!o.has(s)),...r]},defineProperty(i,n,r){return n in e&&delete e[n],Reflect.defineProperty(t,n,r),!0},getOwnPropertyDescriptor(i,n){return n in e?Reflect.getOwnPropertyDescriptor(e,n):Reflect.getOwnPropertyDescriptor(t,n)},has(i,n){return n in e||n in t}})}function _(t){return t&255}function m(t){return t<<16>>16}function l(t){return t&65535}function U(t){return t>>>0}function be(t,e){if(t.length!=e.length)return 0;let i=0;for(let r=0;r<t.length;r++)i|=t[r]^e[r];let n=~i&255;return n&=n>>4,n&=n>>2,n&=n>>1,n&1}function ye(t,e){if(t.length!=e.length)return!1;for(let i=0;i<t.length;i++)if(t[i]!==e[i])return!1;return!0}async function we(){if(typeof de<"u"&&globalThis.crypto!==void 0)return globalThis.crypto;try{let{webcrypto:t}=await import("crypto");return t}catch{throw new Error("failed to load Crypto")}}function me(t,e=0){return t[e]|t[e+1]<<8|t[e+2]<<16}function ge(t,e=0){return(t[e]|t[e+1]<<8|t[e+2]<<16|t[e+3]<<24)>>>0}var S=class{constructor(){Object.defineProperty(this,"_api",{enumerable:!0,configurable:!0,writable:!0,value:void 0}),Object.defineProperty(this,"_k",{enumerable:!0,configurable:!0,writable:!0,value:0}),Object.defineProperty(this,"_du",{enumerable:!0,configurable:!0,writable:!0,value:0}),Object.defineProperty(this,"_dv",{enumerable:!0,configurable:!0,writable:!0,value:0}),Object.defineProperty(this,"_eta1",{enumerable:!0,configurable:!0,writable:!0,value:0}),Object.defineProperty(this,"_eta2",{enumerable:!0,configurable:!0,writable:!0,value:0}),Object.defineProperty(this,"_skSize",{enumerable:!0,configurable:!0,writable:!0,value:0}),Object.defineProperty(this,"_pkSize",{enumerable:!0,configurable:!0,writable:!0,value:0}),Object.defineProperty(this,"_compressedUSize",{enumerable:!0,configurable:!0,writable:!0,value:0}),Object.defineProperty(this,"_compressedVSize",{enumerable:!0,configurable:!0,writable:!0,value:0}),Object.defineProperty(this,"_poolG",{enumerable:!0,configurable:!0,writable:!0,value:void 0}),Object.defineProperty(this,"_poolH",{enumerable:!0,configurable:!0,writable:!0,value:void 0}),Object.defineProperty(this,"_poolKdf",{enumerable:!0,configurable:!0,writable:!0,value:void 0}),Object.defineProperty(this,"_poolXof",{enumerable:!0,configurable:!0,writable:!0,value:void 0}),Object.defineProperty(this,"_poolPrf1",{enumerable:!0,configurable:!0,writable:!0,value:void 0}),Object.defineProperty(this,"_poolPrf2",{enumerable:!0,configurable:!0,writable:!0,value:void 0}),Object.defineProperty(this,"_bufG",{enumerable:!0,configurable:!0,writable:!0,value:new Uint8Array(64)}),Object.defineProperty(this,"_bufH",{enumerable:!0,configurable:!0,writable:!0,value:new Uint8Array(32)}),Object.defineProperty(this,"_bufKdf",{enumerable:!0,configurable:!0,writable:!0,value:new Uint8Array(32)}),Object.defineProperty(this,"_bufXof",{enumerable:!0,configurable:!0,writable:!0,value:new Uint8Array(672)}),Object.defineProperty(this,"_bufPrf1",{enumerable:!0,configurable:!0,writable:!0,value:void 0}),Object.defineProperty(this,"_bufPrf2",{enumerable:!0,configurable:!0,writable:!0,value:void 0}),Object.defineProperty(this,"_nonceBuf",{enumerable:!0,configurable:!0,writable:!0,value:new Uint8Array(1)}),Object.defineProperty(this,"_xofSeed",{enumerable:!0,configurable:!0,writable:!0,value:new Uint8Array(34)}),Object.defineProperty(this,"_kBuf",{enumerable:!0,configurable:!0,writable:!0,value:void 0}),Object.defineProperty(this,"_matrixA",{enumerable:!0,configurable:!0,writable:!0,value:void 0}),Object.defineProperty(this,"_noiseVecs",{enumerable:!0,configurable:!0,writable:!0,value:void 0}),Object.defineProperty(this,"_polyVec",{enumerable:!0,configurable:!0,writable:!0,value:void 0}),Object.defineProperty(this,"_bufPkCheck",{enumerable:!0,configurable:!0,writable:!0,value:void 0}),Object.defineProperty(this,"_bufCt",{enumerable:!0,configurable:!0,writable:!0,value:void 0})}_initPool(){this._poolG=new P(72,6,64),this._poolH=new P(136,6,32),this._poolKdf=new P(136,31,32,!0),this._poolXof=new P(168,31,672,!0);let e=this._eta1*256/4;this._poolPrf1=new P(136,31,e,!0),this._bufPrf1=new Uint8Array(e);let i=this._eta2*256/4;this._poolPrf2=new P(136,31,i,!0),this._bufPrf2=new Uint8Array(i),this._kBuf=new Uint8Array([this._k]),this._matrixA=new Array(this._k);for(let r=0;r<this._k;r++){this._matrixA[r]=new Array(this._k);for(let o=0;o<this._k;o++)this._matrixA[r][o]=new Int16Array(256)}let n=2*this._k+1;this._noiseVecs=new Array(n);for(let r=0;r<n;r++)this._noiseVecs[r]=new Int16Array(256);this._polyVec=new Array(this._k);for(let r=0;r<this._k;r++)this._polyVec[r]=new Int16Array(256);this._bufPkCheck=new Uint8Array(384*this._k),this._bufCt=new Uint8Array(this._compressedUSize+this._compressedVSize)}_zeroPool(){this._bufG.fill(0),this._bufH.fill(0),this._bufKdf.fill(0),this._bufXof.fill(0),this._bufPrf1.fill(0),this._bufPrf2.fill(0),this._nonceBuf[0]=0,this._xofSeed.fill(0);for(let e=0;e<this._k;e++)for(let i=0;i<this._k;i++)this._matrixA[e][i].fill(0);for(let e=0;e<this._noiseVecs.length;e++)this._noiseVecs[e].fill(0);for(let e=0;e<this._k;e++)this._polyVec[e].fill(0);this._bufPkCheck.fill(0),this._bufCt.fill(0),this._poolG.reset(),this._poolH.reset(),this._poolKdf.reset(),this._poolXof.reset(),this._poolPrf1.reset(),this._poolPrf2.reset()}_polyToBytes(e,i,n){let r,o;for(let s=0;s<256/2;s++)r=n[2*s]-3329,r+=r>>31&3329,o=n[2*s+1]-3329,o+=o>>31&3329,e[i+3*s+0]=_(r),e[i+3*s+1]=_(r>>8)|_(o<<4),e[i+3*s+2]=_(o>>4)}_polyFromBytes(e,i,n){for(let r=0;r<256/2;r++)e[2*r]=m((l(i[n+3*r+0])>>0|l(i[n+3*r+1])<<8)&4095),e[2*r+1]=m((l(i[n+3*r+1])>>4|l(i[n+3*r+2])<<4)&4095)}_g(e,i){return this._poolG.reset(),this._poolG.updateUnsafe(e),i!==void 0&&this._poolG.updateUnsafe(i),this._poolG.writeIntoUnsafe(this._bufG),[this._bufG.subarray(0,32),this._bufG.subarray(32,64)]}_h(e){return this._poolH.reset(),this._poolH.updateUnsafe(e).writeIntoUnsafe(this._bufH),this._bufH}_kdf(e,i){return this._poolKdf.reset(),this._poolKdf.updateUnsafe(e),i!==void 0&&this._poolKdf.updateUnsafe(i),this._poolKdf.writeIntoUnsafe(this._bufKdf),this._bufKdf}_xof(e){return this._poolXof.reset(),this._poolXof.updateUnsafe(e).writeIntoUnsafe(this._bufXof),this._bufXof}_prf1(e,i){return this._nonceBuf[0]=i,this._poolPrf1.reset(),this._poolPrf1.updateUnsafe(e).updateUnsafe(this._nonceBuf).writeIntoUnsafe(this._bufPrf1),this._bufPrf1}_prf2(e,i){return this._nonceBuf[0]=i,this._poolPrf2.reset(),this._poolPrf2.updateUnsafe(e).updateUnsafe(this._nonceBuf).writeIntoUnsafe(this._bufPrf2),this._bufPrf2}_generateKeyPairCore(){try{let e=new Uint8Array(64);return this._api.getRandomValues(e),this._deriveKeyPair(e)}finally{this._zeroPool()}}_deriveKeyPairCore(e){try{if(e.byteLength!==64)throw new Error("seed must be 64 bytes in length");return this._deriveKeyPair(e)}finally{this._zeroPool()}}_encapCore(e,i){try{if(e.length!==384*this._k+32)throw new Error("invalid encapsulation key");let n=this._getSeed(i),[r,o]=this._g(n,this._h(e));return this._encap(e,n,o),[this._bufCt.slice(),r.slice()]}finally{this._zeroPool()}}_decapCore(e,i){try{if(e.byteLength!==this._compressedUSize+this._compressedVSize)throw new Error("Invalid ct size");if(i.length!==768*this._k+96)throw new Error("Invalid decapsulation key");let n=i.subarray(0,this._skSize),r=i.subarray(this._skSize,this._skSize+this._pkSize),o=i.subarray(this._skSize+this._pkSize,this._skSize+this._pkSize+32),s=i.subarray(this._skSize+this._pkSize+32,this._skSize+this._pkSize+64),u=this._decap(e,n),[a,f]=this._g(u,o),h=this._kdf(s,e);return this._encap(r,u,f),be(e,this._bufCt)===1?a.slice():h.slice()}finally{this._zeroPool()}}async _setup(){this._api===void 0&&(this._api=await we())}_getSeed(e){if(e==null){let i=new Uint8Array(32);return this._api.getRandomValues(i),i}if(e.byteLength!==32)throw new Error("seed must be 32 bytes in length");return e}_deriveKeyPair(e){let i=e.subarray(0,32),n=e.subarray(32,64),[r,o]=this._deriveCpaKeyPair(i),s=this._h(r),u=new Uint8Array(this._skSize+this._pkSize+64);return u.set(o,0),u.set(r,this._skSize),u.set(s,this._skSize+this._pkSize),u.set(n,this._skSize+this._pkSize+32),[r,u]}_deriveCpaKeyPair(e){let[i,n]=this._g(e,this._kBuf),r=this._sampleMatrix(i,!1),o=this._sampleNoise1(n,0,this._k),s=this._sampleNoise1(n,this._k,this._k);for(let h=0;h<this._k;h++)o[h]=N(o[h]),o[h]=K(o[h]),s[h]=N(s[h]);let u=new Array(this._k);for(let h=0;h<this._k;h++)u[h]=ot(G(r[h],o)),u[h]=I(u[h],s[h]),u[h]=K(u[h]);let a=new Uint8Array(this._pkSize);for(let h=0;h<this._k;h++)this._polyToBytes(a,h*384,u[h]);a.set(i,this._skSize);let f=new Uint8Array(this._skSize);for(let h=0;h<this._k;h++)this._polyToBytes(f,h*384,o[h]);return[a,f]}_encap(e,i,n){let r=this._polyVec,o=this._bufPkCheck;for(let b=0;b<this._k;b++)this._polyFromBytes(r[b],e,b*384),this._polyToBytes(o,b*384,r[b]);if(!ye(e.subarray(0,o.length),o))throw new Error("invalid encapsulation key");let s=e.subarray(this._skSize),u=this._sampleMatrix(s,!0),a=this._sampleNoise1(n,0,this._k),f=this._sampleNoise2(n,this._k,this._k),h=this._sampleNoise2(n,this._k*2,1)[0];for(let b=0;b<this._k;b++)a[b]=N(a[b]),a[b]=K(a[b]);let v=new Array(this._k);for(let b=0;b<this._k;b++)v[b]=G(u[b],a),v[b]=te(v[b]),v[b]=I(v[b],f[b]),v[b]=K(v[b]);let F=it(i),A=G(r,a);return A=te(A),A=I(A,h),A=I(A,F),A=K(A),this._compressU(this._bufCt.subarray(0,this._compressedUSize),v),this._compressV(this._bufCt.subarray(this._compressedUSize),A),this._bufCt}_decap(e,i){let n=this._decompressU(e.subarray(0,this._compressedUSize)),r=this._decompressV(e.subarray(this._compressedUSize)),o=this._polyvecFromBytes(i);for(let u=0;u<this._k;u++)n[u]=N(n[u]);let s=G(o,n);return s=te(s),s=st(r,s),s=K(s),rt(s)}_sampleMatrix(e,i){let n=this._matrixA;this._xofSeed.set(e);for(let r=0,o=0;o<this._k;o++)for(let s=0;s<this._k;s++){i?(this._xofSeed[e.length]=o,this._xofSeed[e.length+1]=s):(this._xofSeed[e.length]=s,this._xofSeed[e.length+1]=o);let u=this._xof(this._xofSeed);for(r=xe(n[o][s],0,u.subarray(0,504),504,256);r<256;){let a=u.subarray(504,672);r+=xe(n[o][s],r,a,168,256-r)}}return n}_sampleNoise1(e,i,n){let r=new Array(n);for(let o=0;o<n;o++)r[o]=this._noiseVecs[i+o],ke(r[o],this._prf1(e,i+o),this._eta1);return r}_sampleNoise2(e,i,n){let r=new Array(n);for(let o=0;o<n;o++)r[o]=this._noiseVecs[i+o],ke(r[o],this._prf2(e,i+o),this._eta2);return r}_polyvecFromBytes(e){let i=this._polyVec;for(let n=0;n<this._k;n++)this._polyFromBytes(i[n],e,n*384);return i}_compressU(e,i){let n=new Array(4);for(let r=0,o=0;o<this._k;o++)for(let s=0;s<256/4;s++){for(let u=0;u<4;u++)n[u]=((i[o][4*s+u]<<10)+3329/2)/3329&1023;e[r++]=_(n[0]>>0),e[r++]=_(n[0]>>8|n[1]<<2),e[r++]=_(n[1]>>6|n[2]<<4),e[r++]=_(n[2]>>4|n[3]<<6),e[r++]=_(n[3]>>2)}return e}_compressV(e,i){let n=new Uint8Array(8);for(let r=0,o=0;o<256/8;o++){for(let s=0;s<8;s++)n[s]=_(((i[8*o+s]<<4)+3329/2)/3329)&15;e[r++]=n[0]|n[1]<<4,e[r++]=n[2]|n[3]<<4,e[r++]=n[4]|n[5]<<4,e[r++]=n[6]|n[7]<<4}return e}_decompressU(e){let i=new Array(this._k);for(let r=0;r<this._k;r++)i[r]=new Int16Array(256);let n=new Array(4);for(let r=0,o=0;o<this._k;o++)for(let s=0;s<256/4;s++){n[0]=l(e[r+0])>>0|l(e[r+1])<<8,n[1]=l(e[r+1])>>2|l(e[r+2])<<6,n[2]=l(e[r+2])>>4|l(e[r+3])<<4,n[3]=l(e[r+3])>>6|l(e[r+4])<<2,r=r+5;for(let u=0;u<4;u++)i[o][4*s+u]=m((n[u]&1023)*3329+512>>10)}return i}_decompressV(e){let i=new Int16Array(256);for(let n=0,r=0;r<256/2;r++,n++)i[2*r+0]=m((e[n]&15)*3329+8>>4),i[2*r+1]=m((e[n]>>4)*3329+8>>4);return i}};function rt(t){let e=new Uint8Array(32),i,n;for(let r=0;r<256/8;r++)for(let o=0;o<8;o++)n=t[8*r+o]-3329,n+=n>>31&3329,i=((l(n)<<1)+l(3329/2))/l(3329)&1,e[r]|=_(i<<o);return e}function it(t){let e=new Int16Array(256),i;for(let n=0;n<256/8;n++)for(let r=0;r<8;r++)i=-1*m(t[n]>>r&1),e[8*n+r]=i&m(3330/2);return e}function xe(t,e,i,n,r){let o=0,s,u;for(let a=0;o<r&&a+3<=n;)s=(l(i[a]>>0)|l(i[a+1])<<8)&4095,u=(l(i[a+1]>>4)|l(i[a+2])<<4)&4095,a=a+3,s<3329&&(t[e+o]=s,o=o+1),o<r&&u<3329&&(t[e+o]=u,o=o+1);return o}function ke(t,e,i){let n,r,o,s;for(let u=0;u<256/8;u++){n=ge(e,4*u),r=n&1431655765,r=r+(n>>1&1431655765);for(let a=0;a<8;a++)o=m(r>>4*a+0&3),s=m(r>>4*a+i&3),t[8*u+a]=o-s}}function N(t){for(let e=0,i=1,n=128;n>=2;n>>=1)for(let r=0;r<256;r=e+n){let o=Q[i];for(i=i+1,e=r;e<r+n;e++){let s=g(o,t[e+n]);t[e+n]=t[e]-s,t[e]=t[e]+s}}return t}function g(t,e){let i=t*e,n=Math.imul(i,62209)<<16>>16;return i-n*3329>>16}function K(t){for(let e=0;e<256;e++)t[e]=Se(t[e]);return t}var nt=((1<<24)+3329/2)/3329;function Se(t){let e=nt*t>>24;return e=e*3329,t-e}function ot(t){for(let i=0;i<256;i++){let n=t[i]*1353,r=Math.imul(n,62209)<<16>>16;t[i]=n-r*3329>>16}return t}function G(t,e){let i=Pe(t[0],e[0]),n;for(let r=1;r<t.length;r++)n=Pe(t[r],e[r]),i=I(i,n);return K(i)}function Pe(t,e){for(let i=0;i<256/4;i++){let n=4*i,r=t[n],o=t[n+1],s=t[n+2],u=t[n+3],a=e[n],f=e[n+1],h=e[n+2],v=e[n+3],F=Q[64+i];t[n]=g(g(o,f),F)+g(r,a),t[n+1]=g(r,f)+g(o,a),t[n+2]=g(g(u,v),-F)+g(s,h),t[n+3]=g(s,v)+g(u,h)}return t}function I(t,e){for(let i=0;i<256;i++)t[i]+=e[i];return t}function st(t,e){for(let i=0;i<256;i++)t[i]-=e[i];return t}function te(t){let e=0;for(let i=0,n=2;n<=128;n<<=1)for(let r=0;r<256;r=e+n){let o=D[i];for(i=i+1,e=r;e<r+n;e++){let s=t[e];t[e]=Se(s+t[e+n]),t[e+n]=s-t[e+n],t[e+n]=g(o,t[e+n])}}for(e=0;e<256;e++)t[e]=g(t[e],D[127]);return t}var z=class extends S{constructor(){super(),Object.defineProperty(this,"_k",{enumerable:!0,configurable:!0,writable:!0,value:2}),Object.defineProperty(this,"_du",{enumerable:!0,configurable:!0,writable:!0,value:10}),Object.defineProperty(this,"_dv",{enumerable:!0,configurable:!0,writable:!0,value:4}),Object.defineProperty(this,"_eta1",{enumerable:!0,configurable:!0,writable:!0,value:3}),Object.defineProperty(this,"_eta2",{enumerable:!0,configurable:!0,writable:!0,value:2}),this._skSize=12*this._k*256/8,this._pkSize=this._skSize+32,this._compressedUSize=this._k*this._du*256/8,this._compressedVSize=this._dv*256/8,this._initPool()}_sampleNoise1(e,i,n){let r=new Array(n);for(let o=0;o<n;o++)r[o]=this._noiseVecs[i+o],ut(r[o],this._prf1(e,i+o),this._eta1);return r}};function ut(t,e,i){let n,r,o,s;for(let u=0;u<256/4;u++){n=me(e,3*u),r=n&2396745,r=r+(n>>1&2396745),r=r+(n>>2&2396745);for(let a=0;a<4;a++)o=m(r>>6*a+0&7),s=m(r>>6*a+i&7),t[4*u+a]=o-s}}var X=class extends z{constructor(){super()}async generateKeyPair(){await this._setup();try{return this._generateKeyPairCore()}catch(e){throw new p(e)}}async deriveKeyPair(e){await this._setup();try{return this._deriveKeyPairCore(e)}catch(i){throw new p(i)}}async encap(e,i){await this._setup();try{return this._encapCore(e,i)}catch(n){throw new p(n)}}async decap(e,i){await this._setup();try{return this._decapCore(e,i)}catch(n){throw new p(n)}}};var re=class t extends z{constructor(){super()}generateKeyPair(){try{return this._generateKeyPairCore()}catch(e){throw new p(e)}}deriveKeyPair(e){try{return this._deriveKeyPairCore(e)}catch(i){throw new p(i)}}encap(e,i){try{return this._encapCore(e,i)}catch(n){throw new p(n)}}decap(e,i){try{return this._decapCore(e,i)}catch(n){throw new p(n)}}static async _create(){let e=new t;return await e._setup(),e}};function Ae(){return re._create()}var R=class extends S{constructor(){super(),Object.defineProperty(this,"_k",{enumerable:!0,configurable:!0,writable:!0,value:3}),Object.defineProperty(this,"_du",{enumerable:!0,configurable:!0,writable:!0,value:10}),Object.defineProperty(this,"_dv",{enumerable:!0,configurable:!0,writable:!0,value:4}),Object.defineProperty(this,"_eta1",{enumerable:!0,configurable:!0,writable:!0,value:2}),Object.defineProperty(this,"_eta2",{enumerable:!0,configurable:!0,writable:!0,value:2}),this._skSize=12*this._k*256/8,this._pkSize=this._skSize+32,this._compressedUSize=this._k*this._du*256/8,this._compressedVSize=this._dv*256/8,this._initPool()}async generateKeyPair(){await this._setup();try{return this._generateKeyPairCore()}catch(e){throw new p(e)}}async deriveKeyPair(e){await this._setup();try{return this._deriveKeyPairCore(e)}catch(i){throw new p(i)}}async encap(e,i){await this._setup();try{return this._encapCore(e,i)}catch(n){throw new p(n)}}async decap(e,i){await this._setup();try{return this._decapCore(e,i)}catch(n){throw new p(n)}}};var ie=class t extends S{constructor(){super(),Object.defineProperty(this,"_k",{enumerable:!0,configurable:!0,writable:!0,value:3}),Object.defineProperty(this,"_du",{enumerable:!0,configurable:!0,writable:!0,value:10}),Object.defineProperty(this,"_dv",{enumerable:!0,configurable:!0,writable:!0,value:4}),Object.defineProperty(this,"_eta1",{enumerable:!0,configurable:!0,writable:!0,value:2}),Object.defineProperty(this,"_eta2",{enumerable:!0,configurable:!0,writable:!0,value:2}),this._skSize=12*this._k*256/8,this._pkSize=this._skSize+32,this._compressedUSize=this._k*this._du*256/8,this._compressedVSize=this._dv*256/8,this._initPool()}generateKeyPair(){try{return this._generateKeyPairCore()}catch(e){throw new p(e)}}deriveKeyPair(e){try{return this._deriveKeyPairCore(e)}catch(i){throw new p(i)}}encap(e,i){try{return this._encapCore(e,i)}catch(n){throw new p(n)}}decap(e,i){try{return this._decapCore(e,i)}catch(n){throw new p(n)}}static async _create(){let e=new t;return await e._setup(),e}};function Ue(){return ie._create()}var O=class extends S{constructor(){super(),Object.defineProperty(this,"_k",{enumerable:!0,configurable:!0,writable:!0,value:4}),Object.defineProperty(this,"_du",{enumerable:!0,configurable:!0,writable:!0,value:11}),Object.defineProperty(this,"_dv",{enumerable:!0,configurable:!0,writable:!0,value:5}),Object.defineProperty(this,"_eta1",{enumerable:!0,configurable:!0,writable:!0,value:2}),Object.defineProperty(this,"_eta2",{enumerable:!0,configurable:!0,writable:!0,value:2}),this._skSize=12*this._k*256/8,this._pkSize=this._skSize+32,this._compressedUSize=this._k*this._du*256/8,this._compressedVSize=this._dv*256/8,this._initPool()}_compressU(e,i){let n=new Array(8);for(let r=0,o=0;o<this._k;o++)for(let s=0;s<256/8;s++){for(let u=0;u<8;u++)n[u]=l(((U(i[o][8*s+u])<<11)+U(3329/2))/U(3329)&2047);e[r++]=_(n[0]>>0),e[r++]=_(n[0]>>8|n[1]<<3),e[r++]=_(n[1]>>5|n[2]<<6),e[r++]=_(n[2]>>2),e[r++]=_(n[2]>>10|n[3]<<1),e[r++]=_(n[3]>>7|n[4]<<4),e[r++]=_(n[4]>>4|n[5]<<7),e[r++]=_(n[5]>>1),e[r++]=_(n[5]>>9|n[6]<<2),e[r++]=_(n[6]>>6|n[7]<<5),e[r++]=_(n[7]>>3)}return e}_compressV(e,i){let n=new Uint8Array(8);for(let r=0,o=0;o<256/8;o++){for(let s=0;s<8;s++)n[s]=_(((U(i[8*o+s])<<5)+U(3329/2))/U(3329))&31;e[r++]=_(n[0]>>0|n[1]<<5),e[r++]=_(n[1]>>3|n[2]<<2|n[3]<<7),e[r++]=_(n[3]>>1|n[4]<<4),e[r++]=_(n[4]>>4|n[5]<<1|n[6]<<6),e[r++]=_(n[6]>>2|n[7]<<3)}return e}_decompressU(e){let i=new Array(this._k);for(let r=0;r<this._k;r++)i[r]=new Int16Array(256);let n=new Array(8);for(let r=0,o=0;o<this._k;o++)for(let s=0;s<256/8;s++){n[0]=l(e[r+0])>>0|l(e[r+1])<<8,n[1]=l(e[r+1])>>3|l(e[r+2])<<5,n[2]=l(e[r+2])>>6|l(e[r+3])<<2|l(e[r+4])<<10,n[3]=l(e[r+4])>>1|l(e[r+5])<<7,n[4]=l(e[r+5])>>4|l(e[r+6])<<4,n[5]=l(e[r+6])>>7|l(e[r+7])<<1|l(e[r+8])<<9,n[6]=l(e[r+8])>>2|l(e[r+9])<<6,n[7]=l(e[r+9])>>5|l(e[r+10])<<3,r=r+11;for(let u=0;u<8;u++)i[o][8*s+u]=(n[u]&2047)*3329+1024>>11}return i}_decompressV(e){let i=new Int16Array(256),n=new Array(8);for(let r=0,o=0;o<256/8;o++){n[0]=e[r+0]>>0,n[1]=e[r+0]>>5|e[r+1]<<3,n[2]=e[r+1]>>2,n[3]=e[r+1]>>7|e[r+2]<<1,n[4]=e[r+2]>>4|e[r+3]<<4,n[5]=e[r+3]>>1,n[6]=e[r+3]>>6|e[r+4]<<2,n[7]=e[r+4]>>3,r=r+5;for(let s=0;s<8;s++)i[8*o+s]=m((n[s]&31)*3329+16>>5)}return i}};var $=class extends O{constructor(){super()}async generateKeyPair(){await this._setup();try{return this._generateKeyPairCore()}catch(e){throw new p(e)}}async deriveKeyPair(e){await this._setup();try{return this._deriveKeyPairCore(e)}catch(i){throw new p(i)}}async encap(e,i){await this._setup();try{return this._encapCore(e,i)}catch(n){throw new p(n)}}async decap(e,i){await this._setup();try{return this._decapCore(e,i)}catch(n){throw new p(n)}}};var ne=class t extends O{constructor(){super()}generateKeyPair(){try{return this._generateKeyPairCore()}catch(e){throw new p(e)}}deriveKeyPair(e){try{return this._deriveKeyPairCore(e)}catch(i){throw new p(i)}}encap(e,i){try{return this._encapCore(e,i)}catch(n){throw new p(n)}}decap(e,i){try{return this._decapCore(e,i)}catch(n){throw new p(n)}}static async _create(){let e=new t;return await e._setup(),e}};function Ke(){return ne._create()}return Ee(at);})();
/*! Bundled license information:

mlkem/esm/src/sha3/utils.js:
  (*! noble-hashes - MIT License (c) 2022 Paul Miller (paulmillr.com) *)
*/
;(function() {
  const shake128 = BitBopMlKem.shake128;
  const shake256 = BitBopMlKem.shake256;
  const N = 256;
  const Q = 8380417;
  const ROOT_OF_UNITY = 1753;
  const F = 8347681;
  const D = 13;
  const GAMMA2_1 = Math.floor((Q - 1) / 88) | 0;
  const K = 4, L = 4, GAMMA1 = 1 << 17, GAMMA2 = GAMMA2_1, TAU = 39, ETA = 2, OMEGA = 80;
  const BETA = TAU * ETA;
  const CRH_BYTES = 64, TR_BYTES = 64, C_TILDE_BYTES = 32;

  const mod = (a, modulo = Q) => {
    const r = a % modulo | 0;
    return (r >= 0 ? r | 0 : (modulo + r) | 0) | 0;
  };
  const smod = (a, modulo = Q) => {
    const r = mod(a, modulo) | 0;
    return (r > (modulo >> 1) ? (r - modulo) | 0 : r) | 0;
  };
  const getMask = (bits) => (bits === 32 ? 0xffffffff : ~(-1 << bits) >>> 0);
  const reverseBits = (n, bits) => {
    let rev = 0;
    for (let i = 0; i < bits; i++, n >>>= 1) rev = (rev << 1) | (n & 1);
    return rev >>> 0;
  };
  const nttZetas = new Int32Array(N);
  for (let i = 0; i < N; i++) {
    const b = reverseBits(i, 8);
    nttZetas[i] = Number((BigInt(ROOT_OF_UNITY) ** BigInt(b)) % BigInt(Q)) | 0;
  }

  function nttEncode(values) {
    for (let i = 0, g = 1; i < 8; i++) {
      const s = 8 - i;
      const m = 1 << s;
      const m2 = m >> 1;
      for (let k = 0; k < N; k += m) {
        for (let j = 0, grp = g++; j < m2; j++) {
          const omega = nttZetas[grp];
          const i0 = k + j, i1 = k + j + m2;
          const a = values[i0], b = values[i1];
          const t = mod((b | 0) * (omega | 0));
          values[i0] = mod((a | 0) + (t | 0));
          values[i1] = mod((a | 0) - (t | 0));
        }
      }
    }
    return values;
  }

  function nttDecode(values) {
    for (let i = 0, g = 1; i < 8; i++) {
      const s = i + 1;
      const m = 1 << s;
      const m2 = m >> 1;
      for (let k = 0; k < N; k += m) {
        for (let j = 0, grp = g++; j < m2; j++) {
          const omega = nttZetas[N - grp];
          const i0 = k + j, i1 = k + j + m2;
          const a = values[i0], b = values[i1];
          values[i0] = mod((b | 0) + (a | 0));
          values[i1] = mod(mod((b | 0) - (a | 0)) * (omega | 0));
        }
      }
    }
    for (let i = 0; i < N; i++) values[i] = mod(F * values[i]);
    return values;
  }

  const bitsCoder = (d, compress, verify) => {
    const mask = getMask(d);
    const bytesLen = d * (N / 8);
    return {
      bytesLen,
      encode: (poly) => {
        const r = new Uint8Array(bytesLen);
        for (let i = 0, buf = 0, bufLen = 0, pos = 0; i < poly.length; i++) {
          buf |= (compress(verify(poly[i])) & mask) << bufLen;
          bufLen += d;
          for (; bufLen >= 8; bufLen -= 8, buf >>= 8) r[pos++] = buf & getMask(bufLen);
        }
        return r;
      },
      decode: (bytes) => {
        const r = new Int32Array(N);
        for (let i = 0, buf = 0, bufLen = 0, pos = 0; i < bytes.length; i++) {
          buf |= bytes[i] << bufLen;
          bufLen += 8;
          for (; bufLen >= d; bufLen -= d, buf >>= d) r[pos++] = verify(compress(buf & mask));
        }
        return r;
      }
    };
  };

  const vecCoder = (c, vecLen) => ({
    bytesLen: vecLen * c.bytesLen,
    encode: (u) => {
      const res = new Uint8Array(vecLen * c.bytesLen);
      for (let i = 0, pos = 0; i < u.length; i++) {
        const b = c.encode(u[i]);
        res.set(b, pos);
        pos += b.length;
      }
      return res;
    },
    decode: (a) => {
      const r = [];
      for (let i = 0; i < a.length; i += c.bytesLen) r.push(c.decode(a.subarray(i, i + c.bytesLen)));
      return r;
    }
  });

  const splitCoder = (...lengths) => {
    const getLen = (c) => (typeof c === 'number' ? c : c.bytesLen);
    const bytesLen = lengths.reduce((sum, a) => sum + getLen(a), 0);
    return {
      bytesLen,
      encode: (bufs) => {
        const res = new Uint8Array(bytesLen);
        for (let i = 0, pos = 0; i < lengths.length; i++) {
          const c = lengths[i];
          const l = getLen(c);
          const b = typeof c === 'number' ? bufs[i] : c.encode(bufs[i]);
          res.set(b, pos);
          pos += l;
        }
        return res;
      },
      decode: (buf) => {
        const res = [];
        let cur = buf;
        for (const c of lengths) {
          const l = getLen(c);
          const b = cur.subarray(0, l);
          res.push(typeof c === 'number' ? b : c.decode(b));
          cur = cur.subarray(l);
        }
        return res;
      }
    };
  };

  const id = (n) => n;
  const T1Coder = bitsCoder(10, id, id);
  const ZCoder = bitsCoder(18, (i) => smod(GAMMA1 - i), id);
  const W1Coder = bitsCoder(6, id, id);
  const W1Vec = vecCoder(W1Coder, K);
  const hintCoder = {
    bytesLen: OMEGA + K,
    encode: (h) => {
      const res = new Uint8Array(OMEGA + K);
      for (let i = 0, k = 0; i < K; i++) {
        for (let j = 0; j < N; j++) if (h[i][j] !== 0) res[k++] = j;
        res[OMEGA + i] = k;
      }
      return res;
    },
    decode: (buf) => {
      const h = [];
      let k = 0;
      for (let i = 0; i < K; i++) {
        const hi = new Int32Array(N);
        if (buf[OMEGA + i] < k || buf[OMEGA + i] > OMEGA) return false;
        for (let j = k; j < buf[OMEGA + i]; j++) {
          if (j > k && buf[j] <= buf[j - 1]) return false;
          hi[buf[j]] = 1;
        }
        k = buf[OMEGA + i];
        h.push(hi);
      }
      for (let j = k; j < OMEGA; j++) if (buf[j] !== 0) return false;
      return h;
    }
  };

  const publicCoder = splitCoder(32, vecCoder(T1Coder, K));
  const sigCoder = splitCoder(C_TILDE_BYTES, vecCoder(ZCoder, L), hintCoder);

  const createXofShake = (shake) => (seed, blockLen) => {
    if (!blockLen) blockLen = shake.blockLen;
    const _seed = new Uint8Array(seed.length + 2);
    _seed.set(seed);
    const seedLen = seed.length;
    const buf = new Uint8Array(blockLen);
    let h = shake.create({});
    return {
      get: (x, y) => {
        _seed[seedLen] = x;
        _seed[seedLen + 1] = y;
        h.destroy();
        h = shake.create({}).update(_seed);
        return () => h.xofInto(buf);
      },
      clean: () => h.destroy()
    };
  };
  const XOF128 = createXofShake(shake128);

  function RejNTTPoly(xof) {
    const r = new Int32Array(N);
    for (let j = 0; j < N;) {
      const b = xof();
      for (let i = 0; j < N && i <= b.length - 3; i += 3) {
        const t = (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16)) & 0x7fffff;
        if (t < Q) r[j++] = t;
      }
    }
    return r;
  }

  function SampleInBall(seed) {
    const pre = new Int32Array(N);
    const s = shake256.create({}).update(seed);
    const buf = new Uint8Array(shake256.blockLen);
    s.xofInto(buf);
    const masks = buf.slice(0, 8);
    for (let i = N - TAU, pos = 8, maskPos = 0, maskBit = 0; i < N; i++) {
      let b = i + 1;
      for (; b > i;) {
        b = buf[pos++];
        if (pos < shake256.blockLen) continue;
        s.xofInto(buf);
        pos = 0;
      }
      pre[i] = pre[b];
      pre[b] = 1 - (((masks[maskPos] >> maskBit++) & 1) << 1);
      if (maskBit >= 8) {
        maskPos++;
        maskBit = 0;
      }
    }
    return pre;
  }

  const decompose = (r) => {
    const rPlus = mod(r);
    const r0 = smod(rPlus, 2 * GAMMA2) | 0;
    if (rPlus - r0 === Q - 1) return { r1: 0 | 0, r0: (r0 - 1) | 0 };
    const r1 = Math.floor((rPlus - r0) / (2 * GAMMA2)) | 0;
    return { r1, r0 };
  };

  const UseHint = (h, r) => {
    const m = Math.floor((Q - 1) / (2 * GAMMA2));
    const { r1, r0 } = decompose(r);
    if (h === 1) return r0 > 0 ? mod(r1 + 1, m) | 0 : mod(r1 - 1, m) | 0;
    return r1 | 0;
  };

  const polyChknorm = (p, B) => {
    for (let i = 0; i < N; i++) if (Math.abs(smod(p[i])) >= B) return true;
    return false;
  };

  const MultiplyNTTs = (a, b) => {
    const c = new Int32Array(N);
    for (let i = 0; i < N; i++) c[i] = mod(a[i] * b[i]);
    return c;
  };

  const polyAdd = (a, b) => {
    for (let i = 0; i < N; i++) a[i] = mod(a[i] + b[i]);
    return a;
  };
  const polySub = (a, b) => {
    for (let i = 0; i < N; i++) a[i] = mod(a[i] - b[i]);
    return a;
  };

  function verifyMlDsa44(sig, msg, publicKey, opts) {
    try {
      const ctx = (opts && opts.context) ? opts.context : new Uint8Array(0);
      if (ctx.length > 255) return false;
      const M = new Uint8Array(2 + ctx.length + msg.length);
      M[0] = 0;
      M[1] = ctx.length;
      M.set(ctx, 2);
      M.set(msg, 2 + ctx.length);

      if (!(publicKey instanceof Uint8Array) || publicKey.length !== publicCoder.bytesLen) return false;
      if (!(sig instanceof Uint8Array) || sig.length !== sigCoder.bytesLen) return false;

      const [rho, t1] = publicCoder.decode(publicKey);
      const tr = shake256(publicKey, { dkLen: TR_BYTES });
      const [cTilde, z, h] = sigCoder.decode(sig);
      if (h === false) return false;
      for (let i = 0; i < L; i++) if (polyChknorm(z[i], GAMMA1 - BETA)) return false;

      const mu = shake256.create({ dkLen: CRH_BYTES }).update(tr).update(M).digest();
      const c = nttEncode(SampleInBall(cTilde));
      const zNtt = z.map((p) => nttEncode(p.slice()));
      const wTick1 = [];
      const xof = XOF128(rho);
      for (let i = 0; i < K; i++) {
        const t1Shift = t1[i].slice();
        for (let n = 0; n < N; n++) t1Shift[n] <<= D;
        const ct12d = MultiplyNTTs(nttEncode(t1Shift), c);
        const Az = new Int32Array(N);
        for (let j = 0; j < L; j++) {
          const aij = RejNTTPoly(xof.get(j, i));
          polyAdd(Az, MultiplyNTTs(aij, zNtt[j]));
        }
        const wApprox = nttDecode(polySub(Az, ct12d));
        for (let n = 0; n < N; n++) wApprox[n] = UseHint(h[i][n], wApprox[n]);
        wTick1.push(wApprox);
      }
      xof.clean();
      const c2 = shake256.create({ dkLen: C_TILDE_BYTES }).update(mu).update(W1Vec.encode(wTick1)).digest();
      for (const t of h) {
        let sum = 0;
        for (let n = 0; n < t.length; n++) sum += t[n];
        if (sum > OMEGA) return false;
      }
      for (const t of z) if (polyChknorm(t, GAMMA1 - BETA)) return false;
      if (cTilde.length !== c2.length) return false;
      let diff = 0;
      for (let i = 0; i < cTilde.length; i++) diff |= cTilde[i] ^ c2[i];
      return diff === 0;
    } catch (_) {
      return false;
    }
  }

  const SERVICE_PUBLIC_KEY_MLDSA44_B64 = 'b/PZgJYkdUHwJR0atxQ3Y5T7+rDwduRkNvjWG+rforWt7ZXCneaBl8PMboHL4RXhuRseHUPyK2ojx1ICxsv9e/qTAmDmrgh3r14dEiNURvOwOmnMJ15xfrF1757kCB1yTSFzqFMnWVoIQaiiZ+LgtObgiih2RffwsWgLGGI1RRakvmwPv3WzBjl6pP59JWOlI4HxSxPLhCtrEbhYgjrafPPNHr+BlpjlHa6V0/FXO8O+vsMcQ4bfg8WD4JqLYg6dn8XZnXWCOZwk0MQqd7lZvMJVx6yUdJHbNbekNr2MOahGi5Zi1ooI1HWXX5BBA9LNSC8MLGuPpHlXkJFkm/TLwOtDgUGNBBaPEH6n1xUQ/jhjSqQM39Rh8EuLdRq8Z1SxpRuizgpkvG3DACGZDU3N19Id0O2wS6S506jaHZmGT7IINx2eNm2SGmCp+25XqZ9CX4yk9oHUO/N11J99qYMSlPfjsGZGOmlDXYfwxG2n9FQtQ7FOdtd1pXNUnQkU2NrgRZZYBjRdkwBIWzmY+Tv+oavixSrncN5e6QZOfK+Bth2eAHoKeS8kzQY3ewmW+j4Nsv6Yc97qCCabSqQicGBE9DJl9Chcg0iIoAp4j2KRMqCiTPLUnufcsW28lG3evjDp8ytAKDyOCK5hEg0vPOAEvdCRclPJqmygMLZZYyHJvuNiE5NO16rkbQSICD1Y3ttYro489o2eHTUvX1ecIIxy5Cc0oAnFKl1X/BGZpzp6rifA0zigdV/ZJdpY/xg/N3EykSnrGf6NuLGP/4fvTLregoiKPmcgiS/whBmn3YjxcLsJPUs9xwups31paQdwpl+mOtP4czSuvce9nu4vOqhjZxu9ik9ILTX9Ef2qqW/PDkMjT3jFqRvmm+XHhzYOneaWzeDqSmCsoG17qFyCxAjddjHWc+juy9R/5R7YQ8z0i6Z5BbTiP3BgYZzaEDTD3K6rN9xBMAwSotciQ6a/dvFbUIPcqX6jub8prUoe17wVdAfJ/h8xkdOhwwKvqcyMJ8cOMH4NUOBjZXeb5hHAx0i5We1T/qyrPzipz4qr//mTWaHjcUPTUfHqecm/PNUchIAG6LmOVgYU8HvkH/RvbPZVIEOXWtwHyAV1kAt2XJ6ne6acfXaVrmaeLr+wTxwkKml6Lj5ouTli9ExryZ9PwECw6cH/QOQEHudJtm+SuKUasLk4acLn3pTyX7vqpjyM0vO4hgnTtv8fxpNZ05G13L/iPYw1Dh/GxOhyOWBQRcMGkSYSEEYtD9rfq9myiXaCucNY9CCwIpPO++FE2auu5IkFZUPmzhebfVf5R8F+EY9AvwApb3+i3HItIcMRJ84wcOsNI8Ge1bKSoNl7VWWQmo8gO5jwd04OFIQvbH2zO1RaGJpLAIOLVAYCfdGTGg/ZrFXpX3k6xk//T+vBJlW4DBvXFpMOpXlOt+ain9fYeyYqnxtC1IzLmkj0E1T3g+xNVo++cOSrsidZagfa5DD1QmrZ+c0I90sFc9z0OCznaI/43ijg9hAdj3TzOpS6SnpsgLU2+BMadsuKO1szaPjDd6edHgdcIuheWBHZ++wfBJGfojoGL+Qbsm3KBTPKxW5VqB/MDKctiS4fQRpjPkUjMorVVVuxAfGHk4F2bV723ou2ek3HDFjQrisjzYjYuoO81sUaWQfpBqC6JkDqYcLg1RATvuA2NoYdukbw88mJQbD9Lq7i732xtyBRk2bgXtz3APnSEYWacZneqxT7/Qr8d9dWyQ==';

  const TRUSTED_RELEASE_KEYS = {
    'mldsa44-release-2026-01': SERVICE_PUBLIC_KEY_MLDSA44_B64
  };

  function b64ToBytes(b64) {
    const bin = typeof atob === 'function' ? atob(String(b64).trim()) : Buffer.from(String(b64).trim(), 'base64').toString('binary');
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function hexToBytesLocal(hex) {
    const clean = String(hex).replace(/^mldsa44:/i, '').trim();
    if (clean.length % 2 !== 0) return new Uint8Array(0);
    const out = new Uint8Array(clean.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
    return out;
  }

  function verifyMlDsa44Signature(payloadStrOrBytes, signatureHex, keyId) {
    const resolvedKeyId = keyId || 'mldsa44-release-2026-01';
    const pubB64 = TRUSTED_RELEASE_KEYS[resolvedKeyId];
    if (!pubB64) return false;
    const pubBytes = b64ToBytes(pubB64);
    const sigBytes = hexToBytesLocal(signatureHex);
    const msgBytes = typeof payloadStrOrBytes === 'string' ? new TextEncoder().encode(payloadStrOrBytes) : payloadStrOrBytes;
    return verifyMlDsa44(sigBytes, msgBytes, pubBytes);
  }

  function verifyReceiptSignature(receipt) {
    if (!receipt || typeof receipt !== 'object') return false;
    const ev = receipt.evidence_receipt || (receipt.receipt_version === 2 ? receipt : null);
    if (ev) {
      if (ev.signature_scheme && ev.signature_scheme !== 'ml-dsa-44') return false;
      const keyId = ev.key_id || 'mldsa44-release-2026-01';
      if (!TRUSTED_RELEASE_KEYS[keyId]) return false;
      const evSig = ev.signature;
      if (!evSig) return false;
      const evCopy = Object.assign({}, ev);
      delete evCopy.signature;
      if (!verifyMlDsa44Signature(JSON.stringify(evCopy), evSig, keyId)) return false;
      if (receipt.delivery_version === 2 && receipt.delivery_signature) {
        if (receipt.delivery_signature_scheme && receipt.delivery_signature_scheme !== 'ml-dsa-44') return false;
        const delPayload = JSON.stringify({
          delivery_version: receipt.delivery_version,
          escrow_id: receipt.escrow_id,
          escrow_profile: receipt.escrow_profile,
          claim_id: receipt.claim_id,
          cipher: receipt.cipher,
          sealed_envelope: receipt.sealed_envelope,
          evidence_receipt_signature: ev.signature
        });
        if (!verifyMlDsa44Signature(delPayload, receipt.delivery_signature, keyId)) {
          const delCopy = Object.assign({}, receipt);
          delete delCopy.delivery_signature;
          delete delCopy.signature;
          if (!verifyMlDsa44Signature(JSON.stringify(delCopy), receipt.delivery_signature, keyId)) return false;
        }
      }
      return true;
    }
    if (receipt.signature_b64 && typeof receipt.signature_b64 === 'string') {
      const keyId = receipt.release_key_id || receipt.key_id || 'mldsa44-release-2026-01';
      const pubB64 = TRUSTED_RELEASE_KEYS[keyId];
      if (!pubB64) return false;
      const excluded = new Set(['signature_b64', 'sig_alg', 'signature_scheme', 'sealed_envelope', 'cipher', 'VerifyURL', 'verify_url']);
      const canonicalObj = {};
      for (const k of Object.keys(receipt).sort()) {
        if (!excluded.has(k) && receipt[k] !== undefined) canonicalObj[k] = receipt[k];
      }
      const pubBytes = b64ToBytes(pubB64);
      const sigBytes = b64ToBytes(receipt.signature_b64);
      const msgBytes = new TextEncoder().encode(JSON.stringify(canonicalObj));
      return verifyMlDsa44(sigBytes, msgBytes, pubBytes);
    }
    const sig = receipt.signature || (receipt.attestation && receipt.attestation.signature);
    if (!sig) return false;
    const scheme = receipt.signature_scheme || (receipt.attestation && receipt.attestation.signature_scheme) || 'ml-dsa-44';
    if (scheme !== 'ml-dsa-44') return false;
    const keyId = receipt.key_id || 'mldsa44-release-2026-01';
    if (!TRUSTED_RELEASE_KEYS[keyId]) return false;
    const copy = Object.assign({}, receipt);
    delete copy.signature;
    delete copy.disclosed_entropy_hex;
    return verifyMlDsa44Signature(JSON.stringify(copy), sig, keyId);
  }

  BitBopMlKem = Object.assign({}, BitBopMlKem, {
    ml_dsa44: { verify: verifyMlDsa44 },
    SERVICE_PUBLIC_KEY_MLDSA44_B64,
    TRUSTED_RELEASE_KEYS,
    verifyMlDsa44Signature,
    verifyReceiptSignature
  });
  if (typeof window !== 'undefined') window.BitBopMlKem = BitBopMlKem;
  if (typeof globalThis !== 'undefined') globalThis.BitBopMlKem = BitBopMlKem;
})();
