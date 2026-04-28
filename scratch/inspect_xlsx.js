
const fs = require('fs');
const zlib = require('zlib');

function unescapeXml(s = '') {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x[Dd];/g, '');
}
function cleanStr(s = '') { return s.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim(); }
function colToIdx(col) { return col.split('').reduce((a, c) => a * 26 + c.charCodeAt(0) - 64, 0) - 1; }

async function inspectXlsx(filePath) {
  const buffer = fs.readFileSync(filePath);
  const bytes = new Uint8Array(buffer);
  const dv = new DataView(buffer.buffer);
  
  // Find EOCD
  let eocdPos = -1;
  for (let i = bytes.length - 22; i >= 0; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocdPos = i; break; }
  }
  if (eocdPos < 0) throw new Error('Not a zip file');

  const cdTotal = dv.getUint16(eocdPos + 10, true);
  const cdOffset = dv.getUint32(eocdPos + 16, true);
  
  let pos = cdOffset;
  const sharedStrings = [];
  let sheet1Xml = '';

  for (let n = 0; n < cdTotal; n++) {
    const sig = dv.getUint32(pos, true);
    if (sig !== 0x02014b50) break;
    const compMethod = dv.getUint16(pos + 10, true);
    const compSz = dv.getUint32(pos + 20, true);
    const fnLen = dv.getUint16(pos + 28, true);
    const extraLen = dv.getUint16(pos + 30, true);
    const commentLen = dv.getUint16(pos + 32, true);
    const localHdrOff = dv.getUint32(pos + 42, true);
    const filename = buffer.slice(pos + 46, pos + 46 + fnLen).toString();

    if (filename === 'xl/sharedStrings.xml' || filename === 'xl/worksheets/sheet1.xml') {
      const lhFnLen = dv.getUint16(localHdrOff + 26, true);
      const lhExtraLen = dv.getUint16(localHdrOff + 28, true);
      const dataStart = localHdrOff + 30 + lhFnLen + lhExtraLen;
      const compressed = bytes.slice(dataStart, dataStart + compSz);
      
      let xml;
      if (compMethod === 8) {
        xml = zlib.inflateRawSync(compressed).toString();
      } else {
        xml = compressed.toString();
      }

      if (filename === 'xl/sharedStrings.xml') {
        for (const m of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
          const texts = [...m[1].matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map(x => unescapeXml(x[1]));
          sharedStrings.push(cleanStr(texts.join('')));
        }
      } else {
        sheet1Xml = xml;
      }
    }
    pos += 46 + fnLen + extraLen + commentLen;
  }

  // Parse first row headers
  const row1 = sheet1Xml.match(/<row[^>]+r="1"[^>]*>([\s\S]*?)<\/row>/);
  if (!row1) {
    console.log('Row 1 not found. First few rows:');
    for (const m of sheet1Xml.matchAll(/<row[^>]+r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
        console.log(`Row ${m[1]}`);
        if (parseInt(m[1]) > 5) break;
    }
    return;
  }

  const headers = [];
  for (const cellM of row1[1].matchAll(/<c\s([^>]*)>([\s\S]*?)<\/c>/g)) {
    const attrs = cellM[1], inner = cellM[2];
    const cellType = (attrs.match(/t="([^"]+)"/) || [])[1];
    let value = '';
    if (cellType === 's') {
      const vM = inner.match(/<v>(\d+)<\/v>/);
      if (vM) value = sharedStrings[parseInt(vM[1])] ?? '';
    }
    headers.push(value);
  }
  console.log('Headers found in Row 1:');
  console.log(JSON.stringify(headers, null, 2));
}

const file = process.argv[2];
inspectXlsx(file).catch(err => console.error(err));
