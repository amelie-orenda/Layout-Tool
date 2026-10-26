(function (root) {
  'use strict';

  const crcTable = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? (value >>> 1) ^ 0xedb88320 : value >>> 1;
    crcTable[i] = value >>> 0;
  }

  function crc32(bytes) {
    let value = 0xffffffff;
    for (let i = 0; i < bytes.length; i += 1) value = crcTable[(value ^ bytes[i]) & 255] ^ (value >>> 8);
    return (value ^ 0xffffffff) >>> 0;
  }

  function createZip(entries) {
    if (!entries.length || entries.length > 65535) throw new Error('ZIP 文件数量无效');
    const encoder = new TextEncoder(); const files = []; const directory = []; let offset = 0;
    for (const { name, bytes } of entries) {
      const nameBytes = encoder.encode(name); const size = bytes.length; const checksum = crc32(bytes);
      if (nameBytes.length > 65535 || size > 0xffffffff || offset + 30 + nameBytes.length + size > 0xffffffff) throw new Error('ZIP 文件过大');
      const local = new Uint8Array(30 + nameBytes.length); const localView = new DataView(local.buffer);
      localView.setUint32(0, 0x04034b50, true); localView.setUint16(4, 20, true);
      localView.setUint16(12, 0x21, true);
      localView.setUint32(14, checksum, true); localView.setUint32(18, size, true); localView.setUint32(22, size, true);
      localView.setUint16(26, nameBytes.length, true); local.set(nameBytes, 30);
      const record = new Uint8Array(46 + nameBytes.length); const recordView = new DataView(record.buffer);
      recordView.setUint32(0, 0x02014b50, true); recordView.setUint16(4, 20, true); recordView.setUint16(6, 20, true);
      recordView.setUint16(14, 0x21, true);
      recordView.setUint32(16, checksum, true); recordView.setUint32(20, size, true); recordView.setUint32(24, size, true);
      recordView.setUint16(28, nameBytes.length, true); recordView.setUint32(42, offset, true); record.set(nameBytes, 46);
      files.push(local, bytes); directory.push(record); offset += local.length + size;
    }
    const directorySize = directory.reduce((total, record) => total + record.length, 0);
    if (offset + directorySize + 22 > 0xffffffff) throw new Error('ZIP 文件过大');
    const end = new Uint8Array(22); const endView = new DataView(end.buffer);
    endView.setUint32(0, 0x06054b50, true); endView.setUint16(8, entries.length, true); endView.setUint16(10, entries.length, true);
    endView.setUint32(12, directorySize, true); endView.setUint32(16, offset, true);
    return new Blob([...files, ...directory, end], { type: 'application/zip' });
  }

  const api = { createZip };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PngZip = api;
})(typeof window !== 'undefined' ? window : globalThis);
