import {deflateSync} from 'node:zlib';
export function iconPng(){
  const crc=b=>{let c=0xffffffff;for(const byte of b){c^=byte;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return(c^0xffffffff)>>>0;};
  const chunk=(type,data)=>{const name=Buffer.from(type),head=Buffer.alloc(4),tail=Buffer.alloc(4);head.writeUInt32BE(data.length);tail.writeUInt32BE(crc(Buffer.concat([name,data])));return Buffer.concat([head,name,data,tail]);};
  const header=Buffer.alloc(13);header.writeUInt32BE(64,0);header.writeUInt32BE(64,4);header[8]=8;header[9]=2;
  const raw=Buffer.alloc(64*(1+64*3));
  for(let y=0;y<64;y++)for(let x=0;x<64;x++){const w=y>17&&y<47&&((x>13&&x<20)||(x>29&&x<36)||(x>45&&x<52)||(y>39&&x>18&&x<48));const i=y*193+1+x*3;raw[i]=w?23:184;raw[i+1]=w?35:213;raw[i+2]=w?26:184;}
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
