"use strict";
const state = {
    provider: 'happyhorse',
    assets: [],
    task: null,
    lastJson: {},
    previewIndex: 0
};
let pollTimer = null;
function byId(id) {
    const element = document.getElementById(id);
    if (!element)
        throw new Error(`Missing element #${id}`);
    return element;
}
const assetList = byId('assetList');
const inputStage = byId('inputStage');
const resultStage = byId('resultStage');
const jsonOut = byId('jsonOut');
const progressFill = byId('progressFill');
const progressText = byId('progressText');
const saved = JSON.parse(localStorage.getItem('seed-horse-settings') || '{}');
function inputValue(id) {
    return byId(id).value;
}
function setInputValue(id, value) {
    byId(id).value = value;
}
function persistSettings() {
    localStorage.setItem('seed-horse-settings', JSON.stringify({
        aliKey: inputValue('aliKey'),
        byteKey: inputValue('byteKey')
    }));
}
function restoreSettings() {
    setInputValue('aliKey', saved.aliKey || '');
    setInputValue('byteKey', saved.byteKey || '');
}
function updateProviderFields() {
    document.querySelectorAll('label[data-provider]').forEach((el) => {
        el.style.display = el.getAttribute('data-provider') === state.provider ? '' : 'none';
    });
}
function escapeHtml(value = '') {
    const amp = '\u0026amp;';
    const lt = '\u0026lt;';
    const gt = '\u0026gt;';
    const quot = '\u0026quot;';
    const sq = '\u0026#39;';
    return String(value)
        .replace(/&/g, amp)
        .replace(/</g, lt)
        .replace(/>/g, gt)
        .replace(/"/g, quot)
        .replace(/'/g, sq);
}
function formatBytes(bytes = 0) {
    if (!bytes)
        return 'remote';
    const units = ['B', 'KB', 'MB', 'GB'];
    const power = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${(bytes / 1024 ** power).toFixed(power ? 1 : 0)} ${units[power]}`;
}
function iconFor(kind) {
    if (kind === 'video')
        return 'clapperboard';
    if (kind === 'audio')
        return 'audio-lines';
    return 'image';
}
function setJson(payload) {
    state.lastJson = payload || {};
    jsonOut.textContent = JSON.stringify(state.lastJson, null, 2);
}
function setProgress(message, level = 'info', percent) {
    progressText.textContent = message;
    progressText.className = `progress-text ${level === 'info' ? '' : level}`;
    progressFill.classList.remove('indeterminate', 'success', 'error');
    if (level === 'success') {
        progressFill.style.width = '100%';
        progressFill.classList.add('success');
    }
    else if (level === 'error') {
        progressFill.style.width = percent !== undefined ? `${percent}%` : '100%';
        progressFill.classList.add('error');
    }
    else if (percent !== undefined) {
        progressFill.style.width = `${percent}%`;
    }
    else {
        progressFill.style.width = '';
        progressFill.classList.add('indeterminate');
    }
}
function resetProgress() {
    progressFill.classList.remove('indeterminate', 'success', 'error');
    progressFill.style.width = '0%';
    progressText.textContent = '等待任务提交';
    progressText.className = 'progress-text';
}
function startPolling(interval = 10000) {
    stopPolling();
    setProgress(`自动轮询中，间隔 ${interval / 1000}s`);
    pollTimer = setInterval(async () => {
        try {
            await pollTask();
        }
        catch {
            stopPolling();
        }
    }, interval);
}
function stopPolling() {
    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
}
function renderInputPreview() {
    if (!state.assets.length) {
        inputStage.classList.remove('gallery');
        inputStage.innerHTML = '<i data-lucide="clapperboard"></i><span>等待素材</span>';
        lucide.createIcons();
        return;
    }
    if (state.previewIndex >= state.assets.length) {
        state.previewIndex = 0;
    }
    const tabs = state.assets.length > 1
        ? '<div class="preview-tabs">' + state.assets.map((asset, i) => {
            const active = i === state.previewIndex ? ' active' : '';
            const icon = iconFor(asset.kind);
            return `<button type="button" class="preview-tab${active}" data-preview-index="${i}" title="${escapeHtml(asset.name)}"><i data-lucide="${icon}"></i><span>${escapeHtml(asset.name)}</span></button>`;
        }).join('') + '</div>'
        : '';
    const asset = state.assets[state.previewIndex];
    const url = escapeHtml(asset.url);
    const name = escapeHtml(asset.name);
    let content = '';
    if (asset.kind === 'video') {
        content = `<video controls playsinline preload="metadata" src="${url}" title="${name}"></video>`;
    }
    else if (asset.kind === 'image') {
        content = `<img src="${url}" alt="${name}" />`;
    }
    else {
        content = `<div class="audio-preview">
      <i data-lucide="audio-lines"></i>
      <strong>${name}</strong>
      <audio controls src="${url}"></audio>
    </div>`;
    }
    inputStage.classList.remove('gallery');
    inputStage.innerHTML = tabs + content;
    lucide.createIcons();
}
function primaryVideo() {
    return state.assets.find((a) => a.kind === 'video' && a.primary);
}
function autoSetPrimary() {
    const videos = state.assets.filter((a) => a.kind === 'video');
    if (!videos.some((a) => a.primary) && videos.length > 0) {
        videos[0].primary = true;
    }
}
function setPrimaryAsset(id) {
    state.assets.forEach((a) => { a.primary = false; });
    const asset = state.assets.find((a) => a.id === id);
    if (asset)
        asset.primary = true;
    renderAssets();
    updateDurationDisplay();
}
function floorDuration(seconds, step = 5) {
    return Math.max(step, Math.floor(seconds / step) * step);
}
function updateDurationDisplay() {
    const durationInput = byId('duration');
    const pv = primaryVideo();
    if (pv?.duration) {
        const floored = floorDuration(pv.duration);
        durationInput.placeholder = `自动（${floored}s，主视频 ${pv.duration.toFixed(1)}s → 向下取整）`;
    }
    else {
        durationInput.placeholder = '自动（主视频时长）';
    }
}
function renderAssets() {
    if (!state.assets.length) {
        assetList.innerHTML = '';
        renderInputPreview();
        updateDurationDisplay();
        return;
    }
    assetList.innerHTML = state.assets.map((asset) => {
        const isPrimary = asset.kind === 'video' && asset.primary;
        const roleTag = asset.kind === 'video'
            ? (isPrimary ? '<span class="asset-role primary-role">主视频</span>' : '<span class="asset-role ref-role">参考</span>')
            : '';
        const starBtn = asset.kind === 'video'
            ? (isPrimary
                ? '<button type="button" class="star-active" title="当前主视频" disabled><i data-lucide="star"></i></button>'
                : `<button type="button" title="设为主视频" data-set-primary="${escapeHtml(asset.id)}"><i data-lucide="star"></i></button>`)
            : '';
        return `
    <article class="asset${isPrimary ? ' asset-primary' : ''}" data-id="${escapeHtml(asset.id)}">
      ${starBtn}
      <div class="asset-icon"><i data-lucide="${iconFor(asset.kind)}"></i></div>
      <div>
        <h3 title="${escapeHtml(asset.name)}">${escapeHtml(asset.name)}${roleTag}</h3>
        <p title="${escapeHtml(asset.url)}">${escapeHtml(asset.kind)} · ${formatBytes(asset.size)}</p>
      </div>
      <button type="button" title="移除素材" data-remove="${escapeHtml(asset.id)}">
        <i data-lucide="x"></i>
      </button>
    </article>
  `;
    }).join('');
    lucide.createIcons();
    renderInputPreview();
    updateDurationDisplay();
}
function normalizeAsset(file) {
    const kind = file.kind || (file.type || '').split('/')[0] || 'remote';
    return {
        id: file.id || crypto.randomUUID(),
        name: file.name,
        type: file.type || `${kind}/remote`,
        size: file.size || 0,
        kind,
        url: file.url,
        primary: file.primary
    };
}
function addAssets(files) {
    state.assets.push(...files.map(normalizeAsset));
    autoSetPrimary();
    renderAssets();
    detectVideoDurations();
}
function detectVideoDurations() {
    state.assets.filter((a) => a.kind === 'video' && a.duration === undefined).forEach((asset) => {
        const video = document.createElement('video');
        video.preload = 'metadata';
        video.src = asset.url;
        video.addEventListener('loadedmetadata', () => {
            asset.duration = video.duration;
            updateDurationDisplay();
        });
    });
}
function collectParameters() {
    const durationInput = inputValue('duration').trim();
    const pv = primaryVideo();
    let duration = durationInput || undefined;
    if (!duration && pv?.duration) {
        duration = floorDuration(pv.duration);
    }
    return {
        resolution: inputValue('resolution'),
        watermark: byId('watermark').checked,
        ratio: inputValue('ratio'),
        duration,
        seed: inputValue('seed')
    };
}
function activeApiKey() {
    return state.provider === 'happyhorse' ? inputValue('aliKey').trim() : inputValue('byteKey').trim();
}
function setTaskMeta(task = {}) {
    byId('metaProvider').textContent = task.provider || '-';
    byId('metaTask').textContent = task.taskId || '-';
    byId('metaStatus').textContent = task.status || '-';
}
function showStage(message, videoUrl) {
    if (videoUrl) {
        resultStage.innerHTML = `<video controls playsinline src="${escapeHtml(videoUrl)}"></video>`;
    }
    else {
        resultStage.innerHTML = `<i data-lucide="film"></i><span>${escapeHtml(message)}</span>`;
        lucide.createIcons();
    }
}
async function parseJsonResponse(response) {
    const payload = await response.json();
    if (!response.ok)
        throw new Error(payload.error || '请求失败');
    return payload;
}
async function uploadFiles(files) {
    const form = new FormData();
    Array.from(files).forEach((file) => form.append('files', file));
    const response = await fetch('/api/upload', { method: 'POST', body: form });
    const payload = await parseJsonResponse(response);
    addAssets(payload.files);
    const names = payload.files.map((f) => f.name).join(', ');
    setProgress(`上传成功: ${names}`);
    if (payload.localOnly) {
        setProgress('注意: 当前素材 URL 是 localhost，云端模型通常无法访问本机地址', 'error');
        setJson({
            notice: '当前素材 URL 是 localhost。云端模型通常无法访问本机地址；部署到公网或设置 PUBLIC_BASE_URL 后即可直接调用。',
            upload: payload
        });
    }
}
async function healthCheck() {
    try {
        const response = await fetch('/api/health');
        if (!response.ok)
            throw new Error('bad status');
        byId('serverStatus').textContent = '已连接';
        byId('serverStatus').classList.add('ok');
    }
    catch {
        byId('serverStatus').textContent = '未连接';
        byId('serverStatus').classList.remove('ok');
    }
}
async function generate() {
    persistSettings();
    stopPolling();
    showStage('提交中');
    setTaskMeta({ provider: state.provider, status: 'SUBMITTING' });
    setProgress('任务提交中...', 'info', 10);
    const parameters = collectParameters();
    const body = {
        provider: state.provider,
        apiKey: activeApiKey(),
        prompt: inputValue('prompt').trim(),
        assets: state.assets,
        parameters
    };
    setProgress(`参数已确认，时长 ${parameters.duration ?? '自动'}s`, 'info', 15);
    const response = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    const payload = await parseJsonResponse(response);
    state.task = {
        provider: payload.provider,
        taskId: payload.taskId,
        status: payload.status
    };
    setTaskMeta(state.task);
    setJson(payload);
    byId('poll').disabled = !payload.taskId;
    showStage('任务已提交');
    if (payload.taskId) {
        setProgress(`任务已提交，Task ID: ${payload.taskId}`, 'info', 20);
        startPolling();
    }
    else {
        setProgress('任务提交成功但未获取到 Task ID', 'error');
    }
}
async function pollTask() {
    if (!state.task?.provider || !state.task.taskId)
        return;
    persistSettings();
    showStage('查询中');
    setProgress('查询任务状态...');
    const response = await fetch(`/api/tasks/${state.task.provider}/${encodeURIComponent(state.task.taskId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            apiKey: activeApiKey()
        })
    });
    const payload = await parseJsonResponse(response);
    state.task.status = payload.status;
    setTaskMeta(state.task);
    setJson(payload);
    if (payload.done) {
        setProgress('视频生成完成！', 'success');
        showStage('已完成', payload.videoUrl);
        stopPolling();
    }
    else {
        setProgress(`状态: ${payload.status || '处理中'}`);
        showStage('处理中', payload.videoUrl);
    }
}
function wireEvents() {
    document.querySelectorAll('.switcher button').forEach((button) => {
        button.addEventListener('click', () => {
            state.provider = button.dataset.provider;
            document.querySelectorAll('.switcher button').forEach((item) => {
                item.classList.toggle('active', item === button);
            });
            updateProviderFields();
        });
    });
    const dropzone = byId('dropzone');
    dropzone.addEventListener('dragover', (event) => {
        event.preventDefault();
        dropzone.classList.add('dragover');
    });
    dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
    dropzone.addEventListener('drop', async (event) => {
        event.preventDefault();
        dropzone.classList.remove('dragover');
        try {
            await uploadFiles(event.dataTransfer?.files || []);
        }
        catch (error) {
            const message = error instanceof Error ? error.message : '上传失败';
            showStage(message);
            setProgress(`上传失败: ${message}`, 'error');
        }
    });
    const fileInput = byId('fileInput');
    fileInput.addEventListener('change', async () => {
        try {
            await uploadFiles(fileInput.files || []);
            fileInput.value = '';
        }
        catch (error) {
            const message = error instanceof Error ? error.message : '上传失败';
            showStage(message);
            setProgress(`上传失败: ${message}`, 'error');
        }
    });
    byId('addUrl').addEventListener('click', () => {
        const url = inputValue('remoteUrl').trim();
        const kind = inputValue('remoteKind');
        if (!url)
            return;
        addAssets([{ id: crypto.randomUUID(), name: url.split('/').pop() || url, kind, url }]);
        setProgress(`添加远程素材: ${url.split('/').pop() || url}`);
        setInputValue('remoteUrl', '');
    });
    assetList.addEventListener('click', (event) => {
        const target = event.target;
        const removeBtn = target.closest('[data-remove]');
        if (removeBtn) {
            state.assets = state.assets.filter((asset) => asset.id !== removeBtn.dataset.remove);
            autoSetPrimary();
            renderAssets();
            return;
        }
        const primaryBtn = target.closest('[data-set-primary]');
        if (primaryBtn) {
            setPrimaryAsset(primaryBtn.dataset.setPrimary || '');
        }
    });
    byId('clearAssets').addEventListener('click', () => {
        state.assets = [];
        state.previewIndex = 0;
        renderAssets();
    });
    inputStage.addEventListener('click', (event) => {
        const tab = event.target.closest('[data-preview-index]');
        if (!tab)
            return;
        state.previewIndex = Number(tab.dataset.previewIndex);
        renderInputPreview();
    });
    byId('generate').addEventListener('click', async () => {
        try {
            await generate();
        }
        catch (error) {
            const message = error instanceof Error ? error.message : '调用失败';
            showStage(message);
            setJson({ error: message });
            setTaskMeta({ provider: state.provider, status: 'ERROR' });
            setProgress(`提交失败: ${message}`, 'error');
        }
    });
    byId('poll').addEventListener('click', async () => {
        try {
            await pollTask();
        }
        catch (error) {
            const message = error instanceof Error ? error.message : '查询失败';
            showStage(message);
            setJson({ error: message });
            setProgress(`查询失败: ${message}`, 'error');
        }
    });
    byId('copyJson').addEventListener('click', async () => {
        await navigator.clipboard.writeText(JSON.stringify(state.lastJson, null, 2));
    });
    byId('clearLog').addEventListener('click', resetProgress);
    ['aliKey', 'byteKey'].forEach((id) => {
        byId(id).addEventListener('change', persistSettings);
    });
}
restoreSettings();
updateProviderFields();
wireEvents();
healthCheck();
setJson({});
renderInputPreview();
window.addEventListener('load', () => lucide.createIcons());
//# sourceMappingURL=app.js.map