(function () {
    'use strict';

    let sortField = 'avg_fish_per_visit';
    let sortDir = 'desc';
    let filteredData = [];
    let map, markersLayer;
    let legendEl = null;
    let markerMap = {};
    let highlightMarker = null;
    let selectedStream = null;
    let mapHasView = false;

    const tableBody    = document.getElementById('tableBody');
    const speciesFilterBtn   = document.getElementById('speciesFilterBtn');
    const speciesFilterPanel = document.getElementById('speciesFilterPanel');
    const drainageFilter     = document.getElementById('drainageFilter');
    const slopeFilter        = document.getElementById('slopeFilter');
    const minSizeSlider      = document.getElementById('minSizeSlider');
    const minSizeVal         = document.getElementById('minSizeVal');
    const minPct8Slider      = document.getElementById('minPct8Slider');
    const minPct8Val         = document.getElementById('minPct8Val');
    const excludeRivers      = document.getElementById('excludeRivers');
    const minSamplesInput = document.getElementById('minSamples');
    const searchInput  = document.getElementById('searchInput');
    const filteredCount = document.getElementById('filteredCount');
    const streamDetail = document.getElementById('streamDetail');

    function init() {
        populateFilters();
        initMap();
        initSorting();
        initControls();
        renderSourceCards();
        applyFilters();
        updateStats();
        updateLegend();
    }

    function populateFilters() {
        const species = [...new Set(IDAHO_DATA.map(d => d.species))].sort();
        const drains  = [...new Set(IDAHO_DATA.map(d => d.drainage).filter(Boolean))].sort();

        // "All" toggle at top
        const allLabel = document.createElement('label');
        allLabel.innerHTML = `<input type="checkbox" id="spAll" checked> All Species`;
        speciesFilterPanel.appendChild(allLabel);
        const divider = document.createElement('hr');
        divider.className = 'ms-divider';
        speciesFilterPanel.appendChild(divider);

        species.forEach(s => {
            const label = document.createElement('label');
            const cb = document.createElement('input');
            cb.type = 'checkbox'; cb.value = s; cb.checked = true;
            cb.className = 'sp-cb';
            label.appendChild(cb);
            label.appendChild(document.createTextNode(s));
            speciesFilterPanel.appendChild(label);
        });

        // Wire up "All" checkbox
        document.getElementById('spAll').addEventListener('change', e => {
            speciesFilterPanel.querySelectorAll('.sp-cb').forEach(cb => cb.checked = e.target.checked);
            updateSpeciesBtn();
            applyFilters();
        });
        speciesFilterPanel.querySelectorAll('.sp-cb').forEach(cb => {
            cb.addEventListener('change', () => {
                const all = speciesFilterPanel.querySelectorAll('.sp-cb');
                const checked = speciesFilterPanel.querySelectorAll('.sp-cb:checked');
                document.getElementById('spAll').checked = all.length === checked.length;
                updateSpeciesBtn();
                applyFilters();
            });
        });

        // Toggle open/close
        speciesFilterBtn.addEventListener('click', e => {
            e.stopPropagation();
            speciesFilterPanel.classList.toggle('open');
            speciesFilterBtn.classList.toggle('open');
        });
        document.addEventListener('click', e => {
            if (!speciesFilterPanel.contains(e.target) && e.target !== speciesFilterBtn) {
                speciesFilterPanel.classList.remove('open');
                speciesFilterBtn.classList.remove('open');
            }
        });

        drains.forEach(s => {
            const opt = document.createElement('option');
            opt.value = s; opt.textContent = s;
            drainageFilter.appendChild(opt);
        });
    }

    function getSelectedSpecies() {
        const checked = [...speciesFilterPanel.querySelectorAll('.sp-cb:checked')].map(cb => cb.value);
        const all = speciesFilterPanel.querySelectorAll('.sp-cb');
        return checked.length === all.length ? null : checked; // null = all selected
    }

    function updateSpeciesBtn() {
        const checked = speciesFilterPanel.querySelectorAll('.sp-cb:checked');
        const all = speciesFilterPanel.querySelectorAll('.sp-cb');
        if (checked.length === 0) speciesFilterBtn.textContent = 'No Species ▾';
        else if (checked.length === all.length) speciesFilterBtn.textContent = 'All Species ▾';
        else speciesFilterBtn.textContent = `${checked.length} Species ▾`;
    }

    function applyFilters() {
        const selectedSpecies = getSelectedSpecies(); // null = all
        const drainage   = drainageFilter.value;
        const minSamples = parseInt(minSamplesInput.value) || 1;
        const search     = searchInput.value.toLowerCase().trim();

        const noRivers  = excludeRivers.checked;
        const slopeMode = slopeFilter.value;
        const minSize   = parseFloat(minSizeSlider.value);
        const minPct8   = parseFloat(minPct8Slider.value);

        filteredData = IDAHO_DATA.filter(d => {
            if (selectedSpecies && !selectedSpecies.includes(d.species)) return false;
            if (drainage !== 'all' && d.drainage !== drainage) return false;
            if ((d.num_samples ?? 0) < minSamples) return false;
            if (search && !d.stream_name.toLowerCase().includes(search)) return false;
            if (noRivers && /\briver\b/i.test(d.stream_name)) return false;
            if (minSize > 0 && (d.avg_length_in == null || d.avg_length_in < minSize)) return false;
            if (minPct8 > 0 && (d.pct_over_8in == null || d.pct_over_8in < minPct8)) return false;
            if (slopeMode === 'any_data' && d.slope_pct == null) return false;
            if (slopeMode === 'flat'     && (d.slope_pct == null || d.slope_pct >= 2)) return false;
            if (slopeMode === 'moderate' && (d.slope_pct == null || d.slope_pct < 2 || d.slope_pct >= 5)) return false;
            if (slopeMode === 'high'     && (d.slope_pct == null || d.slope_pct < 5 || d.slope_pct >= 10)) return false;
            if (slopeMode === 'steep'    && (d.slope_pct == null || d.slope_pct < 10)) return false;
            return true;
        });

        filteredData.sort((a, b) => {
            let aVal = a[sortField] ?? (sortDir === 'desc' ? -Infinity : Infinity);
            let bVal = b[sortField] ?? (sortDir === 'desc' ? -Infinity : Infinity);
            if (typeof aVal === 'string') return sortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
            return sortDir === 'asc' ? aVal - bVal : bVal - aVal;
        });

        renderTable();
        renderMapMarkers();
        updateLegend();
        filteredCount.textContent = `(${filteredData.length} of ${IDAHO_DATA.length})`;
    }

    // ── Table ──────────────────────────────────────────────────────────────────
    function renderTable() {
        tableBody.innerHTML = '';
        filteredData.forEach((d, i) => {
            const rank = i + 1;
            const tr = document.createElement('tr');
            if (selectedStream === d.stream_name) tr.classList.add('highlighted');

            const avgFish  = d.avg_fish_per_visit;
            const peakFish = d.peak_fish_per_visit;
            const totalFish = d.total_fish_observed;

            const highThresh = 80, medThresh = 20;
            const fishClass = avgFish > highThresh ? 'density-high' : avgFish > medThresh ? 'density-med' : 'density-low';

            let rankBadge = '';
            if (rank === 1) rankBadge = 'rank-gold';
            else if (rank === 2) rankBadge = 'rank-silver';
            else if (rank === 3) rankBadge = 'rank-bronze';

            const sizeIn    = d.avg_length_in;
            const sizeIn5yr = d.avg_length_in_5yr;
            const pct8      = d.pct_over_8in;
            const dash = '<span style="color:var(--text-dim)">—</span>';
            const sizeCell   = sizeIn    != null ? `${sizeIn}"`    : dash;
            const size5yrCell = sizeIn5yr != null ? `${sizeIn5yr}"` : dash;
            const pct8Cell   = pct8      != null ? `${pct8}%`      : dash;

            tr.innerHTML = `
                <td>${rankBadge ? `<span class="rank-badge ${rankBadge}">${rank}</span>` : rank}</td>
                <td><strong>${escHtml(d.stream_name)}</strong></td>
                <td>${d.latitude && d.longitude ? '📍' : ''}</td>
                <td>${escHtml(d.species || '')}</td>
                <td>${d.slope_pct != null ? d.slope_pct + '%' : dash}</td>
                <td class="${fishClass}">${avgFish != null ? avgFish.toFixed(1) : 'N/A'}</td>
                <td>${sizeCell}</td>
                <td>${size5yrCell}</td>
                <td>${pct8Cell}</td>
                <td>${peakFish != null ? peakFish : '-'}</td>
                <td>${totalFish != null ? totalFish.toLocaleString() : '-'}</td>
                <td>${d.num_samples ?? '-'}</td>
                <td>${d.years_sampled ?? '-'}</td>
                <td>${d.first_year ?? '-'}</td>
                <td>${d.last_year ?? '-'}</td>
                <td title="${escHtml(d.drainage || '')}">${escHtml(d.drainage || '')}</td>
            `;

            tr.addEventListener('click', () => showDetail(d));
            tr.addEventListener('mouseenter', () => highlightOnMap(`${d.stream_name}|${d.species}`));
            tr.addEventListener('mouseleave', clearMapHighlight);
            tableBody.appendChild(tr);
        });
    }

    function abbreviateSource(s) {
        if (!s) return '';
        return s.replace('Idaho Dept. of Fish and Game', 'IDFG')
                .replace('Standard Stream Survey', 'SSS');
    }

    // ── Map ────────────────────────────────────────────────────────────────────
    function initMap() {
        map = L.map('map').setView([45.5, -114.5], 6);

        const dark = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
            maxZoom: 18
        });
        const terrain = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://opentopomap.org">OpenTopoMap</a>',
            maxZoom: 17
        });
        const usgsTopo = L.tileLayer('https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}', {
            attribution: '&copy; <a href="https://www.usgs.gov/">USGS</a>',
            maxZoom: 16
        });

        dark.addTo(map);
        L.control.layers({ 'Dark': dark, 'Terrain': terrain, 'USGS Topo': usgsTopo }, null, { position: 'topright' }).addTo(map);
        markersLayer = L.layerGroup().addTo(map);

        const LegendControl = L.Control.extend({
            options: { position: 'bottomright' },
            onAdd() { legendEl = L.DomUtil.create('div', 'map-legend'); return legendEl; }
        });
        new LegendControl().addTo(map);

        setTimeout(() => map.invalidateSize(), 100);
        setTimeout(updateLegend, 150);
    }

    function updateLegend() {
        if (!legendEl) return;
        const maxVal = 150;
        const ticks = [0, 0.25, 0.5, 0.75, 1.0].map(t => {
            const raw = t === 0 ? 0 : Math.exp(t * Math.log1p(maxVal)) - 1;
            return `<span>${Math.round(raw)}</span>`;
        }).join('');
        legendEl.innerHTML = `
            <div class="legend-title">avg fish / visit</div>
            <div class="legend-bar"></div>
            <div class="legend-ticks">${ticks}</div>`;
    }

    function fishColor(val) {
        const maxVal = 150;
        if (!val || val <= 0) return '#4fc3f7';
        const t = Math.min(1, Math.log1p(val) / Math.log1p(maxVal));
        const hue = Math.round(t * 270);
        return `hsl(${hue}, 90%, 52%)`;
    }

    function renderMapMarkers() {
        markersLayer.clearLayers();
        markerMap = {};
        if (highlightMarker) { map.removeLayer(highlightMarker); highlightMarker = null; }
        const bounds = [];

        filteredData.forEach((d, i) => {
            if (!d.latitude || !d.longitude) return;
            const key = `${d.stream_name}|${d.species}`;

            const val = d.avg_fish_per_visit || 0;
            const color = fishColor(val);
            const radius = Math.max(4, Math.min(12, val / 12));

            const marker = L.circleMarker([d.latitude, d.longitude], {
                radius, color, fillColor: color, fillOpacity: 0.7,
                weight: selectedStream === d.stream_name ? 3 : 1
            });

            marker.bindPopup(`
                <div class="popup-stream">#${i + 1} ${escHtml(d.stream_name)}</div>
                <div class="popup-stat"><span class="label">Species</span> <span class="value">${escHtml(d.species)}</span></div>
                <div class="popup-stat"><span class="label">Avg fish/visit</span> <span class="value">${val.toFixed(1)}</span></div>
                <div class="popup-stat"><span class="label">Visits</span> <span class="value">${d.num_samples}</span></div>
            `, { maxWidth: 240 });

            markersLayer.addLayer(marker);
            markerMap[key] = { marker, lat: d.latitude, lng: d.longitude };
            bounds.push([d.latitude, d.longitude]);
        });

        if (bounds.length > 0 && !mapHasView) {
            map.fitBounds(bounds, { padding: [30, 30], maxZoom: 11 });
            mapHasView = true;
        }
    }

    function highlightOnMap(streamName) {
        clearMapHighlight();
        const entry = markerMap[streamName];
        if (!entry) return;
        highlightMarker = L.circleMarker([entry.lat, entry.lng], {
            radius: 18, color: '#fff', fillColor: '#4fc3f7',
            fillOpacity: 0.35, weight: 2, dashArray: '4 4'
        }).addTo(map);
        entry.marker.setStyle({ weight: 3, color: '#fff' });
        entry.marker.bringToFront();
    }

    function clearMapHighlight() {
        if (highlightMarker) { map.removeLayer(highlightMarker); highlightMarker = null; }
        Object.values(markerMap).forEach(({ marker }) => marker.setStyle({ weight: 1 }));
    }

    // ── Detail Panel ───────────────────────────────────────────────────────────
    function showDetail(d) {
        selectedStream = d.stream_name;
        document.getElementById('detailName').textContent = `${d.stream_name} — Idaho`;

        const items = [
            ['Region', d.region || 'N/A'],
            ['Avg Fish / Visit', d.avg_fish_per_visit != null ? d.avg_fish_per_visit.toFixed(1) : 'N/A'],
            ['Peak Fish (single visit)', d.peak_fish_per_visit ?? 'N/A'],
            ['Total Fish Observed', d.total_fish_observed != null ? d.total_fish_observed.toLocaleString() : 'N/A'],
            ['# Visits', d.num_samples ?? 'N/A'],
            ['Years Sampled', d.years_sampled ?? 'N/A'],
            ['First Year', d.first_year ?? 'N/A'],
            ['Last Year', d.last_year ?? 'N/A'],
            ['Avg Length (all time)', d.avg_length_in != null ? `${d.avg_length_in}"` : 'N/A'],
            ['Avg Length (5yr)', d.avg_length_in_5yr != null ? `${d.avg_length_in_5yr}"` : 'N/A'],
            ['≥ 8" (quality)', d.pct_over_8in != null ? `${d.pct_over_8in}%` : 'N/A'],
            ['≥ 12" (large)', d.pct_over_12in != null ? `${d.pct_over_12in}%` : 'N/A'],
            ['Fish Measured', d.fish_measured != null ? d.fish_measured.toLocaleString() : 'N/A'],
            ['Gradient (NHDPlus)', d.slope_pct != null ? `${d.slope_pct}%` : 'N/A'],
            ['Species', d.species],
            ['Data Source', d.data_source],
            ['Note', 'No reach dimensions recorded — density not calculable'],
        ];
        document.getElementById('detailStats').innerHTML = items.map(([label, value]) =>
            `<div class="detail-stat"><div class="label">${label}</div><div class="value">${value}</div></div>`
        ).join('');

        // Size histogram
        const notesDiv = document.getElementById('detailNotes');
        let histHtml = '';
        if (d.size_hist && Object.keys(d.size_hist).length > 0) {
            const hist = d.size_hist;
            const total = Object.values(hist).reduce((a, b) => a + b, 0);
            const maxVal = Math.max(...Object.values(hist));
            const bins = ['<4"','4-6"','6-8"','8-10"','10-12"','12-14"','14-18"','18"+'];
            histHtml = `
                <div class="size-hist">
                    <div class="size-hist-title">Size Distribution (${total.toLocaleString()} fish measured)</div>
                    ${bins.filter(b => hist[b]).map(b => {
                        const pct = Math.round(hist[b] / total * 100);
                        const barW = Math.round(hist[b] / maxVal * 100);
                        const isQuality = ['8-10"','10-12"','12-14"','14-18"','18"+'].includes(b);
                        return `<div class="size-hist-row">
                            <span class="size-hist-label">${b}</span>
                            <div class="size-hist-bar-wrap">
                                <div class="size-hist-bar${isQuality ? ' quality' : ''}" style="width:${barW}%"></div>
                            </div>
                            <span class="size-hist-pct">${pct}%</span>
                        </div>`;
                    }).join('')}
                </div>`;
        }
        notesDiv.innerHTML = (d.notes ? `<p style="color:var(--text-dim);font-size:0.8rem;margin-top:0.5rem">${escHtml(d.notes)}</p>` : '') + histHtml;

        const sitesDiv = document.getElementById('detailSites');
        const streamSamples = typeof IDAHO_SAMPLES !== 'undefined' && IDAHO_SAMPLES[d.stream_name];
        if (streamSamples && streamSamples.length > 1) {
            sitesDiv.innerHTML = `
                <div class="samples-heading-row">
                    <h3 style="font-size:0.9rem;color:var(--text-dim);margin:0">Individual Visits (${streamSamples.length})</h3>
                    <button class="btn-expand-samples" id="btnExpandSamples">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>
                        Full screen
                    </button>
                </div>
                <div id="inlineSamplesTable" style="overflow-x:auto"></div>`;
            renderSamplesTable(document.getElementById('inlineSamplesTable'), streamSamples);
            document.getElementById('btnExpandSamples').addEventListener('click', () => openSamplesModal(d.stream_name, streamSamples));
        } else {
            sitesDiv.innerHTML = '';
        }

        streamDetail.style.display = 'block';
        streamDetail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        renderTable();
        renderMapMarkers();
        if (d.latitude && d.longitude) map.setView([d.latitude, d.longitude], 13);
    }

    // ── Stats ──────────────────────────────────────────────────────────────────
    function updateStats() {
        document.getElementById('totalStreams').textContent = IDAHO_DATA.length;
        const totalVisits = IDAHO_DATA.reduce((sum, d) => sum + (d.num_samples || 0), 0);
        document.getElementById('totalSamples').textContent = totalVisits.toLocaleString();
        const years = IDAHO_DATA.filter(d => d.first_year && d.last_year);
        const minYear = Math.min(...years.map(d => d.first_year));
        const maxYear = Math.max(...years.map(d => d.last_year));
        document.getElementById('dateRange').textContent = `${minYear}\u2013${maxYear}`;
        const sources = new Set(IDAHO_DATA.map(d => d.data_source));
        document.getElementById('dataSources').textContent = sources.size;
    }

    // ── Sorting ────────────────────────────────────────────────────────────────
    function initSorting() {
        document.querySelectorAll('th[data-sort]').forEach(th => {
            th.addEventListener('click', () => {
                const field = th.dataset.sort;
                if (field === 'rank') return;
                sortDir = sortField === field ? (sortDir === 'asc' ? 'desc' : 'asc') : 'desc';
                sortField = field;
                document.querySelectorAll('th').forEach(t => t.classList.remove('active', 'asc', 'desc'));
                th.classList.add('active', sortDir);
                applyFilters();
            });
        });
    }

    // ── Controls ───────────────────────────────────────────────────────────────
    function initControls() {
        drainageFilter.addEventListener('change', applyFilters);
        slopeFilter.addEventListener('change', applyFilters);
        excludeRivers.addEventListener('change', applyFilters);

        minSizeSlider.addEventListener('input', () => {
            const v = parseFloat(minSizeSlider.value);
            minSizeVal.textContent = v > 0 ? `≥ ${v}"` : 'Any';
            applyFilters();
        });
        minPct8Slider.addEventListener('input', () => {
            const v = parseFloat(minPct8Slider.value);
            minPct8Val.textContent = v > 0 ? `≥ ${v}%` : 'Any';
            applyFilters();
        });
        minSamplesInput.addEventListener('change', applyFilters);
        searchInput.addEventListener('input', applyFilters);

        document.getElementById('resetFilters').addEventListener('click', () => {
            speciesFilterPanel.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = true);
            updateSpeciesBtn();
            drainageFilter.value = 'all';
            slopeFilter.value = 'all';
            excludeRivers.checked = false;
            minSizeSlider.value = 0; minSizeVal.textContent = 'Any';
            minPct8Slider.value = 0; minPct8Val.textContent = 'Any';
            minSamplesInput.value = '1';
            searchInput.value = '';
            selectedStream = null;
            mapHasView = false;
            streamDetail.style.display = 'none';
            sortField = 'avg_fish_per_visit';
            sortDir = 'desc';
            document.querySelectorAll('th').forEach(t => t.classList.remove('active', 'asc', 'desc'));
            const activeTh = document.querySelector('th[data-sort="avg_fish_per_visit"]');
            if (activeTh) activeTh.classList.add('active', 'desc');
            applyFilters();
            updateLegend();
        });

        document.getElementById('closeDetail').addEventListener('click', () => {
            selectedStream = null;
            streamDetail.style.display = 'none';
            renderTable();
            renderMapMarkers();
        });

        document.getElementById('exportCsv').addEventListener('click', exportCsv);
    }

    // ── Export ─────────────────────────────────────────────────────────────────
    function exportCsv() {
        const headers = ['Rank', 'Stream', 'State', 'Region', 'Avg_Fish_Per_Visit',
            'Peak_Fish_Per_Visit', 'Total_Fish_Observed', 'Visits', 'Years_Sampled',
            'First_Year', 'Last_Year', 'Species', 'Source', 'Latitude', 'Longitude', 'Notes'];
        const rows = filteredData.map((d, i) => [
            i + 1, d.stream_name, d.state, d.region || '',
            d.avg_fish_per_visit, d.peak_fish_per_visit, d.total_fish_observed,
            d.num_samples, d.years_sampled, d.first_year, d.last_year,
            d.species, d.data_source, d.latitude, d.longitude, d.notes || ''
        ]);
        const csv = [headers, ...rows].map(r =>
            r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')
        ).join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url;
        a.download = 'idaho_trout_export.csv'; a.click();
        URL.revokeObjectURL(url);
    }

    // ── Sortable samples table ─────────────────────────────────────────────────
    function renderSamplesTable(container, samples, sortCol = 'year', sortDir = 'desc') {
        const cols = [
            { key: 'year',    label: 'Year' },
            { key: 'fish',    label: 'Fish' },
            { key: 'avg_len', label: 'Avg Size' },
            { key: 'sp',      label: 'Species' },
            { key: 'src',     label: 'Source' },
        ];

        const sorted = [...samples].sort((a, b) => {
            let av = a[sortCol] ?? (sortDir === 'desc' ? -Infinity : Infinity);
            let bv = b[sortCol] ?? (sortDir === 'desc' ? -Infinity : Infinity);
            if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
            return sortDir === 'asc' ? av - bv : bv - av;
        });

        const headerCells = cols.map(c => {
            const active = c.key === sortCol;
            const arrow = active ? (sortDir === 'desc' ? ' ▼' : ' ▲') : '';
            return `<th data-col="${c.key}" style="cursor:pointer;user-select:none${active ? ';color:var(--accent)' : ''}">${c.label}${arrow}</th>`;
        }).join('');

        const bodyRows = sorted.map(s => `<tr>
            <td>${s.year || '-'}</td>
            <td>${s.fish ?? '-'}</td>
            <td>${s.avg_len != null ? s.avg_len + '"' : '-'}</td>
            <td>${s.sp || '-'}</td>
            <td>${s.src || '-'}</td>
        </tr>`).join('');

        container.innerHTML = `<table class="samples-table"><thead><tr>${headerCells}</tr></thead><tbody>${bodyRows}</tbody></table>`;

        container.querySelectorAll('th[data-col]').forEach(th => {
            th.addEventListener('click', () => {
                const col = th.dataset.col;
                const dir = sortCol === col ? (sortDir === 'asc' ? 'desc' : 'asc') : 'desc';
                renderSamplesTable(container, samples, col, dir);
            });
        });
    }

    // ── Source Cards ───────────────────────────────────────────────────────────
    function renderSourceCards() {
        const grid = document.getElementById('sourcesGrid');
        grid.innerHTML = IDAHO_SOURCES.map(s => `
            <div class="source-card">
                <h3>${s.name} <span style="font-size:0.7rem;color:var(--text-dim);font-weight:400">${s.states.join(', ')} &middot; ${s.years}</span></h3>
                <p>${s.description}</p>
                <a href="${s.url}" target="_blank" rel="noopener">View Source &rarr;</a>
            </div>
        `).join('');
    }

    // ── Samples Modal ──────────────────────────────────────────────────────────
    function openSamplesModal(streamName, samples) {
        let overlay = document.getElementById('samplesModalOverlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'samplesModalOverlay';
            overlay.className = 'samples-modal-overlay';
            overlay.innerHTML = `
                <div class="samples-modal">
                    <div class="samples-modal-header">
                        <h2 id="samplesModalTitle"></h2>
                        <button class="btn-close" id="samplesModalClose">&times;</button>
                    </div>
                    <div class="samples-modal-body" id="samplesModalBody"></div>
                </div>`;
            document.body.appendChild(overlay);
            overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.remove('open'); });
            document.getElementById('samplesModalClose').addEventListener('click', () => overlay.classList.remove('open'));
        }
        document.getElementById('samplesModalTitle').textContent = `${streamName} — All Visits (${samples.length})`;
        const modalBody = document.getElementById('samplesModalBody');
        renderSamplesTable(modalBody, samples);
        overlay.classList.add('open');
    }

    function escHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    document.addEventListener('DOMContentLoaded', init);
})();
