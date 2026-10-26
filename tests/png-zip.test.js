const assert = require('assert');
const { createZip } = require('../png-zip.js');

(async () => {
  const entries = [
    { name: 'photo-layout-page-01.png', bytes: new TextEncoder().encode('123456789') },
    { name: 'photo-layout-page-02.png', bytes: Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]) }
  ];
  const zip = Buffer.from(await createZip(entries).arrayBuffer());
  const end = zip.length - 22;
  assert.strictEqual(zip.readUInt32LE(end), 0x06054b50, 'ZIP end record is missing');
  assert.strictEqual(zip.readUInt16LE(end + 10), 2, 'ZIP must contain both pages');
  const directoryOffset = zip.readUInt32LE(end + 16);
  let offset = 0;
  entries.forEach((entry, index) => {
    assert.strictEqual(zip.readUInt32LE(offset), 0x04034b50, 'local ZIP record is missing');
    const nameLength = zip.readUInt16LE(offset + 26);
    const dataStart = offset + 30 + nameLength;
    const size = zip.readUInt32LE(offset + 18);
    assert.strictEqual(zip.subarray(offset + 30, dataStart).toString(), entry.name, 'page name/order changed');
    assert.strictEqual(Buffer.compare(zip.subarray(dataStart, dataStart + size), Buffer.from(entry.bytes)), 0, 'PNG bytes changed');
    if (index === 0) assert.strictEqual(zip.readUInt32LE(offset + 14), 0xcbf43926, 'CRC-32 is incorrect');
    offset = dataStart + size;
  });
  assert.strictEqual(offset, directoryOffset, 'central directory offset is incorrect');
  let record = directoryOffset;
  entries.forEach((entry, index) => {
    assert.strictEqual(zip.readUInt32LE(record), 0x02014b50, 'central ZIP record is missing');
    assert.strictEqual(zip.readUInt32LE(record + 42), index === 0 ? 0 : 30 + entries[0].name.length + entries[0].bytes.length, 'central record points to wrong page');
    record += 46 + Buffer.byteLength(entry.name);
  });
  assert.strictEqual(record, end, 'central directory size is incorrect');
  console.log('PNG ZIP tests passed');
})().catch((error) => { console.error(error); process.exitCode = 1; });
