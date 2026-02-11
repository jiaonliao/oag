'use strict';

(() => {
  const state = {
    assets: [],
    filteredAssets: [],
    filterCounts: { all: 0, agent: 0, skill: 0, mcp: 0 },
    query: '',
    queryRaw: '',
    activeType: 'all',
    baseCounts: { total: 0, agent: 0, skill: 0, mcp: 0 },
    loadError: '',
    selectedAssetId: '',
    selectedFileIndex: -1,
    isDetailOpen: false,
    lastFocusedElement: null,
    detailCloseTimer: null,
    historyStateSynced: false,
  };

  const elements = {
    generatedAt: document.getElementById('generatedAt'),
    visibleCount: document.getElementById('visibleCount'),
    activeFilter: document.getElementById('activeFilter'),
    filterCountAll: document.getElementById('filterCountAll'),
    filterCountAgent: document.getElementById('filterCountAgent'),
    filterCountSkill: document.getElementById('filterCountSkill'),
    filterCountMcp: document.getElementById('filterCountMcp'),
    totalStat: document.getElementById('totalStat'),
    agentStat: document.getElementById('agentStat'),
    skillStat: document.getElementById('skillStat'),
    mcpStat: document.getElementById('mcpStat'),
    resultSummary: document.getElementById('resultSummary'),
    searchInput: document.getElementById('searchInput'),
    filterButtons: Array.from(document.querySelectorAll('.filter-btn')),
    assetGrid: document.getElementById('assetGrid'),
    emptyState: document.getElementById('emptyState'),
    resetFiltersBtn: document.getElementById('resetFiltersBtn'),
    emptyResetBtn: document.getElementById('emptyResetBtn'),
    assetDetailView: document.getElementById('assetDetailView'),
    detailScrim: document.getElementById('detailScrim'),
    closeDetailBtn: document.getElementById('closeDetailBtn'),
    detailTitle: document.getElementById('detailTitle'),
    detailSubtitle: document.getElementById('detailSubtitle'),
    detailAssetId: document.getElementById('detailAssetId'),
    detailAssetDir: document.getElementById('detailAssetDir'),
    detailAssetTools: document.getElementById('detailAssetTools'),
    detailAssetDescription: document.getElementById('detailAssetDescription'),
    detailFileCount: document.getElementById('detailFileCount'),
    detailFileList: document.getElementById('detailFileList'),
    detailPreviewTitle: document.getElementById('detailPreviewTitle'),
    detailPreviewMeta: document.getElementById('detailPreviewMeta'),
    detailPreviewNotice: document.getElementById('detailPreviewNotice'),
    detailPreviewCode: document.getElementById('detailPreviewCode'),
    detailPreviewCodeContent: document.getElementById('detailPreviewCodeContent'),
    detailPreviewFallback: document.getElementById('detailPreviewFallback'),
    detailPreviewMarkdown: document.getElementById('detailPreviewMarkdown'),
  };

  const DEFAULT_EMPTY_TITLE = 'No assets found';
  const DEFAULT_EMPTY_MESSAGE = 'Try another keyword or reset the active filters.';
  const DETAIL_TRANSITION_MS = 220;
  const DETAIL_HISTORY_KEY = '__oag_detail_view__';

  const debounce = (fn, delayMs) => {
    let timer = null;
    return (...args) => {
      if (timer) {
        clearTimeout(timer);
      }
      timer = setTimeout(() => fn(...args), delayMs);
    };
  };

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    configureCodeHighlighter();
    bindEvents();
    await loadAssets();
    applyFilters();
    updateActiveFilterButtons();
    render();
  }

  function configureCodeHighlighter() {
    if (!window.hljs || typeof window.hljs.configure !== 'function') {
      console.warn('[preview] highlight.js is unavailable; code preview falls back to plain text.');
      return;
    }

    window.hljs.configure({
      ignoreUnescapedHTML: true,
      throwUnescapedHTML: false,
    });
  }

  function bindEvents() {
    const onSearch = debounce((value) => {
      const queryRaw = value.trim();
      state.queryRaw = queryRaw;
      state.query = queryRaw.toLowerCase();
      applyFilters();
      render();
    }, 140);

    elements.searchInput.addEventListener('input', (event) => {
      onSearch(event.target.value);
    });

    elements.filterButtons.forEach((button) => {
      button.addEventListener('click', () => {
        state.activeType = button.dataset.type || 'all';
        updateActiveFilterButtons();
        applyFilters();
        render();
      });
    });

    elements.assetGrid.addEventListener('click', (event) => {
      const triggerElement = event.target.closest('[data-item-index]');
      if (!triggerElement || !elements.assetGrid.contains(triggerElement)) {
        return;
      }

      const itemIndex = Number.parseInt(triggerElement.dataset.itemIndex || '-1', 10);
      openDetailByIndex(itemIndex, triggerElement);
    });

    elements.assetGrid.addEventListener('keydown', (event) => {
      const card = event.target.closest('.asset-card[data-item-index]');
      if (!card) {
        return;
      }

      if (event.key !== 'Enter' && event.key !== ' ') {
        return;
      }

      event.preventDefault();
      const itemIndex = Number.parseInt(card.dataset.itemIndex || '-1', 10);
      openDetailByIndex(itemIndex, card);
    });

    elements.resetFiltersBtn.addEventListener('click', resetFilters);
    if (elements.emptyResetBtn) {
      elements.emptyResetBtn.addEventListener('click', resetFilters);
    }

    elements.closeDetailBtn.addEventListener('click', requestCloseDetail);
    elements.detailScrim.addEventListener('click', requestCloseDetail);

    elements.detailFileList.addEventListener('click', (event) => {
      const fileButton = event.target.closest('.detail-file-btn');
      if (!fileButton || fileButton.disabled) {
        return;
      }

      const fileIndex = Number.parseInt(fileButton.dataset.fileIndex || '-1', 10);
      if (!Number.isInteger(fileIndex) || fileIndex < 0) {
        return;
      }

      selectFileIndex(fileIndex, { shouldFocus: false });
    });

    elements.detailFileList.addEventListener('keydown', handleDetailFileListKeydown);

    document.addEventListener('keydown', (event) => {
      if (state.isDetailOpen) {
        if (event.key === 'Escape') {
          event.preventDefault();
          requestCloseDetail();
          return;
        }

        if (event.key === 'Tab') {
          trapDetailFocus(event);
        }
        return;
      }

      if (shouldFocusSearchShortcut(event)) {
        event.preventDefault();
        focusSearchInput();
        return;
      }

      if (event.key === 'Escape' && (state.query || state.activeType !== 'all')) {
        event.preventDefault();
        resetFilters();
      }
    });

    window.addEventListener('popstate', handlePopState);
  }

  function resetFilters() {
    state.activeType = 'all';
    state.query = '';
    state.queryRaw = '';
    elements.searchInput.value = '';
    updateActiveFilterButtons();
    applyFilters();
    render();
  }

  async function loadAssets() {
    try {
      const response = await fetch('./data/assets.json', { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const payload = await response.json();
      state.assets = normalizeItems(payload.items);
      state.baseCounts = normalizeCounts(payload.counts, state.assets);
      state.loadError = '';

      updateGeneratedAt(payload.generatedAt);
      updateBaseStats();
    } catch (error) {
      state.assets = [];
      state.filteredAssets = [];
      state.loadError = `Failed to load assets: ${error.message}`;
      updateGeneratedAt('');
      updateBaseStats();
    }
  }

  function normalizeItems(rawItems) {
    if (!Array.isArray(rawItems)) {
      return [];
    }

    return rawItems.map((item) => {
      const files = Array.isArray(item.files) ? item.files.map(normalizeFileEntry).filter(Boolean) : [];
      const tools = Array.isArray(item.tools) ? item.tools : [];

      const normalized = {
        id: typeof item.id === 'string' ? item.id : `${item.type || 'unknown'}/${item.name || 'unknown'}`,
        name: typeof item.name === 'string' ? item.name : 'unknown',
        type: typeof item.type === 'string' ? item.type : 'unknown',
        description: typeof item.description === 'string' ? item.description : '',
        tools,
        dir: typeof item.dir === 'string' ? item.dir : '-',
        files,
      };

      normalized.searchIndex = [
        normalized.name,
        normalized.id,
        normalized.type,
        normalized.description,
        normalized.dir,
        normalized.tools.join(' '),
        normalized.files.map((file) => file.source || '').join(' '),
      ]
        .join(' ')
        .toLowerCase();

      return normalized;
    });
  }

  function normalizeFileEntry(file) {
    if (!file || typeof file !== 'object') {
      return null;
    }

    const format = typeof file.format === 'string' ? file.format.toLowerCase() : '';
    const normalizedFormat = format === 'markdown' || format === 'code' || format === 'text' ? format : 'text';
    const language = typeof file.language === 'string' ? file.language.trim().toLowerCase() : '';

    return {
      ...file,
      source: typeof file.source === 'string' ? file.source : '',
      format: normalizedFormat,
      language,
    };
  }

  function normalizeCounts(rawCounts, assets) {
    const fallback = {
      total: assets.length,
      agent: assets.filter((item) => item.type === 'agent').length,
      skill: assets.filter((item) => item.type === 'skill').length,
      mcp: assets.filter((item) => item.type === 'mcp').length,
    };

    if (!rawCounts || typeof rawCounts !== 'object') {
      return fallback;
    }

    return {
      total: toSafeNumber(rawCounts.total, fallback.total),
      agent: toSafeNumber(rawCounts.agent, fallback.agent),
      skill: toSafeNumber(rawCounts.skill, fallback.skill),
      mcp: toSafeNumber(rawCounts.mcp, fallback.mcp),
    };
  }

  function toSafeNumber(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  function matchesQuery(item) {
    if (!state.query) {
      return true;
    }

    return item.searchIndex.includes(state.query);
  }

  function summarizeCounts(items) {
    return {
      all: items.length,
      agent: items.filter((item) => item.type === 'agent').length,
      skill: items.filter((item) => item.type === 'skill').length,
      mcp: items.filter((item) => item.type === 'mcp').length,
    };
  }

  function applyFilters() {
    const queryMatchedAssets = state.assets.filter((item) => matchesQuery(item));
    state.filterCounts = summarizeCounts(queryMatchedAssets);

    state.filteredAssets = queryMatchedAssets.filter((item) => {
      if (state.activeType !== 'all' && item.type !== state.activeType) {
        return false;
      }

      return true;
    });
  }

  function render() {
    renderVisibleCount();
    renderFilterCounts();
    renderActiveFilter();
    renderResultSummary();
    renderAssetGrid();

    if (state.isDetailOpen) {
      renderDetailView();
    }
  }

  function updateGeneratedAt(rawValue) {
    if (!rawValue) {
      elements.generatedAt.textContent = '-';
      return;
    }

    const parsed = new Date(rawValue);
    if (Number.isNaN(parsed.getTime())) {
      elements.generatedAt.textContent = rawValue;
      return;
    }

    elements.generatedAt.textContent = new Intl.DateTimeFormat(undefined, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(parsed);
  }

  function updateBaseStats() {
    elements.totalStat.textContent = formatCount(state.baseCounts.total || 0);
    elements.agentStat.textContent = formatCount(state.baseCounts.agent || 0);
    elements.skillStat.textContent = formatCount(state.baseCounts.skill || 0);
    elements.mcpStat.textContent = formatCount(state.baseCounts.mcp || 0);
  }

  function renderVisibleCount() {
    elements.visibleCount.textContent = formatCount(state.filteredAssets.length);
  }

  function renderFilterCounts() {
    if (elements.filterCountAll) {
      elements.filterCountAll.textContent = formatCount(state.filterCounts.all || 0);
    }
    if (elements.filterCountAgent) {
      elements.filterCountAgent.textContent = formatCount(state.filterCounts.agent || 0);
    }
    if (elements.filterCountSkill) {
      elements.filterCountSkill.textContent = formatCount(state.filterCounts.skill || 0);
    }
    if (elements.filterCountMcp) {
      elements.filterCountMcp.textContent = formatCount(state.filterCounts.mcp || 0);
    }
  }

  function renderActiveFilter() {
    elements.activeFilter.textContent = state.activeType === 'all' ? 'All' : capitalize(state.activeType);
  }

  function renderResultSummary() {
    const totalCount = state.baseCounts.total || state.assets.length;
    const visibleCount = state.filteredAssets.length;
    const typeLabel = capitalize(state.activeType);

    if (state.loadError) {
      elements.resultSummary.textContent = 'Data unavailable';
      return;
    }

    if (state.queryRaw && state.activeType !== 'all') {
      elements.resultSummary.textContent = `${formatCount(visibleCount)} ${typeLabel} assets for "${state.queryRaw}"`;
      return;
    }

    if (state.queryRaw) {
      elements.resultSummary.textContent = `${formatCount(visibleCount)} assets for "${state.queryRaw}"`;
      return;
    }

    if (state.activeType !== 'all') {
      elements.resultSummary.textContent = `${formatCount(visibleCount)} ${typeLabel} assets`;
      return;
    }

    elements.resultSummary.textContent = `Showing ${formatCount(totalCount)} assets`;
  }

  function renderAssetGrid() {
    elements.assetGrid.innerHTML = '';

    if (state.filteredAssets.length === 0) {
      elements.emptyState.hidden = false;
      const title = elements.emptyState.querySelector('h3');
      const message = elements.emptyState.querySelector('p');

      if (state.loadError) {
        title.textContent = 'Data unavailable';
        message.textContent = state.loadError;
      } else {
        title.textContent = DEFAULT_EMPTY_TITLE;

        if (state.queryRaw && state.activeType !== 'all') {
          message.textContent = `No ${capitalize(state.activeType)} assets match "${state.queryRaw}".`;
        } else if (state.queryRaw) {
          message.textContent = `No assets match "${state.queryRaw}".`;
        } else if (state.activeType !== 'all') {
          message.textContent = `No ${capitalize(state.activeType)} assets available for this filter.`;
        } else {
          message.textContent = DEFAULT_EMPTY_MESSAGE;
        }
      }
      return;
    }

    elements.emptyState.hidden = true;

    state.filteredAssets.forEach((item, itemIndex) => {
      elements.assetGrid.appendChild(createAssetCard(item, itemIndex));
    });
  }

  function createAssetCard(item, itemIndex) {
    const card = document.createElement('article');
    card.className = 'asset-card';
    card.style.setProperty('--card-stagger', String(itemIndex % 14));
    card.tabIndex = 0;
    card.dataset.itemIndex = String(itemIndex);
    card.dataset.interactive = 'card';
    card.setAttribute('role', 'button');
    card.setAttribute('aria-keyshortcuts', 'Enter Space');
    card.setAttribute('aria-label', `Open detail for ${item.name}`);

    const header = document.createElement('div');
    header.className = 'card-head';

    const name = document.createElement('h3');
    name.className = 'card-name';
    name.textContent = item.name;

    const typeChip = document.createElement('span');
    typeChip.className = `type-chip ${classForType(item.type)}`;
    typeChip.textContent = item.type;

    header.appendChild(name);
    header.appendChild(typeChip);

    const description = document.createElement('p');
    description.className = 'card-desc';
    description.textContent = item.description || 'No description provided.';

    const meta = document.createElement('div');
    meta.className = 'card-meta';
    meta.appendChild(createMetaLine('ID', item.id));
    meta.appendChild(createMetaLine('Path', item.dir));

    const toolsList = document.createElement('ul');
    toolsList.className = 'tools-list';
    if (item.tools.length === 0) {
      toolsList.appendChild(createToolChip('No tools specified'));
    } else {
      item.tools.forEach((tool) => {
        toolsList.appendChild(createToolChip(tool));
      });
    }

    const footer = document.createElement('div');
    footer.className = 'card-footer';

    const fileCount = document.createElement('span');
    fileCount.className = 'file-count';
    fileCount.textContent = `${formatCount(item.files.length)} file${item.files.length === 1 ? '' : 's'}`;

    const detailButton = document.createElement('button');
    detailButton.className = 'asset-detail-btn';
    detailButton.type = 'button';
    detailButton.textContent = 'Open full detail';
    detailButton.dataset.itemIndex = String(itemIndex);
    detailButton.setAttribute('aria-label', `Open detail for ${item.name}`);

    footer.appendChild(fileCount);
    footer.appendChild(detailButton);

    card.appendChild(header);
    card.appendChild(description);
    card.appendChild(meta);
    card.appendChild(toolsList);
    card.appendChild(footer);

    return card;
  }

  function createMetaLine(label, value) {
    const line = document.createElement('div');
    line.className = 'card-meta-line';

    const labelElement = document.createElement('span');
    labelElement.className = 'card-meta-label';
    labelElement.textContent = label;

    const valueElement = document.createElement('span');
    valueElement.className = 'card-meta-value';
    valueElement.textContent = value;
    valueElement.title = value;

    line.appendChild(labelElement);
    line.appendChild(valueElement);
    return line;
  }

  function createToolChip(content) {
    const chip = document.createElement('li');
    chip.className = 'tool-chip';
    chip.textContent = content;
    return chip;
  }

  function openDetailByIndex(itemIndex, triggerElement) {
    const asset = state.filteredAssets[itemIndex];
    if (!asset) {
      return;
    }

    openDetailForAsset(asset, triggerElement);
  }

  function openDetailForAsset(asset, triggerElement) {
    if (state.detailCloseTimer) {
      clearTimeout(state.detailCloseTimer);
      state.detailCloseTimer = null;
    }

    state.lastFocusedElement = triggerElement instanceof HTMLElement ? triggerElement : null;
    state.selectedAssetId = asset.id;
    state.selectedFileIndex = findInitialFileIndex(asset);

    if (!state.isDetailOpen) {
      state.isDetailOpen = true;
      elements.assetDetailView.hidden = false;
      document.body.classList.add('detail-open');

      requestAnimationFrame(() => {
        elements.assetDetailView.classList.add('is-open');
      });

      requestAnimationFrame(() => {
        elements.closeDetailBtn.focus();
      });
    }

    syncHistoryOnOpen(asset.id);
    renderDetailView();
  }

  function syncHistoryOnOpen(assetId) {
    if (state.historyStateSynced) {
      return;
    }

    const currentState = window.history.state && typeof window.history.state === 'object' ? window.history.state : {};
    const nextState = { ...currentState, [DETAIL_HISTORY_KEY]: assetId };
    window.history.pushState(nextState, '');
    state.historyStateSynced = true;
  }

  function requestCloseDetail() {
    if (!state.isDetailOpen) {
      return;
    }

    if (state.historyStateSynced) {
      window.history.back();

      setTimeout(() => {
        if (state.isDetailOpen) {
          closeDetailView({ fromHistory: true });
        }
      }, DETAIL_TRANSITION_MS + 120);
      return;
    }

    closeDetailView({ fromHistory: true });
  }

  function handlePopState() {
    if (!state.isDetailOpen) {
      return;
    }

    closeDetailView({ fromHistory: true });
  }

  function closeDetailView({ fromHistory = false } = {}) {
    if (!state.isDetailOpen) {
      return;
    }

    state.isDetailOpen = false;
    state.selectedAssetId = '';
    state.selectedFileIndex = -1;

    if (fromHistory) {
      state.historyStateSynced = false;
    }

    elements.assetDetailView.classList.remove('is-open');
    document.body.classList.remove('detail-open');

    if (state.lastFocusedElement && state.lastFocusedElement.isConnected) {
      state.lastFocusedElement.focus();
    }
    state.lastFocusedElement = null;

    if (state.detailCloseTimer) {
      clearTimeout(state.detailCloseTimer);
    }

    state.detailCloseTimer = setTimeout(() => {
      elements.assetDetailView.hidden = true;
      clearDetailContent();
      state.detailCloseTimer = null;
    }, DETAIL_TRANSITION_MS);
  }

  function renderDetailView() {
    if (!state.isDetailOpen) {
      return;
    }

    const asset = state.assets.find((item) => item.id === state.selectedAssetId);
    if (!asset) {
      requestCloseDetail();
      return;
    }

    elements.detailTitle.textContent = asset.name;
    elements.detailSubtitle.textContent = `${capitalize(asset.type)} asset`;
    elements.detailAssetId.textContent = asset.id;
    elements.detailAssetDir.textContent = asset.dir;
    elements.detailAssetTools.textContent = asset.tools.length > 0 ? asset.tools.join(', ') : 'None';
    elements.detailAssetDescription.textContent = asset.description || 'No description provided.';
    elements.detailFileCount.textContent = `${formatCount(asset.files.length)} total`;

    if (state.selectedFileIndex >= asset.files.length || state.selectedFileIndex < 0) {
      state.selectedFileIndex = findInitialFileIndex(asset);
    }

    renderDetailFileList(asset);
    renderDetailPreview(asset);
  }

  function renderDetailFileList(asset) {
    elements.detailFileList.innerHTML = '';

    if (asset.files.length === 0) {
      const item = document.createElement('li');
      item.className = 'detail-file-item';

      const button = document.createElement('button');
      button.className = 'detail-file-btn';
      button.type = 'button';
      button.disabled = true;

      const name = document.createElement('span');
      name.className = 'detail-file-name';
      name.textContent = 'No files declared';

      const status = document.createElement('span');
      status.className = 'detail-file-status';
      status.textContent = 'This asset does not define any file entries.';

      button.appendChild(name);
      button.appendChild(status);
      item.appendChild(button);
      elements.detailFileList.appendChild(item);
      return;
    }

    asset.files.forEach((file, fileIndex) => {
      const listItem = document.createElement('li');
      listItem.className = 'detail-file-item';

      const button = document.createElement('button');
      button.className = 'detail-file-btn';
      button.type = 'button';
      button.dataset.fileIndex = String(fileIndex);

      const hasPreview = typeof file.preview === 'string' && file.preview.length > 0;
      if (!hasPreview) {
        button.disabled = true;
      }

      if (fileIndex === state.selectedFileIndex && hasPreview) {
        button.classList.add('is-active');
        button.setAttribute('aria-current', 'true');
      } else {
        button.setAttribute('aria-current', 'false');
      }

      const name = document.createElement('span');
      name.className = 'detail-file-name';
      name.textContent = file.source || '(unknown file)';

      const status = document.createElement('span');
      status.className = 'detail-file-status';
      status.textContent = describeFileStatus(file, hasPreview);

      if (!hasPreview && file.previewError) {
        button.title = file.previewError;
      }

      button.appendChild(name);
      button.appendChild(status);
      listItem.appendChild(button);
      elements.detailFileList.appendChild(listItem);
    });
  }

  function handleDetailFileListKeydown(event) {
    const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End'];
    if (!keys.includes(event.key)) {
      return;
    }

    const currentButton = event.target.closest('.detail-file-btn');
    if (!currentButton || currentButton.disabled) {
      return;
    }

    const interactiveButtons = Array.from(elements.detailFileList.querySelectorAll('.detail-file-btn:not([disabled])'));
    if (interactiveButtons.length === 0) {
      return;
    }

    const currentIndex = interactiveButtons.indexOf(currentButton);
    if (currentIndex < 0) {
      return;
    }

    let nextIndex = currentIndex;
    if (event.key === 'ArrowDown') {
      nextIndex = Math.min(currentIndex + 1, interactiveButtons.length - 1);
    } else if (event.key === 'ArrowUp') {
      nextIndex = Math.max(currentIndex - 1, 0);
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = interactiveButtons.length - 1;
    }

    if (nextIndex === currentIndex) {
      return;
    }

    event.preventDefault();
    const nextButton = interactiveButtons[nextIndex];
    const fileIndex = Number.parseInt(nextButton.dataset.fileIndex || '-1', 10);
    if (!Number.isInteger(fileIndex) || fileIndex < 0) {
      return;
    }

    selectFileIndex(fileIndex, { shouldFocus: true });
  }

  function selectFileIndex(fileIndex, { shouldFocus }) {
    state.selectedFileIndex = fileIndex;
    renderDetailView();

    if (!shouldFocus) {
      return;
    }

    const button = elements.detailFileList.querySelector(`.detail-file-btn[data-file-index="${fileIndex}"]`);
    if (button instanceof HTMLElement) {
      button.focus();
    }
  }

  function describeFileStatus(file, hasPreview) {
    if (hasPreview) {
      if (file.format === 'markdown') {
        return 'Markdown preview available';
      }
      if (file.format === 'code') {
        return 'Code preview available';
      }
      return 'Text preview available';
    }

    if (file.previewError) {
      return file.previewError;
    }

    return 'No preview available';
  }

  function renderDetailPreview(asset) {
    const file = asset.files[state.selectedFileIndex];
    if (!file) {
      elements.detailPreviewTitle.textContent = 'Select a file';
      elements.detailPreviewMeta.textContent = 'Choose a file from the list.';
      clearPreviewArea();
      return;
    }

    elements.detailPreviewTitle.textContent = file.source || '(unknown file)';
    elements.detailPreviewMeta.textContent = describePreviewMeta(file);

    const hasPreview = typeof file.preview === 'string' && file.preview.length > 0;
    if (!hasPreview) {
      setPreviewNotice(file.previewError || 'No preview available for this file.');
      clearPreviewBodies();
      return;
    }

    const notices = [];
    if (file.truncated) {
      notices.push('Showing only the first 120 lines.');
    }
    if (file.previewError) {
      notices.push(file.previewError);
    }
    setPreviewNotice(notices.join(' '));

    if (file.format === 'code' || file.format === 'markdown') {
      const previewLanguage = file.format === 'markdown' ? 'markdown' : file.language;
      renderCodePreview(file.preview, previewLanguage);
      return;
    }

    renderPlainTextPreview(file.preview);
  }

  function describePreviewMeta(file) {
    if (file.format === 'markdown') {
      return 'Markdown source preview (highlighted)';
    }

    if (file.format === 'code') {
      const languageLabel = normalizeHighlightLanguage(file.language);
      return languageLabel ? 'Code preview (' + languageLabel + ')' : 'Code preview';
    }

    return 'Text preview';
  }

  function canHighlightCode() {
    return Boolean(window.hljs && typeof window.hljs.highlightElement === 'function');
  }

  function normalizeHighlightLanguage(language) {
    if (typeof language !== 'string') {
      return '';
    }

    const normalized = language.trim().toLowerCase();
    if (!normalized) {
      return '';
    }

    const aliases = {
      js: 'javascript',
      ts: 'typescript',
      py: 'python',
      sh: 'bash',
      md: 'markdown',
    };

    return aliases[normalized] || normalized;
  }

  function resolveHighlightLanguage(language) {
    const normalized = normalizeHighlightLanguage(language);
    if (!normalized) {
      return '';
    }

    const candidates = [normalized];
    if (normalized === 'markdown') {
      candidates.push('md');
    }

    if (!window.hljs || typeof window.hljs.getLanguage !== 'function') {
      return normalized;
    }

    const available = candidates.find((candidate) => window.hljs.getLanguage(candidate));
    return available || '';
  }

  function renderCodePreview(content, language) {
    clearPreviewBodies();

    const highlighterReady = canHighlightCode();
    const resolvedLanguage = resolveHighlightLanguage(language);

    elements.detailPreviewCode.hidden = false;

    if (!highlighterReady || typeof window.hljs.highlight !== 'function') {
      elements.detailPreviewCodeContent.textContent = content;
      return;
    }

    try {
      const highlighted = resolvedLanguage
        ? window.hljs.highlight(content, { language: resolvedLanguage, ignoreIllegals: true })
        : window.hljs.highlightAuto(content);

      elements.detailPreviewCodeContent.innerHTML = highlighted.value;
      elements.detailPreviewCodeContent.classList.add('hljs');
      if (resolvedLanguage) {
        elements.detailPreviewCodeContent.classList.add('language-' + resolvedLanguage);
      }
    } catch {
      elements.detailPreviewCodeContent.textContent = content;
      window.hljs.highlightElement(elements.detailPreviewCodeContent);
    }
  }

  function renderPlainTextPreview(content) {
    clearPreviewBodies();
    elements.detailPreviewFallback.textContent = content;
    elements.detailPreviewFallback.hidden = false;
  }

  function setPreviewNotice(message) {
    if (!message) {
      elements.detailPreviewNotice.textContent = '';
      elements.detailPreviewNotice.hidden = true;
      return;
    }

    elements.detailPreviewNotice.textContent = message;
    elements.detailPreviewNotice.hidden = false;
  }

  function clearPreviewBodies() {
    elements.detailPreviewCode.hidden = true;
    elements.detailPreviewCodeContent.textContent = '';
    elements.detailPreviewCodeContent.className = '';
    elements.detailPreviewFallback.textContent = '';
    elements.detailPreviewFallback.hidden = true;
    elements.detailPreviewMarkdown.innerHTML = '';
    elements.detailPreviewMarkdown.hidden = true;
  }

  function clearPreviewArea() {
    setPreviewNotice('');
    clearPreviewBodies();
  }

  function clearDetailContent() {
    elements.detailTitle.textContent = '-';
    elements.detailSubtitle.textContent = '-';
    elements.detailAssetId.textContent = '-';
    elements.detailAssetDir.textContent = '-';
    elements.detailAssetTools.textContent = '-';
    elements.detailAssetDescription.textContent = '-';
    elements.detailFileCount.textContent = '0 total';
    elements.detailFileList.innerHTML = '';
    elements.detailPreviewTitle.textContent = 'Select a file';
    elements.detailPreviewMeta.textContent = 'Choose a file from the list.';
    clearPreviewArea();
  }

  function findInitialFileIndex(asset) {
    if (!Array.isArray(asset.files) || asset.files.length === 0) {
      return -1;
    }

    const previewable = asset.files.findIndex((file) => typeof file.preview === 'string' && file.preview.length > 0);
    return previewable >= 0 ? previewable : 0;
  }

  function trapDetailFocus(event) {
    const focusable = getDetailFocusableElements();
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;

    if (event.shiftKey && (active === first || active === elements.assetDetailView)) {
      event.preventDefault();
      last.focus();
      return;
    }

    if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function getDetailFocusableElements() {
    const selectors = [
      'button:not([disabled])',
      '[href]',
      'input:not([disabled])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[tabindex]:not([tabindex="-1"])',
    ];

    return Array.from(elements.assetDetailView.querySelectorAll(selectors.join(','))).filter((node) => {
      if (!(node instanceof HTMLElement)) {
        return false;
      }
      return node.offsetParent !== null || node === document.activeElement;
    });
  }

  function shouldFocusSearchShortcut(event) {
    if (event.defaultPrevented || event.altKey || event.shiftKey) {
      return false;
    }

    if (isEditableTarget(event.target)) {
      return false;
    }

    if (event.key === '/') {
      return true;
    }

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      return true;
    }

    return false;
  }

  function isEditableTarget(target) {
    if (!(target instanceof HTMLElement)) {
      return false;
    }

    if (target.isContentEditable) {
      return true;
    }

    const tagName = target.tagName.toLowerCase();
    return tagName === 'input' || tagName === 'textarea' || tagName === 'select';
  }

  function focusSearchInput() {
    elements.searchInput.focus();
    elements.searchInput.select();
  }

  function formatCount(value) {
    const parsed = Number.parseInt(value, 10);
    const safe = Number.isFinite(parsed) ? parsed : 0;
    return new Intl.NumberFormat(undefined).format(safe);
  }

  function updateActiveFilterButtons() {
    elements.filterButtons.forEach((button) => {
      const isActive = button.dataset.type === state.activeType;
      const wasActive = button.dataset.wasActive === 'true';

      button.classList.toggle('is-active', isActive);
      button.setAttribute('aria-pressed', String(isActive));

      if (isActive && !wasActive) {
        button.classList.remove('is-activating');
        void button.offsetWidth;
        button.classList.add('is-activating');
      }

      if (!isActive) {
        button.classList.remove('is-activating');
      }

      button.dataset.wasActive = String(isActive);
    });
  }

  function classForType(type) {
    if (type === 'agent') {
      return 'type-agent';
    }
    if (type === 'skill') {
      return 'type-skill';
    }
    if (type === 'mcp') {
      return 'type-mcp';
    }
    return 'type-other';
  }

  function capitalize(rawValue) {
    if (!rawValue) {
      return '';
    }
    return rawValue[0].toUpperCase() + rawValue.slice(1);
  }
})();
