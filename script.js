/* Compression and ZIP creation happen entirely in the browser. */
const $ = selector => document.querySelector(selector);
const fileInput = $('#fileInput'), dropZone = $('#dropZone'), browseButton = $('#browseButton'), editor = $('#editor');
const qualitySlider = $('#qualitySlider'), qualityOutput = $('#qualityOutput'), originalImage = $('#originalImage'), compressedImage = $('#compressedImage');
const originalSize = $('#originalSize'), compressedSize = $('#compressedSize'), savedPill = $('#savedPill'), resultText = $('#resultText'), downloadButton = $('#downloadButton');
const targetSize = $('#targetSize'), customSize = $('#customSize'), customSizeWrap = $('#customSizeWrap'), targetHint = $('#targetHint');
const batchPanel = $('#batchPanel'), batchList = $('#batchList'), batchTitle = $('#batchTitle'), downloadAllButton = $('#downloadAllButton');
const singleProgress = $('#singleProgress'), singleProgressFill = $('#singleProgressFill'), singleProgressValue = $('#singleProgressValue'), singleProgressLabel = $('#singleProgressLabel');
let currentFile, originalUrl, compressedUrl, compressionTimer, compressionJob = 0, batchRun = 0, batchItems = [];

const formatBytes = bytes => bytes < 1048576 ? `${(bytes / 1024).toFixed(bytes < 1024 ? 0 : 1)} KB` : `${(bytes / 1048576).toFixed(2)} MB`;
const validType = file => ['image/jpeg', 'image/png', 'image/webp'].includes(file.type);
const makeWebp = (canvas, quality) => new Promise(resolve => canvas.toBlob(resolve, 'image/webp', quality));
const loadImage = file => new Promise((resolve, reject) => { const image = new Image(); const url = URL.createObjectURL(file); image.onload = () => { URL.revokeObjectURL(url); resolve(image); }; image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Unable to read image')); }; image.src = url; });

function setRangeBackground() { const value = Number(qualitySlider.value), fill = ((value - 10) / 90) * 100; qualityOutput.value = `${value}%`; qualitySlider.style.background = `linear-gradient(90deg, var(--purple) ${fill}%, ${document.body.classList.contains('dark') ? '#474960' : '#dadbe5'} ${fill}%)`; }
function getTargetBytes() { const selected = targetSize.value === 'custom' ? Number(customSize.value) : Number(targetSize.value); return selected > 0 ? selected * 1024 : 0; }
function outputName(file, blob) { return `${file.name.replace(/\.[^/.]+$/, '')}-compressify.${blob.type === 'image/webp' ? 'webp' : file.name.split('.').pop()}`; }
function setSingleProgress(value, label = 'Optimizing image') { singleProgress.classList.remove('hidden'); singleProgressLabel.textContent = label; singleProgressValue.textContent = `${value}%`; singleProgressFill.style.width = `${value}%`; }
function celebrateSuccess() { compressedImage.closest('.compressed-preview').classList.remove('success-flash'); void compressedImage.offsetWidth; compressedImage.closest('.compressed-preview').classList.add('success-flash'); }

function showResult(blob, message, warning = false) {
  if (compressedUrl) URL.revokeObjectURL(compressedUrl);
  compressedUrl = URL.createObjectURL(blob); compressedImage.src = compressedUrl; compressedSize.textContent = formatBytes(blob.size);
  const saved = Math.max(0, Math.round((1 - blob.size / currentFile.size) * 100));
  savedPill.textContent = saved ? `${saved}% smaller` : 'Original kept'; resultText.textContent = message; resultText.classList.toggle('warning', warning);
  resultText.classList.toggle('success-message', !warning); setSingleProgress(100, warning ? 'Optimization complete' : 'Ready to download'); if (!warning) celebrateSuccess();
  downloadButton.href = compressedUrl; downloadButton.download = outputName(currentFile, blob);
}

async function compressFile(file, reportProgress = () => {}) {
  const target = getTargetBytes(), ceiling = Number(qualitySlider.value) / 100;
  if (target && file.size <= target) return { blob: file, warning: false, message: 'Original already meets target' };
  reportProgress(10);
  const image = await loadImage(file), canvas = document.createElement('canvas'), maxDimension = 3200;
  const ratio = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
  canvas.width = Math.round(image.naturalWidth * ratio); canvas.height = Math.round(image.naturalHeight * ratio);
  canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height); reportProgress(25);
  let blob, actualQuality = ceiling;
  if (target) {
    let low = .1, high = ceiling, best = null, bestQuality = low;
    for (let pass = 0; pass < 7; pass += 1) {
      const quality = (low + high) / 2, candidate = await makeWebp(canvas, quality);
      if (!candidate) throw new Error('Compression unavailable');
      reportProgress(30 + (pass + 1) * 9);
      if (candidate.size <= target) { best = candidate; bestQuality = quality; low = quality; } else high = quality;
    }
    blob = best || await makeWebp(canvas, .1); actualQuality = best ? bestQuality : .1;
  } else { blob = await makeWebp(canvas, ceiling); reportProgress(90); }
  if (!blob) throw new Error('Compression unavailable');
  if (blob.size >= file.size) return { blob: file, warning: true, message: 'Original kept (already smaller)' };
  const metTarget = !target || blob.size <= target;
  return { blob, warning: !metTarget, actualQuality, message: metTarget ? 'Compressed' : 'Closest possible result' };
}

async function compressImage() {
  if (!currentFile || !originalImage.complete || !originalImage.naturalWidth || batchItems.length > 1) return;
  const job = ++compressionJob; resultText.classList.remove('warning'); resultText.textContent = 'Compressing privately on your device...';
  try {
    setSingleProgress(5); const result = await compressFile(currentFile, percent => setSingleProgress(percent));
    if (job !== compressionJob) return;
    if (getTargetBytes()) qualityOutput.value = `${Math.round((result.actualQuality || 1) * 100)}%`;
    const target = getTargetBytes(), message = result.warning ? `Warning - ${result.message}.` : target && result.message === 'Original already meets target' ? `Success - your original already meets the ${formatBytes(target)} target.` : target ? `Success - optimized to ${formatBytes(result.blob.size)} for your ${formatBytes(target)} target.` : `Success - you saved ${formatBytes(currentFile.size - result.blob.size)}.`;
    showResult(result.blob, message, result.warning);
  } catch { if (job === compressionJob) { resultText.textContent = 'Your browser could not compress this image.'; resultText.classList.add('warning'); } }
}

function renderBatch(items) {
  batchList.replaceChildren(); batchPanel.classList.toggle('hidden', items.length < 2); downloadAllButton.disabled = true;
  items.forEach(item => {
    const row = document.createElement('article'); row.className = 'batch-row';
    const name = document.createElement('div'); name.className = 'batch-name'; const strong = document.createElement('strong'); strong.textContent = item.file.name; const details = document.createElement('span'); details.textContent = `${formatBytes(item.file.size)} • Waiting`; name.append(strong, details);
    const bar = document.createElement('div'); bar.className = 'batch-progress'; const fill = document.createElement('i'); bar.append(fill);
    const button = document.createElement('button'); button.className = 'secondary-button'; button.type = 'button'; button.disabled = true; button.textContent = 'Download'; button.addEventListener('click', () => downloadItem(item));
    row.append(name, bar, button); batchList.append(row); item.ui = { details, fill, button };
  });
}
function updateRow(item, progress, details) { if (!item.ui) return; item.ui.fill.style.width = `${progress}%`; if (details) item.ui.details.textContent = details; }
function downloadItem(item) { if (!item.blob) return; const link = document.createElement('a'); link.href = item.url || URL.createObjectURL(item.blob); link.download = outputName(item.file, item.blob); link.click(); }

async function processBatch() {
  const run = ++batchRun; const items = batchItems; renderBatch(items); batchTitle.textContent = `Compressing 0 of ${items.length} images`;
  for (let index = 0; index < items.length; index += 1) {
    if (run !== batchRun) return;
    const item = items[index]; batchTitle.textContent = `Compressing ${index + 1} of ${items.length} images`;
    try {
      const result = await compressFile(item.file, percent => updateRow(item, percent, `${formatBytes(item.file.size)} • Compressing ${percent}%`));
      if (run !== batchRun) return;
      item.blob = result.blob; item.url = URL.createObjectURL(result.blob); updateRow(item, 100, `${formatBytes(item.file.size)} → ${formatBytes(result.blob.size)} • ${Math.max(0, Math.round((1 - result.blob.size / item.file.size) * 100))}% saved`); item.ui.button.disabled = false;
      if (index === 0) { currentFile = item.file; showResult(item.blob, result.warning ? `Warning - ${result.message}.` : `Success - ${result.message}.`, result.warning); }
    } catch { updateRow(item, 100, `${formatBytes(item.file.size)} • Could not compress`); }
  }
  if (run === batchRun) { batchTitle.textContent = `${items.length} images ready to download`; downloadAllButton.disabled = !items.some(item => item.blob); }
}

function loadFiles(files) {
  const validFiles = [...files].filter(file => validType(file) && file.size <= 25 * 1024 * 1024);
  if (!validFiles.length) return alert('Please choose JPG, PNG, or WebP images smaller than 25 MB.');
  if (validFiles.length !== files.length) alert('Unsupported or over-size images were skipped.');
  batchRun += 1; batchItems.forEach(item => item.url && URL.revokeObjectURL(item.url)); batchItems = validFiles.map(file => ({ file })); currentFile = validFiles[0];
  if (originalUrl) URL.revokeObjectURL(originalUrl); originalUrl = URL.createObjectURL(currentFile); originalImage.src = originalUrl; originalSize.textContent = formatBytes(currentFile.size); dropZone.classList.add('hidden'); editor.classList.remove('hidden');
  if (batchItems.length > 1) processBatch(); else { batchPanel.classList.add('hidden'); compressImage(); }
}

const crcTable = (() => { const table = new Uint32Array(256); for (let n = 0; n < 256; n += 1) { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; } return table; })();
const crc32 = bytes => { let crc = 0xffffffff; for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0; };
function zipParts(files) {
  const encoder = new TextEncoder(), chunks = [], records = []; let offset = 0;
  const write = (length, fill) => { const data = new Uint8Array(length); fill(new DataView(data.buffer)); return data; };
  files.forEach(file => { const name = encoder.encode(file.name), data = new Uint8Array(file.data), crc = crc32(data); const local = write(30, v => { v.setUint32(0, 0x04034b50, true); v.setUint16(4, 20, true); v.setUint16(6, 0x0800, true); v.setUint16(8, 0, true); v.setUint32(14, crc, true); v.setUint32(18, data.length, true); v.setUint32(22, data.length, true); v.setUint16(26, name.length, true); }); chunks.push(local, name, data); records.push({ name, crc, size: data.length, offset }); offset += local.length + name.length + data.length; });
  const centralStart = offset; records.forEach(record => { const central = write(46, v => { v.setUint32(0, 0x02014b50, true); v.setUint16(4, 20, true); v.setUint16(6, 20, true); v.setUint16(8, 0x0800, true); v.setUint16(10, 0, true); v.setUint32(16, record.crc, true); v.setUint32(20, record.size, true); v.setUint32(24, record.size, true); v.setUint16(28, record.name.length, true); v.setUint32(42, record.offset, true); }); chunks.push(central, record.name); offset += central.length + record.name.length; });
  chunks.push(write(22, v => { v.setUint32(0, 0x06054b50, true); v.setUint16(8, records.length, true); v.setUint16(10, records.length, true); v.setUint32(12, offset - centralStart, true); v.setUint32(16, centralStart, true); })); return new Blob(chunks, { type: 'application/zip' });
}
downloadAllButton.addEventListener('click', async () => { const ready = batchItems.filter(item => item.blob); if (!ready.length) return; downloadAllButton.disabled = true; downloadAllButton.textContent = 'Preparing ZIP...'; const files = await Promise.all(ready.map(async item => ({ name: outputName(item.file, item.blob), data: await item.blob.arrayBuffer() }))); const link = document.createElement('a'); link.href = URL.createObjectURL(zipParts(files)); link.download = 'compressify-images.zip'; link.click(); downloadAllButton.textContent = 'Download all (.zip)'; downloadAllButton.disabled = false; });

browseButton.addEventListener('click', event => { event.stopPropagation(); fileInput.click(); }); dropZone.addEventListener('click', () => fileInput.click()); dropZone.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') fileInput.click(); }); fileInput.addEventListener('change', () => loadFiles(fileInput.files));
['dragenter', 'dragover'].forEach(name => dropZone.addEventListener(name, event => { event.preventDefault(); dropZone.classList.add('dragging'); })); ['dragleave', 'drop'].forEach(name => dropZone.addEventListener(name, event => { event.preventDefault(); dropZone.classList.remove('dragging'); })); dropZone.addEventListener('drop', event => loadFiles(event.dataTransfer.files));
originalImage.addEventListener('load', compressImage); qualitySlider.addEventListener('input', () => { setRangeBackground(); clearTimeout(compressionTimer); compressionTimer = setTimeout(() => batchItems.length > 1 ? processBatch() : compressImage(), 180); });
targetSize.addEventListener('change', () => { customSizeWrap.classList.toggle('hidden', targetSize.value !== 'custom'); targetHint.textContent = targetSize.value ? 'We make up to seven quick adjustments to get as close as possible.' : 'Choose a target and we’ll preserve the best quality that fits.'; batchItems.length > 1 ? processBatch() : compressImage(); }); customSize.addEventListener('input', () => { if (targetSize.value === 'custom') { clearTimeout(compressionTimer); compressionTimer = setTimeout(() => batchItems.length > 1 ? processBatch() : compressImage(), 250); } });
$('#replaceButton').addEventListener('click', () => fileInput.click()); $('#themeToggle').addEventListener('click', () => { document.body.classList.toggle('dark'); localStorage.setItem('compressify-theme', document.body.classList.contains('dark') ? 'dark' : 'light'); setRangeBackground(); }); if (localStorage.getItem('compressify-theme') === 'dark') document.body.classList.add('dark'); setRangeBackground();
const legalCopy = { privacy: '<h2>Privacy Policy</h2><p><strong>Last updated: July 2026</strong></p><p>Compressify processes images locally in your web browser. We do not upload, store, view, or share your image files. We may store your visual theme preference in your browser using local storage.</p><p>Our site contains no account system, analytics requirement, or sale of personal data. If you contact us by email, we use your email only to respond to your message.</p>', terms: '<h2>Terms of Service</h2><p><strong>Last updated: July 2026</strong></p><p>Compressify is provided as-is for personal and commercial image optimization. You are responsible for ensuring that you have the right to use every image you process.</p><p>Because compression is a lossy process, please keep your original image. We make no guarantee that a compressed output will be smaller or suitable for every purpose.</p>' };
const modal = $('#legalModal'); document.querySelectorAll('[data-modal]').forEach(button => button.addEventListener('click', () => { $('#modalContent').innerHTML = legalCopy[button.dataset.modal]; modal.showModal(); })); $('.close-modal').addEventListener('click', () => modal.close()); modal.addEventListener('click', event => { if (event.target === modal) modal.close(); });
window.addEventListener('DOMContentLoaded', () => {
  /* PDF merging stays on the device; pdf-lib supplies safe PDF page handling. */
  const pdfInput = $('#pdfInput'), pdfDropZone = $('#pdfDropZone'), pdfBrowseButton = $('#pdfBrowseButton'), pdfWorkspace = $('#pdfWorkspace');
  const pdfList = $('#pdfList'), pdfQueueTitle = $('#pdfQueueTitle'), pdfStatus = $('#pdfStatus'), mergePdfButton = $('#mergePdfButton'), clearPdfsButton = $('#clearPdfsButton');
  let pdfFiles = [];
  function renderPdfQueue() {
    pdfList.replaceChildren(); pdfQueueTitle.textContent = `${pdfFiles.length} ${pdfFiles.length === 1 ? 'file' : 'files'} selected`;
    pdfWorkspace.classList.toggle('hidden', !pdfFiles.length); pdfDropZone.classList.toggle('hidden', !!pdfFiles.length);
    pdfFiles.forEach((file, index) => {
      const item = document.createElement('li'); item.className = 'pdf-item'; const number = document.createElement('span'); number.className = 'pdf-number'; number.textContent = index + 1;
      const details = document.createElement('div'); details.className = 'pdf-file-name'; const name = document.createElement('strong'); name.textContent = file.name; const size = document.createElement('span'); size.textContent = formatBytes(file.size); details.append(name, size);
      const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'pdf-remove'; remove.setAttribute('aria-label', `Remove ${file.name}`); remove.textContent = '×'; remove.addEventListener('click', () => { pdfFiles.splice(index, 1); pdfStatus.textContent = pdfFiles.length ? 'Files are merged in the order shown.' : ''; renderPdfQueue(); }); item.append(number, details, remove); pdfList.append(item);
    });
  }
  function addPdfFiles(files) {
    const valid = [...files].filter(file => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf'));
    if (!valid.length) return alert('Please choose PDF files.'); if (valid.length !== files.length) alert('Only PDF files were added.'); pdfFiles.push(...valid); pdfStatus.textContent = 'Files are merged in the order shown.'; renderPdfQueue();
  }
  async function mergePdfs() {
    if (pdfFiles.length < 2) { pdfStatus.textContent = 'Please add at least two PDF files to merge.'; return; }
    if (!window.PDFLib) { pdfStatus.textContent = 'The PDF tool is still loading. Please check your connection and try again.'; return; }
    mergePdfButton.disabled = true; clearPdfsButton.disabled = true;
    try {
      const merged = await window.PDFLib.PDFDocument.create();
      for (let index = 0; index < pdfFiles.length; index += 1) { pdfStatus.textContent = `Merging ${index + 1} of ${pdfFiles.length} PDF files...`; const source = await window.PDFLib.PDFDocument.load(await pdfFiles[index].arrayBuffer()); const pages = await merged.copyPages(source, source.getPageIndices()); pages.forEach(page => merged.addPage(page)); }
      const bytes = await merged.save(), link = document.createElement('a'), url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' })); link.href = url; link.download = 'compressify-merged.pdf'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); pdfStatus.textContent = `Success - ${pdfFiles.length} PDF files merged and downloaded.`;
    } catch { pdfStatus.textContent = 'We could not merge one or more PDFs. Please ensure the files are valid and not password protected.'; }
    finally { mergePdfButton.disabled = false; clearPdfsButton.disabled = false; }
  }
  pdfBrowseButton.addEventListener('click', event => { event.stopPropagation(); pdfInput.click(); }); pdfDropZone.addEventListener('click', () => pdfInput.click()); pdfDropZone.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') pdfInput.click(); }); pdfInput.addEventListener('change', () => { addPdfFiles(pdfInput.files); pdfInput.value = ''; });
  ['dragenter', 'dragover'].forEach(name => pdfDropZone.addEventListener(name, event => { event.preventDefault(); pdfDropZone.classList.add('dragging'); })); ['dragleave', 'drop'].forEach(name => pdfDropZone.addEventListener(name, event => { event.preventDefault(); pdfDropZone.classList.remove('dragging'); })); pdfDropZone.addEventListener('drop', event => addPdfFiles(event.dataTransfer.files)); clearPdfsButton.addEventListener('click', () => { pdfFiles = []; pdfStatus.textContent = ''; renderPdfQueue(); }); mergePdfButton.addEventListener('click', mergePdfs);
});

