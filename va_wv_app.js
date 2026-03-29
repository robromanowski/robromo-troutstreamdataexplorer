(function () {
    'use strict';

    // State
    let sortField = 'avg_density_per_100m2';
    let sortDir = 'desc';
    let filteredData = [];
    let map, markersLayer;
    let legendEl = null;
    let markerMap = {};
    let highlightMarker = null;
    let selectedStream = null;
    let mapHasView = false;

    // DOM refs
    const tableBody = document.getElementById('tableBody');
    const regionFilter = document.getElementById('regionFilter');
    const sourceFilter = document.getElementById('sourceFilter');
    const speciesFilter = document.getElementById('speciesFilter');
    const stateFilter = document.getElementById('stateFilter');
    const minSamplesInput = document.getElementById('minSamples');
    const searchInput = document.getElementById('searchInput');
    const filteredCount = document.getElementById('filteredCount');
    const estimatedFilter = document.getElementById('estimatedFilter');
    const metricSelect = document.getElementById('metricSelect');
    const streamDetail = document.getElementById('streamDetail');

    // ── Init ──
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

    // ── Filters ──
    function populateFilters() {
        const states = [...new Set(VA_WV_MASTER_DATA.map(d => d.state))].sort();
        const regions = [...new Set(VA_WV_MASTER_DATA.map(d => d.region).filter(Boolean))].sort();
        const sources = [...new Set(VA_WV_MASTER_DATA.map(d => d.data_source))].sort();
        const species = [...new Set(VA_WV_MASTER_DATA.map(d => d.species))].sort();

        states.forEach(s => {
            const opt = document.createElement('option');
            opt.value = s;
            opt.textContent = s;
            stateFilter.appendChild(opt);
        });

        regions.forEach(r => {
            const opt = document.createElement('option');
            opt.value = r;
            opt.textContent = r;
            regionFilter.appendChild(opt);
        });

        sources.forEach(s => {
            const opt = document.createElement('option');
            opt.value = s;
            opt.textContent = s;
            sourceFilter.appendChild(opt);
        });

        species.forEach(s => {
            const opt = document.createElement('option');
            opt.value = s;
            opt.textContent = s;
            speciesFilter.appendChild(opt);
        });
    }

    const ALL_DENSITY_FIELDS = ['avg_density_per_100m2', 'best_site_density', 'peak_sample_density', 'avg_linear_per_km', 'best_linear_per_km'];

    function getMetricConfig() {
        const m = metricSelect.value;
        if (m === 'linear_km') return {
            avgField: 'avg_linear_per_km', bestField: 'best_linear_per_km', peakField: 'best_linear_per_km',
            unit: 'fish/km', factor: 1,
            highThresh: 300, medThresh: 80, radiusDivisor: 50,
        };
        if (m === 'linear_mi') return {
            avgField: 'avg_linear_per_km', bestField: 'best_linear_per_km', peakField: 'best_linear_per_km',
            unit: 'fish/mi', factor: 1.609,
            highThresh: 300, medThresh: 80, radiusDivisor: 50,
        };
        return {
            avgField: 'avg_density_per_100m2', bestField: 'best_site_density', peakField: 'peak_sample_density',
            unit: 'fish/100m²', factor: 1,
            highThresh: 15, medThresh: 5, radiusDivisor: 2.5,
        };
    }

    function applyFilters() {
        const state = stateFilter.value;
        const region = regionFilter.value;
        const source = sourceFilter.value;
        const species = speciesFilter.value;
        const minSamples = parseInt(minSamplesInput.value) || 1;
        const search = searchInput.value.toLowerCase().trim();
        const estMode = estimatedFilter.value;

        filteredData = VA_WV_MASTER_DATA.filter(d => {
            if (state !== 'all' && d.state !== state) return false;
            if (region !== 'all' && d.region !== region) return false;
            if (source !== 'all' && d.data_source !== source) return false;
            if (species !== 'all' && !d.species.includes(species.split(',')[0].trim())) return false;
            if (d.num_samples !== null && d.num_samples < minSamples) return false;
            if (d.num_samples === null && minSamples > 1) return false;
            if (search && !d.stream_name.toLowerCase().includes(search)) return false;
            if (estMode === 'hide' && d.density_estimated) return false;
            return true;
        });

        // Sort
        filteredData.sort((a, b) => {
            let aVal = a[sortField];
            let bVal = b[sortField];

            // In "blank" mode, push estimated records to the bottom when sorting by density
            if (estMode === 'blank' && ALL_DENSITY_FIELDS.includes(sortField)) {
                if (a.density_estimated) aVal = null;
                if (b.density_estimated) bVal = null;
            }

            if (aVal === null || aVal === undefined) aVal = sortDir === 'desc' ? -Infinity : Infinity;
            if (bVal === null || bVal === undefined) bVal = sortDir === 'desc' ? -Infinity : Infinity;

            if (typeof aVal === 'string') {
                return sortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
            }
            return sortDir === 'asc' ? aVal - bVal : bVal - aVal;
        });

        renderTable();
        renderMapMarkers();
        updateLegend();
        filteredCount.textContent = `(${filteredData.length} of ${VA_WV_MASTER_DATA.length})`;
    }

    // ── Table ──
    function renderTable() {
        tableBody.innerHTML = '';
        filteredData.forEach((d, i) => {
            const rank = i + 1;
            const tr = document.createElement('tr');
            if (selectedStream === d.stream_name) tr.classList.add('highlighted');

            const mc = getMetricConfig();
            const avgVal = d[mc.avgField];
            const bestVal = d[mc.bestField];
            const peakVal = d[mc.peakField];
            const densityClass = avgVal > mc.highThresh ? 'density-high' :
                avgVal > mc.medThresh ? 'density-med' : 'density-low';

            let rankBadge = '';
            if (rank === 1) rankBadge = 'rank-gold';
            else if (rank === 2) rankBadge = 'rank-silver';
            else if (rank === 3) rankBadge = 'rank-bronze';

            const est = d.density_estimated ? true : false;
            const blankDensity = est && estimatedFilter.value === 'blank';
            const estMark = est && !blankDensity ? '<span class="est-badge" title="Estimated density (assumed reach dimensions)">~</span>' : '';

            const fmt = (v) => v != null ? (v * mc.factor).toFixed(mc.factor > 1 ? 1 : 2) : null;
            const densityDisplay = blankDensity ? '—' : fmt(avgVal) ?? 'N/A';
            const bestSiteDisplay = blankDensity ? '—' : fmt(bestVal) ?? densityDisplay;
            const peakDisplay = blankDensity ? '—' : fmt(peakVal) ?? '-';
            const avgFishDisplay = d.avg_fish_per_sample !== null ?
                d.avg_fish_per_sample.toFixed(1) : 'N/A';

            const hi2 = mc.highThresh * 1.5, hi3 = mc.highThresh * 2;
            const me2 = mc.medThresh * 1.5, me3 = mc.medThresh * 2;
            const bestSiteClass = blankDensity ? 'density-low' :
                (bestVal || 0) > hi2 ? 'density-high' : (bestVal || 0) > me2 ? 'density-med' : 'density-low';
            const peakClass = blankDensity ? 'density-low' :
                (peakVal || 0) > hi3 ? 'density-high' : (peakVal || 0) > me3 ? 'density-med' : 'density-low';
            const effDensityClass = blankDensity ? 'density-low' : densityClass;

            tr.innerHTML = `
                <td>${rankBadge ? `<span class="rank-badge ${rankBadge}">${rank}</span>` : rank}</td>
                <td><strong>${escHtml(d.stream_name)}</strong></td>
                <td>${d.latitude && d.longitude ? '📍' : ''}</td>
                <td>${abbreviateSpecies(d.species)}</td>
                <td>${d.state}</td>
                <td class="${effDensityClass}${est && !blankDensity ? ' density-est' : ''}">${estMark}${densityDisplay}</td>
                <td class="${bestSiteClass}${est && !blankDensity ? ' density-est' : ''}">${estMark}${bestSiteDisplay}</td>
                <td class="${peakClass}${est && !blankDensity ? ' density-est' : ''}">${estMark}${peakDisplay}</td>
                <td>${avgFishDisplay}</td>
                <td>${d.peak_fish_per_sample != null ? d.peak_fish_per_sample : '-'}</td>
                <td>${d.num_samples ?? '-'}</td>
                <td>${d.years_sampled ?? '-'}</td>
                <td>${d.first_year ?? '-'}</td>
                <td>${d.last_year ?? '-'}</td>
                <td title="${escHtml(d.region)}">${escHtml(abbreviateRegion(d.region))}</td>
                <td title="${escHtml(d.data_source)}">${escHtml(abbreviateSource(d.data_source))}</td>
            `;

            tr.addEventListener('click', () => showDetail(d));
            tr.addEventListener('mouseenter', () => highlightOnMap(`${d.stream_name}|${d.state}|${d.species}`));
            tr.addEventListener('mouseleave', clearMapHighlight);
            tableBody.appendChild(tr);
        });
    }

    function abbreviateRegion(r) {
        if (!r) return '';
        return r.replace(' County', ' Co.')
            .replace('Connecticut River Watershed', 'CT River')
            .replace('West River Watershed', 'West River')
            .replace('Upper Androscoggin River', 'Androscoggin')
            .replace(' River', ' R.');
    }

    function abbreviateSource(s) {
        if (!s) return '';
        return s.replace('NH Fish and Game', 'NHFG')
            .replace('CT DEEP Fish Community Monitoring', 'CT DEEP')
            .replace('USGS Conte Lab (West Brook)', 'USGS West Brook')
            .replace('VT Fish & Wildlife Dept.', 'VT F&W');
    }

    function abbreviateSpecies(s) {
        if (!s) return '';
        return s.replace('Brook Trout', 'BKT')
                .replace('Brown Trout', 'BNT')
                .replace('Rainbow Trout', 'RBT');
    }

    // ── Map ──
    function initMap() {
        map = L.map('map').setView([38.5, -79.5], 7);

        const dark = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
            maxZoom: 18
        });

        const terrain = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://opentopomap.org">OpenTopoMap</a> &copy; <a href="https://www.openstreetmap.org/">OSM</a>',
            maxZoom: 17
        });

        const satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
            attribution: '&copy; Esri, Maxar, Earthstar Geographics',
            maxZoom: 18
        });

        const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/">OpenStreetMap</a>',
            maxZoom: 19
        });

        const usgsTopo = L.tileLayer('https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}', {
            attribution: '&copy; <a href="https://www.usgs.gov/">USGS</a>',
            maxZoom: 16
        });

        dark.addTo(map);

        L.control.layers({
            'Dark': dark,
            'Terrain': terrain,
            'Satellite': satellite,
            'USGS Topo': usgsTopo,
            'OpenStreetMap': osm
        }, null, { position: 'topright' }).addTo(map);

        markersLayer = L.layerGroup().addTo(map);

        // Color legend control
        const LegendControl = L.Control.extend({
            options: { position: 'bottomright' },
            onAdd() {
                legendEl = L.DomUtil.create('div', 'map-legend');
                return legendEl;
            }
        });
        new LegendControl().addTo(map);

        setTimeout(() => map.invalidateSize(), 100);
        setTimeout(updateLegend, 150);
    }

    function updateLegend() {
        const el = legendEl;
        if (!el) return;
        const cfg = getMapColorConfig();
        const ticks = [0, 0.25, 0.5, 0.75, 1.0].map(t => {
            const raw = t === 0 ? 0 : Math.exp(t * Math.log1p(cfg.maxVal)) - 1;
            const val = Math.round(raw * cfg.factor);
            return `<span>${val}</span>`;
        }).join('');
        el.innerHTML = `
            <div class="legend-title">${cfg.unit}</div>
            <div class="legend-bar"></div>
            <div class="legend-ticks">${ticks}</div>`;
    }

    function densityColor(val, maxVal) {
        if (!val || val <= 0) return '#4fc3f7';
        const t = Math.min(1, Math.log1p(val) / Math.log1p(maxVal));
        const hue = Math.round(t * 270); // red(0) → yellow → green → blue → violet(270)
        return `hsl(${hue}, 90%, 52%)`;
    }

    function getMapColorConfig() {
        const mc = getMetricConfig();
        if (sortField === 'avg_fish_per_sample') {
            return { field: sortField, maxVal: 200, unit: 'Avg Fish/Sample', radiusDivisor: 16, factor: 1 };
        }
        if (sortField === 'peak_fish_per_sample') {
            return { field: sortField, maxVal: 200, unit: 'Peak Fish/Sample', radiusDivisor: 16, factor: 1 };
        }
        let unit = mc.unit;
        if (sortField === mc.bestField) unit = 'Best ' + mc.unit;
        else if (sortField === mc.peakField && sortField !== mc.bestField) unit = 'Peak ' + mc.unit;
        const field = ALL_DENSITY_FIELDS.includes(sortField) ? sortField : mc.avgField;
        return { field, maxVal: mc.highThresh * 2, unit, radiusDivisor: mc.radiusDivisor, factor: mc.factor };
    }

    function getMarkerStyle(d) {
        const cfg = getMapColorConfig();
        const val = d[cfg.field] || 0;
        return {
            radius: Math.max(4, Math.min(12, val / cfg.radiusDivisor)),
            color: densityColor(val, cfg.maxVal),
        };
    }

    function renderMapMarkers() {
        markersLayer.clearLayers();
        markerMap = {};
        if (highlightMarker) { map.removeLayer(highlightMarker); highlightMarker = null; }
        const bounds = [];

        const seenCoords = new Set();
        filteredData.forEach((d, i) => {
            if (!d.latitude || !d.longitude) return;

            // Skip if another higher-ranked record already placed a dot at this exact location
            const coordKey = `${d.latitude},${d.longitude}`;
            if (seenCoords.has(coordKey)) return;
            seenCoords.add(coordKey);

            const rank = i + 1;
            const { radius, color } = getMarkerStyle(d);

            const marker = L.circleMarker([d.latitude, d.longitude], {
                radius: radius,
                color: color,
                fillColor: color,
                fillOpacity: 0.7,
                weight: selectedStream === d.stream_name ? 3 : 1
            });

            const _cfg = getMapColorConfig();
            const _rawVal = d[_cfg.field];
            const _decimals = _cfg.factor > 1 ? 1 : 2;
            const valStr = _rawVal != null ? (_rawVal * _cfg.factor).toFixed(_decimals) : 'N/A';
            const popupEst = d.density_estimated ? ' <span style="color:#ffa726;font-size:0.7rem">~est</span>' : '';

            marker.bindPopup(`
                <div class="popup-stream">#${rank} ${escHtml(d.stream_name)}</div>
                <div class="popup-stat"><span class="label">${_cfg.unit}${popupEst}</span> <span class="value">${valStr}</span></div>
                <div class="popup-stat"><span class="label">Species</span> <span class="value">${escHtml(abbreviateSpecies(d.species))}</span></div>
            `, { maxWidth: 240 });

            markersLayer.addLayer(marker);
            markerMap[`${d.stream_name}|${d.state}|${d.species}`] = { marker, lat: d.latitude, lng: d.longitude };
            bounds.push([d.latitude, d.longitude]);
        });

        if (bounds.length > 0 && !mapHasView) {
            map.fitBounds(bounds, { padding: [30, 30], maxZoom: 10 });
            mapHasView = true;
        }
    }

    // ── Map Highlight ──
    function highlightOnMap(streamName) {
        clearMapHighlight();
        const entry = markerMap[streamName];
        if (!entry) return;

        highlightMarker = L.circleMarker([entry.lat, entry.lng], {
            radius: 18,
            color: '#fff',
            fillColor: '#4fc3f7',
            fillOpacity: 0.35,
            weight: 2,
            dashArray: '4 4'
        }).addTo(map);

        entry.marker.setStyle({ weight: 3, color: '#fff' });
        entry.marker.bringToFront();
    }

    function clearMapHighlight() {
        if (highlightMarker) {
            map.removeLayer(highlightMarker);
            highlightMarker = null;
        }
        Object.values(markerMap).forEach(({ marker }) => {
            marker.setStyle({ weight: 1 });
        });
    }

    // ── Detail Panel ──
    function showDetail(d) {
        selectedStream = d.stream_name;
        document.getElementById('detailName').textContent = `${d.stream_name} (${d.state})`;

        const stats = document.getElementById('detailStats');
        const estLabel = d.density_estimated ? ' <span class="est-badge-detail">estimated</span>' : '';
        const items = [
            ['State', d.state],
            ['Region / Watershed', d.region || 'N/A'],
            ['County', d.county || 'N/A'],
            ['Avg Density/100m\u00B2' + estLabel, d.avg_density_per_100m2 !== null ? d.avg_density_per_100m2.toFixed(2) : 'N/A'],
            ['Best Site/100m\u00B2' + estLabel, d.best_site_density ? d.best_site_density.toFixed(2) : 'N/A'],
            ['Peak Sample/100m\u00B2' + estLabel, d.peak_sample_density ? d.peak_sample_density.toFixed(2) : 'N/A'],
            ['Avg Fish/Sample', d.avg_fish_per_sample !== null ? d.avg_fish_per_sample.toFixed(1) : 'N/A'],
            ['# Samples', d.num_samples ?? 'N/A'],
            ['Years Sampled', d.years_sampled ?? 'N/A'],
            ['First Year', d.first_year ?? 'N/A'],
            ['Last Year', d.last_year ?? 'N/A'],
            ['Species', d.species],
            ['Data Source', d.data_source]
        ];

        stats.innerHTML = items.map(([label, value]) =>
            `<div class="detail-stat"><div class="label">${label}</div><div class="value">${value}</div></div>`
        ).join('');

        const sitesDiv = document.getElementById('detailSites');
        const streamSamples = typeof VA_WV_SAMPLES_DATA !== 'undefined' && VA_WV_SAMPLES_DATA[d.stream_name];
        if (streamSamples && streamSamples.length > 1) {
            const hasDensity = streamSamples.some(s => s.density != null);
            sitesDiv.innerHTML = `
                <div class="samples-heading-row">
                    <h3 style="font-size:0.9rem;color:var(--text-dim);margin:0">Individual Samples (${streamSamples.length})</h3>
                    <button class="btn-expand-samples" id="btnExpandSamples">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>
                        Full screen
                    </button>
                </div>
                <div style="overflow-x:auto">
                <table class="samples-table">
                    <thead><tr>
                        <th>Year</th>
                        <th>Fish Count</th>
                        ${hasDensity ? '<th>Density/100m²</th>' : ''}
                        <th>Source</th>
                    </tr></thead>
                    <tbody>
                        ${streamSamples.map(s => `<tr>
                            <td>${s.year || '-'}</td>
                            <td>${s.fish ?? '-'}</td>
                            ${hasDensity ? `<td>${s.density != null ? s.density.toFixed(2) : '-'}</td>` : ''}
                            <td>${s.src || '-'}</td>
                        </tr>`).join('')}
                    </tbody>
                </table>
                </div>`;
            document.getElementById('btnExpandSamples').addEventListener('click', () =>
                openSamplesModal(d.stream_name, streamSamples, {hasDensity, hasYOY: false, hasWidth: false})
            );
        } else {
            sitesDiv.innerHTML = '';
        }

        const notes = document.getElementById('detailNotes');
        notes.textContent = d.notes || '';

        streamDetail.style.display = 'block';
        streamDetail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

        renderTable();
        renderMapMarkers();

        if (d.latitude && d.longitude) {
            map.setView([d.latitude, d.longitude], 13);
        }
    }

    // ── Stats ──
    function updateStats() {
        document.getElementById('totalStreams').textContent = VA_WV_MASTER_DATA.length.toLocaleString();

        const totalSamples = VA_WV_MASTER_DATA.reduce((sum, d) => sum + (d.num_samples || 0), 0);
        document.getElementById('totalSamples').textContent = totalSamples.toLocaleString();

        const years = VA_WV_MASTER_DATA.filter(d => d.first_year && d.last_year);
        const minYear = Math.min(...years.map(d => d.first_year));
        const maxYear = Math.max(...years.map(d => d.last_year));
        document.getElementById('dateRange').textContent = `${minYear}\u2013${maxYear}`;

        const sources = new Set(VA_WV_MASTER_DATA.map(d => d.data_source));
        document.getElementById('dataSources').textContent = sources.size;
    }

    // ── Sorting ──
    function initSorting() {
        document.querySelectorAll('th[data-sort]').forEach(th => {
            th.addEventListener('click', () => {
                const field = th.dataset.sort;
                if (field === 'rank') return;

                if (sortField === field) {
                    sortDir = sortDir === 'asc' ? 'desc' : 'asc';
                } else {
                    sortField = field;
                    sortDir = 'desc';
                }

                document.querySelectorAll('th').forEach(t => t.classList.remove('active', 'asc', 'desc'));
                th.classList.add('active', sortDir);
                applyFilters();
            });
        });
    }

    // ── Controls ──
    function initControls() {
        [stateFilter, regionFilter, sourceFilter, speciesFilter].forEach(el => {
            el.addEventListener('change', applyFilters);
        });
        minSamplesInput.addEventListener('change', applyFilters);
        searchInput.addEventListener('input', applyFilters);
        estimatedFilter.addEventListener('change', applyFilters);
        metricSelect.addEventListener('change', () => {
            const mc = getMetricConfig();
            // If currently sorted by a density field, switch to the new metric's avg field
            if (ALL_DENSITY_FIELDS.includes(sortField)) {
                sortField = mc.avgField;
                sortDir = 'desc';
            }
            updateColumnHeaders();
            applyFilters();
            updateLegend();
        });

        document.getElementById('resetFilters').addEventListener('click', () => {
            stateFilter.value = 'all';
            regionFilter.value = 'all';
            sourceFilter.value = 'all';
            speciesFilter.value = 'all';
            minSamplesInput.value = '1';
            searchInput.value = '';
            estimatedFilter.value = 'show';
            metricSelect.value = 'area';
            selectedStream = null;
            mapHasView = false;
            streamDetail.style.display = 'none';
            sortField = 'avg_density_per_100m2';
            sortDir = 'desc';
            updateColumnHeaders();
            applyFilters();
            updateLegend();
        });

    function updateColumnHeaders() {
        const mc = getMetricConfig();
        const avgTh = document.getElementById('th-avg-density');
        const bestTh = document.getElementById('th-best-density');
        const peakTh = document.getElementById('th-peak-density');
        if (!avgTh) return;
        avgTh.dataset.sort = mc.avgField;
        bestTh.dataset.sort = mc.bestField;
        peakTh.dataset.sort = mc.peakField;
        avgTh.innerHTML = `Avg Density<br><small>${mc.unit}</small>`;
        bestTh.innerHTML = `Best Site<br><small>${mc.unit}</small>`;
        peakTh.innerHTML = `Peak<br><small>${mc.unit}</small>`;
        document.querySelectorAll('th').forEach(t => t.classList.remove('active', 'asc', 'desc'));
        const activeTh = document.querySelector(`th[data-sort="${sortField}"]`);
        if (activeTh) activeTh.classList.add('active', sortDir);
    }

        document.getElementById('closeDetail').addEventListener('click', () => {
            selectedStream = null;
            streamDetail.style.display = 'none';
            renderTable();
            renderMapMarkers();
        });

        document.getElementById('exportCsv').addEventListener('click', exportCsv);
    }

    // ── Export ──
    function exportCsv() {
        const headers = ['Rank', 'Stream', 'State', 'County', 'Region',
            'Avg_Density_per_100m2', 'Best_Site_Density', 'Peak_Sample_Density',
            'Density_Estimated', 'Avg_Fish_per_Sample', 'Samples', 'Years_Sampled',
            'First_Year', 'Last_Year', 'Species', 'Source', 'Latitude', 'Longitude', 'Notes'];

        const rows = filteredData.map((d, i) => [
            i + 1, d.stream_name, d.state, d.county || '', d.region || '',
            d.avg_density_per_100m2, d.best_site_density, d.peak_sample_density,
            d.density_estimated ? 'Yes' : 'No',
            d.avg_fish_per_sample, d.num_samples, d.years_sampled,
            d.first_year, d.last_year, d.species, d.data_source,
            d.latitude, d.longitude, d.notes || ''
        ]);

        const csv = [headers, ...rows].map(r =>
            r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')
        ).join('\n');

        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'ne_trout_stream_density_export.csv';
        a.click();
        URL.revokeObjectURL(url);
    }

    // ── Source Cards ──
    function renderSourceCards() {
        const grid = document.getElementById('sourcesGrid');
        grid.innerHTML = VA_WV_SOURCES.map(s => `
            <div class="source-card">
                <h3>${s.name} <span style="font-size:0.7rem;color:var(--text-dim);font-weight:400">${s.state} &middot; ${s.years}</span></h3>
                <p>${s.description}</p>
                <p style="font-size:0.75rem;color:var(--text-dim);margin-top:0.5rem"><strong>${s.streams}</strong> streams &middot; ${s.method}</p>
                <a href="${s.url}" target="_blank" rel="noopener">View Source &rarr;</a>
            </div>
        `).join('');
    }

    // ── Util ──
    function escHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // ── Samples Modal ──
    function openSamplesModal(streamName, samples, {hasDensity, hasYOY, hasWidth}) {
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

        const hasLengthM = samples.some(s => s.length_m);
        const hasWidthM = samples.some(s => s.width_m || s.width_ft);
        const hasPpkm = samples.some(s => s.ppkm);
        const hasStation = samples.some(s => s.station);
        const hasSp = samples.some(s => s.sp);
        const hasSrc = samples.some(s => s.src);
        const hasElev = samples.some(s => s.elev_ft);

        document.getElementById('samplesModalTitle').textContent = `${streamName} — All Samples (${samples.length})`;
        document.getElementById('samplesModalBody').innerHTML = `
            <table class="samples-table">
                <thead><tr>
                    <th>Date</th>
                    ${hasSp ? '<th>Species</th>' : ''}
                    ${hasStation ? '<th>Station</th>' : ''}
                    <th>Fish Count</th>
                    ${hasDensity ? '<th>Density/100m²</th>' : ''}
                    ${hasPpkm ? '<th>Fish/km</th>' : ''}
                    ${hasLengthM ? '<th>Length (m)</th>' : ''}
                    ${hasWidthM ? '<th>Width (m)</th>' : ''}
                    ${hasElev ? '<th>Elev (ft)</th>' : ''}
                    ${hasSrc ? '<th>Source</th>' : ''}
                </tr></thead>
                <tbody>
                    ${samples.map(s => `<tr>
                        <td>${s.date || s.year || '-'}</td>
                        ${hasSp ? `<td>${s.sp || '-'}</td>` : ''}
                        ${hasStation ? `<td>${s.station || '-'}</td>` : ''}
                        <td>${s.fish ?? '-'}</td>
                        ${hasDensity ? `<td>${s.density != null ? s.density.toFixed(2) : '-'}</td>` : ''}
                        ${hasPpkm ? `<td>${s.ppkm ?? '-'}</td>` : ''}
                        ${hasLengthM ? `<td>${s.length_m ?? '-'}</td>` : ''}
                        ${hasWidthM ? `<td>${s.width_m ?? s.width_ft ?? '-'}</td>` : ''}
                        ${hasElev ? `<td>${s.elev_ft ?? '-'}</td>` : ''}
                        ${hasSrc ? `<td>${s.src || '-'}</td>` : ''}
                    </tr>`).join('')}
                </tbody>
            </table>`;
        overlay.classList.add('open');
    }

    // ── Boot ──
    document.addEventListener('DOMContentLoaded', init);
})();
