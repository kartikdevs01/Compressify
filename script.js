/* All image processing happens locally in the browser. */
const fileInput = document.querySelector('#fileInput');
const dropZone = document.querySelector('#dropZone');
const browseButton = document.querySelector('#browseButton');
const editor = document.querySelector('#editor');
const qualitySlider = document.querySelector('#qualitySlider');
const qualityOutput = document.querySelector('#qualityOutput');
const originalImage = document.querySelector('#originalImage');
const compressedImage = document.querySelector('#compressedImage');
const originalSize = document.querySelector('#originalSize');
const compressedSize = document.querySelector('#compressedSize');
const savedPill = document.querySelector('#savedPill');
const resultText = document.querySelector('#resultText');
const downloadButton = document.querySelector('#downloadButton');
const targetSize = document.querySelector('#targetSize');
const customSize = document.querySelector('#customSize');
const customSizeWrap = document.querySelector('#customSizeWrap');
const targetHint = document.querySelector('#targetHint');
let currentFile, originalUrl, compressedUrl, compressionTimer, compressionJob = 0;

const formatBytes = bytes => bytes < 1048576 ? `${(bytes / 1024).toFixed(bytes < 1024 ? 0 : 1)} KB` : `${(bytes / 1048576).toFixed(2)} MB`;
const validType = file => ['image/jpeg', 'image/png', 'image/webp'].includes(file.type);
const makeWebp = (canvas, quality) => new Promise(resolve => canvas.toBlob(resolve, 'image/webp', quality));

function setRangeBackground() {
  const value = Number(qualitySlider.value);
  qualityOutput.value = `${value}%`;
  const fill = ((value - 10) / 90) * 100;
  const empty = document.body.classList.contains('dark') ? '#474960' : '#dadbe5';
  qualitySlider.style.background = `linear-gradient(90deg, var(--purple) ${fill}%, ${empty} ${fill}%)`;
}

function getTargetBytes() {
  const selected = targetSize.value === 'custom' ? Number(customSize.value) : Number(targetSize.value);
  return selected > 0 ? selected * 1024 : 0;
}

function showResult(blob, message, warning = false) {
  if (compressedUrl) URL.revokeObjectURL(compressedUrl);
  compressedUrl = URL.createObjectURL(blob);
  compressedImage.src = compressedUrl;
  compressedSize.textContent = formatBytes(blob.size);
  const saved = Math.max(0, Math.round((1 - blob.size / currentFile.size) * 100));
  savedPill.textContent = saved ? `${saved}% smaller` : 'Original kept';
  resultText.textContent = message;
  resultText.classList.toggle('warning', warning);
  downloadButton.href = compressedUrl;
  const extension = blob.type === 'image/webp' ? 'webp' : currentFile.name.split('.').pop();
  downloadButton.download = `${currentFile.name.replace(/\.[^/.]+$/, '')}-compressify.${extension}`;
}

function loadFile(file) {
  if (!file || !validType(file)) return alert('Please choose a JPG, PNG, or WebP image.');
  if (file.size > 25 * 1024 * 1024) return alert('Please choose an image smaller than 25 MB.');
  currentFile = file;
  if (originalUrl) URL.revokeObjectURL(originalUrl);
  originalUrl = URL.createObjectURL(file);
  originalImage.src = originalUrl;
  originalSize.textContent = formatBytes(file.size);
  dropZone.classList.add('hidden');
  editor.classList.remove('hidden');
}

async function compressImage() {
  if (!currentFile || !originalImage.complete || !originalImage.naturalWidth) return;
  const job = ++compressionJob;
  resultText.classList.remove('warning');
  resultText.textContent = 'Compressing privately on your device...';
  const target = getTargetBytes();
  if (target && currentFile.size <= target) {
    if (job === compressionJob) showResult(currentFile, `Success - your original already meets the ${formatBytes(target)} target. We kept it unchanged.`);
    return;
  }
  const canvas = document.createElement('canvas');
  const maxDimension = 3200;
  const ratio = Math.min(1, maxDimension / Math.max(originalImage.naturalWidth, originalImage.naturalHeight));
  canvas.width = Math.round(originalImage.naturalWidth * ratio);
  canvas.height = Math.round(originalImage.naturalHeight * ratio);
  canvas.getContext('2d').drawImage(originalImage, 0, 0, canvas.width, canvas.height);
  const ceiling = Number(qualitySlider.value) / 100;
  let blob, actualQuality = ceiling;
  if (target) {
    let low = 0.1, high = ceiling, best = null, bestQuality = low;
    for (let pass = 0; pass < 7; pass += 1) {
      const quality = (low + high) / 2;
      const candidate = await makeWebp(canvas, quality);
      if (job !== compressionJob) return;
      if (!candidate) { resultText.textContent = 'Your browser could not compress this image.'; return; }
      if (candidate.size <= target) { best = candidate; bestQuality = quality; low = quality; } else high = quality;
    }
    blob = best || await makeWebp(canvas, 0.1);
    actualQuality = best ? bestQuality : 0.1;
  } else {
    blob = await makeWebp(canvas, ceiling);
  }
  if (job !== compressionJob || !blob) return;
  if (blob.size >= currentFile.size) {
    showResult(currentFile, 'Warning - compression would increase the file size, so your original was kept.', true);
    return;
  }
  if (target) {
    qualityOutput.value = `${Math.round(actualQuality * 100)}%`;
    const metTarget = blob.size <= target;
    showResult(blob, metTarget ? `Success - optimized to ${formatBytes(blob.size)} for your ${formatBytes(target)} target.` : `Warning - closest result is ${formatBytes(blob.size)}. This image cannot reach the target without further changes.`, !metTarget);
  } else {
    showResult(blob, `Success - you saved ${formatBytes(currentFile.size - blob.size)}.`);
  }
}

browseButton.addEventListener('click', event => { event.stopPropagation(); fileInput.click(); });
dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') fileInput.click(); });
fileInput.addEventListener('change', () => loadFile(fileInput.files[0]));
['dragenter', 'dragover'].forEach(name => dropZone.addEventListener(name, event => { event.preventDefault(); dropZone.classList.add('dragging'); }));
['dragleave', 'drop'].forEach(name => dropZone.addEventListener(name, event => { event.preventDefault(); dropZone.classList.remove('dragging'); }));
dropZone.addEventListener('drop', event => loadFile(event.dataTransfer.files[0]));
originalImage.addEventListener('load', compressImage);
qualitySlider.addEventListener('input', () => { setRangeBackground(); clearTimeout(compressionTimer); compressionTimer = setTimeout(compressImage, 180); });
targetSize.addEventListener('change', () => { customSizeWrap.classList.toggle('hidden', targetSize.value !== 'custom'); targetHint.textContent = targetSize.value ? 'We make up to seven quick adjustments to get as close as possible.' : 'Choose a target and we’ll preserve the best quality that fits.'; compressImage(); });
customSize.addEventListener('input', () => { if (targetSize.value === 'custom') { clearTimeout(compressionTimer); compressionTimer = setTimeout(compressImage, 250); } });
document.querySelector('#replaceButton').addEventListener('click', () => fileInput.click());
document.querySelector('#themeToggle').addEventListener('click', () => { document.body.classList.toggle('dark'); localStorage.setItem('compressify-theme', document.body.classList.contains('dark') ? 'dark' : 'light'); setRangeBackground(); });
if (localStorage.getItem('compressify-theme') === 'dark') document.body.classList.add('dark');
setRangeBackground();

const legalCopy = {
  privacy: '<h2>Privacy Policy</h2><p><strong>Last updated: July 2026</strong></p><p>Compressify processes images locally in your web browser. We do not upload, store, view, or share your image files. We may store your visual theme preference in your browser using local storage.</p><p>Our site contains no account system, analytics requirement, or sale of personal data. If you contact us by email, we use your email only to respond to your message.</p>',
  terms: '<h2>Terms of Service</h2><p><strong>Last updated: July 2026</strong></p><p>Compressify is provided as-is for personal and commercial image optimization. You are responsible for ensuring that you have the right to use every image you process.</p><p>Because compression is a lossy process, please keep your original image. We make no guarantee that a compressed output will be smaller or suitable for every purpose.</p>'
};
const modal = document.querySelector('#legalModal');
document.querySelectorAll('[data-modal]').forEach(button => button.addEventListener('click', () => { document.querySelector('#modalContent').innerHTML = legalCopy[button.dataset.modal]; modal.showModal(); }));
document.querySelector('.close-modal').addEventListener('click', () => modal.close());
modal.addEventListener('click', event => { if (event.target === modal) modal.close(); });
