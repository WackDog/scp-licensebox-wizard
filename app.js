(function () {
  'use strict';

  //api links
  const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
  const EXAMPLE_INPUT = 'https://commons.wikimedia.org/wiki/File:Kievitsbloem.jpg\nFile:Example.jpg';

  const state = {
    input: EXAMPLE_INPUT,
    titles: [],
    items: [],
    loading: false,
    copied: false,
    options: {
      includeSeparators: false,
      includeOptionalEmptyFields: false,
    },
  };

  //Ui vars//
  const els = {
    input: document.querySelector('#link-input'),
    loadExample: document.querySelector('#load-example'),
    fetchButton: document.querySelector('#fetch-button'),
    detectedCount: document.querySelector('#detected-count'),
    detectedList: document.querySelector('#detected-list'),
    errorBox: document.querySelector('#error-box'),
    summaryGrid: document.querySelector('#summary-grid'),
    countTotal: document.querySelector('#count-total'),
    countGreen: document.querySelector('#count-green'),
    countYellow: document.querySelector('#count-yellow'),
    countRed: document.querySelector('#count-red'),
    resultsPanel: document.querySelector('#results-panel'),
    resultsStack: document.querySelector('#results-stack'),
    outputPanel: document.querySelector('#output-panel'),
    output: document.querySelector('#output'),
    includeSeparators: document.querySelector('#include-separators'),
    includeEmptyFields: document.querySelector('#include-empty-fields'),
    copyButton: document.querySelector('#copy-button'),
  };


  function unique(values) {
    return Array.from(new Set(values.filter(Boolean)));
  }

  function stripHtml(value) {
    if (!value) return '';
    const template = document.createElement('template');
    template.innerHTML = String(value);
    template.content.querySelectorAll('script, style, sup.reference').forEach((node) => node.remove());
    return (template.content.textContent || '')
      .replace(/\[edit\]/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function metaValue(extmetadata, key) {
    const raw = extmetadata && extmetadata[key] ? extmetadata[key].value : '';
    return stripHtml(raw);
  }


  function rawMetaValue(extmetadata, key) {
    return extmetadata && extmetadata[key] ? extmetadata[key].value || '' : '';
  }

  function normalizeFileTitle(raw) {
    if (!raw) return null;
    let value = String(raw).trim();
    if (!value) return null;

    value = value.replace(/^[<({\[]+/, '').replace(/[>)}\],.;]+$/, '');

    try {
      value = decodeURIComponent(value);
    } catch (_) {
      // keep original if malformed URL.
    }

    value = value.replace(/_/g, ' ').trim();

    if (/^(file|image):/i.test(value)) {
      return 'File:' + value.replace(/^(file|image):/i, '').trim();
    }

    if (/\.(png|jpe?g|gif|webp|svg|tiff?|bmp|ogg|oga|mp3|wav|webm|mp4)$/i.test(value)) {
      return 'File:' + value;
    }

    return null;
  }


  function titleFromUrl(token) {
    let url;
    try {
      url = new URL(token);
    } catch (_) {
      return normalizeFileTitle(token);
    }

    const host = url.hostname.toLowerCase();
    const path = decodeURIComponent(url.pathname || '').replace(/_/g, ' ');

    //Verify commons links
    if (host === 'commons.wikimedia.org') {
      const titleParam = url.searchParams.get('title');
      const fileFromTitleParam = normalizeFileTitle(titleParam);
      if (fileFromTitleParam) return fileFromTitleParam;

      const wikiMatch = path.match(/\/wiki\/(File:.+)$/i);
      if (wikiMatch) return normalizeFileTitle(wikiMatch[1]);

      const specialFilePathMatch = path.match(/\/wiki\/Special:FilePath\/(.+)$/i);
      if (specialFilePathMatch) return normalizeFileTitle(specialFilePathMatch[1]);
    }

    if (host.endsWith('wikimedia.org')) {
      const parts = path.split('/').filter(Boolean);
      const thumbIndex = parts.findIndex((part) => part.toLowerCase() === 'thumb');
      if (thumbIndex >= 0 && parts.length >= thumbIndex + 5) {
        return normalizeFileTitle(parts[parts.length - 2]);
      }
      const last = parts[parts.length - 1];
      return normalizeFileTitle(last);
    }

    return normalizeFileTitle(token);
  }

  function extractTitles(input) {
    const tokens = String(input || '')
      .split(/[\n\t]+/)
      .flatMap((line) => line.split(/\s+(?=https?:\/\/|File:|Image:)/i))
      .map((part) => part.trim())
      .filter(Boolean);

    return unique(tokens.map(titleFromUrl));
  }

  function chunk(items, size) {
    const chunks = [];
    for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
    return chunks;
  }

  function getFileNameFromTitle(title) {
    return String(title || '').replace(/^File:/i, '').trim();
  }

  function getNameWithoutExtension(filename) {
    return String(filename || '').replace(/\.[^.]+$/, '').trim();
  }

  function newId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    return 'item-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  }


  /*
  checking licenses from metadata, colour code based on compatibility.
  green = compatible
  yellow = review needed
  red = not compatible
  */
  function classifyCompatibility(item) {
    const text = [
      item.licenseShortName,
      item.usageTerms,
      item.license,
      item.licenseUrl,
      item.permission,
      item.nonFree,
      item.copyrighted,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    if (!item.licenseShortName && !item.usageTerms && !item.licenseUrl) {
      return {
        level: 'red',
        label: 'Needs license',
        notes: ['No clear machine-readable license was found.'],
      };
    }

    if (/nonfree|non-free|fair use|all rights reserved/.test(text) || item.nonFree === 'true') {
      return {
        level: 'red',
        label: 'Not acceptable',
        notes: ['Commons metadata suggests this is non-free or restricted.'],
      };
    }

    if (/(^|\W)(nc|noncommercial|non-commercial)(\W|$)/i.test(text)) {
      return {
        level: 'red',
        label: 'NC license',
        notes: ['Non-commercial licenses are not compatible with SCP Wiki image policy.'],
      };
    }

    if (/(^|\W)(nd|no derivatives|no-derivatives)(\W|$)/i.test(text)) {
      return {
        level: 'red',
        label: 'ND license',
        notes: ['No-derivatives licenses are not compatible with SCP Wiki image policy.'],
      };
    }

    if (/cc\s*by(?:\s*-\s*sa)?\s*1\.0/i.test(text)) {
      return {
        level: 'red',
        label: 'Not compatible',
        notes: ['CC BY-SA 1.0 is not compatible because it is not forward-compatible with the SCP Wiki license.'],
      };
    }

    if (/cc0|public domain|pd-|pdm|copyrighted false/.test(text)) {
      return {
        level: 'green',
        label: 'Likely OK',
        notes: ['Public domain or CC0-style metadata detected.'],
      };
    }

    if (/cc\s*by\s*-?\s*sa\s*(2\.0|2\.5|3\.0)/i.test(text)) {
      return {
        level: 'green',
        label: 'Likely OK',
        notes: ['CC BY-SA 2.x/3.0 metadata detected.'],
      };
    }

    if (/cc\s*by\s*(2\.0|2\.5|3\.0)/i.test(text)) {
      return {
        level: 'green',
        label: 'Likely OK',
        notes: ['CC BY 2.x/3.0 metadata detected.'],
      };
    }

    if (/cc\s*by\s*-?\s*sa\s*4\.0|cc\s*by\s*4\.0/i.test(text)) {
      return {
        level: 'yellow',
        label: 'Review branch rules',
        notes: ['CC 4.0 metadata detected. This may be acceptable on SCP EN but should be checked for the target branch.'],
      };
    }

    if (/creative commons|cc-by|cc by|cc-by-sa|cc by-sa/i.test(text)) {
      return {
        level: 'yellow',
        label: 'Review version',
        notes: ['A Creative Commons license was detected, but the version/terms need review.'],
      };
    }

    if (/gfdl|gnu free documentation|free art license|fal/i.test(text)) {
      return {
        level: 'yellow',
        label: 'Review license',
        notes: ['A free license was detected, but it may need manual SCP licensing review.'],
      };
    }

    return {
      level: 'yellow',
      label: 'Review needed',
      notes: ['The license was extracted, but the app cannot confidently classify SCP compatibility.'],
    };
  }


  function formatCommonsPageUrl(title) {
    const withUnderscores = String(title || '').replace(/ /g, '_');
    return 'https://commons.wikimedia.org/wiki/' + encodeURIComponent(withUnderscores).replace(/%3A/i, ':');
  }

  function itemFromPage(page, sourceInput) {
    const imageInfo = page.imageinfo && page.imageinfo[0] ? page.imageinfo[0] : {};
    const ext = imageInfo.extmetadata || {};
    const title = page.title || sourceInput || '';
    const filename = getFileNameFromTitle(title);
    const objectName = metaValue(ext, 'ObjectName') || getNameWithoutExtension(filename);
    const artist = metaValue(ext, 'Artist');
    const attribution = metaValue(ext, 'Attribution');
    const credit = metaValue(ext, 'Credit');
    const licenseShortName = metaValue(ext, 'LicenseShortName');
    const usageTerms = metaValue(ext, 'UsageTerms');
    const licenseUrl = metaValue(ext, 'LicenseUrl');
    const license = metaValue(ext, 'License');
    const permission = metaValue(ext, 'Permission');
    const categories = metaValue(ext, 'Categories');
    const descriptionUrl = imageInfo.descriptionurl || formatCommonsPageUrl(title);

    //item object
    const item = {
      id: newId(),
      found: !page.missing,
      title,
      filename,
      name: objectName,
      author: attribution || artist || credit || '',
      artist,
      attribution,
      credit,
      licenseShortName,
      usageTerms,
      licenseUrl,
      license,
      permission,
      sourceLink: descriptionUrl,
      directUrl: imageInfo.url || '',
      thumbUrl: imageInfo.thumburl || imageInfo.url || '',
      mime: imageInfo.mime || '',
      width: imageInfo.width || null,
      height: imageInfo.height || null,
      copyrighted: metaValue(ext, 'Copyrighted'),
      nonFree: metaValue(ext, 'NonFree'),
      categories,
      notes: '',
      derivativeOf: '',
      rawArtist: rawMetaValue(ext, 'Artist'),
      rawLicense: rawMetaValue(ext, 'LicenseShortName') || rawMetaValue(ext, 'UsageTerms') || rawMetaValue(ext, 'License'),
    };

    item.compatibility = classifyCompatibility(item);
    item.notes = buildDefaultNotes(item);
    return item;
  }

  // Default note to add to the notes section, I think this would be helpful to see which licenseboxes have utilised the wizard, so any particular issues can be reported and fixed on my end.
  function buildDefaultNotes(item) {
    const notes = ['Metadata extracted from Wikimedia Commons using SCP Licensebox Wizard;'];
    if (item.licenseUrl) notes.push('License URL: ' + item.licenseUrl);
    if (item.compatibility && item.compatibility.level !== 'green') notes.push(item.compatibility.notes[0]);
    return unique(notes).join(' ');
  }

  // fetch the data
  async function fetchCommonsMetadata(titles) {
    const results = [];
    for (const titleChunk of chunk(titles, 25)) {
      const params = new URLSearchParams({
        action: 'query',
        format: 'json',
        formatversion: '2',
        origin: '*',
        prop: 'imageinfo',
        titles: titleChunk.join('|'),
        iiprop: 'url|size|mime|extmetadata',
        iiurlwidth: '360',
        redirects: '1',
      });

      const response = await fetch(COMMONS_API + '?' + params.toString());
      if (!response.ok) throw new Error('Commons API returned HTTP ' + response.status + '.');
      const data = await response.json();
      if (data.error) throw new Error(data.error.info || data.error.code || 'Commons API error.');
      const pages = data.query && data.query.pages ? data.query.pages : [];
      pages.forEach((page) => results.push(itemFromPage(page)));
    }
    return results;
  }

  function escapeWikidot(value) {
    return String(value || '').replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function licenseLabel(item) {
    const base = item.licenseShortName || item.usageTerms || item.license || 'Unknown license';
    return escapeWikidot(base);
  }

  //reformat entry
  function buildEntry(item) {
    const includeOptionalEmptyFields = state.options.includeOptionalEmptyFields;
    const lines = [];
    lines.push('> **Filename:** ' + escapeWikidot(item.filename));

    const suggestedName = escapeWikidot(item.name);
    const filenameStem = getNameWithoutExtension(item.filename);
    if (includeOptionalEmptyFields || (suggestedName && suggestedName.toLowerCase() !== filenameStem.toLowerCase())) {
      lines.push('> **Name:** ' + suggestedName);
    }

    lines.push('> **Author:** ' + (escapeWikidot(item.author) || 'UNKNOWN — verify manually'));
    lines.push('> **License:** ' + licenseLabel(item));
    lines.push('> **Source Link:** ' + escapeWikidot(item.sourceLink));

    if (includeOptionalEmptyFields || item.derivativeOf) {
      lines.push('> **Derivative Of:** ' + escapeWikidot(item.derivativeOf));
    }

    if (includeOptionalEmptyFields || item.notes) {
      lines.push('> **Additional Notes:** ' + escapeWikidot(item.notes));
    }

    return lines.join('\n');
  }


  // format into component markup, optional seperator as I see some authors prefer those.
  function buildLicenseBox() {
    const usable = state.items.filter((item) => item.found);
    const entries = usable.map(buildEntry);
    if (entries.length === 0) return '';

    const separator = state.options.includeSeparators ? '\n-----\n' : '\n\n';
    return [
      '[[include :scp-wiki:component:license-box]]',
      state.options.includeSeparators ? '-----' : '',
      entries.join(separator),
      state.options.includeSeparators ? '-----' : '',
      '[[include :scp-wiki:component:license-box-end]]',
    ]
      .filter((line) => line !== '')
      .join('\n');
  }

  //error handling and such 
  function setError(message) {
    if (!message) {
      els.errorBox.textContent = '';
      els.errorBox.classList.add('hidden');
      return;
    }
    els.errorBox.textContent = '✕ ' + message;
    els.errorBox.classList.remove('hidden');
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function statusIcon(level) {
    if (level === 'green') return '✓';
    if (level === 'red') return '✕';
    return '⚠';
  }

  function fieldHtml(item, name, label, value, options) {
    const safeOptions = options || {};
    const safeValue = escapeHtml(value || '');
    if (safeOptions.textarea) {
      return '<label class="field"><span>' + escapeHtml(label) + '</span><textarea data-field="' + escapeHtml(name) + '" rows="3" placeholder="' + escapeHtml(safeOptions.placeholder || '') + '">' + safeValue + '</textarea></label>';
    }
    return '<label class="field"><span>' + escapeHtml(label) + '</span><input data-field="' + escapeHtml(name) + '" value="' + safeValue + '" placeholder="' + escapeHtml(safeOptions.placeholder || '') + '" /></label>';
  }

  function renderResultCard(item) {
    const status = item.compatibility || classifyCompatibility(item);
    if (!item.found) {
      return '<article class="result-card missing-card" data-id="' + escapeHtml(item.id) + '">' +
        '<div class="result-header"><div><h3>' + escapeHtml(item.title) + '</h3><p>Commons could not find this file title.</p></div>' +
        '<button type="button" class="icon-button" data-remove="' + escapeHtml(item.id) + '" aria-label="Remove result">×</button></div>' +
        '</article>';
    }

    const thumb = item.thumbUrl
      ? '<img class="thumb" src="' + escapeHtml(item.thumbUrl) + '" alt="" loading="lazy" />'
      : '<div class="thumb thumb-empty"></div>';

    const notes = (status.notes || []).map((note) => '<p><span class="small-icon">ⓘ</span>' + escapeHtml(note) + '</p>').join('');
    const dimensions = item.width && item.height ? '<span class="mini-pill">' + escapeHtml(item.width + ' × ' + item.height) + '</span>' : '';
    const mime = item.mime ? '<span class="mini-pill">' + escapeHtml(item.mime) + '</span>' : '';

    return '<article class="result-card" data-id="' + escapeHtml(item.id) + '">' +
      '<div class="result-header">' +
        '<div class="result-title-row">' + thumb + '<div><h3>' + escapeHtml(item.filename) + '</h3>' +
          '<div class="meta-row"><span class="status status-' + escapeHtml(status.level) + '">' + statusIcon(status.level) + ' ' + escapeHtml(status.label) + '</span>' + mime + dimensions + '</div>' +
        '</div></div>' +
        '<button type="button" class="icon-button" data-remove="' + escapeHtml(item.id) + '" aria-label="Remove result">×</button>' +
      '</div>' +
      '<div class="warning-list">' + notes + '</div>' +
      '<div class="grid fields-grid">' +
        fieldHtml(item, 'filename', 'Filename used on your SCP page', item.filename) +
        fieldHtml(item, 'name', 'Original name', item.name) +
        fieldHtml(item, 'author', 'Author', item.author) +
        fieldHtml(item, 'licenseShortName', 'License', licenseLabel(item)) +
        fieldHtml(item, 'sourceLink', 'Source link', item.sourceLink) +
        fieldHtml(item, 'derivativeOf', 'Derivative Of', item.derivativeOf, { placeholder: 'Only needed for composites/derivatives' }) +
      '</div>' +
      fieldHtml(item, 'notes', 'Additional notes', item.notes, { textarea: true }) +
      '<details class="raw-details"><summary>Extracted metadata</summary>' +
        '<dl>' +
          '<dt>Artist</dt><dd>' + escapeHtml(item.artist || '—') + '</dd>' +
          '<dt>Attribution</dt><dd>' + escapeHtml(item.attribution || '—') + '</dd>' +
          '<dt>Credit</dt><dd>' + escapeHtml(item.credit || '—') + '</dd>' +
          '<dt>Usage terms</dt><dd>' + escapeHtml(item.usageTerms || '—') + '</dd>' +
          '<dt>License URL</dt><dd>' + escapeHtml(item.licenseUrl || '—') + '</dd>' +
          '<dt>Categories</dt><dd>' + escapeHtml(item.categories || '—') + '</dd>' +
        '</dl>' +
      '</details>' +
    '</article>';
  }


  function updateTitles() {
    state.input = els.input.value;
    state.titles = extractTitles(state.input);
  }

  function renderDetectedTitles() {
    const count = state.titles.length;
    els.detectedCount.textContent = 'Detected ' + count + ' file title' + (count === 1 ? '' : 's') + '.';
    els.detectedList.innerHTML = state.titles.map((title) => '<span>' + escapeHtml(title) + '</span>').join('');
  }

  function renderSummary() {
    const counts = {
      green: state.items.filter((item) => item.compatibility && item.compatibility.level === 'green').length,
      yellow: state.items.filter((item) => item.compatibility && item.compatibility.level === 'yellow').length,
      red: state.items.filter((item) => item.compatibility && item.compatibility.level === 'red').length,
    };
    els.countTotal.textContent = String(state.items.length);
    els.countGreen.textContent = String(counts.green);
    els.countYellow.textContent = String(counts.yellow);
    els.countRed.textContent = String(counts.red);
  }

  function renderResults() {
    els.resultsStack.innerHTML = state.items.map(renderResultCard).join('');
    els.summaryGrid.classList.toggle('hidden', state.items.length === 0);
    els.resultsPanel.classList.toggle('hidden', state.items.length === 0);
    els.outputPanel.classList.toggle('hidden', state.items.length === 0);
  }

  function renderOutput() {
    const output = buildLicenseBox();
    els.output.value = output;
    const lineCount = output ? output.split('\n').length + 2 : 14;
    els.output.rows = String(Math.max(14, lineCount));
    els.copyButton.disabled = !output;
  }

  function renderLoading() {
    els.fetchButton.disabled = state.loading;
    els.fetchButton.textContent = state.loading ? 'Fetching…' : '↻ Fetch metadata';
    els.fetchButton.classList.toggle('loading', state.loading);
  }

  function renderAll() {
    updateTitles();
    renderDetectedTitles();
    renderSummary();
    renderResults();
    renderOutput();
    renderLoading();
  }

  function updateItem(id, patch) {
    state.items = state.items.map((item) => {
      if (item.id !== id) return item;
      const updated = Object.assign({}, item, patch);
      updated.compatibility = classifyCompatibility(updated);
      return updated;
    });
  }

  
  async function handleFetch() {
    setError('');
    updateTitles();
    renderDetectedTitles();

    if (state.titles.length === 0) {
      setError('Paste at least one Wikimedia Commons file URL or File: title.');
      return;
    }

    state.loading = true;
    renderLoading();

    try {
      state.items = await fetchCommonsMetadata(state.titles);
      renderAll();
      document.querySelector('#results-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      setError(err && err.message ? err.message : 'Something went wrong while fetching Commons metadata.');
    } finally {
      state.loading = false;
      renderLoading();
    }
  }

  async function copyOutput() {
    const output = buildLicenseBox();
    if (!output) return;

    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(output);
      } else {
        els.output.focus();
        els.output.select();
        document.execCommand('copy');
      }
      els.copyButton.textContent = 'Copied';
      window.setTimeout(() => { els.copyButton.textContent = 'Copy'; }, 2200);
    } catch (_) {
      setError('Could not copy automatically. Select the output text and copy it manually.');
    }
  }


  els.input.value = EXAMPLE_INPUT;
  els.includeSeparators.checked = state.options.includeSeparators;
  els.includeEmptyFields.checked = state.options.includeOptionalEmptyFields;

  els.input.addEventListener('input', () => {
    updateTitles();
    renderDetectedTitles();
  });

  els.loadExample.addEventListener('click', () => {
    els.input.value = EXAMPLE_INPUT;
    setError('');
    renderAll();
  });

  els.fetchButton.addEventListener('click', handleFetch);
  els.copyButton.addEventListener('click', copyOutput);

  els.includeSeparators.addEventListener('change', () => {
    state.options.includeSeparators = els.includeSeparators.checked;
    renderOutput();
  });

  els.includeEmptyFields.addEventListener('change', () => {
    state.options.includeOptionalEmptyFields = els.includeEmptyFields.checked;
    renderOutput();
  });

  els.resultsStack.addEventListener('click', (event) => {
    const removeButton = event.target.closest('[data-remove]');
    if (!removeButton) return;
    const id = removeButton.getAttribute('data-remove');
    state.items = state.items.filter((item) => item.id !== id);
    renderAll();
  });

  els.resultsStack.addEventListener('input', (event) => {
    const field = event.target.getAttribute('data-field');
    if (!field) return;
    const card = event.target.closest('[data-id]');
    if (!card) return;
    updateItem(card.getAttribute('data-id'), { [field]: event.target.value });
    renderSummary();
    renderOutput();
  });


  els.resultsStack.addEventListener('change', (event) => {
    const field = event.target.getAttribute('data-field');
    if (!field) return;
    renderAll();
  });

  renderAll();
})();
