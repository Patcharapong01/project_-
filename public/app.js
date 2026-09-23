document.addEventListener('DOMContentLoaded', () => {
    const themeToggle = document.getElementById('themeToggle');
    const savedTheme = localStorage.getItem('pl-theme');

    if (savedTheme === 'dark') {
        document.body.classList.add('dark-theme');
        document.documentElement.classList.add('dark');
    }

    function updateThemeToggle() {
        const isDark = document.body.classList.contains('dark-theme');
        document.documentElement.classList.toggle('dark', isDark);
        themeToggle.innerHTML = isDark
            ? '<i data-lucide="sun" class="w-4 h-4 text-amber-400"></i>'
            : '<i data-lucide="moon" class="w-4 h-4"></i>';
        themeToggle.title = isDark ? 'เปลี่ยนเป็นโหมดสว่าง' : 'เปลี่ยนเป็นโหมดมืด';
        themeToggle.setAttribute('aria-label', themeToggle.title);
        lucide.createIcons();
    }

    themeToggle.addEventListener('click', () => {
        const isDark = document.body.classList.toggle('dark-theme');
        localStorage.setItem('pl-theme', isDark ? 'dark' : 'light');
        updateThemeToggle();
    });

    lucide.createIcons();
    updateThemeToggle();

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
            history.innerHTML = '<p class="p-5 text-sm text-slate-400">ยังไม่มีเอกสารที่บันทึกไว้</p>';
            return;
        }

        savedDocuments.slice().reverse().forEach(metadata => {
            const row = document.createElement('div');
            row.className = 'p-3.5 flex flex-wrap items-center justify-between gap-3 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors';

            const details = document.createElement('div');
            details.className = 'min-w-0 flex-1';
            const name = document.createElement('p');
            name.className = 'text-xs font-bold text-slate-800 dark:text-slate-200 truncate font-mono';
            name.textContent = metadata.originalName;
            const info = document.createElement('p');
            info.className = 'text-[11px] text-slate-400 dark:text-slate-500 mt-0.5 font-mono';
            info.textContent = `${metadata.documentId} · ${new Date(metadata.confirmedTimestamp || metadata.uploadTimestamp).toLocaleDateString('th-TH')}`;
            details.append(name, info);

            const openButton = document.createElement('button');
            openButton.type = 'button';
            openButton.className = 'px-2.5 py-1 text-[11px] font-semibold text-blue-600 dark:text-cyan-400 bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-900 hover:bg-blue-100 dark:hover:bg-blue-900 rounded-lg transition-colors';
            openButton.textContent = 'ดูข้อมูล';
            openButton.dataset.documentId = metadata.documentId;

            const pdfLink = document.createElement('a');
            pdfLink.className = 'px-2.5 py-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-900 hover:bg-emerald-100 dark:hover:bg-emerald-900 rounded-lg transition-colors';
            pdfLink.textContent = 'PDF';
            pdfLink.href = `/api/documents/${encodeURIComponent(metadata.documentId)}/file`;
            pdfLink.target = '_blank';
            pdfLink.rel = 'noopener';

            const actions = document.createElement('div');
            actions.className = 'flex items-center gap-1.5 shrink-0';
            actions.append(openButton, pdfLink);
            row.append(details, actions);
            history.appendChild(row);
        });
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
        lucide.createIcons();
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

        extractedDataItems = items;
        currentMetadata = metadata;
        document.getElementById('confirmDataBtn').classList.toggle('hidden', Boolean(metadata.confirmedTimestamp));
        localStorage.setItem('pl-current-document', JSON.stringify({ metadata, items }));
        updateDashboard(metadata, items);
        buildTableRows();
    }

    function buildTableRows() {
        const tbody = document.getElementById('dataTableBody');
        tbody.innerHTML = '';

        if (extractedDataItems.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="4" class="p-8 text-center text-slate-400 dark:text-slate-500 font-sans">
                        ไม่พบข้อมูลในเอกสาร PDF นี้ หรือโครงสร้าง PDF อ่านยากเกินไป
                    </td>
                </tr>
            `;
            return;
        }

        extractedDataItems.forEach((item, index) => {
            const tr = document.createElement('tr');
            tr.className = "hover:bg-blue-50/40 dark:hover:bg-slate-800/60 transition-colors border-b border-slate-100 dark:border-slate-800/80 group";

            tr.innerHTML = `
                <td class="py-2 px-3 text-center text-slate-400 dark:text-slate-500 font-mono text-[11px]">${String(index + 1).padStart(2, '0')}</td>
                <td class="py-1 px-2"><input type="text" data-field="sapPo" value="${escapeHtml(item.sapPo)}" class="w-full bg-transparent focus:bg-white dark:focus:bg-slate-950 focus:ring-1 focus:ring-blue-500 rounded px-2 py-1 border border-transparent hover:border-slate-300 dark:hover:border-slate-700 focus:border-blue-500 font-mono text-xs text-slate-800 dark:text-slate-100 transition-all"></td>
                <td class="py-1 px-2"><input type="text" data-field="sapNo" value="${escapeHtml(item.sapNo)}" class="w-full bg-transparent focus:bg-white dark:focus:bg-slate-950 focus:ring-1 focus:ring-blue-500 rounded px-2 py-1 border border-transparent hover:border-slate-300 dark:hover:border-slate-700 focus:border-blue-500 font-mono text-xs text-slate-800 dark:text-slate-100 transition-all font-semibold"></td>
                <td class="py-1 px-2"><input type="text" data-field="description" value="${escapeHtml(item.description)}" class="w-full bg-transparent focus:bg-white dark:focus:bg-slate-950 focus:ring-1 focus:ring-blue-500 rounded px-2 py-1 border border-transparent hover:border-slate-300 dark:hover:border-slate-700 focus:border-blue-500 text-xs text-slate-800 dark:text-slate-100 transition-all"></td>
            `;

            const inputs = tr.querySelectorAll('input');
            inputs.forEach(input => {
                input.addEventListener('change', (e) => {
                    const field = e.target.dataset.field;
                    extractedDataItems[index][field] = e.target.value;
                    extractedDataItems[index].editedByUser = true;
                    document.getElementById('confirmDataBtn').classList.remove('hidden');
                    
                    const itemRef = extractedDataItems[index];
                    if (itemRef.sapPo && itemRef.sapNo && itemRef.description && itemRef.totalQty) {
                        itemRef.status = 'COMPLETE';
                    }
                    updateDashboard(currentMetadata, extractedDataItems);
                    localStorage.setItem('pl-current-document', JSON.stringify({ metadata: currentMetadata, items: extractedDataItems }));
                    buildTableRows();
                });
            });

            tbody.appendChild(tr);
        });

        lucide.createIcons();
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
