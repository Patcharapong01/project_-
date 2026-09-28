// Global variable to store BOM and Production Model data for quick lookups
let bomLookupMap = {};
let productionModelLookupMap = {};

let selectedFile = null;
let extractedDataItems = [];
let currentMetadata = null;
let savedDocuments = [];

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// Helper function to clean product IDs/SAP numbers for matching
function cleanProductId(id) {
    if (id === null || id === undefined) return '';
    return String(id).trim().replace(/^0+/, ''); // Remove leading zeros, e.g., "00123" -> "123"
}

// Function to load and parse BOM data from CSV
async function loadBomData() {
    const candidateUrls = [
        '/Project01 - Ex.BOM.csv',
        'Project01 - Ex.BOM.csv',
        '/NEWBOM.csv',
        'NEWBOM.csv',
        '/NEWBOM - สำเนาของ สำเนาของ Ex.BOM.csv'
    ];

    for (const url of candidateUrls) {
        try {
            const response = await fetch(url);
            if (!response.ok) continue;
            const csvText = await response.text();
            if (!csvText || !csvText.trim()) continue;

            const lines = csvText.split(/\r?\n/).filter(line => line.trim().length > 0);
            if (lines.length < 2) continue;

            const headers = lines[0].split(',').map(header => header.trim().replace(/^["']|["']$/g, ''));
            const productIdIndex = headers.indexOf('Product ID');
            const bomDescriptionIndex = headers.indexOf('BoM Description');

            if (productIdIndex === -1 || bomDescriptionIndex === -1) {
                console.warn('BOM CSV missing required columns in:', url);
                continue;
            }

            bomLookupMap = {};
            for (let i = 1; i < lines.length; i++) {
                const values = lines[i].split(',').map(value => value.trim().replace(/^["']|["']$/g, ''));
                const rawProductId = values[productIdIndex];
                const brand = values[bomDescriptionIndex];

                if (rawProductId && brand) {
                    const cleanedId = cleanProductId(rawProductId);
                    bomLookupMap[cleanedId] = brand;
                }
            }
            console.log('BOM data loaded successfully:', bomLookupMap);
            return;
        } catch (error) {
            console.warn(`Error loading BOM data from ${url}:`, error);
        }
    }
    console.warn('Could not load BOM data from candidate URLs.');
}

// Function to load and parse Production Model data from CSV
async function loadProductionModelData() {
    const candidateUrls = [
        '/Project01 - Ex.Production Model.csv',
        'Project01 - Ex.Production Model.csv',
        '/Project01%20-%20Ex.Production%20Model.csv'
    ];

    for (const url of candidateUrls) {
        try {
            const response = await fetch(url);
            if (!response.ok) continue;
            const csvText = await response.text();
            if (!csvText || !csvText.trim()) continue;

            const lines = csvText.split(/\r?\n/).filter(line => line.trim().length > 0);
            if (lines.length < 2) continue;

            const headers = lines[0].split(',').map(header => header.trim().replace(/^["']|["']$/g, ''));
            const productIdIndex = headers.indexOf('Product ID');
            const modelDescIndex = headers.indexOf('Production Model Description');
            const modelIdIndex = headers.indexOf('Production Model ID');

            if (productIdIndex === -1 || modelDescIndex === -1) {
                console.warn('Production Model CSV missing required columns in:', url);
                continue;
            }

            productionModelLookupMap = {};
            for (let i = 1; i < lines.length; i++) {
                const values = lines[i].split(',').map(value => value.trim().replace(/^["']|["']$/g, ''));
                const rawProductId = values[productIdIndex];
                const modelDesc = values[modelDescIndex];
                const modelId = modelIdIndex !== -1 ? values[modelIdIndex] : '';

                if (rawProductId && modelDesc) {
                    const cleanedId = cleanProductId(rawProductId);
                    if (!productionModelLookupMap[cleanedId]) {
                        productionModelLookupMap[cleanedId] = [];
                    }
                    productionModelLookupMap[cleanedId].push({
                        id: modelId,
                        desc: modelDesc
                    });
                }
            }
            console.log('Production Model data loaded successfully:', Object.keys(productionModelLookupMap).length, 'products');
            return;
        } catch (error) {
            console.warn(`Error loading Production Model data from ${url}:`, error);
        }
    }
    console.warn('Could not load Production Model data from candidate URLs.');
}

// Helper function to enrich an item's description with its Brand from BOM and Production Models
function enrichItemDescription(item) {
    let baseDesc = item.rawDescription || item.description || '';
    // Strip existing brand suffix if re-evaluating
    const suffixRegex = /\s*-\s*(Brand\s+[A-Za-z0-9]+|ไม่พบ Brand|ไม่มี Brand|ไม่มีbrand)$/i;
    baseDesc = baseDesc.replace(suffixRegex, '').trim();

    item.rawDescription = baseDesc;
    item.description = baseDesc;
    const cleanedSapNo = cleanProductId(item.sapNo);
    const rawBom = bomLookupMap[cleanedSapNo];
    const models = productionModelLookupMap[cleanedSapNo] || [];

    if (rawBom && rawBom.trim()) {
        item.bom = rawBom.trim();
        item.brand = rawBom.trim();
    } else {
        item.bom = '';
        item.brand = '';
    }

    item.productionModels = models;

    return item;
}

// Function to enrich and sync Brand for all items: If SAP PO matches, assign the same Brand
function enrichAllItems(items) {
    if (!Array.isArray(items)) return [];

    // Step 1: Initial enrichment per item based on its SAP NO
    items.forEach(item => enrichItemDescription(item));

    // Step 2: Build SAP PO to Brand mapping (look for any resolved Brand in the same SAP PO group)
    const poBrandMap = {};
    items.forEach(item => {
        const po = String(item.sapPo || '').trim();
        if (po && item.bom && item.bom.trim()) {
            if (!poBrandMap[po]) {
                poBrandMap[po] = item.bom.trim();
            }
        }
    });

    // Step 3: Synchronize Brand & BOM status for all items with matching SAP PO
    items.forEach(item => {
        const po = String(item.sapPo || '').trim();
        if (po && poBrandMap[po]) {
            item.brand = poBrandMap[po];
            item.bom = poBrandMap[po];
        } else {
            item.brand = item.bom || '';
        }
    });

    return items;
}

function getModelBadge(modelDesc, modelId = '') {
    const d = (modelDesc || '').toLowerCase();
    let colorClass = 'bg-sky-50 dark:bg-sky-950/70 text-sky-700 dark:text-sky-300 border-sky-200/90 dark:border-sky-800/90';
    let iconName = 'layers';

    if (d.includes('inspection') || d.includes('assembly')) {
        colorClass = 'bg-purple-50 dark:bg-purple-950/70 text-purple-700 dark:text-purple-300 border-purple-200/90 dark:border-purple-800/90';
        iconName = 'check-square';
    } else if (d.includes('stk') || d.includes('ctn') || d.includes('change code')) {
        colorClass = 'bg-amber-50 dark:bg-amber-950/70 text-amber-700 dark:text-amber-300 border-amber-200/90 dark:border-amber-800/90';
        iconName = 'package-search';
    } else if (d.includes('direct')) {
        colorClass = 'bg-emerald-50 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300 border-emerald-200/90 dark:border-emerald-800/90';
        iconName = 'send';
    }

    return `
        <div class="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium border ${colorClass} shadow-2xs">
            <i data-lucide="${iconName}" class="w-3.5 h-3.5 shrink-0"></i>
            <span class="font-sans leading-tight">${escapeHtml(modelDesc)}</span>
        </div>
    `;
}

// Global Floating Popover for Production Models
let activePopoverTrigger = null;
function initModelPopover() {
    let popover = document.getElementById('modelFloatingPopover');
    if (!popover) {
        popover = document.createElement('div');
        popover.id = 'modelFloatingPopover';
        popover.className = 'fixed z-[9999] hidden opacity-0 transition-opacity duration-150 pointer-events-none min-w-[280px] max-w-sm bg-white/95 dark:bg-slate-900/95 backdrop-blur-md rounded-2xl p-3.5 shadow-2xl border border-slate-200/90 dark:border-slate-700';
        document.body.appendChild(popover);
    }
    return popover;
}

function showModelPopover(trigger, itemIndex) {
    const item = extractedDataItems[itemIndex];
    if (!item) return;
    const models = item.productionModels || [];
    if (models.length === 0) return;

    const popover = initModelPopover();
    activePopoverTrigger = trigger;

    popover.innerHTML = `
        <div class="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2 mb-2.5">
            <div class="flex items-center gap-1.5">
                <div class="w-5 h-5 rounded-md bg-blue-100 dark:bg-blue-950 text-blue-600 dark:text-cyan-400 flex items-center justify-center">
                    <i data-lucide="layers" class="w-3 h-3"></i>
                </div>
                <span class="text-xs font-bold text-slate-800 dark:text-slate-100 font-sans">โมเดลการผลิต (${models.length})</span>
            </div>
            <span class="text-[11px] font-mono font-extrabold px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-blue-600 dark:text-cyan-400 border border-slate-200 dark:border-slate-700">${escapeHtml(item.sapNo)}</span>
        </div>
        <div class="flex flex-col gap-1.5">
            ${models.map(m => getModelBadge(m.desc, m.id)).join('')}
        </div>
    `;

    safeCreateIcons();

    // Default: place directly BELOW trigger button with 8px spacing
    popover.style.display = 'block';
    popover.style.visibility = 'hidden';
    popover.classList.remove('hidden', 'opacity-100');
    popover.classList.add('opacity-0');

    const triggerRect = trigger.getBoundingClientRect();
    const popHeight = popover.offsetHeight || 170;
    const popWidth = popover.offsetWidth || 280;

    let top = triggerRect.bottom + 8;
    let left = triggerRect.left;

    // If bottom would overflow the viewport screen, place ABOVE trigger button
    if (top + popHeight > window.innerHeight - 12) {
        top = Math.max(12, triggerRect.top - popHeight - 8);
    }

    // Keep within horizontal screen boundaries
    if (left + popWidth > window.innerWidth - 20) {
        left = window.innerWidth - popWidth - 20;
    }
    if (left < 16) {
        left = 16;
    }

    popover.style.top = `${Math.round(top)}px`;
    popover.style.left = `${Math.round(left)}px`;
    popover.style.visibility = 'visible';

    // Smooth fade-in
    requestAnimationFrame(() => {
        popover.classList.remove('opacity-0');
        popover.classList.add('opacity-100');
    });
}

function hideModelPopover() {
    const popover = document.getElementById('modelFloatingPopover');
    if (!popover) return;
    activePopoverTrigger = null;
    popover.classList.remove('opacity-100');
    popover.classList.add('opacity-0');
    setTimeout(() => {
        if (!activePopoverTrigger) {
            popover.classList.add('hidden');
        }
    }, 150);
}

function safeCreateIcons() {
    if (window.lucide && typeof lucide.createIcons === 'function') {
        try {
            lucide.createIcons();
        } catch (e) {
            console.warn('Lucide icon creation warning:', e);
        }
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    const themeToggle = document.getElementById('themeToggle');
    const savedTheme = localStorage.getItem('pl-theme');

    if (savedTheme === 'dark') {
        document.body.classList.add('dark-theme');
        document.documentElement.classList.add('dark');
    }

    function updateThemeToggle() {
        const isDark = document.body.classList.contains('dark-theme');
        document.documentElement.classList.toggle('dark', isDark);
        if (themeToggle) {
            themeToggle.innerHTML = isDark
                ? '<i data-lucide="sun" class="w-4 h-4 text-amber-400"></i>'
                : '<i data-lucide="moon" class="w-4 h-4"></i>';
            themeToggle.title = isDark ? 'เปลี่ยนเป็นโหมดสว่าง' : 'เปลี่ยนเป็นโหมดมืด';
            themeToggle.setAttribute('aria-label', themeToggle.title);
        }
        safeCreateIcons();
    }

    if (themeToggle) {
        themeToggle.addEventListener('click', () => {
            const isDark = document.body.classList.toggle('dark-theme');
            localStorage.setItem('pl-theme', isDark ? 'dark' : 'light');
            updateThemeToggle();
        });
    }

    // Global listener to close popover on scroll/resize
    window.addEventListener('scroll', hideModelPopover, true);
    window.addEventListener('resize', hideModelPopover, true);

    // Render initial icons and theme immediately
    safeCreateIcons();
    updateThemeToggle();

    // Load BOM & Production Model data in background
    await Promise.all([loadBomData(), loadProductionModelData()]);

    const dropZone = document.getElementById('dropZone');
    const fileInput = document.getElementById('fileInput');
    const fileDetails = document.getElementById('fileDetails');
    const fileNameDisplay = document.getElementById('fileName');
    const fileSizeDisplay = document.getElementById('fileSize');
    const cancelBtn = document.getElementById('cancelBtn');
    const processBtn = document.getElementById('processBtn');

    const uploadSection = document.getElementById('uploadSection');
    const statusSection = document.getElementById('statusSection');
    const previewSection = document.getElementById('previewSection');

    const statusText = document.getElementById('statusText');
    const statusSubText = document.getElementById('statusSubText');

    async function loadDocumentHistory() {
        try {
            const response = await fetch('/api/documents');
            const result = await response.json();
            if (!response.ok || !result.success) return;
            savedDocuments = result.documents;
            renderDocumentHistory();
            updateDashboard(currentMetadata, extractedDataItems, savedDocuments.length);
        } catch (error) {
            console.warn('ไม่สามารถโหลดประวัติเอกสารได้', error);
        }
    }

    function renderDocumentHistory() {
        const history = document.getElementById('documentHistory');
        history.innerHTML = '';

        if (savedDocuments.length === 0) {
            history.innerHTML = `
                <div class="p-8 text-center text-xs text-slate-400 flex flex-col items-center gap-2">
                    <i data-lucide="inbox" class="w-8 h-8 text-slate-300 dark:text-slate-600 stroke-[1.5]"></i>
                    <span>ยังไม่มีเอกสารที่บันทึกไว้</span>
                </div>
            `;
            safeCreateIcons();
            return;
        }

        savedDocuments.slice().reverse().forEach(metadata => {
            const row = document.createElement('div');
            row.className = 'p-3.5 sm:p-4 flex flex-wrap items-center justify-between gap-3 hover:bg-blue-50/40 dark:hover:bg-slate-800/60 transition-all border-b border-slate-100 dark:border-slate-800/60 last:border-0 group';

            const details = document.createElement('div');
            details.className = 'min-w-0 flex-1';
            
            const name = document.createElement('p');
            name.className = 'text-xs font-bold text-slate-800 dark:text-slate-200 truncate font-mono group-hover:text-blue-600 dark:group-hover:text-cyan-400 transition-colors';
            name.textContent = metadata.originalName;
            
            const info = document.createElement('p');
            info.className = 'text-[11px] text-slate-400 dark:text-slate-500 mt-1 font-mono flex items-center gap-1.5';
            info.innerHTML = `<span class="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 text-[10px] font-bold">${metadata.documentId}</span> <span>${new Date(metadata.confirmedTimestamp || metadata.uploadTimestamp).toLocaleDateString('th-TH')}</span>`;
            
            details.append(name, info);

            const openButton = document.createElement('button');
            openButton.type = 'button';
            openButton.className = 'px-2.5 py-1.5 text-[11px] font-semibold text-blue-600 dark:text-cyan-400 bg-blue-50 dark:bg-blue-950/70 border border-blue-200/80 dark:border-blue-900 hover:bg-blue-600 hover:text-white dark:hover:bg-cyan-500 dark:hover:text-slate-950 rounded-xl transition-all shadow-2xs flex items-center gap-1';
            openButton.innerHTML = '<i data-lucide="eye" class="w-3 h-3"></i> ดูข้อมูล';
            openButton.dataset.documentId = metadata.documentId;

            const pdfLink = document.createElement('a');
            pdfLink.className = 'px-2.5 py-1.5 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/70 border border-emerald-200/80 dark:border-emerald-900 hover:bg-emerald-600 hover:text-white dark:hover:bg-emerald-500 dark:hover:text-slate-950 rounded-xl transition-all shadow-2xs flex items-center gap-1';
            pdfLink.innerHTML = '<i data-lucide="file-text" class="w-3 h-3"></i> PDF';
            pdfLink.href = `/api/documents/${encodeURIComponent(metadata.documentId)}/file`;
            pdfLink.target = '_blank';
            pdfLink.rel = 'noopener';

            const actions = document.createElement('div');
            actions.className = 'flex items-center gap-1.5 shrink-0';
            actions.append(openButton, pdfLink);
            row.append(details, actions);
            history.appendChild(row);
        });

        safeCreateIcons();
    }

    async function restoreLatestDocument() {
        let latestDocument = null;

        try {
            const response = await fetch('/api/documents/latest');
            const result = await response.json();
            if (response.ok && result.success && result.document) {
                latestDocument = result.document;
            }
        } catch (error) {
            console.warn('ไม่สามารถโหลดเอกสารล่าสุดได้', error);
        }

        const savedDraft = localStorage.getItem('pl-current-document');
        if (savedDraft) {
            try {
                const draftDocument = JSON.parse(savedDraft);
                const serverTime = latestDocument ? new Date(latestDocument.metadata.uploadTimestamp).getTime() : 0;
                const draftTime = new Date(draftDocument.metadata.uploadTimestamp).getTime();
                if (!latestDocument || draftTime >= serverTime) {
                    renderPreview(draftDocument.metadata, draftDocument.items);
                    return;
                }
            } catch (error) {
                localStorage.removeItem('pl-current-document');
            }
        }

        if (latestDocument) {
            renderPreview(latestDocument.metadata, latestDocument.items);
        }
    }

    async function restoreRequestedDocument() {
        const documentId = new URLSearchParams(window.location.search).get('documentId');
        if (!documentId) {
            restoreLatestDocument();
            return;
        }

        try {
            const response = await fetch(`/api/documents/${encodeURIComponent(documentId)}`);
            const result = await response.json();
            if (response.ok && result.success) {
                renderPreview(result.document.metadata, result.document.items, true);
                document.getElementById('extractedDataSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
                return;
            }
        } catch (error) {
            console.warn('ไม่สามารถโหลดเอกสารที่เลือกได้', error);
        }

        restoreLatestDocument();
    }

    function updateDashboard(metadata, items, documentCount = metadata ? 1 : 0) {
        const totalItems = items.length;
        const completeItems = items.filter(item => item.status === 'COMPLETE').length;
        const totalQuantity = items.reduce((sum, item) => {
            const quantity = Number(String(item.totalQty || '').replace(/,/g, ''));
            return sum + (Number.isFinite(quantity) ? quantity : 0);
        }, 0);
        const completeRate = totalItems ? Math.round((completeItems / totalItems) * 100) : 0;

        document.getElementById('dashboardDocuments').textContent = String(documentCount);
        document.getElementById('dashboardDocumentName').textContent = metadata
            ? (documentCount ? metadata.originalName : `ฉบับร่าง: ${metadata.originalName}`)
            : 'รอการอัปโหลด';
        document.getElementById('dashboardItems').textContent = totalItems.toLocaleString('th-TH');
        document.getElementById('dashboardComplete').textContent = completeItems.toLocaleString('th-TH');
        document.getElementById('dashboardCompleteRate').textContent = `${completeRate}% ของรายการทั้งหมด`;
        document.getElementById('dashboardQuantity').textContent = totalQuantity.toLocaleString('th-TH');

        const dashboardStatus = document.getElementById('dashboardStatus');
        dashboardStatus.innerHTML = metadata
            ? '<span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> พร้อมใช้งาน'
            : '<span class="w-1.5 h-1.5 rounded-full bg-slate-400"></span> ยังไม่มีเอกสาร';
        dashboardStatus.className = metadata
            ? 'inline-flex items-center gap-1.5 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 text-xs px-3 py-1 rounded-full font-medium shadow-sm'
            : 'inline-flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 text-xs px-3 py-1 rounded-full font-medium shadow-sm';
    }

    updateDashboard(null, [], 0);
    restoreRequestedDocument();
    loadDocumentHistory();

    document.getElementById('refreshHistoryBtn').addEventListener('click', loadDocumentHistory);
    document.getElementById('documentHistory').addEventListener('click', async (event) => {
        const button = event.target.closest('[data-document-id]');
        if (!button) return;

        const response = await fetch(`/api/documents/${encodeURIComponent(button.dataset.documentId)}`);
        const result = await response.json();
        if (response.ok && result.success) {
            renderPreview(result.document.metadata, result.document.items, true);
            document.getElementById('extractedDataSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    });

    document.getElementById('toggleTableBtn').addEventListener('click', () => {
        const tablePanel = document.getElementById('dataTablePanel');
        const toggleButton = document.getElementById('toggleTableBtn');
        const isHidden = tablePanel.classList.toggle('hidden');
        toggleButton.setAttribute('aria-expanded', String(!isHidden));
        toggleButton.innerHTML = isHidden
            ? '<i data-lucide="table-2" class="w-4 h-4"></i> แสดงตาราง'
            : '<i data-lucide="chevron-up" class="w-4 h-4"></i> ซ่อนตาราง';
        safeCreateIcons();
    });

    document.getElementById('newUploadBtn').addEventListener('click', () => {
        currentMetadata = null;
        extractedDataItems = [];
        localStorage.removeItem('pl-current-document');
        resetUploadForm();
        previewSection.classList.add('hidden');
        statusSection.classList.add('hidden');
        uploadSection.classList.remove('hidden');
        updateDashboard(null, [], savedDocuments.length);
        uploadSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    dropZone.addEventListener('click', () => fileInput.click());

    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('border-blue-500', 'bg-blue-50/50');
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('border-blue-500', 'bg-blue-50/50');
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('border-blue-500', 'bg-blue-50/50');
        if (e.dataTransfer.files.length > 0) {
            handleFileSelection(e.dataTransfer.files[0]);
        }
    });

    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleFileSelection(e.target.files[0]);
        }
    });

    function handleFileSelection(file) {
        if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
            Swal.fire({
                icon: 'error',
                title: 'ข้อผิดพลาด',
                text: 'รองรับเฉพาะไฟล์ PDF เท่านั้น',
                confirmButtonColor: '#2563eb'
            });
            return;
        }

        selectedFile = file;
        fileNameDisplay.textContent = file.name;
        fileSizeDisplay.textContent = (file.size / 1024).toFixed(2) + ' KB';
        
        dropZone.classList.add('hidden');
        fileDetails.classList.remove('hidden');
    }

    cancelBtn.addEventListener('click', resetUploadForm);

    function resetUploadForm() {
        selectedFile = null;
        fileInput.value = '';
        fileDetails.classList.add('hidden');
        dropZone.classList.remove('hidden');
    }

    processBtn.addEventListener('click', async () => {
        if (!selectedFile) return;

        uploadSection.classList.add('hidden');
        statusSection.classList.remove('hidden');
        
        updateStatus('กำลังอ่านไฟล์...', 'อ่านไฟล์ PDF และอัปโหลดไปยังระบบ');

        const formData = new FormData();
        formData.append('file', selectedFile);

        try {
            setTimeout(() => updateStatus('Extract ข้อมูล...', 'ค้นหา SAP PO, SAP NO. และรายการสินค้า'), 600);
            setTimeout(() => updateStatus('ตรวจสอบข้อมูล...', 'ตรวจสอบความสมบูรณ์ของค่าที่สกัดได้'), 1200);

            const response = await fetch('/api/upload', {
                method: 'POST',
                body: formData
            });

            const result = await response.json();

            if (!response.ok || !result.success) {
                throw new Error(result.message || 'เกิดข้อผิดพลาดในการประมวลผล');
            }

            renderPreview(result.metadata, result.items, false);

        } catch (error) {
            statusSection.classList.add('hidden');
            uploadSection.classList.remove('hidden');
            
            Swal.fire({
                icon: 'error',
                title: 'ไม่สามารถอ่านข้อมูลได้',
                text: error.message || 'เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์',
                confirmButtonColor: '#2563eb'
            });
        }
    });

    function updateStatus(mainText, subText) {
        statusText.textContent = mainText;
        statusSubText.textContent = subText;
    }

    function renderPreview(metadata, items, showTable = false) {
        statusSection.classList.add('hidden');
        previewSection.classList.remove('hidden');

        const tablePanel = document.getElementById('dataTablePanel');
        const toggleTableButton = document.getElementById('toggleTableBtn');
        tablePanel.classList.toggle('hidden', !showTable);
        toggleTableButton.setAttribute('aria-expanded', String(showTable));
        toggleTableButton.innerHTML = showTable
            ? '<i data-lucide="chevron-up" class="w-4 h-4"></i> ซ่อนตาราง'
            : '<i data-lucide="table-2" class="w-4 h-4"></i> แสดงตาราง';

        document.getElementById('metaDocId').textContent = metadata.documentId;
        document.getElementById('metaFileName').textContent = metadata.originalName;
        document.getElementById('metaUploadTime').textContent = new Date(metadata.uploadTimestamp).toLocaleString('th-TH');
        document.getElementById('metaPageCount').textContent = `${metadata.pageCount || '-'} หน้า / ${metadata.fileSize || '-'}`;
        const incompleteCount = items.filter(item => item.status !== 'COMPLETE' || !item.sapNo || !item.description || !item.totalQty).length;
        const validationSummary = document.getElementById('validationSummary');
        validationSummary.textContent = incompleteCount
            ? `ต้องตรวจทานเพิ่ม ${incompleteCount.toLocaleString('th-TH')} รายการ`
            : 'ข้อมูลสกัดครบถ้วนสมบูรณ์ทุกแถว';
        validationSummary.className = incompleteCount
            ? 'text-xs font-semibold mt-1 text-amber-600 dark:text-amber-400'
            : 'text-xs font-semibold mt-1 text-emerald-600 dark:text-emerald-400';
        const processBadge = document.getElementById('metaProcessType');
        const isOcr = metadata.processType === 'OCR';
        processBadge.innerHTML = isOcr
            ? '<i data-lucide="scan-text" class="w-3 h-3"></i> OCR Engine'
            : '<i data-lucide="check-circle" class="w-3 h-3"></i> Text Layer';
        processBadge.className = isOcr
            ? 'inline-flex items-center gap-1 bg-amber-50 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300 text-[11px] px-2 py-0.5 rounded-md font-semibold font-mono'
            : 'inline-flex items-center gap-1 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 text-[11px] px-2 py-0.5 rounded-md font-semibold font-mono';

        // Enrich items with Brand data from BOM & synchronize by matching SAP PO
        const enrichedItems = enrichAllItems(items.map(item => ({ ...item })));

        extractedDataItems = enrichedItems;
        currentMetadata = metadata;
        document.getElementById('confirmDataBtn').classList.toggle('hidden', Boolean(metadata.confirmedTimestamp));
        localStorage.setItem('pl-current-document', JSON.stringify({ metadata, items: enrichedItems }));
        updateDashboard(metadata, enrichedItems);
        updateBrandFilterOptions();
        buildTableRows();
    }

    function updateBrandFilterOptions() {
        const brandSelect = document.getElementById('filterBrandSelect');
        if (!brandSelect) return;
        const currentVal = brandSelect.value;
        const brandsSet = new Set();
        let hasNoBrand = false;

        extractedDataItems.forEach(item => {
            if (item.brand && item.brand.trim()) {
                brandsSet.add(item.brand.trim());
            } else {
                hasNoBrand = true;
            }
        });

        const sortedBrands = Array.from(brandsSet).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

        let optionsHtml = '<option value="ALL">แบรนด์ทั้งหมด</option>';
        sortedBrands.forEach(brand => {
            optionsHtml += `<option value="${escapeHtml(brand)}">${escapeHtml(brand)}</option>`;
        });
        if (hasNoBrand) {
            optionsHtml += '<option value="NO_BRAND">ไม่มี Brand</option>';
        }

        brandSelect.innerHTML = optionsHtml;
        if (sortedBrands.includes(currentVal) || currentVal === 'NO_BRAND') {
            brandSelect.value = currentVal;
        } else {
            brandSelect.value = 'ALL';
        }
    }

    function getFilteredItems() {
        const searchInput = document.getElementById('tableSearchInput');
        const brandSelect = document.getElementById('filterBrandSelect');
        const bomSelect = document.getElementById('filterBomSelect');
        const modelSelect = document.getElementById('filterModelSelect');

        const query = searchInput ? searchInput.value.trim().toLowerCase() : '';
        const selectedBrand = brandSelect ? brandSelect.value : 'ALL';
        const selectedBom = bomSelect ? bomSelect.value : 'ALL';
        const selectedModel = modelSelect ? modelSelect.value : 'ALL';

        return extractedDataItems.map((item, originalIndex) => ({ item, originalIndex })).filter(({ item }) => {
            // Text Search Filter
            if (query) {
                const po = String(item.sapPo || '').toLowerCase();
                const sapNo = String(item.sapNo || '').toLowerCase();
                const desc = String(item.description || '').toLowerCase();
                const brand = String(item.brand || '').toLowerCase();
                const models = (item.productionModels || []).map(m => (m.desc || '').toLowerCase()).join(' ');

                const matchesQuery = po.includes(query) || sapNo.includes(query) || desc.includes(query) || brand.includes(query) || models.includes(query);
                if (!matchesQuery) return false;
            }

            // Brand Filter
            if (selectedBrand !== 'ALL') {
                if (selectedBrand === 'NO_BRAND') {
                    if (item.brand && item.brand.trim()) return false;
                } else if (item.brand !== selectedBrand) {
                    return false;
                }
            }

            // BOM Filter
            if (selectedBom === 'FOUND') {
                if (!item.bom || !item.bom.trim()) return false;
            } else if (selectedBom === 'NOT_FOUND') {
                if (item.bom && item.bom.trim()) return false;
            }

            // Production Model Filter
            if (selectedModel !== 'ALL') {
                const models = item.productionModels || [];
                if (selectedModel === 'HAS_MODELS' && models.length === 0) return false;
                if (selectedModel === 'NO_MODELS' && models.length > 0) return false;
                if (selectedModel === 'ASSEMBLY' && !models.some(m => /inspection|assembly/i.test(m.desc || ''))) return false;
                if (selectedModel === 'STK_CTN' && !models.some(m => /stk|ctn|change code/i.test(m.desc || ''))) return false;
                if (selectedModel === 'DIRECT' && !models.some(m => /direct/i.test(m.desc || ''))) return false;
            }

            return true;
        });
    }

    function buildTableRows() {
        const tbody = document.getElementById('dataTableBody');
        tbody.innerHTML = '';

        const filtered = getFilteredItems();
        const counterEl = document.getElementById('tableItemCounter');
        if (counterEl) {
            counterEl.textContent = `แสดง ${filtered.length.toLocaleString('th-TH')} / ${extractedDataItems.length.toLocaleString('th-TH')} รายการ`;
        }

        if (extractedDataItems.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="7" class="p-12 text-center text-slate-400 dark:text-slate-500 font-sans">
                        <div class="flex flex-col items-center justify-center gap-2">
                            <i data-lucide="file-question" class="w-8 h-8 text-slate-300 dark:text-slate-600"></i>
                            <span>ไม่พบข้อมูลในเอกสาร PDF นี้ หรือโครงสร้าง PDF อ่านยากเกินไป</span>
                        </div>
                    </td>
                </tr>
            `;
            safeCreateIcons();
            return;
        }

        if (filtered.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="7" class="p-12 text-center text-slate-400 dark:text-slate-500 font-sans">
                        <div class="flex flex-col items-center justify-center gap-2">
                            <i data-lucide="filter-x" class="w-8 h-8 text-slate-300 dark:text-slate-600"></i>
                            <span class="font-medium text-slate-600 dark:text-slate-300">ไม่พบรายการที่ตรงกับเงื่อนไขการกรอง</span>
                            <button type="button" onclick="document.getElementById('resetFiltersBtn').click()" class="text-xs text-blue-600 dark:text-cyan-400 hover:underline">รีเซ็ตตัวกรองทั้งหมด</button>
                        </div>
                    </td>
                </tr>
            `;
            safeCreateIcons();
            return;
        }

        filtered.forEach(({ item, originalIndex }) => {
            const tr = document.createElement('tr');
            tr.className = "hover:bg-blue-50/50 dark:hover:bg-slate-800/60 transition-colors border-b border-slate-100 dark:border-slate-800/80 group";

            // BOM Column Badge: ถ้ามี BOM ให้แสดงป้ายสีเขียว "พบ" (พร้อมไอคอน check-circle) ถ้าไม่มีให้แสดงป้ายสีแดง "ไม่พบ" (พร้อมไอคอน x-circle)
            const hasBom = Boolean(item.bom && item.bom.trim());
            const bomBadge = hasBom
                ? `<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 border border-emerald-200/80 dark:border-emerald-800/80 shadow-2xs whitespace-nowrap"><i data-lucide="check-circle-2" class="w-3.5 h-3.5"></i> พบ</span>`
                : `<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-red-50 dark:bg-red-950/60 text-red-600 dark:text-red-400 border border-red-200/80 dark:border-red-900/60 shadow-2xs whitespace-nowrap"><i data-lucide="x-circle" class="w-3.5 h-3.5"></i> ไม่พบ</span>`;

            // BRAND Column Badge (Synced across same SAP PO)
            const hasBrand = Boolean(item.brand && item.brand.trim());
            const brandBadge = hasBrand
                ? `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold bg-gradient-to-r from-blue-500/10 to-indigo-500/10 dark:from-blue-900/50 dark:to-indigo-900/50 text-blue-700 dark:text-cyan-300 border border-blue-200/80 dark:border-blue-800/80 shadow-2xs whitespace-nowrap"><i data-lucide="tag" class="w-3 h-3 text-blue-500 dark:text-cyan-400"></i> ${escapeHtml(item.brand)}</span>`
                : `<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 border border-slate-200/60 dark:border-slate-700/60 whitespace-nowrap">ไม่มี Brand</span>`;

            const models = item.productionModels || [];
            let productionModelHtml = '';
            if (models.length > 0) {
                productionModelHtml = `
                    <div class="flex items-center gap-2 py-1">
                        <button type="button" 
                                data-model-index="${originalIndex}"
                                class="model-popover-trigger inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-bold font-mono bg-blue-50/90 dark:bg-blue-950/70 text-blue-700 dark:text-cyan-300 border border-blue-200/90 dark:border-blue-800/80 shadow-2xs hover:bg-blue-600 hover:text-white dark:hover:bg-cyan-500 dark:hover:text-slate-950 hover:shadow-md hover:border-blue-500 transition-all cursor-pointer">
                            <i data-lucide="layers" class="w-3.5 h-3.5"></i>
                            <span>+${models.length} Models</span>
                            <i data-lucide="chevron-down" class="w-3 h-3 opacity-60"></i>
                        </button>
                    </div>
                `;
            } else {
                productionModelHtml = `
                    <span class="inline-flex items-center gap-1 text-[11px] text-slate-400 dark:text-slate-500 font-sans italic">
                        <i data-lucide="minus-circle" class="w-3.5 h-3.5 text-slate-300 dark:text-slate-600"></i>
                        <span>-</span>
                    </span>
                `;
            }

            tr.innerHTML = `
                <td class="py-2.5 px-3 text-center text-slate-400 dark:text-slate-500 font-mono text-[11px] font-semibold">${String(originalIndex + 1).padStart(2, '0')}</td>
                <td class="py-1.5 px-2">
                    <input type="text" data-field="sapPo" value="${escapeHtml(item.sapPo)}" placeholder="SAP PO" class="w-full bg-slate-50/50 dark:bg-slate-900/50 focus:bg-white dark:focus:bg-slate-950 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 rounded-lg px-2.5 py-1.5 border border-slate-200/80 dark:border-slate-700/80 font-mono text-xs text-slate-800 dark:text-slate-100 transition-all">
                </td>
                <td class="py-1.5 px-2">
                    <input type="text" data-field="sapNo" value="${escapeHtml(item.sapNo)}" placeholder="SAP NO." class="w-full bg-slate-50/50 dark:bg-slate-900/50 focus:bg-white dark:focus:bg-slate-950 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 rounded-lg px-2.5 py-1.5 border border-slate-200/80 dark:border-slate-700/80 font-mono text-xs text-slate-900 dark:text-slate-50 font-bold transition-all">
                </td>
                <td class="py-1.5 px-2">
                    <input type="text" data-field="description" value="${escapeHtml(item.description)}" placeholder="Description" class="w-full bg-slate-50/50 dark:bg-slate-900/50 focus:bg-white dark:focus:bg-slate-950 focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 rounded-lg px-2.5 py-1.5 border border-slate-200/80 dark:border-slate-700/80 text-xs text-slate-800 dark:text-slate-100 transition-all font-sans">
                </td>
                <td class="py-1.5 px-2 text-center">
                    ${bomBadge}
                </td>
                <td class="py-1.5 px-2 text-center">
                    ${brandBadge}
                </td>
                <td class="py-1.5 px-3">
                    ${productionModelHtml}
                </td>
            `;

            const inputs = tr.querySelectorAll('input');
            inputs.forEach(input => {
                input.addEventListener('change', (e) => {
                    const field = e.target.dataset.field;
                    extractedDataItems[originalIndex][field] = e.target.value;

                    if (field === 'description') {
                        extractedDataItems[originalIndex].rawDescription = e.target.value;
                    }

                    // Re-enrich & synchronize Brands across all items with matching SAP PO
                    enrichAllItems(extractedDataItems);

                    extractedDataItems[originalIndex].editedByUser = true;
                    document.getElementById('confirmDataBtn').classList.remove('hidden');
                    
                    const itemRef = extractedDataItems[originalIndex];
                    if (itemRef.sapPo && itemRef.sapNo && itemRef.description && itemRef.totalQty) {
                        itemRef.status = 'COMPLETE';
                    }
                    updateDashboard(currentMetadata, extractedDataItems);
                    updateBrandFilterOptions();
                    localStorage.setItem('pl-current-document', JSON.stringify({ metadata: currentMetadata, items: extractedDataItems }));
                    buildTableRows();
                });
            });

            const triggerBtn = tr.querySelector('.model-popover-trigger');
            if (triggerBtn) {
                triggerBtn.addEventListener('mouseenter', () => showModelPopover(triggerBtn, originalIndex));
                triggerBtn.addEventListener('mouseleave', hideModelPopover);
                triggerBtn.addEventListener('focus', () => showModelPopover(triggerBtn, originalIndex));
                triggerBtn.addEventListener('blur', hideModelPopover);
            }

            tbody.appendChild(tr);
        });

        safeCreateIcons();
    }

    // Attach Filter Toolbar Event Listeners
    const tableSearchInput = document.getElementById('tableSearchInput');
    if (tableSearchInput) {
        tableSearchInput.addEventListener('input', () => buildTableRows());
    }

    const filterBrandSelect = document.getElementById('filterBrandSelect');
    if (filterBrandSelect) {
        filterBrandSelect.addEventListener('change', () => buildTableRows());
    }

    const filterBomSelect = document.getElementById('filterBomSelect');
    if (filterBomSelect) {
        filterBomSelect.addEventListener('change', () => buildTableRows());
    }

    const filterModelSelect = document.getElementById('filterModelSelect');
    if (filterModelSelect) {
        filterModelSelect.addEventListener('change', () => buildTableRows());
    }

    const resetFiltersBtn = document.getElementById('resetFiltersBtn');
    if (resetFiltersBtn) {
        resetFiltersBtn.addEventListener('click', () => {
            if (tableSearchInput) tableSearchInput.value = '';
            if (filterBrandSelect) filterBrandSelect.value = 'ALL';
            if (filterBomSelect) filterBomSelect.value = 'ALL';
            if (filterModelSelect) filterModelSelect.value = 'ALL';
            buildTableRows();
        });
    }

    document.getElementById('confirmDataBtn').addEventListener('click', async () => {
        const confirmButton = document.getElementById('confirmDataBtn');
        confirmButton.disabled = true;
        confirmButton.classList.add('opacity-60', 'cursor-wait');

        try {
            const response = await fetch('/api/documents', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ metadata: currentMetadata, items: extractedDataItems })
            });
            const result = await response.json();

            if (!response.ok || !result.success) {
                throw new Error(result.message || 'ไม่สามารถบันทึกข้อมูลได้');
            }

            currentMetadata = result.document.metadata;
            localStorage.setItem('pl-current-document', JSON.stringify({ metadata: currentMetadata, items: extractedDataItems }));
            confirmButton.classList.add('hidden');
            resetUploadForm();
            uploadSection.classList.remove('hidden');
            await loadDocumentHistory();
            document.getElementById('dashboardStatus').innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-blue-500"></span> บันทึกข้อมูลแล้ว';
            document.getElementById('dashboardStatus').className = 'inline-flex items-center gap-1.5 bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-900 text-xs px-3 py-1 rounded-full font-medium shadow-sm';
            uploadSection.scrollIntoView({ behavior: 'smooth', block: 'start' });

            await Swal.fire({
                icon: 'success',
                title: 'บันทึกข้อมูลสำเร็จ',
                text: 'ข้อมูลถูกจัดเก็บแล้ว และจะถูกเรียกคืนเมื่อกลับเข้าหน้านี้',
                confirmButtonColor: '#059669'
            });
        } catch (error) {
            Swal.fire({
                icon: 'error',
                title: 'บันทึกข้อมูลไม่สำเร็จ',
                text: error.message,
                confirmButtonColor: '#2563eb'
            });
        } finally {
            confirmButton.disabled = false;
            confirmButton.classList.remove('opacity-60', 'cursor-wait');
        }
    });

    document.getElementById('deleteDataBtn').addEventListener('click', async () => {
        if (!currentMetadata) return;

        const confirmation = await Swal.fire({
            icon: 'warning',
            title: 'ลบเอกสารนี้หรือไม่?',
            text: 'ระบบจะลบข้อมูลที่บันทึกไว้และไฟล์ PDF ด้วย ไม่สามารถย้อนกลับได้',
            showCancelButton: true,
            confirmButtonText: 'ลบข้อมูล',
            cancelButtonText: 'ยกเลิก',
            confirmButtonColor: '#dc2626',
            cancelButtonColor: '#64748b'
        });

        if (!confirmation.isConfirmed) return;

        try {
            const response = await fetch(`/api/documents/${encodeURIComponent(currentMetadata.documentId)}`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ metadata: currentMetadata })
            });
            const result = await response.json();

            if (!response.ok || !result.success) {
                throw new Error(result.message || 'ไม่สามารถลบข้อมูลได้');
            }

            const deletedDocumentId = currentMetadata.documentId;
            localStorage.removeItem('pl-current-document');
            currentMetadata = null;
            extractedDataItems = [];
            savedDocuments = savedDocuments.filter(document => document.documentId !== deletedDocumentId);
            renderDocumentHistory();
            previewSection.classList.add('hidden');
            statusSection.classList.add('hidden');
            uploadSection.classList.remove('hidden');
            resetUploadForm();
            updateDashboard(null, [], savedDocuments.length);

            await Swal.fire({
                icon: 'success',
                title: 'ลบข้อมูลสำเร็จ',
                text: 'ลบข้อมูลและไฟล์ PDF เรียบร้อยแล้ว',
                confirmButtonColor: '#2563eb'
            });
        } catch (error) {
            Swal.fire({
                icon: 'error',
                title: 'ลบข้อมูลไม่สำเร็จ',
                text: error.message,
                confirmButtonColor: '#2563eb'
            });
        }
    });
});
